//! Shared test infrastructure for e2e tests.
//!
//! Provides `TestEnv` — a unified test environment for all e2e tests — along
//! with mock agent output helpers, workflow config builders, and process utilities.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tempfile::TempDir;

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::{
    config::WorkflowConfig,
    domain::{Question, Task},
    execution::StageOutput,
    runtime::Phase,
    MockAgentRunner, OrchestratorLoop, SqliteWorkflowStore, StageExecutionService, WorkflowApi,
};
use orkestra_core::MockTitleGenerator;

// =============================================================================
// TestEnv — Unified Test Environment
// =============================================================================

/// Test environment with real `SQLite`, real orchestrator, and mock agent execution.
///
/// Two constructors cover all current e2e patterns:
/// - `with_workflow(wf)` — script-only tests (no git)
/// - `with_git(wf, agents)` — agent tests with real git repo and prompt files
pub struct TestEnv {
    api: Arc<Mutex<WorkflowApi>>,
    orchestrator: OrchestratorLoop,
    runner: Arc<MockAgentRunner>,
    temp_dir: TempDir,
}

impl TestEnv {
    /// Create a test env with the given workflow config (no git).
    ///
    /// Used by cleanup tests and script-only tests where git worktrees
    /// aren't needed.
    pub fn with_workflow(workflow: WorkflowConfig) -> Self {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");

        // Create .orkestra directory for script logs
        let orkestra_dir = temp_dir.path().join(".orkestra");
        std::fs::create_dir_all(&orkestra_dir).unwrap();

        // Real SQLite database
        let db_path = orkestra_dir.join("orkestra.db");
        let db_conn = DatabaseConnection::open(&db_path).expect("Should open database");

        let store: Arc<dyn orkestra_core::workflow::WorkflowStore> =
            Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

        let api = Arc::new(Mutex::new(WorkflowApi::new(
            workflow.clone(),
            Arc::new(SqliteWorkflowStore::new(db_conn.shared())),
        )));

        let project_root = temp_dir.path().to_path_buf();
        let iteration_service = api.lock().unwrap().iteration_service().clone();

        let runner = Arc::new(MockAgentRunner::new());

        let stage_executor = Arc::new(StageExecutionService::with_runner(
            workflow,
            project_root,
            store,
            iteration_service,
            runner.clone(),
        ));

        let orchestrator = OrchestratorLoop::new(api.clone(), stage_executor);

        Self {
            api,
            orchestrator,
            runner,
            temp_dir,
        }
    }

    /// Create a test env with a real git repo and agent prompt files.
    ///
    /// Used by workflow tests that need git worktrees and agent stages.
    /// Creates `.orkestra/agents/{name}.md` for each agent name provided.
    pub fn with_git(workflow: &WorkflowConfig, agents: &[&str]) -> Self {
        use orkestra_core::testutil::create_temp_git_repo;
        use orkestra_core::workflow::{Git2GitService, GitService};
        use std::path::PathBuf;

        let temp_dir = create_temp_git_repo().expect("Failed to create git repo");

        // Create .orkestra directory structure
        let orkestra_dir = temp_dir.path().join(".orkestra");
        std::fs::create_dir_all(&orkestra_dir).unwrap();

        // Create agent definition files
        let agents_dir = orkestra_dir.join("agents");
        std::fs::create_dir_all(&agents_dir).unwrap();
        for agent in agents {
            std::fs::write(
                agents_dir.join(format!("{agent}.md")),
                format!("You are a {agent} agent."),
            )
            .unwrap();
        }

        // Save and reload workflow config (tests the loader too)
        let workflow_path = orkestra_dir.join("workflow.yaml");
        let yaml = serde_yaml::to_string(&workflow).unwrap();
        std::fs::write(&workflow_path, yaml).unwrap();
        let loaded_workflow = orkestra_core::workflow::config::load_workflow(&workflow_path)
            .expect("Should load workflow");

        // Real SQLite database
        let db_path = orkestra_dir.join("orkestra.db");
        let db_conn = DatabaseConnection::open(&db_path).expect("Should open database");
        let store: Arc<dyn orkestra_core::workflow::WorkflowStore> =
            Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

        // Git service for worktree support
        let git_service: Arc<dyn GitService> =
            Arc::new(Git2GitService::new(temp_dir.path()).expect("Git service should init"));

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
        let runner = Arc::new(MockAgentRunner::new());

        let stage_executor = Arc::new(StageExecutionService::with_runner(
            loaded_workflow,
            project_root,
            store,
            iteration_service,
            runner.clone(),
        ));

        let orchestrator = OrchestratorLoop::new(api.clone(), stage_executor);

        Self {
            api,
            orchestrator,
            runner,
            temp_dir,
        }
    }

    /// Create a test env with a real git repo where title generation fails.
    ///
    /// Same as `with_git` but uses `MockTitleGenerator::failing()`, so tasks
    /// created with empty titles will exercise the fallback path.
    pub fn with_git_title_fail(workflow: &WorkflowConfig, agents: &[&str]) -> Self {
        use orkestra_core::testutil::create_temp_git_repo;
        use orkestra_core::workflow::{Git2GitService, GitService};
        use std::path::PathBuf;

        let temp_dir = create_temp_git_repo().expect("Failed to create git repo");

        // Create .orkestra directory structure
        let orkestra_dir = temp_dir.path().join(".orkestra");
        std::fs::create_dir_all(&orkestra_dir).unwrap();

        // Create agent definition files
        let agents_dir = orkestra_dir.join("agents");
        std::fs::create_dir_all(&agents_dir).unwrap();
        for agent in agents {
            std::fs::write(
                agents_dir.join(format!("{agent}.md")),
                format!("You are a {agent} agent."),
            )
            .unwrap();
        }

        // Save and reload workflow config
        let workflow_path = orkestra_dir.join("workflow.yaml");
        let yaml = serde_yaml::to_string(&workflow).unwrap();
        std::fs::write(&workflow_path, yaml).unwrap();
        let loaded_workflow = orkestra_core::workflow::config::load_workflow(&workflow_path)
            .expect("Should load workflow");

        // Real SQLite database
        let db_path = orkestra_dir.join("orkestra.db");
        let db_conn = DatabaseConnection::open(&db_path).expect("Should open database");
        let store: Arc<dyn orkestra_core::workflow::WorkflowStore> =
            Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

        // Git service for worktree support
        let git_service: Arc<dyn GitService> =
            Arc::new(Git2GitService::new(temp_dir.path()).expect("Git service should init"));

        let api = Arc::new(Mutex::new(
            WorkflowApi::with_git(
                loaded_workflow.clone(),
                Arc::new(SqliteWorkflowStore::new(db_conn.shared())),
                git_service,
            )
            .with_title_generator(Arc::new(MockTitleGenerator::failing())),
        ));
        let project_root = PathBuf::from(temp_dir.path());

        let iteration_service = api.lock().unwrap().iteration_service().clone();
        let runner = Arc::new(MockAgentRunner::new());

        let stage_executor = Arc::new(StageExecutionService::with_runner(
            loaded_workflow,
            project_root,
            store,
            iteration_service,
            runner.clone(),
        ));

        let orchestrator = OrchestratorLoop::new(api.clone(), stage_executor);

        Self {
            api,
            orchestrator,
            runner,
            temp_dir,
        }
    }

    // =========================================================================
    // Task Lifecycle
    // =========================================================================

    /// Get the API lock for human actions.
    pub fn api(&self) -> MutexGuard<'_, WorkflowApi> {
        self.api.lock().unwrap()
    }

    /// Create a task and wait for async setup to complete.
    ///
    /// Returns the task in Idle phase (or Failed if setup failed).
    pub fn create_task(&self, title: &str, desc: &str, base_branch: Option<&str>) -> Task {
        let task = self
            .api()
            .create_task(title, desc, base_branch)
            .expect("Should create task");
        let task_id = task.id.clone();

        for _ in 0..100 {
            std::thread::sleep(Duration::from_millis(20));
            let task = self.api().get_task(&task_id).expect("Should get task");
            if task.phase != Phase::SettingUp {
                return task;
            }
        }

        panic!("Task setup did not complete in time for task {task_id}");
    }

    /// Create a subtask and wait for async setup to complete.
    pub fn create_subtask(&self, parent_id: &str, title: &str, desc: &str) -> Task {
        let task = self
            .api()
            .create_subtask(parent_id, title, desc)
            .expect("Should create subtask");
        let task_id = task.id.clone();

        for _ in 0..100 {
            std::thread::sleep(Duration::from_millis(20));
            let task = self.api().get_task(&task_id).expect("Should get task");
            if task.phase != Phase::SettingUp {
                return task;
            }
        }

        panic!("Subtask setup did not complete in time for {task_id}");
    }

    // =========================================================================
    // Orchestrator
    // =========================================================================

    /// Run all startup recovery steps (stale tasks, orphaned worktrees, stuck integrations).
    ///
    /// Simulates what happens when the app restarts and the orchestrator recovers.
    pub fn run_startup_recovery(&self) -> Vec<orkestra_core::workflow::OrchestratorEvent> {
        self.orchestrator.run_startup_recovery()
    }

    /// Single orchestrator tick (spawn pending, poll completions).
    ///
    /// Use this for script stages where you want to check state mid-execution.
    pub fn tick(&self) {
        self.orchestrator.tick().expect("Tick should succeed");
    }

    /// Tick until all active work settles (handles multi-step like restage).
    ///
    /// Use this for agent stages where mock callbacks complete asynchronously.
    pub fn tick_until_settled(&self) {
        for _ in 0..10 {
            self.orchestrator.tick().expect("Tick should succeed");
            std::thread::sleep(Duration::from_millis(30));

            if self.orchestrator.active_count() == 0 {
                // One more tick to ensure all events are processed
                self.orchestrator.tick().expect("Final tick should succeed");
                break;
            }
        }
    }

    // =========================================================================
    // Mock Agent Control
    // =========================================================================

    /// Set the output for the next agent spawn for a task.
    pub fn set_output(&self, task_id: &str, output: impl Into<StageOutput>) {
        self.runner.set_output(task_id, output.into());
    }

    /// Get the number of calls made to the mock runner.
    pub fn call_count(&self) -> usize {
        self.runner.calls().len()
    }

    // =========================================================================
    // Query Shortcuts
    // =========================================================================

    /// Get the repository / temp directory path.
    pub fn repo_path(&self) -> &Path {
        self.temp_dir.path()
    }

    /// Get the PID recorded in the session for a task+stage.
    pub fn get_session_pid(&self, task_id: &str, stage: &str) -> Option<u32> {
        self.api()
            .get_stage_session(task_id, stage)
            .ok()
            .flatten()
            .and_then(|s| s.agent_pid)
    }

    // =========================================================================
    // Prompt Verification
    // =========================================================================

    /// Get the last prompt sent to the agent.
    pub fn last_prompt(&self) -> String {
        let calls = self.runner.calls();
        calls
            .last()
            .expect("No agent calls recorded")
            .prompt
            .clone()
    }

    /// Assert that the last prompt has a specific resume marker type and contains expected strings.
    pub fn assert_resume_prompt_contains(&self, expected_type: &str, expected_content: &[&str]) {
        let prompt = self.last_prompt();
        let expected_marker = format!("<!orkestra-resume:{expected_type}>");
        assert!(
            prompt.starts_with(&expected_marker),
            "Expected resume marker '{}', got prompt starting with: {}...",
            expected_marker,
            &prompt[..prompt.len().min(100)]
        );

        for content in expected_content {
            assert!(
                prompt.contains(content),
                "Resume prompt should contain '{content}'. Full prompt:\n{prompt}"
            );
        }
    }

    /// Assert that the last prompt is a full prompt with expected stage characteristics.
    ///
    /// # Arguments
    /// * `artifact` - The artifact name this stage produces (e.g., "plan", "summary", "verdict")
    /// * `can_ask_questions` - Whether the stage has `ask_questions` capability
    /// * `restage_targets` - Stages this stage can restage to (empty if no restage capability)
    pub fn assert_full_prompt(
        &self,
        artifact: &str,
        can_ask_questions: bool,
        restage_targets: &[&str],
    ) {
        let prompt = self.last_prompt();

        // Should NOT be a resume prompt
        assert!(
            !prompt.starts_with("<!orkestra-resume:"),
            "Expected full prompt (not resume), but got resume prompt starting with: {}...",
            &prompt[..prompt.len().min(100)]
        );

        // Full prompts should contain the task section
        assert!(
            prompt.contains("## Your Current Task"),
            "Full prompt should contain '## Your Current Task' section"
        );

        // Should contain the expected artifact name in output format
        let artifact_pattern = format!("\"{artifact}\"");
        assert!(
            prompt.contains(&artifact_pattern),
            "Full prompt should reference artifact '{}'. Got prompt: {}...",
            artifact,
            &prompt[..prompt.len().min(500)]
        );

        // Check questions capability
        if can_ask_questions {
            assert!(
                prompt.contains("\"questions\""),
                "Prompt for stage with ask_questions should mention questions output type"
            );
        }

        // Check restage capability
        for target in restage_targets {
            assert!(
                prompt.contains("restage") || prompt.contains("rejected"),
                "Prompt for stage with restage capability should mention restage/rejected"
            );
            assert!(
                prompt.contains(target),
                "Prompt should mention restage target '{}' but doesn't. Prompt: {}...",
                target,
                &prompt[..prompt.len().min(500)]
            );
        }
    }
}

// =============================================================================
// MockAgentOutput — Ergonomic Agent Response Builder
// =============================================================================

/// Simulated output from Claude Code agent.
///
/// This is a test convenience type that converts to the actual `StageOutput`.
#[derive(Debug, Clone)]
pub enum MockAgentOutput {
    /// Agent is asking clarifying questions.
    Questions(Vec<Question>),
    /// Agent produced an artifact (plan, summary, verdict).
    Artifact { name: String, content: String },
    /// Agent (reviewer) is restaging to another stage.
    Restage { target: String, feedback: String },
    /// Agent produced subtasks for breakdown.
    Subtasks {
        subtasks: Vec<orkestra_core::workflow::execution::SubtaskOutput>,
        skip_reason: Option<String>,
    },
    /// Agent failed.
    Failed { error: String },
    /// Agent is blocked.
    Blocked { reason: String },
}

impl From<MockAgentOutput> for StageOutput {
    fn from(mock: MockAgentOutput) -> Self {
        match mock {
            MockAgentOutput::Questions(questions) => StageOutput::Questions { questions },
            MockAgentOutput::Artifact { content, .. } => StageOutput::Artifact { content },
            MockAgentOutput::Restage { target, feedback } => {
                StageOutput::Restage { target, feedback }
            }
            MockAgentOutput::Subtasks {
                subtasks,
                skip_reason,
            } => StageOutput::Subtasks {
                subtasks,
                skip_reason,
            },
            MockAgentOutput::Failed { error } => StageOutput::Failed { error },
            MockAgentOutput::Blocked { reason } => StageOutput::Blocked { reason },
        }
    }
}

// =============================================================================
// Workflow Config Builders
// =============================================================================

pub mod workflows {
    use orkestra_core::workflow::config::{
        IntegrationConfig, ScriptStageConfig, StageConfig, WorkflowConfig,
    };

    /// Single `sleep 60` script stage. Never completes on its own.
    ///
    /// Use for testing process killing — the script runs indefinitely,
    /// giving tests time to verify kill behavior.
    pub fn sleep_script() -> WorkflowConfig {
        WorkflowConfig {
            version: 1,
            stages: vec![
                StageConfig::new("work", "output").with_script(ScriptStageConfig {
                    command: "sleep 60".into(),
                    timeout_seconds: 120,
                    on_failure: None,
                }),
            ],
            integration: IntegrationConfig::default(),
            flows: std::collections::HashMap::new(),
        }
    }

    /// Full workflow with breakdown that produces subtasks.
    ///
    /// planning → breakdown → work → review
    /// Plus a "subtask" flow: work → review
    pub fn with_subtasks() -> WorkflowConfig {
        use orkestra_core::workflow::config::{
            FlowConfig, FlowStageEntry, FlowStageOverride, StageCapabilities,
        };

        let mut flows = std::collections::HashMap::new();
        flows.insert(
            "subtask".to_string(),
            FlowConfig {
                description: "Simplified pipeline for subtasks".to_string(),
                icon: None,
                stages: vec![
                    FlowStageEntry {
                        stage_name: "work".to_string(),
                        overrides: None,
                    },
                    FlowStageEntry {
                        stage_name: "review".to_string(),
                        overrides: Some(FlowStageOverride {
                            prompt: None,
                            capabilities: Some(StageCapabilities::with_restage(
                                vec!["work".into()],
                            )),
                        }),
                    },
                ],
            },
        );

        WorkflowConfig {
            version: 1,
            stages: vec![
                StageConfig::new("planning", "plan")
                    .with_prompt("planner.md")
                    .with_capabilities(
                        orkestra_core::workflow::config::StageCapabilities::with_questions(),
                    ),
                StageConfig::new("breakdown", "breakdown")
                    .with_prompt("breakdown.md")
                    .with_inputs(vec!["plan".into()])
                    .with_capabilities(orkestra_core::workflow::config::StageCapabilities {
                        subtasks: Some(
                            orkestra_core::workflow::config::SubtaskCapabilities::default()
                                .with_flow("subtask"),
                        ),
                        ..Default::default()
                    }),
                StageConfig::new("work", "summary")
                    .with_prompt("worker.md")
                    .with_inputs(vec!["plan".into()]),
                StageConfig::new("review", "verdict")
                    .with_prompt("reviewer.md")
                    .with_inputs(vec!["plan".into(), "summary".into()])
                    .with_capabilities(
                        orkestra_core::workflow::config::StageCapabilities::with_restage(vec![
                            "work".into(),
                        ]),
                    )
                    .automated(),
            ],
            integration: IntegrationConfig::default(),
            flows,
        }
    }

    /// Single `echo hello` script stage. Exits immediately.
    ///
    /// Use for stale-PID tests where the process needs to be dead but
    /// the PID is still recorded in the session (simulating crash before completion).
    pub fn instant_script() -> WorkflowConfig {
        WorkflowConfig {
            version: 1,
            stages: vec![
                StageConfig::new("work", "output").with_script(ScriptStageConfig {
                    command: "echo hello".into(),
                    timeout_seconds: 10,
                    on_failure: None,
                }),
            ],
            integration: IntegrationConfig::default(),
            flows: std::collections::HashMap::new(),
        }
    }
}

// =============================================================================
// Process Helpers
// =============================================================================

/// Reap a killed process by PID (removes zombie from process table).
///
/// Uses `waitpid` directly since the `Child` handle is inside the orchestrator's
/// `ScriptHandle` and we can't access it. This works because the script process
/// is a direct child of our test process.
#[cfg(unix)]
#[allow(clippy::cast_possible_wrap)]
pub fn reap_pid(pid: u32) {
    unsafe {
        libc::waitpid(pid as i32, std::ptr::null_mut(), 0);
    }
}
