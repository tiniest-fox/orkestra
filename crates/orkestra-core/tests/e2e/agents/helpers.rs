//! Shared infrastructure for real-agent e2e tests.
//!
//! Provides `AgentTestEnv` — a test environment that uses real process spawners
//! (Claude Code, `OpenCode`) instead of mocks. Tests using this require the actual
//! CLI tools installed and API keys configured.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::{
    config::{IntegrationConfig, StageCapabilities, StageConfig, WorkflowConfig},
    domain::{LogEntry, Question, StageSession, Task},
    runtime::TaskState,
    Git2GitService, GitService, OrchestratorLoop, SqliteWorkflowStore, StageExecutionService,
    WorkflowApi,
};
use orkestra_core::MockTitleGenerator;
use tempfile::TempDir;

/// Test environment with real agent spawners (no mocks).
///
/// Unlike `TestEnv` (which uses `MockAgentRunner`), this environment uses
/// `StageExecutionService::new()` which registers real `ClaudeProcessSpawner`
/// and `OpenCodeProcessSpawner`. Tests require actual CLI tools + API keys.
pub struct AgentTestEnv {
    api: Arc<Mutex<WorkflowApi>>,
    orchestrator: OrchestratorLoop,
    temp_dir: TempDir,
}

impl AgentTestEnv {
    /// Create a test environment for a specific model with default capabilities.
    ///
    /// Sets up a single "work" stage workflow using the given model string
    /// (e.g., `"opencode/kimi-k2.5-free"`, `"claudecode/sonnet"`).
    pub fn new(model: &str) -> Self {
        Self::with_capabilities(
            model,
            StageCapabilities::default(),
            "You are a worker agent. Complete the task described below.",
        )
    }

    /// Create a test environment with custom stage capabilities and prompt.
    ///
    /// Builds a single "work" stage workflow with the given capabilities and
    /// writes the prompt content to `.orkestra/agents/worker.md`.
    pub fn with_capabilities(model: &str, capabilities: StageCapabilities, prompt: &str) -> Self {
        use orkestra_core::testutil::create_temp_git_repo;

        let temp_dir = create_temp_git_repo().expect("create temp git repo");

        // Create .orkestra directory structure + agent prompt file
        let orkestra_dir = temp_dir.path().join(".orkestra");
        std::fs::create_dir_all(orkestra_dir.join(".database")).unwrap();
        std::fs::create_dir_all(orkestra_dir.join("agents")).unwrap();

        // Initialize debug logging so ORKESTRA_DEBUG=1 works in tests
        orkestra_core::debug_log::init(&orkestra_dir);
        println!(
            "Debug log: {}",
            orkestra_dir.join(".logs/debug.log").display()
        );
        std::fs::write(orkestra_dir.join("agents/worker.md"), prompt).unwrap();

        // Allow OpenCode full permissions so it doesn't prompt interactively
        // for external_directory access when writing to temp worktree paths.
        std::fs::write(
            temp_dir.path().join("opencode.json"),
            r#"{"permission": "allow"}"#,
        )
        .unwrap();

        // Build and save workflow config
        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "result")
            .with_prompt("worker.md")
            .with_model(model)
            .with_capabilities(capabilities)])
        .with_integration(IntegrationConfig::new("work"));

        let workflow_path = orkestra_dir.join("workflow.yaml");
        std::fs::write(&workflow_path, serde_yaml::to_string(&workflow).unwrap()).unwrap();
        let loaded_workflow =
            orkestra_core::workflow::config::load_workflow(&workflow_path).expect("load workflow");

        // Real SQLite database
        let db_path = orkestra_dir.join(".database/orkestra.db");
        let db_conn = DatabaseConnection::open(&db_path).expect("open database");
        let store: Arc<dyn orkestra_core::workflow::WorkflowStore> =
            Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

        // Git service
        let git_service: Arc<dyn GitService> =
            Arc::new(Git2GitService::new(temp_dir.path()).expect("git service"));

        let api = Arc::new(Mutex::new(
            WorkflowApi::with_git(
                loaded_workflow.clone(),
                Arc::new(SqliteWorkflowStore::new(db_conn.shared())),
                git_service,
            )
            .with_title_generator(Arc::new(MockTitleGenerator::succeeding())),
        ));

        let project_root = PathBuf::from(temp_dir.path());
        let iteration_service = api.lock().unwrap().iteration_service().clone();

        // Real stage executor — registers both ClaudeProcessSpawner and OpenCodeProcessSpawner
        let stage_executor = Arc::new(StageExecutionService::new(
            loaded_workflow,
            project_root,
            store,
            iteration_service,
        ));

        let orchestrator = OrchestratorLoop::new(api.clone(), stage_executor);

        Self {
            api,
            orchestrator,
            temp_dir,
        }
    }

    /// Print the debug log contents to stdout for test diagnostics.
    fn dump_debug_log(&self) {
        let log_path = self.temp_dir.path().join(".orkestra/.logs/debug.log");
        if let Ok(contents) = std::fs::read_to_string(&log_path) {
            println!("\n=== DEBUG LOG ({}) ===", log_path.display());
            for line in contents.lines() {
                println!("{line}");
            }
            println!("=== END DEBUG LOG ===\n");
        } else {
            println!("No debug log found at {}", log_path.display());
        }
    }

    /// Create a task and wait for worktree setup to complete.
    ///
    /// Returns the task ID. Panics if setup doesn't complete within 10 seconds.
    pub fn create_task(&self, title: &str, description: &str) -> String {
        let task = self
            .api
            .lock()
            .unwrap()
            .create_task(title, description, None)
            .expect("create task");
        let task_id = task.id.clone();

        let start = Instant::now();
        let timeout = Duration::from_secs(10);
        loop {
            std::thread::sleep(Duration::from_millis(50));
            let t = self
                .api
                .lock()
                .unwrap()
                .get_task(&task_id)
                .expect("get task");
            if !matches!(
                t.state,
                TaskState::AwaitingSetup { .. } | TaskState::SettingUp { .. }
            ) {
                println!("Task setup complete: state={:?}", t.state);
                return task_id;
            }
            assert!(
                start.elapsed() <= timeout,
                "Task setup did not complete in time"
            );
        }
    }

    /// Tick the orchestrator until the task reaches `AwaitingReview`.
    ///
    /// Prints progress every tick. Panics on timeout or task failure.
    pub fn run_to_completion(&self, task_id: &str, timeout: Duration) -> Task {
        println!("Starting orchestrator ticks...");
        let start = Instant::now();

        loop {
            self.orchestrator.tick().expect("tick should succeed");
            std::thread::sleep(Duration::from_millis(200));

            let t = self
                .api
                .lock()
                .unwrap()
                .get_task(task_id)
                .expect("get task");
            println!(
                "  [{:.1}s] state={:?} stage={:?}",
                start.elapsed().as_secs_f64(),
                t.state,
                t.current_stage()
            );

            if matches!(t.state, TaskState::AwaitingApproval { .. }) {
                println!("Task reached AwaitingApproval!");
                return t;
            }

            if matches!(t.state, TaskState::Failed { .. }) {
                panic!("Task failed: {:?}", t.state);
            }

            if start.elapsed() > timeout {
                self.dump_debug_log();
                panic!(
                    "Timed out after {:.0}s waiting for task completion (state={:?})",
                    timeout.as_secs_f64(),
                    t.state
                );
            }
        }
    }

    /// Tick the orchestrator until the task reaches `Failed` status.
    ///
    /// Returns the failure reason. Panics on timeout or if the task succeeds unexpectedly.
    pub fn run_to_failure(&self, task_id: &str, timeout: Duration) -> String {
        println!("Starting orchestrator ticks (expecting failure)...");
        let start = Instant::now();

        loop {
            self.orchestrator.tick().expect("tick should succeed");
            std::thread::sleep(Duration::from_millis(200));

            let t = self
                .api
                .lock()
                .unwrap()
                .get_task(task_id)
                .expect("get task");
            println!(
                "  [{:.1}s] state={:?} stage={:?}",
                start.elapsed().as_secs_f64(),
                t.state,
                t.current_stage()
            );

            if let TaskState::Failed { error, .. } = &t.state {
                let msg = error
                    .clone()
                    .unwrap_or_else(|| "unknown failure".to_string());
                println!("Task failed as expected: {msg}");
                return msg;
            }

            if matches!(t.state, TaskState::AwaitingApproval { .. }) {
                self.dump_debug_log();
                panic!("Task succeeded unexpectedly — expected failure");
            }

            if start.elapsed() > timeout {
                self.dump_debug_log();
                panic!(
                    "Timed out after {:.0}s waiting for task failure (state={:?})",
                    timeout.as_secs_f64(),
                    t.state
                );
            }
        }
    }

    /// Assert that log entries were persisted for the given stage.
    ///
    /// Checks that at least one `Text` or `ToolUse` entry exists.
    pub fn assert_has_logs(&self, task_id: &str, stage: &str) {
        let logs = self
            .api
            .lock()
            .unwrap()
            .get_task_logs(task_id, Some(stage), None)
            .expect("get logs");

        let text_count = logs
            .iter()
            .filter(|e| matches!(e, LogEntry::Text { .. }))
            .count();
        let tool_use_count = logs
            .iter()
            .filter(|e| matches!(e, LogEntry::ToolUse { .. }))
            .count();

        println!(
            "Logs for {stage}: {} entries (text: {text_count}, tool_use: {tool_use_count})",
            logs.len()
        );

        assert!(!logs.is_empty(), "Should have persisted log entries");
        assert!(
            text_count > 0 || tool_use_count > 0,
            "Should have at least one text or tool_use log entry"
        );
    }

    /// Reject the current work with feedback, sending the task back to Idle.
    pub fn reject(&self, task_id: &str, feedback: &str) {
        self.api
            .lock()
            .unwrap()
            .reject(task_id, feedback)
            .expect("reject should succeed");
        println!("Rejected task {task_id} with feedback: {feedback}");
    }

    /// Clear the `claude_session_id` for a stage session.
    ///
    /// Simulates a crash before the provider's session ID was extracted.
    /// The session keeps its `spawn_count`, so the next spawn would normally
    /// try to resume — but with no session ID, it must start fresh.
    pub fn clear_session_id(&self, task_id: &str, stage: &str) {
        self.api
            .lock()
            .unwrap()
            .clear_session_id(task_id, stage)
            .expect("clear_session_id should succeed");
    }

    /// Get the stage session for a task+stage. Panics if not found.
    pub fn get_stage_session(&self, task_id: &str, stage: &str) -> StageSession {
        self.api
            .lock()
            .unwrap()
            .get_stage_session(task_id, stage)
            .expect("get_stage_session should succeed")
            .unwrap_or_else(|| panic!("No stage session found for {task_id}/{stage}"))
    }

    /// Get all log entries for a task+stage.
    pub fn get_logs(&self, task_id: &str, stage: &str) -> Vec<LogEntry> {
        self.api
            .lock()
            .unwrap()
            .get_task_logs(task_id, Some(stage), None)
            .expect("get_task_logs should succeed")
    }

    /// Get the number of log entries for a task+stage.
    pub fn get_log_count(&self, task_id: &str, stage: &str) -> usize {
        self.api
            .lock()
            .unwrap()
            .get_task_logs(task_id, Some(stage), None)
            .expect("get_task_logs should succeed")
            .len()
    }

    /// Assert that a named artifact was stored and is non-empty.
    pub fn assert_has_artifact(&self, task_id: &str, artifact_name: &str) {
        let artifact = self
            .api
            .lock()
            .unwrap()
            .get_artifact(task_id, artifact_name)
            .expect("get artifact");

        println!(
            "Artifact '{artifact_name}': {:?}",
            artifact.as_ref().map(|a| &a.content)
        );

        assert!(
            artifact.is_some(),
            "Should have stored a '{artifact_name}' artifact"
        );
        assert!(
            !artifact.unwrap().content.is_empty(),
            "Artifact '{artifact_name}' content should not be empty"
        );
    }

    /// Get the full task state.
    #[allow(dead_code)]
    pub fn get_task(&self, task_id: &str) -> Task {
        self.api
            .lock()
            .unwrap()
            .get_task(task_id)
            .expect("get task")
    }

    /// Get pending questions for a task.
    pub fn get_pending_questions(&self, task_id: &str) -> Vec<Question> {
        self.api
            .lock()
            .unwrap()
            .get_pending_questions(task_id)
            .expect("get_pending_questions should succeed")
    }

    /// Assert that the task has pending questions and return them.
    pub fn assert_has_questions(&self, task_id: &str) -> Vec<Question> {
        let questions = self.get_pending_questions(task_id);
        println!("Questions: {} total", questions.len());
        for (i, q) in questions.iter().enumerate() {
            println!(
                "  Q{}: {:?} ({} options)",
                i + 1,
                q.question,
                q.options.len()
            );
        }
        assert!(!questions.is_empty(), "Should have pending questions");
        questions
    }

    /// Tick the orchestrator until the task reaches `Blocked` status.
    ///
    /// Returns the blocked reason. Panics on timeout, failure, or unexpected success.
    pub fn run_to_blocked(&self, task_id: &str, timeout: Duration) -> String {
        println!("Starting orchestrator ticks (expecting blocked)...");
        let start = Instant::now();

        loop {
            self.orchestrator.tick().expect("tick should succeed");
            std::thread::sleep(Duration::from_millis(200));

            let t = self
                .api
                .lock()
                .unwrap()
                .get_task(task_id)
                .expect("get task");
            println!(
                "  [{:.1}s] state={:?} stage={:?}",
                start.elapsed().as_secs_f64(),
                t.state,
                t.current_stage()
            );

            if let TaskState::Blocked { reason, .. } = &t.state {
                let msg = reason
                    .clone()
                    .unwrap_or_else(|| "unknown block reason".to_string());
                println!("Task blocked as expected: {msg}");
                return msg;
            }

            if let TaskState::Failed { error, .. } = &t.state {
                self.dump_debug_log();
                panic!("Task failed unexpectedly — expected blocked. Error: {error:?}");
            }

            if matches!(t.state, TaskState::AwaitingApproval { .. }) {
                self.dump_debug_log();
                panic!("Task succeeded unexpectedly — expected blocked");
            }

            if start.elapsed() > timeout {
                self.dump_debug_log();
                panic!(
                    "Timed out after {:.0}s waiting for task to be blocked (state={:?})",
                    timeout.as_secs_f64(),
                    t.state
                );
            }
        }
    }
}
