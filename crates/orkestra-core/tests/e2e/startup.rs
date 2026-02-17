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
fn test_startup_with_invalid_input_reference() {
    let yaml = r"
version: 1
stages:
  - name: work
    artifact: summary
    inputs: [plan]
";
    let temp = create_project_with_workflow(yaml);
    let result = load_workflow(&temp.path().join(".orkestra/workflow.yaml"));

    // Should fail with validation error
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("plan"),
        "Error should mention the missing artifact: {err}"
    );
    assert!(
        err.contains("work"),
        "Error should mention the stage with the problem: {err}"
    );
}

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
fn test_startup_with_invalid_script_on_failure() {
    let yaml = r#"
version: 1
stages:
  - name: work
    artifact: summary
  - name: checks
    artifact: results
    script:
      command: "./check.sh"
      on_failure: nonexistent
"#;
    let config: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
    let errors = config.validate();

    assert!(!errors.is_empty(), "Should have validation errors");
    assert!(
        errors
            .iter()
            .any(|e| e.contains("on_failure") && e.contains("nonexistent")),
        "Should mention invalid on_failure target: {errors:?}"
    );
}

#[test]
fn test_startup_with_forward_reference() {
    let yaml = r"
version: 1
stages:
  - name: review
    artifact: verdict
    inputs: [summary]
  - name: work
    artifact: summary
";
    let config: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
    let errors = config.validate();

    assert!(!errors.is_empty(), "Should have validation errors");
    assert!(
        errors.iter().any(|e| e.contains("comes later")),
        "Should mention forward reference: {errors:?}"
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

#[test]
fn test_startup_with_stage_having_both_prompt_and_script() {
    use orkestra_core::workflow::config::{ScriptStageConfig, StageConfig};

    let mut stage = StageConfig::new("checks", "check_results");
    stage.prompt = Some("worker.md".to_string());
    stage.script = Some(ScriptStageConfig::new("./run.sh"));

    let workflow = WorkflowConfig::new(vec![stage]);
    let errors = workflow.validate();

    assert!(!errors.is_empty(), "Should have validation errors");
    assert!(
        errors.iter().any(|e| e.contains("both")),
        "Should mention having both prompt and script: {errors:?}"
    );
}

#[test]
fn test_startup_with_script_stage_asking_questions() {
    use orkestra_core::workflow::config::{StageCapabilities, StageConfig};

    let stage = StageConfig::new_script("checks", "check_results", "./run.sh")
        .with_capabilities(StageCapabilities::with_questions());

    let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary"), stage]);
    let errors = workflow.validate();

    assert!(!errors.is_empty(), "Should have validation errors");
    assert!(
        errors
            .iter()
            .any(|e| e.contains("Script stage") && e.contains("ask_questions")),
        "Should mention script stage with ask_questions: {errors:?}"
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
    inputs: [plan]
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
fn test_startup_with_valid_script_stage() {
    let yaml = r#"
version: 1
stages:
  - name: work
    artifact: summary
  - name: checks
    artifact: results
    inputs: [summary]
    script:
      command: "./run_checks.sh"
      timeout_seconds: 300
      on_failure: work
  - name: review
    artifact: verdict
    inputs: [summary, results]
integration:
  on_failure: work
"#;
    let temp = create_project_with_workflow(yaml);
    let result = load_workflow(&temp.path().join(".orkestra/workflow.yaml"));

    assert!(result.is_ok(), "Should load valid config: {result:?}");
    let config = result.unwrap();
    assert_eq!(config.stages.len(), 3);
    assert!(config.stage("checks").unwrap().is_script_stage());
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
fn test_startup_error_messages_are_actionable() {
    // Test that error messages include enough context to fix the problem
    let yaml = r"
version: 1
stages:
  - name: work
    artifact: summary
    inputs: [missing_artifact]
";
    let config: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
    let errors = config.validate();

    assert!(!errors.is_empty());
    let error = &errors[0];

    // Error should tell user:
    // 1. Which stage has the problem
    assert!(
        error.contains("work"),
        "Should mention the problematic stage: {error}"
    );
    // 2. What the specific artifact name that's wrong is
    assert!(
        error.contains("missing_artifact"),
        "Should mention the unknown artifact: {error}"
    );
    // 3. Available options
    assert!(
        error.contains("summary"),
        "Should list available artifacts: {error}"
    );
}

#[test]
fn test_forward_reference_error_suggests_fix() {
    let yaml = r"
version: 1
stages:
  - name: review
    artifact: verdict
    inputs: [summary]
  - name: work
    artifact: summary
";
    let config: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
    let errors = config.validate();

    assert!(!errors.is_empty());
    let error = &errors[0];

    // Error should mention both stages and suggest reordering
    assert!(
        error.contains("review"),
        "Should mention the stage with the error: {error}"
    );
    assert!(
        error.contains("work"),
        "Should mention the stage that produces the artifact: {error}"
    );
    // Should suggest moving stages
    assert!(
        error.contains("Move") || error.contains("before"),
        "Should suggest how to fix: {error}"
    );
}

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
