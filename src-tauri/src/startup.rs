//! Startup validation and initialization system.
//!
//! This module handles application startup, including:
//! - Loading and validating workflow configuration
//! - Running database migrations
//! - Reporting startup status to the frontend
//!
//! The app always starts (Tauri window opens), but if startup fails,
//! the frontend displays an error screen instead of the normal UI.

use std::path::PathBuf;
use std::sync::RwLock;

use orkestra_core::{
    find_project_root,
    workflow::{load_workflow_for_project, LoadError},
};
use serde::Serialize;

use crate::state::AppState;

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
    /// `AppState` if initialization succeeded (None if failed)
    pub app_state: Option<AppState>,
}

// =============================================================================
// Startup Orchestration
// =============================================================================

/// Run all startup tasks and return the result.
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

    let mut warnings = Vec::new();

    // Step 1: Find project root
    let project_root = match find_project_root() {
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

    let orkestra_dir = project_root.join(".orkestra");

    // Step 2: Initialize debug logging (non-fatal)
    orkestra_core::debug_log::init(&orkestra_dir);

    // Step 3: Load workflow config
    let workflow_config = match load_workflow_for_project(&project_root) {
        Ok(config) => config,
        Err(e) => {
            let error = map_load_error_to_startup_error(e);
            return StartupResult {
                status: StartupStatus::failed(vec![error]),
                app_state: None,
            };
        }
    };

    // Step 4: Validate config (defensive - should be validated during load, but double-check)
    let validation_errors = workflow_config.validate();
    if !validation_errors.is_empty() {
        return StartupResult {
            status: StartupStatus::failed(vec![StartupError::new(
                StartupErrorCategory::ConfigValidationError,
                "Workflow configuration is invalid",
            )
            .with_details(validation_errors)
            .with_remediation("Fix the errors in .orkestra/workflow.yaml and click Retry")]),
            app_state: None,
        };
    }

    // Step 5: Open database and create AppState (runs migrations)
    let db_path = orkestra_dir.join("orkestra.db");
    let app_state = match AppState::new(workflow_config, &db_path, project_root.clone()) {
        Ok(state) => state,
        Err(e) => {
            return StartupResult {
                status: StartupStatus::failed(vec![StartupError::new(
                    StartupErrorCategory::DatabaseError,
                    format!("Failed to initialize database: {e}"),
                )
                .with_remediation(
                    "Try deleting .orkestra/workflow.db to start fresh \
                     (this will delete existing tasks)",
                )]),
                app_state: None,
            };
        }
    };

    // Check if git service is available (non-fatal warning if not)
    if !app_state.has_git_service() {
        warnings.push(
            StartupWarning::new("Git service unavailable")
                .with_context("Tasks will run without git worktree isolation"),
        );
    }

    StartupResult {
        status: StartupStatus::ready(project_root, warnings),
        app_state: Some(app_state),
    }
}

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
