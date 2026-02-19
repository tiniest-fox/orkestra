//! Shared test infrastructure for e2e tests.
//!
//! Provides `TestEnv` — a unified test environment for all e2e tests — along
//! with mock agent output helpers, workflow config builders, and process utilities.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tempfile::TempDir;

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::{
    config::WorkflowConfig,
    domain::{Question, Task},
    execution::{
        claudecode_aliases, claudecode_capabilities, opencode_aliases, opencode_capabilities,
        ProviderRegistry, RunConfig, StageOutput,
    },
    ports::{GitService, MockGitService, MockPrService, PrService},
    runtime::TaskState,
    MockAgentRunner, OrchestratorLoop, SqliteWorkflowStore, StageExecutionService, WorkflowApi,
};
use orkestra_core::{
    MockCommitMessageGenerator, MockPrDescriptionGenerator, MockTitleGenerator,
    PrDescriptionGenerator,
};

// =============================================================================
// Prompt Helpers
// =============================================================================

/// Combine system prompt and user message for test assertions.
///
/// Since system prompts are now passed separately via CLI flags (when supported),
/// tests need to combine them to verify the full agent context.
fn combine_prompts(system_prompt: Option<&String>, user_message: &str) -> String {
    match system_prompt {
        Some(sp) => format!("{sp}\n\n{user_message}"),
        None => user_message.to_string(),
    }
}

// =============================================================================
// Provider Registry
// =============================================================================

/// Create a default provider registry for tests.
///
/// Registers both claudecode and opencode (with stub spawners) since tests use
/// `MockAgentRunner` and only need the registry for capability checks.
fn test_provider_registry() -> Arc<ProviderRegistry> {
    use orkestra_core::workflow::ports::{MockProcessSpawner, ProcessSpawner};

    let mut registry = ProviderRegistry::new("claudecode");
    registry.register(
        "claudecode",
        Arc::new(MockProcessSpawner::new()) as Arc<dyn ProcessSpawner>,
        claudecode_capabilities(),
        claudecode_aliases(),
    );
    registry.register(
        "opencode",
        Arc::new(MockProcessSpawner::new()) as Arc<dyn ProcessSpawner>,
        opencode_capabilities(),
        opencode_aliases(),
    );
    Arc::new(registry)
}

// =============================================================================
// TestEnv — Unified Test Environment
// =============================================================================

/// Test environment with real `SQLite`, real orchestrator, and mock agent execution.
///
/// Three constructors cover all current e2e patterns:
/// - `with_workflow(wf)` — script-only tests (no git)
/// - `with_git(wf, agents)` — agent tests with real git repo and prompt files
/// - `with_mock_git(wf, agents)` — tests that need to verify git service calls
pub struct TestEnv {
    api: Arc<Mutex<WorkflowApi>>,
    orchestrator: OrchestratorLoop,
    runner: Arc<MockAgentRunner>,
    pr_service: Arc<MockPrService>,
    mock_git_service: Option<Arc<MockGitService>>,
    temp_dir: TempDir,
}

impl TestEnv {
    /// Create a test env with the given workflow config (no git).
    ///
    /// Used by cleanup tests and script-only tests where git worktrees
    /// aren't needed.
    pub fn with_workflow(workflow: WorkflowConfig) -> Self {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");

        // Create .orkestra directory structure
        let orkestra_dir = temp_dir.path().join(".orkestra");
        std::fs::create_dir_all(orkestra_dir.join(".database")).unwrap();

        // Real SQLite database
        let db_path = orkestra_dir.join(".database/orkestra.db");
        let db_conn = DatabaseConnection::open(&db_path).expect("Should open database");

        let store: Arc<dyn orkestra_core::workflow::WorkflowStore> =
            Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

        let pr_service = Arc::new(MockPrService::new());
        let api = Arc::new(Mutex::new(
            WorkflowApi::new(
                workflow.clone(),
                Arc::new(SqliteWorkflowStore::new(db_conn.shared())),
            )
            .with_commit_message_generator(Arc::new(MockCommitMessageGenerator::succeeding()))
            .with_pr_service(pr_service.clone() as Arc<dyn PrService>)
            .with_pr_description_generator(Arc::new(MockPrDescriptionGenerator::succeeding())
                as Arc<dyn PrDescriptionGenerator>),
        ));

        let project_root = temp_dir.path().to_path_buf();
        let iteration_service = api.lock().unwrap().iteration_service().clone();

        let runner = Arc::new(MockAgentRunner::new());

        let stage_executor = Arc::new(StageExecutionService::with_runner(
            workflow,
            project_root,
            store,
            iteration_service,
            runner.clone(),
            test_provider_registry(),
        ));

        // Sync setup so create_task() completes inline (no worktree/title-gen to wait for).
        // Scripts still spawn as real processes via tick() — that's the async lifecycle
        // cleanup tests need.
        api.lock().unwrap().set_sync_setup(true);
        let orchestrator = OrchestratorLoop::new(api.clone(), stage_executor);

        Self {
            api,
            orchestrator,
            runner,
            pr_service,
            mock_git_service: None,
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
        std::fs::create_dir_all(orkestra_dir.join(".database")).unwrap();

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
        let db_path = orkestra_dir.join(".database/orkestra.db");
        let db_conn = DatabaseConnection::open(&db_path).expect("Should open database");
        let store: Arc<dyn orkestra_core::workflow::WorkflowStore> =
            Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

        // Git service for worktree support
        let git_service: Arc<dyn GitService> =
            Arc::new(Git2GitService::new(temp_dir.path()).expect("Git service should init"));

        let pr_service = Arc::new(MockPrService::new());
        let api = WorkflowApi::with_git(
            loaded_workflow.clone(),
            Arc::new(SqliteWorkflowStore::new(db_conn.shared())),
            git_service,
        )
        .with_title_generator(Arc::new(MockTitleGenerator::succeeding()))
        .with_commit_message_generator(Arc::new(MockCommitMessageGenerator::succeeding()))
        .with_pr_service(pr_service.clone() as Arc<dyn PrService>)
        .with_pr_description_generator(
            Arc::new(MockPrDescriptionGenerator::succeeding()) as Arc<dyn PrDescriptionGenerator>
        );

        let api = Arc::new(Mutex::new(api));
        let project_root = PathBuf::from(temp_dir.path());

        let iteration_service = api.lock().unwrap().iteration_service().clone();
        let runner = Arc::new(MockAgentRunner::new());

        let stage_executor = Arc::new(StageExecutionService::with_runner(
            loaded_workflow,
            project_root,
            store,
            iteration_service,
            runner.clone(),
            test_provider_registry(),
        ));

        let mut orchestrator = OrchestratorLoop::new(api.clone(), stage_executor);
        orchestrator.set_sync_background(true);
        api.lock().unwrap().set_sync_setup(true);

        Self {
            api,
            orchestrator,
            runner,
            pr_service,
            mock_git_service: None,
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
        std::fs::create_dir_all(orkestra_dir.join(".database")).unwrap();

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
        let db_path = orkestra_dir.join(".database/orkestra.db");
        let db_conn = DatabaseConnection::open(&db_path).expect("Should open database");
        let store: Arc<dyn orkestra_core::workflow::WorkflowStore> =
            Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

        // Git service for worktree support
        let git_service: Arc<dyn GitService> =
            Arc::new(Git2GitService::new(temp_dir.path()).expect("Git service should init"));

        let pr_service = Arc::new(MockPrService::new());
        let api = Arc::new(Mutex::new(
            WorkflowApi::with_git(
                loaded_workflow.clone(),
                Arc::new(SqliteWorkflowStore::new(db_conn.shared())),
                git_service,
            )
            .with_title_generator(Arc::new(MockTitleGenerator::failing()))
            .with_commit_message_generator(Arc::new(MockCommitMessageGenerator::succeeding()))
            .with_pr_service(pr_service.clone() as Arc<dyn PrService>)
            .with_pr_description_generator(Arc::new(MockPrDescriptionGenerator::succeeding())
                as Arc<dyn PrDescriptionGenerator>),
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
            test_provider_registry(),
        ));

        let mut orchestrator = OrchestratorLoop::new(api.clone(), stage_executor);
        orchestrator.set_sync_background(true);
        api.lock().unwrap().set_sync_setup(true);

        Self {
            api,
            orchestrator,
            runner,
            pr_service,
            mock_git_service: None,
            temp_dir,
        }
    }

    /// Create a test env with a `MockGitService` for verifying git operations.
    ///
    /// Unlike `with_git`, this uses a mock git service that doesn't create real
    /// worktrees but allows verifying that git operations (like `sync_base_branch`)
    /// are called with the expected arguments.
    pub fn with_mock_git(workflow: &WorkflowConfig, agents: &[&str]) -> Self {
        use std::path::PathBuf;

        let temp_dir = TempDir::new().expect("Failed to create temp dir");

        // Create .orkestra directory structure
        let orkestra_dir = temp_dir.path().join(".orkestra");
        std::fs::create_dir_all(orkestra_dir.join(".database")).unwrap();

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
        let db_path = orkestra_dir.join(".database/orkestra.db");
        let db_conn = DatabaseConnection::open(&db_path).expect("Should open database");
        let store: Arc<dyn orkestra_core::workflow::WorkflowStore> =
            Arc::new(SqliteWorkflowStore::new(db_conn.shared()));

        // Mock git service for verifying calls
        let mock_git = Arc::new(MockGitService::new());
        let git_service: Arc<dyn GitService> = mock_git.clone();

        let pr_service = Arc::new(MockPrService::new());
        let api = WorkflowApi::with_git(
            loaded_workflow.clone(),
            Arc::new(SqliteWorkflowStore::new(db_conn.shared())),
            git_service,
        )
        .with_title_generator(Arc::new(MockTitleGenerator::succeeding()))
        .with_commit_message_generator(Arc::new(MockCommitMessageGenerator::succeeding()))
        .with_pr_service(pr_service.clone() as Arc<dyn PrService>)
        .with_pr_description_generator(
            Arc::new(MockPrDescriptionGenerator::succeeding()) as Arc<dyn PrDescriptionGenerator>
        );

        let api = Arc::new(Mutex::new(api));
        let project_root = PathBuf::from(temp_dir.path());

        let iteration_service = api.lock().unwrap().iteration_service().clone();
        let runner = Arc::new(MockAgentRunner::new());

        let stage_executor = Arc::new(StageExecutionService::with_runner(
            loaded_workflow,
            project_root,
            store,
            iteration_service,
            runner.clone(),
            test_provider_registry(),
        ));

        let mut orchestrator = OrchestratorLoop::new(api.clone(), stage_executor);
        orchestrator.set_sync_background(true);
        api.lock().unwrap().set_sync_setup(true);

        Self {
            api,
            orchestrator,
            runner,
            pr_service,
            mock_git_service: Some(mock_git),
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

    /// Get a clone of the `Arc<Mutex<WorkflowApi>>` for functions that need it.
    pub fn api_arc(&self) -> Arc<Mutex<WorkflowApi>> {
        Arc::clone(&self.api)
    }

    /// Get the mock PR service for configuring test results.
    pub fn pr_service(&self) -> Arc<MockPrService> {
        Arc::clone(&self.pr_service)
    }

    /// Get the mock git service for verifying git operations.
    ///
    /// Only available when using `with_mock_git()`. Panics if called on
    /// environments created with other constructors.
    pub fn mock_git_service(&self) -> &Arc<MockGitService> {
        self.mock_git_service
            .as_ref()
            .expect("mock_git_service only available with with_mock_git()")
    }

    /// Get the temp directory path for direct file/git operations.
    pub fn temp_dir(&self) -> &Path {
        self.temp_dir.path()
    }

    /// Create a task with synchronous setup.
    ///
    /// Setup (worktree creation, title generation) runs inline because
    /// `set_sync_setup(true)` is enabled. Returns the task in Idle phase
    /// (or Failed if setup failed).
    pub fn create_task(&self, title: &str, desc: &str, base_branch: Option<&str>) -> Task {
        let task = self
            .api()
            .create_task(title, desc, base_branch)
            .expect("Should create task");
        let task_id = task.id.clone();

        // Task starts in AwaitingSetup. One orchestrator tick triggers setup_awaiting_tasks(),
        // which transitions to SettingUp and calls spawn_setup(). With sync setup enabled,
        // that runs inline and transitions to Idle (or Failed).
        self.advance();

        let task = self.api().get_task(&task_id).expect("Should get task");
        assert!(
            !matches!(
                task.state,
                TaskState::AwaitingSetup { .. } | TaskState::SettingUp { .. }
            ),
            "Task should have completed setup synchronously, got: {:?}",
            task.state
        );
        task
    }

    /// Create a subtask with synchronous setup.
    ///
    /// Subtask setup is deferred to the orchestrator tick loop, so this method
    /// advances once to trigger `setup_awaiting_tasks()`. With sync setup
    /// enabled, the worktree is created inline and the subtask transitions
    /// to Idle within that advance.
    ///
    /// Subtasks with unsatisfied dependencies will stay in `AwaitingSetup` — use
    /// `create_subtask_deferred` for those.
    pub fn create_subtask(&self, parent_id: &str, title: &str, desc: &str) -> Task {
        let task = self
            .api()
            .create_subtask(parent_id, title, desc)
            .expect("Should create subtask");
        let task_id = task.id.clone();

        // One advance triggers setup_awaiting_tasks; with sync setup, it completes inline
        self.advance();

        let task = self.api().get_task(&task_id).expect("Should get task");
        assert!(
            !matches!(
                task.state,
                TaskState::AwaitingSetup { .. } | TaskState::SettingUp { .. }
            ),
            "Subtask should have completed setup synchronously, got: {:?}",
            task.state
        );
        task
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

    /// Run one orchestrator pass through all phases.
    ///
    /// With sync mock agents and sync integration, each advance is deterministic:
    /// - Agents spawned in the previous advance have completions ready
    /// - Integration runs inline (no background thread)
    ///
    /// Tests call this the exact number of times needed for their flow,
    /// checking state between calls.
    pub fn advance(&self) {
        self.orchestrator.tick().expect("Advance should succeed");
    }

    /// Tick until a predicate is true or timeout is reached.
    ///
    /// Uses wall-clock time instead of iteration counts, so timeouts are reliable
    /// even under CPU contention from parallel test execution.
    #[allow(dead_code)]
    pub fn tick_until(
        &self,
        mut predicate: impl FnMut() -> bool,
        timeout: Duration,
        context: &str,
    ) {
        let start = Instant::now();
        while start.elapsed() < timeout {
            self.orchestrator.tick().expect("Tick should succeed");
            std::thread::sleep(Duration::from_millis(20));
            if predicate() {
                return;
            }
        }
        panic!("Timed out after {:.1}s: {context}", timeout.as_secs_f64());
    }

    // =========================================================================
    // Mock Agent Control
    // =========================================================================

    /// Set the output for the next agent spawn for a task.
    pub fn set_output(&self, task_id: &str, output: impl Into<StageOutput>) {
        self.runner.set_output(task_id, output.into());
    }

    /// Set the output for the next agent spawn WITH simulated activity.
    /// The mock sends a `LogLine` event before Completed, triggering `has_activity`.
    pub fn set_output_with_activity(&self, task_id: &str, output: impl Into<StageOutput>) {
        self.runner.set_output_with_activity(task_id, output.into());
    }

    /// Set the next agent spawn to emit activity then fail.
    /// The mock sends a `LogLine` event then an error, testing the scenario where
    /// an agent produces streaming output but ultimately fails.
    pub fn set_failure_with_activity(&self, task_id: &str, error: String) {
        self.runner.set_failure_with_activity(task_id, error);
    }

    /// Get the number of calls made to the mock runner.
    pub fn call_count(&self) -> usize {
        self.runner.calls().len()
    }

    /// Get the full `RunConfig` from the last agent spawn call.
    pub fn last_run_config(&self) -> RunConfig {
        let calls = self.runner.calls();
        calls.last().expect("No agent calls recorded").clone()
    }

    /// Get all `RunConfig` calls made to the mock runner.
    pub fn runner_calls(&self) -> Vec<RunConfig> {
        self.runner.calls()
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

    /// Get the last prompt sent to the agent (combines `system_prompt` + user message).
    pub fn last_prompt(&self) -> String {
        let calls = self.runner.calls();
        let call = calls.last().expect("No agent calls recorded");
        combine_prompts(call.system_prompt.as_ref(), &call.prompt)
    }

    /// Get the last prompt sent to a specific task's agent (combines `system_prompt` + user message).
    pub fn last_prompt_for(&self, task_id: &str) -> String {
        let calls = self.runner.calls();
        let call = calls
            .iter()
            .rev()
            .find(|c| c.task_id.as_deref() == Some(task_id))
            .unwrap_or_else(|| panic!("No agent calls recorded for task {task_id}"));
        combine_prompts(call.system_prompt.as_ref(), &call.prompt)
    }

    /// Get the last system prompt sent to the agent.
    #[allow(dead_code)]
    pub fn last_system_prompt(&self) -> Option<String> {
        let calls = self.runner.calls();
        calls.last().and_then(|call| call.system_prompt.clone())
    }

    /// Get the last system prompt sent to a specific task's agent.
    #[allow(dead_code)]
    pub fn last_system_prompt_for(&self, task_id: &str) -> Option<String> {
        let calls = self.runner.calls();
        calls
            .iter()
            .rev()
            .find(|c| c.task_id.as_deref() == Some(task_id))
            .and_then(|call| call.system_prompt.clone())
    }

    /// Assert that the last prompt has a specific resume marker type and contains expected strings.
    ///
    /// Marker format: `<!orkestra:resume:STAGE:TYPE>`
    ///
    /// Note: Checks only the user message (not system prompt). Resume prompts are short
    /// user messages that reference an existing session, while the system prompt is still
    /// passed separately.
    pub fn assert_resume_prompt_contains(&self, expected_type: &str, expected_content: &[&str]) {
        let calls = self.runner.calls();
        let call = calls.last().expect("No agent calls recorded");
        let user_message = &call.prompt; // Just the user message, not combined with system

        let type_tag = format!(":{expected_type}>");
        assert!(
            user_message.starts_with("<!orkestra:resume:") && user_message.contains(&type_tag),
            "Expected resume marker with type '{expected_type}', got prompt starting with: {}...",
            &user_message[..user_message.len().min(100)]
        );

        for content in expected_content {
            assert!(
                user_message.contains(content),
                "Resume prompt should contain '{content}'. Full prompt:\n{user_message}"
            );
        }
    }

    /// Assert that the last prompt is a full prompt with expected stage characteristics.
    ///
    /// # Arguments
    /// * `artifact` - The artifact name this stage produces (e.g., "plan", "summary", "verdict")
    /// * `can_ask_questions` - Whether the stage has `ask_questions` capability
    /// * `has_approval` - Whether the stage has approval capability
    pub fn assert_full_prompt(&self, artifact: &str, can_ask_questions: bool, has_approval: bool) {
        let calls = self.runner.calls();
        let call = calls.last().expect("No agent calls recorded");

        // Get both system and user parts
        let system_prompt = call.system_prompt.as_ref();
        let user_message = &call.prompt;

        // User message should NOT be a resume prompt (full prompts use <!orkestra:spawn:STAGE>)
        assert!(
            !user_message.starts_with("<!orkestra:resume:"),
            "Expected full prompt (not resume), but got resume prompt starting with: {}...",
            &user_message[..user_message.len().min(100)]
        );

        // User message should contain the task section
        assert!(
            user_message.contains("## Your Current Task"),
            "User message should contain '## Your Current Task' section"
        );

        // System prompt should contain output format sections
        if let Some(sys) = system_prompt {
            assert!(
                sys.contains("Output Format") || sys.contains("output format"),
                "System prompt should contain output format instructions"
            );

            // Output format should reference the artifact name
            assert!(
                sys.contains(artifact),
                "System prompt should reference artifact '{}'. Got system prompt: {}...",
                artifact,
                &sys[..sys.len().min(500)]
            );

            // Check questions capability in system prompt
            if can_ask_questions {
                assert!(
                    sys.contains("\"questions\"") || sys.contains("questions"),
                    "System prompt for stage with ask_questions should mention questions output type"
                );
            }

            // Check approval capability in system prompt
            if has_approval {
                assert!(
                    sys.contains("approval") || sys.contains("approve"),
                    "System prompt for stage with approval capability should mention approval"
                );
            }
        } else {
            // If no system prompt, these should be in the user message (fallback mode)
            assert!(
                user_message.contains("Output Format") || user_message.contains(artifact),
                "User message should contain output format when system prompt is absent"
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
    Artifact {
        name: String,
        content: String,
        activity_log: Option<String>,
    },
    /// Agent (reviewer) is producing an approval decision.
    Approval {
        decision: String,
        content: String,
        activity_log: Option<String>,
    },
    /// Agent produced subtasks for breakdown.
    Subtasks {
        content: String,
        subtasks: Vec<orkestra_core::workflow::execution::SubtaskOutput>,
        skip_reason: Option<String>,
        activity_log: Option<String>,
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
            MockAgentOutput::Artifact {
                content,
                activity_log,
                ..
            } => StageOutput::Artifact {
                content,
                activity_log,
            },
            MockAgentOutput::Approval {
                decision,
                content,
                activity_log,
            } => StageOutput::Approval {
                decision,
                content,
                activity_log,
            },
            MockAgentOutput::Subtasks {
                content,
                subtasks,
                skip_reason,
                activity_log,
            } => StageOutput::Subtasks {
                content,
                subtasks,
                skip_reason,
                activity_log,
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
            integration: IntegrationConfig::new("work"),
            flows: indexmap::IndexMap::new(),
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

        let mut flows = indexmap::IndexMap::new();
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
                            capabilities: Some(StageCapabilities::with_approval(Some(
                                "work".into(),
                            ))),
                            ..Default::default()
                        }),
                    },
                ],
                integration: None,
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
                    .with_capabilities(orkestra_core::workflow::config::StageCapabilities {
                        subtasks: Some(
                            orkestra_core::workflow::config::SubtaskCapabilities::default()
                                .with_flow("subtask"),
                        ),
                        ..Default::default()
                    }),
                StageConfig::new("work", "summary").with_prompt("worker.md"),
                StageConfig::new("review", "verdict")
                    .with_prompt("reviewer.md")
                    .with_capabilities(
                        orkestra_core::workflow::config::StageCapabilities::with_approval(Some(
                            "work".into(),
                        )),
                    )
                    .automated(),
            ],
            integration: IntegrationConfig::new("work"),
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
            integration: IntegrationConfig::new("work"),
            flows: indexmap::IndexMap::new(),
        }
    }
}

/// Disable `auto_merge` on a workflow config.
pub fn disable_auto_merge(mut workflow: WorkflowConfig) -> WorkflowConfig {
    workflow.integration.auto_merge = false;
    workflow
}

/// Enable `auto_merge` on a workflow config.
pub fn enable_auto_merge(mut workflow: WorkflowConfig) -> WorkflowConfig {
    workflow.integration.auto_merge = true;
    workflow
}

// =============================================================================
// Assistant Test Helpers
// =============================================================================

/// Create an `AssistantService` with real `SQLite` storage and mock process spawner.
///
/// Returns (service, store, `temp_dir`). The `temp_dir` must be kept alive for the
/// duration of the test to prevent database deletion.
pub fn create_assistant_service() -> (
    orkestra_core::workflow::AssistantService,
    Arc<dyn orkestra_core::workflow::WorkflowStore>,
    TempDir,
) {
    let temp_dir = TempDir::new().expect("temp dir");
    let db_path = temp_dir.path().join("test.db");
    let conn = DatabaseConnection::open(&db_path).expect("open db");
    let store: Arc<dyn orkestra_core::workflow::WorkflowStore> =
        Arc::new(SqliteWorkflowStore::new(conn.shared()));

    let service = orkestra_core::workflow::AssistantService::new(
        Arc::clone(&store),
        test_provider_registry(),
        temp_dir.path().to_path_buf(),
    );

    (service, store, temp_dir)
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
