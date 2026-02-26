//! E2E tests for startup validation.
//!
//! These tests verify that invalid workflow configurations produce
//! clear, actionable error messages during startup.

use orkestra_core::workflow::config::{load_workflow, LoadError, WorkflowConfig};
use std::fs;
use tempfile::TempDir;

/// Helper to create a temp project with a workflow.yaml
fn create_project_with_workflow(yaml: &str) -> TempDir {
    let temp = TempDir::new().unwrap();
    let orkestra_dir = temp.path().join(".orkestra");
    fs::create_dir_all(&orkestra_dir).unwrap();
    fs::write(orkestra_dir.join("workflow.yaml"), yaml).unwrap();
    temp
}

// =============================================================================
// Invalid Configuration Tests
// =============================================================================

#[test]
fn test_startup_with_duplicate_stage_names() {
    let yaml = r"
version: 1
stages:
  - name: work
    artifact: summary1
  - name: work
    artifact: summary2
";
    let _temp = create_project_with_workflow(yaml);
    let config: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
    let errors = config.validate();

    assert!(!errors.is_empty(), "Should have validation errors");
    assert!(
        errors.iter().any(|e| e.contains("Duplicate stage name")),
        "Should mention duplicate stage name: {errors:?}"
    );
}

#[test]
fn test_startup_with_duplicate_artifact_names() {
    let yaml = r"
version: 1
stages:
  - name: planning
    artifact: output
  - name: work
    artifact: output
";
    let config: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
    let errors = config.validate();

    assert!(!errors.is_empty(), "Should have validation errors");
    assert!(
        errors.iter().any(|e| e.contains("Duplicate artifact name")),
        "Should mention duplicate artifact: {errors:?}"
    );
}

#[test]
fn test_startup_with_invalid_approval_rejection_stage() {
    use orkestra_core::workflow::config::{StageCapabilities, StageConfig};

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan"),
        StageConfig::new("review", "verdict")
            .with_capabilities(StageCapabilities::with_approval(Some("nonexistent".into()))),
    ]);

    let errors = workflow.validate();

    assert!(!errors.is_empty(), "Should have validation errors");
    assert!(
        errors
            .iter()
            .any(|e| e.contains("rejection_stage") && e.contains("doesn't exist")),
        "Should mention invalid rejection_stage: {errors:?}"
    );
}

#[test]
fn test_startup_with_invalid_integration_on_failure() {
    use orkestra_core::workflow::config::{IntegrationConfig, StageConfig};

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan"),
        StageConfig::new("work", "summary"),
    ])
    .with_integration(IntegrationConfig {
        on_failure: "nonexistent".to_string(),
        auto_merge: true,
    });

    let errors = workflow.validate();

    assert!(!errors.is_empty(), "Should have validation errors");
    assert!(
        errors
            .iter()
            .any(|e| e.contains("Integration on_failure") && e.contains("doesn't exist")),
        "Should mention invalid integration on_failure: {errors:?}"
    );
}

// =============================================================================
// Valid Configuration Tests
// =============================================================================

#[test]
fn test_startup_with_valid_config_succeeds() {
    let yaml = r"
version: 1
stages:
  - name: planning
    artifact: plan
  - name: work
    artifact: summary
integration:
  on_failure: work
";
    let config: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
    let errors = config.validate();

    assert!(
        errors.is_empty(),
        "Valid config should have no errors: {errors:?}"
    );
}

#[test]
fn test_startup_with_missing_file_returns_error() {
    let temp = TempDir::new().unwrap();
    // No workflow.yaml file exists

    let result = load_workflow(&temp.path().join(".orkestra/workflow.yaml"));
    assert!(
        matches!(result, Err(LoadError::NotFound(_))),
        "Should return NotFound error when file is missing"
    );
}

// =============================================================================
// Error Message Quality Tests
// =============================================================================

#[test]
fn test_approval_error_shows_valid_options() {
    use orkestra_core::workflow::config::{StageCapabilities, StageConfig};

    let workflow = WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan"),
        StageConfig::new("work", "summary"),
        StageConfig::new("review", "verdict")
            .with_capabilities(StageCapabilities::with_approval(Some("nonexistent".into()))),
    ]);

    let errors = workflow.validate();
    assert!(!errors.is_empty());
    let error = &errors[0];

    // Should list valid stages
    assert!(
        error.contains("planning") || error.contains("work") || error.contains("review"),
        "Should show valid stage options: {error}"
    );
}
