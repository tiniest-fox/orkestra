//! Workflow configuration loading.
//!
//! Loads workflow configuration from YAML files. Errors if the file is missing.

use std::path::Path;

use super::WorkflowConfig;

/// Error type for workflow loading.
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    /// Workflow file not found.
    #[error("No workflow.yaml found at {0} — Orkestra requires a workflow.yaml to operate")]
    NotFound(String),

    /// File could not be read.
    #[error("Failed to read workflow file: {0}")]
    Io(#[from] std::io::Error),

    /// YAML parsing failed.
    #[error("Failed to parse workflow YAML: {0}")]
    Parse(#[from] serde_yaml::Error),

    /// Workflow validation failed.
    #[error("Invalid workflow configuration: {0}")]
    Validation(String),
}

/// Load workflow configuration from a YAML file.
///
/// Returns an error if the file doesn't exist.
/// Validates the configuration after loading.
pub fn load_workflow(path: &Path) -> Result<WorkflowConfig, LoadError> {
    if !path.exists() {
        return Err(LoadError::NotFound(path.display().to_string()));
    }

    let content = std::fs::read_to_string(path)?;
    let config: WorkflowConfig = serde_yaml::from_str(&content)?;

    let errors = config.validate();
    if !errors.is_empty() {
        return Err(LoadError::Validation(errors.join("; ")));
    }

    Ok(config)
}

/// Load workflow from a project directory.
///
/// Looks for `.orkestra/workflow.yaml` in the project root.
/// Returns an error if the file doesn't exist.
pub fn load_workflow_for_project(project_root: &Path) -> Result<WorkflowConfig, LoadError> {
    let workflow_path = project_root.join(".orkestra").join("workflow.yaml");
    load_workflow(&workflow_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_load_nonexistent_returns_error() {
        let path = Path::new("/nonexistent/workflow.yaml");
        let result = load_workflow(path);
        assert!(matches!(result, Err(LoadError::NotFound(_))));
    }

    #[test]
    fn test_load_valid_yaml() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("workflow.yaml");

        let yaml = r"
flows:
  default:
    stages:
      - name: planning
        artifact: plan
      - name: work
        artifact: summary
    integration:
      on_failure: work
";
        std::fs::write(&path, yaml).unwrap();

        let result = load_workflow(&path);
        assert!(result.is_ok());

        let config = result.unwrap();
        assert_eq!(config.stages_in_flow("default").len(), 2);
        assert_eq!(
            config.stage("default", "planning").unwrap().artifact_name(),
            "plan"
        );
    }

    #[test]
    fn test_load_invalid_yaml() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("workflow.yaml");

        std::fs::write(&path, "not: valid: yaml: {{").unwrap();

        let result = load_workflow(&path);
        assert!(matches!(result, Err(LoadError::Parse(_))));
    }

    #[test]
    fn test_load_invalid_workflow() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("workflow.yaml");

        // Duplicate stage names - should fail validation
        let yaml = r"
flows:
  default:
    stages:
      - name: planning
        artifact: plan
      - name: planning
        artifact: other
    integration:
      on_failure: planning
";
        std::fs::write(&path, yaml).unwrap();

        let result = load_workflow(&path);
        assert!(matches!(result, Err(LoadError::Validation(_))));
    }

    #[test]
    fn test_load_workflow_for_project() {
        let dir = tempdir().unwrap();
        let orkestra_dir = dir.path().join(".orkestra");
        std::fs::create_dir(&orkestra_dir).unwrap();

        let workflow_path = orkestra_dir.join("workflow.yaml");
        let yaml = r"
flows:
  default:
    stages:
      - name: custom_stage
        artifact: custom_output
    integration:
      on_failure: custom_stage
";
        std::fs::write(&workflow_path, yaml).unwrap();

        let result = load_workflow_for_project(dir.path());
        assert!(result.is_ok());

        let config = result.unwrap();
        let stages = config.stages_in_flow("default");
        assert_eq!(stages.len(), 1);
        assert_eq!(stages[0].name, "custom_stage");
        assert_eq!(
            config.flow("default").unwrap().integration.on_failure,
            "custom_stage"
        );
    }

    #[test]
    fn test_load_workflow_for_project_no_file() {
        let dir = tempdir().unwrap();
        // No .orkestra directory

        let result = load_workflow_for_project(dir.path());
        assert!(matches!(result, Err(LoadError::NotFound(_))));
    }
}
