//! Startup validation and initialization system.
//!
//! This module handles project initialization, including:
//! - Loading and validating workflow configuration
//! - Running database migrations
//! - Reporting startup status to the frontend
//!
//! The app always starts (Tauri window opens), but if startup fails,
//! the frontend displays an error screen instead of the normal UI.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::RwLock;
use std::thread;
use std::time::Duration;

use orkestra_core::orkestra_debug;
use orkestra_core::workflow::{
    load_auto_task_templates, load_workflow_for_project, LoadError, OrchestratorLoop,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::project_registry::ProjectState;

// =============================================================================
// Startup Error Types
// =============================================================================

/// Category of startup error for programmatic handling.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupErrorCategory {
    /// Could not find project root (.orkestra or workspace Cargo.toml)
    ProjectNotFound,
    /// Failed to read or parse workflow.yaml
    ConfigLoadError,
    /// workflow.yaml parsed but failed validation
    ConfigValidationError,
    /// Database failed to open or migrate
    DatabaseError,
}

/// A startup error with details and remediation suggestion.
#[derive(Debug, Clone, Serialize)]
pub struct StartupError {
    /// Error category for programmatic handling
    pub category: StartupErrorCategory,
    /// Human-readable error message
    pub message: String,
    /// Additional details (e.g., list of validation errors)
    pub details: Vec<String>,
    /// Suggested fix for the user
    pub remediation: Option<String>,
}

impl StartupError {
    /// Create a new startup error.
    pub fn new(category: StartupErrorCategory, message: impl Into<String>) -> Self {
        Self {
            category,
            message: message.into(),
            details: vec![],
            remediation: None,
        }
    }

    /// Add details to the error.
    #[must_use]
    pub fn with_details(mut self, details: Vec<String>) -> Self {
        self.details = details;
        self
    }

    /// Add a remediation suggestion.
    #[must_use]
    pub fn with_remediation(mut self, remediation: impl Into<String>) -> Self {
        self.remediation = Some(remediation.into());
        self
    }
}

/// A non-fatal warning during startup.
#[derive(Debug, Clone, Serialize)]
pub struct StartupWarning {
    /// Warning message
    pub message: String,
    /// Additional context
    pub context: Option<String>,
}

impl StartupWarning {
    /// Create a new warning.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            context: None,
        }
    }

    /// Add context to the warning.
    #[must_use]
    pub fn with_context(mut self, context: impl Into<String>) -> Self {
        self.context = Some(context.into());
        self
    }
}

// =============================================================================
// Startup Status
// =============================================================================

/// Result of the startup process, reported to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum StartupStatus {
    /// Startup is in progress
    Initializing,
    /// Startup completed successfully
    Ready {
        /// Path to the project root
        project_root: String,
        /// Non-fatal warnings (e.g., git service unavailable)
        warnings: Vec<StartupWarning>,
    },
    /// Startup failed with errors
    Failed {
        /// List of errors that caused startup to fail
        errors: Vec<StartupError>,
    },
}

impl StartupStatus {
    /// Create an initializing status.
    pub fn initializing() -> Self {
        Self::Initializing
    }

    /// Create a ready status.
    pub fn ready(project_root: PathBuf, warnings: Vec<StartupWarning>) -> Self {
        Self::Ready {
            project_root: project_root.display().to_string(),
            warnings,
        }
    }

    /// Create a failed status.
    pub fn failed(errors: Vec<StartupError>) -> Self {
        Self::Failed { errors }
    }
}

// =============================================================================
// Startup State (Tauri managed state)
// =============================================================================

/// Startup state that is always available, even when initialization fails.
///
/// This is managed by Tauri separately from `AppState` so that the frontend
/// can always query startup status, even if the main app state failed to initialize.
///
/// Uses `RwLock` to allow updating status from a background thread after the
/// window opens.
pub struct StartupState {
    status: RwLock<StartupStatus>,
}

impl StartupState {
    /// Create startup state from a status.
    pub fn from_status(status: StartupStatus) -> Self {
        Self {
            status: RwLock::new(status),
        }
    }

    /// Create startup state in the initializing state.
    pub fn initializing() -> Self {
        Self::from_status(StartupStatus::initializing())
    }

    /// Get the startup status.
    pub fn status(&self) -> StartupStatus {
        self.status.read().unwrap().clone()
    }

    /// Update the startup status.
    pub fn set_status(&self, status: StartupStatus) {
        *self.status.write().unwrap() = status;
    }
}

// =============================================================================
// Startup Result
// =============================================================================

/// Result of running all startup tasks.
pub struct StartupResult {
    /// The status to report to frontend
    pub status: StartupStatus,
    /// `ProjectState` if initialization succeeded (None if failed)
    pub app_state: Option<ProjectState>,
}

// =============================================================================
// Project Initialization
// =============================================================================

/// Initialize a project at the given path.
///
/// This function loads and validates the workflow configuration, opens the database,
/// and creates a `ProjectState`. It also cleans up any orphaned agents from previous
/// crashes to enable auto-resume.
///
/// This function always returns (never panics) so that initialization errors can be
/// displayed to the user.
pub fn initialize_project(project_path: &Path) -> Result<ProjectState, StartupStatus> {
    let mut warnings = Vec::new();
    let orkestra_dir = project_path.join(".orkestra");

    // Step 1: Validate project path
    if let Err(e) = crate::project_init::validate_project_path(project_path) {
        return Err(StartupStatus::failed(vec![StartupError::new(
            StartupErrorCategory::ProjectNotFound,
            e.to_string(),
        )
        .with_remediation(match e {
            crate::project_init::ProjectInitError::PathNotFound { remediation, .. }
            | crate::project_init::ProjectInitError::NotADirectory { remediation, .. }
            | crate::project_init::ProjectInitError::PermissionDenied { remediation, .. }
            | crate::project_init::ProjectInitError::CreateFailed { remediation, .. } => {
                remediation
            }
        })]));
    }

    // Step 2: Initialize .orkestra directory (creates if missing)
    if let Err(e) = crate::project_init::initialize_orkestra_dir(project_path) {
        return Err(StartupStatus::failed(vec![StartupError::new(
            StartupErrorCategory::ProjectNotFound,
            e.to_string(),
        )
        .with_remediation(match e {
            crate::project_init::ProjectInitError::PathNotFound { remediation, .. }
            | crate::project_init::ProjectInitError::NotADirectory { remediation, .. }
            | crate::project_init::ProjectInitError::PermissionDenied { remediation, .. }
            | crate::project_init::ProjectInitError::CreateFailed { remediation, .. } => {
                remediation
            }
        })]));
    }

    // Step 3: Initialize debug logging (non-fatal)
    orkestra_core::debug_log::init(&orkestra_dir);

    // Step 4: Load workflow config
    let workflow_config = match load_workflow_for_project(project_path) {
        Ok(config) => config,
        Err(e) => {
            let error = map_load_error_to_startup_error(e);
            return Err(StartupStatus::failed(vec![error]));
        }
    };

    // Step 5: Validate config (defensive - should be validated during load, but double-check)
    let validation_errors = workflow_config.validate();
    if !validation_errors.is_empty() {
        return Err(StartupStatus::failed(vec![StartupError::new(
            StartupErrorCategory::ConfigValidationError,
            "Workflow configuration is invalid",
        )
        .with_details(validation_errors)
        .with_remediation(
            "Fix the errors in .orkestra/workflow.yaml and try again",
        )]));
    }

    // Step 6: Load auto-task templates (non-fatal — empty list on failure)
    let auto_task_templates = load_auto_task_templates(project_path, &workflow_config);

    // Step 7: Open database and create ProjectState (runs migrations)
    let db_path = orkestra_dir.join("orkestra.db");
    let project_state = match ProjectState::new(
        workflow_config,
        auto_task_templates,
        &db_path,
        project_path.to_path_buf(),
    ) {
        Ok(state) => state,
        Err(e) => {
            return Err(StartupStatus::failed(vec![StartupError::new(
                StartupErrorCategory::DatabaseError,
                format!("Failed to initialize database: {e}"),
            )
            .with_remediation(
                "Try deleting .orkestra/orkestra.db to start fresh \
                 (this will delete existing tasks)",
            )]));
        }
    };

    // Step 8: Clean up orphaned agents from previous crash (enables auto-resume)
    cleanup_orphaned_agents(&project_state);

    // Check if git service is available (non-fatal warning if not)
    if !project_state.has_git_service() {
        warnings.push(
            StartupWarning::new("Git service unavailable")
                .with_context("Tasks will run without git worktree isolation"),
        );
    }

    // Update the status to indicate success
    if !warnings.is_empty() {
        orkestra_debug!("startup", "Project initialized with warnings");
    }

    Ok(project_state)
}

/// Clean up any orphaned agent processes from a previous crash.
///
/// Called during project initialization to ensure stale PIDs don't prevent new agents
/// from spawning. Delegates to core's `cleanup_orphaned_agents()` which kills processes
/// and clears stale PIDs from sessions.
fn cleanup_orphaned_agents(project_state: &ProjectState) {
    orkestra_debug!("startup", "Checking for orphaned agents...");

    let Ok(api) = project_state.api() else {
        orkestra_debug!("startup", "Failed to get API lock");
        return;
    };

    match api.cleanup_orphaned_agents() {
        Ok(orphans) if orphans > 0 => {
            orkestra_debug!("startup", "Cleaned up {} orphaned agent(s)", orphans);
        }
        Ok(_) => {
            orkestra_debug!("startup", "No orphaned agents found");
        }
        Err(e) => {
            orkestra_debug!("startup", "Failed to clean up orphaned agents: {}", e);
        }
    }
}

// =============================================================================
// Legacy Startup Function (DEPRECATED)
// =============================================================================

/// Run all startup tasks and return the result.
///
/// DEPRECATED: This function will be removed in subtask 2. Use `initialize_project` instead.
///
/// This function always returns (never panics) so that Tauri can start
/// and display an error to the user if needed.
pub fn run_startup() -> StartupResult {
    // Load .env files. More specific files are loaded first so their values
    // take precedence. Neither call uses _override, so process environment
    // always wins over file values.
    // Precedence: process env > .env.development > .env
    if cfg!(debug_assertions) {
        dotenvy::from_filename(".env.development").ok();
    }
    dotenvy::dotenv().ok();

    // Step 1: Find project root
    let project_root = match orkestra_core::find_project_root() {
        Ok(root) => root,
        Err(e) => {
            return StartupResult {
                status: StartupStatus::failed(vec![StartupError::new(
                    StartupErrorCategory::ProjectNotFound,
                    format!("Failed to find project root: {e}"),
                )
                .with_remediation(
                    "Run Orkestra from within a project directory that has a .orkestra folder \
                     or a workspace Cargo.toml",
                )]),
                app_state: None,
            };
        }
    };

    // Step 2: Initialize the project
    match initialize_project(&project_root) {
        Ok(project_state) => StartupResult {
            status: StartupStatus::ready(project_root, vec![]),
            app_state: Some(project_state),
        },
        Err(status) => StartupResult {
            status,
            app_state: None,
        },
    }
}

// =============================================================================
// Orchestrator Lifecycle
// =============================================================================

/// Start the orchestrator loop for a project in a background thread.
///
/// This spawns a background thread that continuously checks for tasks needing agents
/// and spawns them as needed. The orchestrator emits events to the frontend via
/// the provided `AppHandle`.
///
/// The orchestrator respects the project's stop flag for graceful shutdown.
pub fn start_project_orchestrator(app_handle: AppHandle, project: &ProjectState) {
    let api = project.api_arc();
    let workflow = project.config().clone();
    let project_root = project.project_root().to_path_buf();
    let store = project.create_store();
    let stop_flag = project.stop_flag();

    thread::spawn(move || {
        let orchestrator = OrchestratorLoop::for_project(api, workflow, project_root, store);

        // Share the orchestrator's stop flag with the project's stop flag
        let orch_stop = orchestrator.stop_flag();

        // Forward stop signal from project to orchestrator
        let stop_flag_clone = stop_flag.clone();
        thread::spawn(move || {
            while !stop_flag_clone.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(100));
            }
            orch_stop.store(true, Ordering::Relaxed);
        });

        // Run the orchestrator with event handling
        orchestrator.run(move |event| {
            handle_orchestrator_event(&app_handle, &event);
        });

        orkestra_debug!("orchestrator", "Stopped");
    });
}

/// Handle an orchestrator event by logging it and emitting a task-updated event.
fn handle_orchestrator_event(
    app_handle: &AppHandle,
    event: &orkestra_core::workflow::OrchestratorEvent,
) {
    use orkestra_core::workflow::OrchestratorEvent;

    match event {
        OrchestratorEvent::AgentSpawned {
            task_id,
            stage,
            pid,
        } => {
            orkestra_debug!(
                "orchestrator",
                "Spawned {stage} agent for {task_id} (pid: {pid})"
            );
            let _ = app_handle.emit("task-updated", task_id);
        }
        OrchestratorEvent::OutputProcessed {
            task_id,
            stage,
            output_type,
        } => {
            orkestra_debug!(
                "orchestrator",
                "Processed {output_type} output from {stage} for {task_id}"
            );
            let _ = app_handle.emit("task-updated", task_id);
            // Note: Desktop notifications would be handled here in subtask 2
            // when per-window notification handling is implemented
        }
        OrchestratorEvent::Error { task_id, error } => {
            orkestra_debug!("orchestrator", "Error: {error}");
            if let Some(id) = task_id {
                let _ = app_handle.emit("task-updated", id);
            }
        }
        OrchestratorEvent::IntegrationStarted { task_id, branch } => {
            orkestra_debug!(
                "orchestrator",
                "Starting integration for {task_id} (branch: {branch})"
            );
            let _ = app_handle.emit("task-updated", task_id);
        }
        OrchestratorEvent::IntegrationCompleted { task_id } => {
            orkestra_debug!("orchestrator", "Integration completed for {task_id}");
            let _ = app_handle.emit("task-updated", task_id);
        }
        OrchestratorEvent::IntegrationFailed { task_id, error, .. } => {
            orkestra_debug!("orchestrator", "Integration failed for {task_id}: {error}");
            let _ = app_handle.emit("task-updated", task_id);
        }
        OrchestratorEvent::ScriptSpawned {
            task_id,
            stage,
            command,
            pid,
        } => {
            orkestra_debug!(
                "orchestrator",
                "Spawned script for {task_id}/{stage}: {command} (pid: {pid})"
            );
            let _ = app_handle.emit("task-updated", task_id);
        }
        OrchestratorEvent::ScriptCompleted { task_id, stage } => {
            orkestra_debug!("orchestrator", "Script completed for {task_id}/{stage}");
            let _ = app_handle.emit("task-updated", task_id);
        }
        OrchestratorEvent::ScriptFailed {
            task_id,
            stage,
            error,
            recovery_stage,
        } => {
            let recovery = recovery_stage.as_deref().unwrap_or("none");
            orkestra_debug!(
                "orchestrator",
                "Script failed for {task_id}/{stage}: {error} (recovery: {recovery})"
            );
            let _ = app_handle.emit("task-updated", task_id);
        }
        OrchestratorEvent::ParentAdvanced {
            task_id,
            subtask_count,
        } => {
            orkestra_debug!(
                "orchestrator",
                "Parent {task_id} advanced: all {subtask_count} subtasks done"
            );
            let _ = app_handle.emit("task-updated", task_id);
        }
    }
}

// =============================================================================
// Error Mapping
// =============================================================================

/// Map a workflow load error to a startup error.
fn map_load_error_to_startup_error(error: LoadError) -> StartupError {
    match error {
        LoadError::Io(e) => StartupError::new(
            StartupErrorCategory::ConfigLoadError,
            format!("Failed to read workflow.yaml: {e}"),
        )
        .with_remediation("Check that .orkestra/workflow.yaml exists and is readable"),

        LoadError::Parse(e) => StartupError::new(
            StartupErrorCategory::ConfigLoadError,
            "Invalid YAML syntax in workflow.yaml",
        )
        .with_details(vec![e.to_string()])
        .with_remediation("Fix the YAML syntax errors in .orkestra/workflow.yaml"),

        LoadError::Validation(errors) => StartupError::new(
            StartupErrorCategory::ConfigValidationError,
            "Workflow configuration is invalid",
        )
        .with_details(errors.split("; ").map(String::from).collect())
        .with_remediation("Fix the configuration errors in .orkestra/workflow.yaml"),
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_initialize_project_success() {
        let temp_dir = TempDir::new().unwrap();
        let project_path = temp_dir.path();

        // Don't create .orkestra directory - it should be created automatically
        // Initialize the project
        let result = initialize_project(project_path);
        assert!(result.is_ok());

        let project_state = result.unwrap();
        assert_eq!(project_state.project_root(), project_path);

        // Verify .orkestra was created
        assert!(project_path.join(".orkestra").exists());
    }

    #[test]
    fn test_initialize_project_auto_creates_orkestra_dir() {
        let temp_dir = TempDir::new().unwrap();
        let project_path = temp_dir.path();

        // Don't create .orkestra directory - should be created automatically
        assert!(!project_path.join(".orkestra").exists());

        let result = initialize_project(project_path);

        // Should succeed with default config
        assert!(result.is_ok());
        let _ = result.unwrap();
        // Verify .orkestra was created by initialize_orkestra_dir
        assert!(project_path.join(".orkestra").exists());
    }

    #[test]
    fn test_initialize_project_creates_state_with_default_config() {
        let temp_dir = TempDir::new().unwrap();
        let project_path = temp_dir.path();

        // Don't create .orkestra or workflow.yaml - should use defaults
        // Should succeed with default config
        let result = initialize_project(project_path);
        assert!(result.is_ok());

        let project_state = result.unwrap();
        // Verify config has default stages
        assert!(!project_state.config().stages.is_empty());
    }

    #[test]
    fn test_initialize_project_with_custom_workflow() {
        let temp_dir = TempDir::new().unwrap();
        let project_path = temp_dir.path();

        // First, initialize the project to create .orkestra
        let _ = initialize_project(project_path);

        let orkestra_dir = project_path.join(".orkestra");

        // Create a custom workflow.yaml
        let workflow_yaml = r"
stages:
  - name: planning
    artifact: plan
    inputs: []
    capabilities:
      ask_questions: true
  - name: work
    artifact: summary
    inputs: [plan]
    capabilities:
      ask_questions: false
";
        fs::write(orkestra_dir.join("workflow.yaml"), workflow_yaml).unwrap();

        // Initialize the project
        let result = initialize_project(project_path);
        assert!(result.is_ok());

        let project_state = result.unwrap();
        // Verify custom config was loaded
        assert_eq!(project_state.config().stages.len(), 2);
        assert_eq!(project_state.config().stages[0].name, "planning");
        assert_eq!(project_state.config().stages[1].name, "work");
    }

    #[test]
    fn test_initialize_project_invalid_workflow_yaml() {
        let temp_dir = TempDir::new().unwrap();
        let project_path = temp_dir.path();

        // First, initialize to create .orkestra
        let _ = initialize_project(project_path);

        let orkestra_dir = project_path.join(".orkestra");

        // Create an invalid workflow.yaml
        let invalid_yaml = "this is not valid yaml: [";
        fs::write(orkestra_dir.join("workflow.yaml"), invalid_yaml).unwrap();

        // Initialize should fail with config load error
        let result = initialize_project(project_path);
        assert!(result.is_err());

        if let Err(status) = result {
            match status {
                StartupStatus::Failed { errors } => {
                    assert_eq!(errors.len(), 1);
                    assert!(matches!(
                        errors[0].category,
                        StartupErrorCategory::ConfigLoadError
                    ));
                }
                _ => panic!("Expected Failed status"),
            }
        }
    }

    #[test]
    fn test_initialize_project_invalid_path() {
        let path = Path::new("/nonexistent/path/that/does/not/exist");
        let result = initialize_project(path);
        assert!(result.is_err());

        if let Err(status) = result {
            match status {
                StartupStatus::Failed { errors } => {
                    assert_eq!(errors.len(), 1);
                    assert!(matches!(
                        errors[0].category,
                        StartupErrorCategory::ProjectNotFound
                    ));
                }
                _ => panic!("Expected Failed status"),
            }
        }
    }

    #[test]
    fn test_initialize_project_file_not_directory() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("file.txt");
        fs::write(&file_path, "test").unwrap();

        let result = initialize_project(&file_path);
        assert!(result.is_err());

        if let Err(status) = result {
            match status {
                StartupStatus::Failed { errors } => {
                    assert_eq!(errors.len(), 1);
                    assert!(matches!(
                        errors[0].category,
                        StartupErrorCategory::ProjectNotFound
                    ));
                }
                _ => panic!("Expected Failed status"),
            }
        }
    }
}
