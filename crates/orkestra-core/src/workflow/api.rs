//! Core `WorkflowApi` struct and workflow configuration queries.

use std::path::PathBuf;
use std::sync::Arc;

use crate::commit_message::{ClaudeCommitMessageGenerator, CommitMessageGenerator};
use crate::pr_description::{ClaudePrDescriptionGenerator, PrDescriptionGenerator};
use crate::title::{ClaudeTitleGenerator, TitleGenerator};
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{LogNotification, Task};
use crate::workflow::execution::ProviderRegistry;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{GitService, PrService, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::task::setup::TaskSetupService;

/// Trait for killing active agent processes.
///
/// Used by `interrupt()` to kill the agent before transitioning state.
/// Implemented by `StageExecutionService`.
pub trait AgentKiller: Send + Sync {
    /// Kill the active agent for a task, removing it from tracking.
    /// Returns the PID that was killed, or None if no active agent was found.
    /// Implementations should handle errors internally (log and continue)
    /// since the state transition should proceed regardless.
    fn kill_agent(&self, task_id: &str) -> Option<u32>;

    /// Kill the active gate script for a task, removing it from tracking.
    /// Returns the PID that was killed, or None if no active gate was found.
    fn kill_gate(&self, task_id: &str) -> Option<u32>;
}

/// The main API for workflow operations.
///
/// This is the interface that Tauri commands, CLI, and tests use.
/// It encapsulates all business logic for task lifecycle management.
///
/// # Example
///
/// ```ignore
/// let api = WorkflowApi::new(workflow, store);
/// let task = api.create_task("Fix bug", "Fix the login bug", None)?;
/// ```
pub struct WorkflowApi {
    pub(crate) workflow: WorkflowConfig,
    pub(crate) store: Arc<dyn WorkflowStore>,
    pub(crate) git_service: Option<Arc<dyn GitService>>,
    pub(crate) iteration_service: Arc<IterationService>,
    pub(crate) title_generator: Arc<dyn TitleGenerator>,
    pub(crate) commit_message_generator: Arc<dyn CommitMessageGenerator>,
    pub(crate) pr_description_generator: Arc<dyn PrDescriptionGenerator>,
    pub(crate) pr_service: Option<Arc<dyn PrService>>,
    pub(crate) setup_service: Arc<TaskSetupService>,
    pub(crate) agent_killer: Option<Arc<dyn AgentKiller>>,
    pub(crate) provider_registry: Option<Arc<ProviderRegistry>>,
    pub(crate) project_root: Option<PathBuf>,
    /// Optional channel for push-based log notifications from stage chat.
    pub(crate) log_notify_tx: Option<std::sync::mpsc::Sender<LogNotification>>,
}

impl WorkflowApi {
    /// Create a new `WorkflowApi` with the given config and store.
    ///
    /// Git service is not configured by default. Use `with_git()` to add it.
    pub fn new(workflow: WorkflowConfig, store: Arc<dyn WorkflowStore>) -> Self {
        let iteration_service = Arc::new(IterationService::new(Arc::clone(&store)));
        let title_generator: Arc<dyn TitleGenerator> = Arc::new(ClaudeTitleGenerator);
        let commit_message_generator: Arc<dyn CommitMessageGenerator> =
            Arc::new(ClaudeCommitMessageGenerator);
        let pr_description_generator: Arc<dyn PrDescriptionGenerator> =
            Arc::new(ClaudePrDescriptionGenerator);
        let setup_service = Arc::new(TaskSetupService::new(
            Arc::clone(&store),
            None,
            Arc::clone(&title_generator),
        ));
        Self {
            workflow,
            store,
            git_service: None,
            iteration_service,
            title_generator,
            commit_message_generator,
            pr_description_generator,
            pr_service: None,
            setup_service,
            agent_killer: None,
            provider_registry: None,
            project_root: None,
            log_notify_tx: None,
        }
    }

    /// Create a new `WorkflowApi` with git worktree support.
    ///
    /// Git worktrees enable parallel task development by isolating each task
    /// in its own worktree with a dedicated branch.
    pub fn with_git(
        workflow: WorkflowConfig,
        store: Arc<dyn WorkflowStore>,
        git_service: Arc<dyn GitService>,
    ) -> Self {
        let iteration_service = Arc::new(IterationService::new(Arc::clone(&store)));
        let title_generator: Arc<dyn TitleGenerator> = Arc::new(ClaudeTitleGenerator);
        let commit_message_generator: Arc<dyn CommitMessageGenerator> =
            Arc::new(ClaudeCommitMessageGenerator);
        let pr_description_generator: Arc<dyn PrDescriptionGenerator> =
            Arc::new(ClaudePrDescriptionGenerator);
        let setup_service = Arc::new(TaskSetupService::new(
            Arc::clone(&store),
            Some(Arc::clone(&git_service)),
            Arc::clone(&title_generator),
        ));
        Self {
            workflow,
            store,
            git_service: Some(git_service),
            iteration_service,
            title_generator,
            commit_message_generator,
            pr_description_generator,
            pr_service: None,
            setup_service,
            agent_killer: None,
            provider_registry: None,
            project_root: None,
            log_notify_tx: None,
        }
    }

    /// Replace the title generator (for testing).
    #[must_use]
    pub fn with_title_generator(mut self, gen: Arc<dyn TitleGenerator>) -> Self {
        self.setup_service = Arc::new(TaskSetupService::new(
            Arc::clone(&self.store),
            self.git_service.clone(),
            Arc::clone(&gen),
        ));
        self.title_generator = gen;
        self
    }

    /// Replace the commit message generator (for testing).
    #[must_use]
    pub fn with_commit_message_generator(mut self, gen: Arc<dyn CommitMessageGenerator>) -> Self {
        self.commit_message_generator = gen;
        self
    }

    /// Replace the PR description generator (for testing).
    #[must_use]
    pub fn with_pr_description_generator(mut self, gen: Arc<dyn PrDescriptionGenerator>) -> Self {
        self.pr_description_generator = gen;
        self
    }

    /// Set the PR service.
    #[must_use]
    pub fn with_pr_service(mut self, service: Arc<dyn PrService>) -> Self {
        self.pr_service = Some(service);
        self
    }

    /// Run task setup synchronously instead of on background threads.
    ///
    /// When enabled, `create_task` and subtask setup complete inline
    /// rather than deferring to a background thread. Used by tests for
    /// deterministic execution.
    pub fn set_sync_setup(&self, sync: bool) {
        self.setup_service.set_sync(sync);
    }

    /// Set the agent killer (used by interrupt to kill active agents).
    pub fn set_agent_killer(&mut self, killer: Arc<dyn AgentKiller>) {
        self.agent_killer = Some(killer);
    }

    /// Set the log notification channel (used by stage chat to push log events).
    pub fn set_log_notify_tx(&mut self, tx: std::sync::mpsc::Sender<LogNotification>) {
        self.log_notify_tx = Some(tx);
    }

    /// Set the provider registry (required for stage chat).
    #[must_use]
    pub fn with_provider_registry(mut self, registry: Arc<ProviderRegistry>) -> Self {
        self.provider_registry = Some(registry);
        self
    }

    /// Set the project root (required for stage chat worktree resolution).
    #[must_use]
    pub fn with_project_root(mut self, project_root: PathBuf) -> Self {
        self.project_root = Some(project_root);
        self
    }

    /// Get the git service, if configured.
    pub fn git_service(&self) -> Option<&Arc<dyn GitService>> {
        self.git_service.as_ref()
    }

    /// Get the workflow configuration.
    pub fn workflow(&self) -> &WorkflowConfig {
        &self.workflow
    }

    /// Get the commit message generator.
    pub fn commit_message_generator(&self) -> &Arc<dyn CommitMessageGenerator> {
        &self.commit_message_generator
    }

    /// Get the iteration service (shared reference).
    pub fn iteration_service(&self) -> &Arc<IterationService> {
        &self.iteration_service
    }

    /// Get the next stage in a flow after the given stage.
    pub fn next_stage_after_in_flow(&self, flow: &str, stage: &str) -> Option<&str> {
        self.workflow
            .next_stage(flow, stage)
            .map(|s| s.name.as_str())
    }

    /// Get the stage to return to on integration failure.
    pub fn integration_failure_stage(&self, flow: &str) -> Option<String> {
        self.workflow.recovery_stage(flow)
    }

    /// Mark a task as being integrated.
    pub fn mark_integrating(&self, task_id: &str) -> WorkflowResult<Task> {
        crate::workflow::integration::interactions::mark_integrating::execute(
            self.store.as_ref(),
            task_id,
        )
    }

    /// Get commits on a task's branch since it diverged from the base branch.
    pub fn get_branch_commits(
        &self,
        task_id: &str,
    ) -> WorkflowResult<crate::workflow::ports::BranchCommitsResponse> {
        let git = self
            .git_service
            .as_ref()
            .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;
        crate::workflow::query::interactions::branch_commits::execute(
            self.store.as_ref(),
            git.as_ref(),
            task_id,
        )
    }

    /// Get the uncommitted diff for a task's worktree (staged + unstaged vs HEAD).
    pub fn get_uncommitted_diff(
        &self,
        task_id: &str,
    ) -> WorkflowResult<crate::workflow::ports::TaskDiff> {
        let git = self
            .git_service
            .as_ref()
            .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;
        crate::workflow::query::interactions::uncommitted_diff::execute(
            self.store.as_ref(),
            git.as_ref(),
            task_id,
        )
    }

    /// Get the diff for a task against its base branch.
    pub fn get_task_diff(&self, task_id: &str) -> WorkflowResult<crate::workflow::ports::TaskDiff> {
        let git = self
            .git_service
            .as_ref()
            .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;
        crate::workflow::query::interactions::diff::execute(
            self.store.as_ref(),
            git.as_ref(),
            task_id,
        )
    }

    /// Get the content of a file at HEAD in a task's worktree.
    pub fn get_file_content(
        &self,
        task_id: &str,
        file_path: &str,
    ) -> WorkflowResult<Option<String>> {
        let git = self
            .git_service
            .as_ref()
            .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;
        crate::workflow::query::interactions::file_content::execute(
            self.store.as_ref(),
            git.as_ref(),
            task_id,
            file_path,
        )
    }

    /// List all git-tracked files at the project root.
    pub fn list_project_files(&self) -> WorkflowResult<Vec<String>> {
        let git = self
            .git_service
            .as_ref()
            .ok_or_else(|| WorkflowError::GitError("No git service configured".into()))?;
        git.list_files()
            .map_err(|e| WorkflowError::GitError(e.to_string()))
    }

    /// Read a file from the project root's working tree.
    ///
    /// Unlike `get_file_content` (which reads from a task worktree at HEAD),
    /// this reads the live filesystem content at the project root, including
    /// uncommitted changes.
    pub fn get_project_file_content(&self, file_path: &str) -> WorkflowResult<Option<String>> {
        let project_root = self
            .project_root
            .as_ref()
            .ok_or_else(|| WorkflowError::InvalidState("No project root configured".into()))?;

        // Path traversal validation
        if file_path.contains("..")
            || file_path.starts_with('/')
            || file_path.starts_with('\\')
            || file_path.contains('\0')
        {
            return Err(WorkflowError::InvalidState(format!(
                "Invalid file path: {file_path}"
            )));
        }

        let full_path = project_root.join(file_path);

        // Verify the resolved path is under project_root
        match full_path.canonicalize() {
            Ok(canonical) => {
                let canonical_root = project_root
                    .canonicalize()
                    .map_err(|e| WorkflowError::InvalidState(e.to_string()))?;
                if !canonical.starts_with(&canonical_root) {
                    return Err(WorkflowError::InvalidState(format!(
                        "Path escapes project root: {file_path}"
                    )));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(WorkflowError::InvalidState(e.to_string())),
        }

        // Size limit: 1MB
        let metadata = std::fs::metadata(&full_path)
            .map_err(|e| WorkflowError::InvalidState(e.to_string()))?;
        if metadata.len() > 1_048_576 {
            return Err(WorkflowError::InvalidState(format!(
                "File too large: {} bytes (max 1MB)",
                metadata.len()
            )));
        }

        // Read as bytes to detect binary files
        let bytes =
            std::fs::read(&full_path).map_err(|e| WorkflowError::InvalidState(e.to_string()))?;
        match String::from_utf8(bytes) {
            Ok(content) => Ok(Some(content)),
            Err(_) => Err(WorkflowError::InvalidState(
                "Binary file cannot be displayed".into(),
            )),
        }
    }

    /// Force a task into `GateRunning` state without validation.
    ///
    /// Used by tests to simulate a crash while a gate was running.
    pub fn mark_gate_running(&self, task_id: &str, stage: &str) -> WorkflowResult<Task> {
        use crate::workflow::runtime::TaskState;
        let mut task = self
            .store
            .get_task(task_id)?
            .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;
        task.state = TaskState::gate_running(stage);
        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Generate a commit message for task integration.
    ///
    /// Collects model attribution from the workflow config, gets the diff summary
    /// from the git service, and invokes the commit message generator.
    /// Falls back to the task title if generation fails.
    pub fn generate_integration_commit_message(&self, task: &Task) -> String {
        match &self.git_service {
            Some(git) => super::integration::interactions::generate_commit_message::execute(
                git.as_ref(),
                task,
                &self.workflow,
                self.commit_message_generator.as_ref(),
            ),
            None => {
                super::integration::interactions::generate_commit_message::execute_without_diff(
                    task,
                    &self.workflow,
                    self.commit_message_generator.as_ref(),
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::{FlowConfig, GateConfig, IntegrationConfig, StageConfig};
    use crate::workflow::InMemoryWorkflowStore;
    use indexmap::IndexMap;
    use std::sync::Arc;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("breakdown", "subtasks"),
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict").with_gate(GateConfig::Automated {
                command: "checks.sh".into(),
                timeout_seconds: 600,
            }),
        ])
        .with_integration(IntegrationConfig::new("work"))
    }

    #[test]
    fn test_new() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        assert_eq!(api.workflow().stages_in_flow("default").len(), 4);
    }

    #[test]
    fn test_compute_next_state() {
        use crate::workflow::stage::interactions::finalize_advancement::compute_next_state_on_approve;

        let workflow = test_workflow();

        // Planning goes to breakdown (default flow)
        let state = compute_next_state_on_approve(&workflow, "default", "planning");
        assert_eq!(state.stage(), Some("breakdown"));

        // Breakdown goes to work
        let state = compute_next_state_on_approve(&workflow, "default", "breakdown");
        assert_eq!(state.stage(), Some("work"));

        // Work goes to review
        let state = compute_next_state_on_approve(&workflow, "default", "work");
        assert_eq!(state.stage(), Some("review"));

        // Review goes to Done
        let state = compute_next_state_on_approve(&workflow, "default", "review");
        assert_eq!(state, crate::workflow::runtime::TaskState::Done);
    }

    #[test]
    fn test_integration_failure_stage() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        // Default flow: "work" stage
        assert_eq!(
            api.integration_failure_stage("default"),
            Some("work".to_string())
        );
    }

    #[test]
    fn test_integration_failure_stage_with_flow_override() {
        let mut flows = IndexMap::new();
        flows.insert(
            "quick".to_string(),
            FlowConfig {
                stages: vec![
                    StageConfig::new("planning", "plan"),
                    StageConfig::new("work", "summary"),
                ],
                integration: IntegrationConfig::new("planning"),
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("breakdown", "subtasks"),
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict").with_gate(GateConfig::Automated {
                command: "checks.sh".into(),
                timeout_seconds: 600,
            }),
        ])
        .with_integration(IntegrationConfig::new("work"))
        .with_flows(flows);

        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        // Default flow uses default integration config
        assert_eq!(
            api.integration_failure_stage("default"),
            Some("work".to_string())
        );

        // Flow with its own integration config uses that
        assert_eq!(
            api.integration_failure_stage("quick"),
            Some("planning".to_string())
        );
    }

    #[test]
    fn test_with_commit_message_generator() {
        use crate::commit_message::mock::MockCommitMessageGenerator;

        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let mock_gen = Arc::new(MockCommitMessageGenerator::succeeding());

        let api = WorkflowApi::new(workflow, store).with_commit_message_generator(mock_gen);

        // Verify the generator can be overridden (by creating a task and calling generate)
        let task = Task::new(
            "task-1",
            "Test Task",
            "Test description",
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        let message = api.generate_integration_commit_message(&task);

        // Mock generator returns the task title followed by "Automated changes."
        assert!(message.contains("Test Task"));
        assert!(message.contains("Automated changes."));
    }

    #[test]
    fn test_generate_commit_message_fallback_on_failure() {
        use crate::commit_message::mock::MockCommitMessageGenerator;

        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let failing_gen = Arc::new(MockCommitMessageGenerator::failing());

        let api = WorkflowApi::new(workflow, store).with_commit_message_generator(failing_gen);

        let task = Task::new(
            "task-123",
            "Test Task",
            "Test description",
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        let message = api.generate_integration_commit_message(&task);

        // On failure, should fall back to task title
        assert_eq!(message, "Test Task");
    }

    #[test]
    fn test_generate_commit_message_fallback_on_empty_title() {
        use crate::commit_message::mock::MockCommitMessageGenerator;

        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let failing_gen = Arc::new(MockCommitMessageGenerator::failing());

        let api = WorkflowApi::new(workflow, store).with_commit_message_generator(failing_gen);

        let task = Task::new(
            "task-456",
            "",
            "Test description",
            "planning",
            chrono::Utc::now().to_rfc3339(),
        );
        let message = api.generate_integration_commit_message(&task);

        // On failure with empty title, should fall back to "Task {id}"
        assert_eq!(message, "Task task-456");
    }

    // ============================================================================
    // list_project_files
    // ============================================================================

    #[test]
    fn test_list_project_files_returns_tracked_files() {
        use orkestra_git::MockGitService;

        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let mock_git = Arc::new(MockGitService::new());
        mock_git.set_next_list_files_result(Ok(vec![
            "src/main.rs".to_string(),
            "Cargo.toml".to_string(),
        ]));

        let api = WorkflowApi::with_git(workflow, store, mock_git);
        let files = api.list_project_files().unwrap();

        assert_eq!(files, vec!["src/main.rs", "Cargo.toml"]);
    }

    #[test]
    fn test_list_project_files_no_git_service_returns_error() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let result = api.list_project_files();
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("No git service"), "error was: {err}");
    }

    // ============================================================================
    // get_project_file_content
    // ============================================================================

    fn api_with_project_root(dir: &std::path::Path) -> WorkflowApi {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        WorkflowApi::new(workflow, store).with_project_root(dir.to_path_buf())
    }

    #[test]
    fn test_get_project_file_content_valid_path_returns_content() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("hello.txt"), "hello world").unwrap();

        let api = api_with_project_root(dir.path());
        let content = api.get_project_file_content("hello.txt").unwrap();
        assert_eq!(content, Some("hello world".to_string()));
    }

    #[test]
    fn test_get_project_file_content_nonexistent_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let api = api_with_project_root(dir.path());

        let result = api.get_project_file_content("does_not_exist.txt").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_get_project_file_content_dotdot_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let api = api_with_project_root(dir.path());

        let result = api.get_project_file_content("../etc/passwd");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid file path"), "error was: {err}");
    }

    #[test]
    fn test_get_project_file_content_absolute_path_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let api = api_with_project_root(dir.path());

        let result = api.get_project_file_content("/etc/passwd");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid file path"), "error was: {err}");
    }

    #[test]
    fn test_get_project_file_content_null_byte_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let api = api_with_project_root(dir.path());

        let result = api.get_project_file_content("file\0name.txt");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid file path"), "error was: {err}");
    }

    #[test]
    fn test_get_project_file_content_symlink_escape_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "secret").unwrap();

        // Create a symlink inside project root pointing outside
        let link_path = dir.path().join("escape_link.txt");
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), &link_path).unwrap();

        let api = api_with_project_root(dir.path());
        let result = api.get_project_file_content("escape_link.txt");

        // Should fail: canonical path escapes project root
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("escapes project root"), "error was: {err}");
    }

    #[test]
    fn test_get_project_file_content_over_1mb_rejected() {
        let dir = tempfile::tempdir().unwrap();
        // Write a file just over 1MB
        let large: Vec<u8> = vec![b'a'; 1_048_577];
        std::fs::write(dir.path().join("large.txt"), &large).unwrap();

        let api = api_with_project_root(dir.path());
        let result = api.get_project_file_content("large.txt");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("too large"), "error was: {err}");
    }

    #[test]
    fn test_get_project_file_content_binary_rejected() {
        let dir = tempfile::tempdir().unwrap();
        // Write bytes that are not valid UTF-8
        let binary: Vec<u8> = vec![0xFF, 0xFE, 0x00, 0x01, 0x80];
        std::fs::write(dir.path().join("binary.bin"), &binary).unwrap();

        let api = api_with_project_root(dir.path());
        let result = api.get_project_file_content("binary.bin");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Binary file"), "error was: {err}");
    }
}
