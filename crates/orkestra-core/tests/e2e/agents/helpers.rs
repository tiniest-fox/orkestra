//! Shared infrastructure for real-agent e2e tests.
//!
//! Provides `AgentTestEnv` — a test environment that uses real process spawners
//! (Claude Code, OpenCode) instead of mocks. Tests using this require the actual
//! CLI tools installed and API keys configured.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::{
    config::{IntegrationConfig, StageConfig, WorkflowConfig},
    domain::{LogEntry, Task},
    runtime::Phase,
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
    _temp_dir: TempDir,
}

impl AgentTestEnv {
    /// Create a test environment for a specific model.
    ///
    /// Sets up a single "work" stage workflow using the given model string
    /// (e.g., `"opencode/kimi-k2.5-free"`, `"claudecode/sonnet"`).
    pub fn new(model: &str) -> Self {
        use orkestra_core::testutil::create_temp_git_repo;

        let temp_dir = create_temp_git_repo().expect("create temp git repo");

        // Create .orkestra directory + agent prompt file
        let orkestra_dir = temp_dir.path().join(".orkestra");
        std::fs::create_dir_all(orkestra_dir.join("agents")).unwrap();
        std::fs::write(
            orkestra_dir.join("agents/worker.md"),
            "You are a worker agent. Complete the task described below.",
        )
        .unwrap();

        // Build and save workflow config
        let workflow = WorkflowConfig {
            version: 1,
            stages: vec![StageConfig::new("work", "result")
                .with_prompt("worker.md")
                .with_model(model)],
            integration: IntegrationConfig::default(),
            flows: std::collections::HashMap::new(),
        };

        let workflow_path = orkestra_dir.join("workflow.yaml");
        std::fs::write(&workflow_path, serde_yaml::to_string(&workflow).unwrap()).unwrap();
        let loaded_workflow =
            orkestra_core::workflow::config::load_workflow(&workflow_path).expect("load workflow");

        // Real SQLite database
        let db_path = orkestra_dir.join("orkestra.db");
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
            _temp_dir: temp_dir,
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
            if t.phase != Phase::SettingUp {
                println!("Task setup complete: phase={:?}", t.phase);
                return task_id;
            }
            if start.elapsed() > timeout {
                panic!("Task setup did not complete in time");
            }
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
                "  [{:.1}s] phase={:?} stage={:?}",
                start.elapsed().as_secs_f64(),
                t.phase,
                t.current_stage()
            );

            match t.phase {
                Phase::AwaitingReview => {
                    println!("Task reached AwaitingReview!");
                    return t;
                }
                Phase::Idle
                    if matches!(
                        t.status,
                        orkestra_core::workflow::runtime::Status::Failed { .. }
                    ) =>
                {
                    panic!("Task failed: {:?}", t.status);
                }
                _ => {}
            }

            if start.elapsed() > timeout {
                panic!(
                    "Timed out after {:.0}s waiting for task completion (phase={:?})",
                    timeout.as_secs_f64(),
                    t.phase
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
            .get_task_logs(task_id, Some(stage))
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
}
