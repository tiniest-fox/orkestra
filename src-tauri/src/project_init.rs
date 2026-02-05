//! Project initialization and validation.
//!
//! Handles creating `.orkestra` directories for new projects and validating existing ones.

use std::path::Path;

use orkestra_core::orkestra_debug;
use orkestra_core::workflow::{load_auto_task_templates, load_workflow_for_project};

use crate::project_registry::ProjectState;

/// Initialize an `.orkestra` directory for a project.
///
/// If the directory doesn't exist, creates it with a default `workflow.yaml`.
/// Returns a `ProjectState` for the initialized project.
pub fn initialize_project(project_root: &Path) -> Result<ProjectState, String> {
    let orkestra_dir = project_root.join(".orkestra");

    // Create .orkestra directory structure if needed
    orkestra_debug!(
        "project_init",
        "Ensuring .orkestra structure at {}",
        orkestra_dir.display()
    );
    orkestra_core::ensure_orkestra_project(&orkestra_dir).map_err(|e| {
        format!(
            "Failed to create .orkestra structure at {}: {}",
            orkestra_dir.display(),
            e
        )
    })?;

    // Initialize debug logging for this project
    orkestra_core::debug_log::init(&orkestra_dir);

    // Initialize agent output logging (separate from debug logs)
    orkestra_core::debug_log::init_agent_log(&orkestra_dir);

    // Load or create workflow config
    let workflow_config = load_workflow_for_project(project_root).map_err(|e| {
        format!(
            "Failed to load workflow config for {}: {}",
            project_root.display(),
            e
        )
    })?;

    // Validate config
    let validation_errors = workflow_config.validate();
    if !validation_errors.is_empty() {
        return Err(format!(
            "Workflow configuration is invalid: {}",
            validation_errors.join("; ")
        ));
    }

    // Load auto-task templates (non-fatal — empty list on failure)
    let auto_task_templates = load_auto_task_templates(project_root, &workflow_config);

    // Create database path
    let db_path = orkestra_dir.join(".database/orkestra.db");

    // Create ProjectState (initializes database connection)
    ProjectState::new(
        workflow_config,
        auto_task_templates,
        &db_path,
        project_root.to_path_buf(),
    )
}

/// Validate that a project directory exists and can be initialized.
pub fn validate_project_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", path.display()));
    }

    // Check if we can create .orkestra directory
    let orkestra_dir = path.join(".orkestra");
    if orkestra_dir.exists() && !orkestra_dir.is_dir() {
        return Err(format!(
            ".orkestra exists but is not a directory: {}",
            orkestra_dir.display()
        ));
    }

    Ok(())
}
