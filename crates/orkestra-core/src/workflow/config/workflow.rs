//! Workflow configuration.
//!
//! A workflow is an ordered collection of stages that define the task lifecycle.
//! Stages are processed in order, with optional stages being skippable.

use serde::{Deserialize, Serialize};

use super::stage::StageConfig;

/// Complete workflow configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowConfig {
    /// Schema version for future compatibility.
    #[serde(default = "default_version")]
    pub version: u32,

    /// Ordered list of stages in the workflow.
    pub stages: Vec<StageConfig>,

    /// Integration (merge) configuration.
    #[serde(default)]
    pub integration: IntegrationConfig,
}

/// Configuration for task integration (merging branches).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IntegrationConfig {
    /// Stage to return to when integration fails (e.g., merge conflict).
    /// The failure details (error, conflict files) are passed to this stage's prompt.
    #[serde(default = "default_on_failure")]
    pub on_failure: String,
    // Future: mode (auto_merge, pull_request), target_branch, etc.
}

impl Default for IntegrationConfig {
    fn default() -> Self {
        Self {
            on_failure: default_on_failure(),
        }
    }
}

fn default_version() -> u32 {
    1
}

fn default_on_failure() -> String {
    "work".to_string()
}

impl WorkflowConfig {
    /// Create a new workflow with the given stages.
    pub fn new(stages: Vec<StageConfig>) -> Self {
        Self {
            version: 1,
            stages,
            integration: IntegrationConfig::default(),
        }
    }

    /// Builder: set integration config.
    #[must_use]
    pub fn with_integration(mut self, integration: IntegrationConfig) -> Self {
        self.integration = integration;
        self
    }

    /// Get a stage by name.
    pub fn stage(&self, name: &str) -> Option<&StageConfig> {
        self.stages.iter().find(|s| s.name == name)
    }

    /// Get the index of a stage by name.
    pub fn stage_index(&self, name: &str) -> Option<usize> {
        self.stages.iter().position(|s| s.name == name)
    }

    /// Get the next stage after the given stage name.
    /// Returns None if this is the last stage or stage not found.
    pub fn next_stage(&self, current: &str) -> Option<&StageConfig> {
        let idx = self.stage_index(current)?;
        self.stages.get(idx + 1)
    }

    /// Get the first stage in the workflow.
    pub fn first_stage(&self) -> Option<&StageConfig> {
        self.stages.first()
    }

    /// Get all stage names in order.
    pub fn stage_names(&self) -> Vec<&str> {
        self.stages.iter().map(|s| s.name.as_str()).collect()
    }

    /// Validate the workflow configuration.
    /// Returns a list of validation errors, empty if valid.
    pub fn validate(&self) -> Vec<String> {
        let mut errors = Vec::new();

        if self.stages.is_empty() {
            errors.push("Workflow must have at least one stage".into());
            return errors;
        }

        // Build validation context
        let stage_names: Vec<&str> = self.stages.iter().map(|s| s.name.as_str()).collect();
        let stage_names_set: std::collections::HashSet<_> = stage_names.iter().copied().collect();
        let artifact_names: Vec<&str> = self.stages.iter().map(|s| s.artifact.as_str()).collect();
        let artifact_names_set: std::collections::HashSet<_> =
            artifact_names.iter().copied().collect();

        // Run all validations
        self.validate_no_duplicate_stage_names(&mut errors);
        self.validate_no_duplicate_artifact_names(&mut errors);
        self.validate_input_references(&artifact_names, &artifact_names_set, &mut errors);
        self.validate_input_ordering(&artifact_names_set, &mut errors);
        self.validate_restage_targets(&stage_names, &stage_names_set, &mut errors);
        self.validate_integration_on_failure(&stage_names, &stage_names_set, &mut errors);
        self.validate_script_stages(&stage_names, &stage_names_set, &mut errors);

        errors
    }

    /// Check for duplicate stage names.
    fn validate_no_duplicate_stage_names(&self, errors: &mut Vec<String>) {
        let mut seen = std::collections::HashSet::new();
        for stage in &self.stages {
            if !seen.insert(&stage.name) {
                errors.push(format!(
                    "Duplicate stage name \"{}\". Each stage must have a unique name.",
                    stage.name
                ));
            }
        }
    }

    /// Check for duplicate artifact names.
    fn validate_no_duplicate_artifact_names(&self, errors: &mut Vec<String>) {
        let mut seen = std::collections::HashSet::new();
        for stage in &self.stages {
            if !seen.insert(&stage.artifact) {
                errors.push(format!(
                    "Duplicate artifact name \"{}\". Each stage must produce a unique artifact.",
                    stage.artifact
                ));
            }
        }
    }

    /// Check that all input references point to existing artifacts.
    fn validate_input_references(
        &self,
        artifact_names: &[&str],
        artifact_names_set: &std::collections::HashSet<&str>,
        errors: &mut Vec<String>,
    ) {
        for stage in &self.stages {
            for input in &stage.inputs {
                if !artifact_names_set.contains(input.as_str()) {
                    errors.push(format!(
                        "Stage \"{}\" references input artifact \"{}\" which doesn't exist. \
                         Available artifacts: {:?}",
                        stage.name, input, artifact_names
                    ));
                }
            }
        }
    }

    /// Check that inputs come from earlier stages (no forward references).
    fn validate_input_ordering(
        &self,
        artifact_names_set: &std::collections::HashSet<&str>,
        errors: &mut Vec<String>,
    ) {
        for (idx, stage) in self.stages.iter().enumerate() {
            let earlier_artifacts: std::collections::HashSet<_> = self.stages[..idx]
                .iter()
                .map(|s| s.artifact.as_str())
                .collect();

            for input in &stage.inputs {
                if !earlier_artifacts.contains(input.as_str())
                    && artifact_names_set.contains(input.as_str())
                {
                    let producing_stage = self
                        .stages
                        .iter()
                        .find(|s| s.artifact == *input)
                        .map_or("unknown", |s| s.name.as_str());
                    errors.push(format!(
                        "Stage \"{}\" references input \"{}\" from stage \"{}\", \
                         but \"{}\" comes later in the workflow. \
                         Move \"{}\" before \"{}\" or remove this input.",
                        stage.name,
                        input,
                        producing_stage,
                        producing_stage,
                        producing_stage,
                        stage.name
                    ));
                }
            }
        }
    }

    /// Check that all restage targets reference valid stage names.
    fn validate_restage_targets(
        &self,
        stage_names: &[&str],
        stage_names_set: &std::collections::HashSet<&str>,
        errors: &mut Vec<String>,
    ) {
        for stage in &self.stages {
            for target in &stage.capabilities.supports_restage {
                if !stage_names_set.contains(target.as_str()) {
                    errors.push(format!(
                        "Stage \"{}\" has restage target \"{}\" which doesn't exist. \
                         Valid stages: {:?}",
                        stage.name, target, stage_names
                    ));
                }
            }
        }
    }

    /// Check that `integration.on_failure` references a valid stage.
    fn validate_integration_on_failure(
        &self,
        stage_names: &[&str],
        stage_names_set: &std::collections::HashSet<&str>,
        errors: &mut Vec<String>,
    ) {
        if !stage_names_set.contains(self.integration.on_failure.as_str()) {
            errors.push(format!(
                "Integration on_failure references stage \"{}\" which doesn't exist. \
                 Valid stages: {:?}",
                self.integration.on_failure, stage_names
            ));
        }
    }

    /// Validate script stage configurations.
    fn validate_script_stages(
        &self,
        stage_names: &[&str],
        stage_names_set: &std::collections::HashSet<&str>,
        errors: &mut Vec<String>,
    ) {
        for stage in &self.stages {
            // Check that stage doesn't have both agent and script
            if stage.agent.is_some() && stage.script.is_some() {
                errors.push(format!(
                    "Stage \"{}\" has both 'agent' and 'script' configuration. \
                     Choose one: either run an agent OR a script, not both.",
                    stage.name
                ));
            }

            // Script-specific validations
            if let Some(ref script) = stage.script {
                if let Some(ref on_failure) = script.on_failure {
                    if !stage_names_set.contains(on_failure.as_str()) {
                        errors.push(format!(
                            "Script stage \"{}\" has on_failure=\"{}\" but stage \"{}\" doesn't exist. \
                             Valid stages: {:?}",
                            stage.name, on_failure, on_failure, stage_names
                        ));
                    }
                }

                if stage.capabilities.ask_questions {
                    errors.push(format!(
                        "Script stage \"{}\" cannot have ask_questions capability. \
                         Only agent stages can ask questions.",
                        stage.name
                    ));
                }
                if stage.capabilities.produce_subtasks {
                    errors.push(format!(
                        "Script stage \"{}\" cannot have produce_subtasks capability. \
                         Only agent stages can produce subtasks.",
                        stage.name
                    ));
                }
            }
        }
    }

    /// Check if the workflow is valid.
    pub fn is_valid(&self) -> bool {
        self.validate().is_empty()
    }
}

impl Default for WorkflowConfig {
    /// Create the default workflow matching the current Orkestra behavior.
    fn default() -> Self {
        use super::stage::{AgentStageConfig, StageCapabilities, StageConfig};

        Self::new(vec![
            StageConfig::new("planning", "plan")
                .with_display_name("Planning")
                .with_agent(AgentStageConfig::planner())
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("breakdown", "breakdown")
                .with_display_name("Breaking Down")
                .with_agent(AgentStageConfig::breakdown())
                .with_inputs(vec!["plan".into()])
                .with_capabilities(StageCapabilities::with_subtasks()),
            StageConfig::new("work", "summary")
                .with_display_name("Working")
                .with_agent(AgentStageConfig::worker())
                .with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_display_name("Reviewing")
                .with_agent(AgentStageConfig::reviewer())
                .with_inputs(vec!["plan".into(), "summary".into()])
                .with_capabilities(StageCapabilities::with_restage(vec!["work".into()]))
                .automated(),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::config::stage::StageConfig;

    #[test]
    fn test_workflow_new() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ]);

        assert_eq!(workflow.version, 1);
        assert_eq!(workflow.stages.len(), 2);
    }

    #[test]
    fn test_workflow_stage_lookup() {
        let workflow = WorkflowConfig::default();

        let planning = workflow.stage("planning");
        assert!(planning.is_some());
        assert_eq!(planning.unwrap().artifact, "plan");

        let missing = workflow.stage("nonexistent");
        assert!(missing.is_none());
    }

    #[test]
    fn test_workflow_next_stage() {
        let workflow = WorkflowConfig::default();

        let next = workflow.next_stage("planning");
        assert!(next.is_some());
        assert_eq!(next.unwrap().name, "breakdown");

        let next = workflow.next_stage("review");
        assert!(next.is_none()); // Last stage
    }

    #[test]
    fn test_workflow_stage_names() {
        let workflow = WorkflowConfig::default();
        let names = workflow.stage_names();
        assert_eq!(names, vec!["planning", "breakdown", "work", "review"]);
    }

    #[test]
    fn test_workflow_validation_valid() {
        let workflow = WorkflowConfig::default();
        assert!(workflow.is_valid());
        assert!(workflow.validate().is_empty());
    }

    #[test]
    fn test_workflow_validation_empty() {
        let workflow = WorkflowConfig::new(vec![]);
        let errors = workflow.validate();
        assert!(!errors.is_empty());
        assert!(errors[0].contains("at least one stage"));
    }

    #[test]
    fn test_workflow_validation_duplicate_stage_name() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("planning", "other"), // Duplicate name
        ]);
        let errors = workflow.validate();
        assert!(errors.iter().any(|e| e.contains("Duplicate stage name")));
    }

    #[test]
    fn test_workflow_validation_duplicate_artifact() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "plan"), // Duplicate artifact
        ]);
        let errors = workflow.validate();
        assert!(errors.iter().any(|e| e.contains("Duplicate artifact name")));
    }

    #[test]
    fn test_workflow_validation_unknown_input() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").with_inputs(vec!["nonexistent".into()]),
        ]);
        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("nonexistent") && e.contains("doesn't exist")));
    }

    #[test]
    fn test_workflow_validation_forward_reference() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan").with_inputs(vec!["summary".into()]), // References later artifact
            StageConfig::new("work", "summary"),
        ]);
        let errors = workflow.validate();
        assert!(errors.iter().any(|e| e.contains("comes later")));
    }

    #[test]
    fn test_workflow_serialization() {
        let workflow = WorkflowConfig::default();
        let yaml = serde_yaml::to_string(&workflow).unwrap();

        assert!(yaml.contains("version: 1"));
        assert!(yaml.contains("- name: planning"));
        assert!(yaml.contains("artifact: plan"));

        let parsed: WorkflowConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed, workflow);
    }

    #[test]
    fn test_default_workflow_matches_orkestra() {
        let workflow = WorkflowConfig::default();

        // Should have 4 stages
        assert_eq!(workflow.stages.len(), 4);

        // Planning can ask questions
        let planning = workflow.stage("planning").unwrap();
        assert!(planning.capabilities.ask_questions);
        assert!(!planning.capabilities.produce_subtasks);

        // Breakdown can produce subtasks
        let breakdown = workflow.stage("breakdown").unwrap();
        assert!(breakdown.capabilities.produce_subtasks);

        // Review is automated and can restage to work
        let review = workflow.stage("review").unwrap();
        assert!(review.is_automated);
        assert!(review.capabilities.can_restage_to("work"));
    }

    #[test]
    fn test_default_workflow_has_agent_types() {
        let workflow = WorkflowConfig::default();

        // Each stage should have the correct agent type
        let planning = workflow.stage("planning").unwrap();
        assert_eq!(planning.agent_config().unwrap().agent_type, "planner");

        let breakdown = workflow.stage("breakdown").unwrap();
        assert_eq!(breakdown.agent_config().unwrap().agent_type, "breakdown");

        let work = workflow.stage("work").unwrap();
        assert_eq!(work.agent_config().unwrap().agent_type, "worker");

        let review = workflow.stage("review").unwrap();
        assert_eq!(review.agent_config().unwrap().agent_type, "reviewer");
    }

    #[test]
    fn test_workflow_validation_invalid_restage_target() {
        use crate::workflow::config::stage::StageCapabilities;

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_restage(vec!["nonexistent".into()])),
        ]);
        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("restage target") && e.contains("doesn't exist")));
    }

    #[test]
    fn test_workflow_validation_valid_restage_target() {
        use crate::workflow::config::stage::StageCapabilities;

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_restage(vec!["work".into()])),
        ]);
        let errors = workflow.validate();
        assert!(errors.is_empty(), "Expected no errors, got: {errors:?}");
    }

    #[test]
    fn test_integration_config_default() {
        let config = IntegrationConfig::default();
        assert_eq!(config.on_failure, "work");
    }

    #[test]
    fn test_workflow_with_integration_config() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig {
            on_failure: "planning".to_string(),
        });

        assert_eq!(workflow.integration.on_failure, "planning");
        assert!(workflow.is_valid());
    }

    #[test]
    fn test_workflow_validation_invalid_integration_on_failure() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig {
            on_failure: "nonexistent".to_string(),
        });

        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("Integration on_failure") && e.contains("doesn't exist")));
    }

    #[test]
    fn test_integration_config_serialization() {
        let workflow = WorkflowConfig::default();
        let yaml = serde_yaml::to_string(&workflow).unwrap();

        // Integration config should be serialized
        assert!(yaml.contains("integration:"));
        assert!(yaml.contains("on_failure: work"));

        let parsed: WorkflowConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.integration.on_failure, "work");
    }

    #[test]
    fn test_integration_config_custom_on_failure() {
        let yaml = r"
version: 1
stages:
  - name: planning
    artifact: plan
  - name: work
    artifact: summary
integration:
  on_failure: planning
";
        let workflow: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(workflow.integration.on_failure, "planning");
        assert!(workflow.is_valid());
    }

    // ========================================================================
    // Script stage validation tests
    // ========================================================================

    #[test]
    fn test_workflow_with_script_stage() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
            StageConfig::new_script("checks", "check_results", "./run_checks.sh")
                .with_inputs(vec!["summary".into()]),
            StageConfig::new("review", "verdict").with_inputs(vec!["check_results".into()]),
        ]);

        let errors = workflow.validate();
        assert!(errors.is_empty(), "Expected no errors, got: {errors:?}");
    }

    #[test]
    fn test_script_stage_with_valid_on_failure() {
        use crate::workflow::config::stage::ScriptStageConfig;

        let mut stage = StageConfig::new_script("checks", "check_results", "./run.sh");
        stage.script = Some(ScriptStageConfig::new("./run.sh").with_on_failure("work"));

        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary"), stage]);

        let errors = workflow.validate();
        assert!(errors.is_empty(), "Expected no errors, got: {errors:?}");
    }

    #[test]
    fn test_script_stage_with_invalid_on_failure() {
        use crate::workflow::config::stage::ScriptStageConfig;

        let mut stage = StageConfig::new_script("checks", "check_results", "./run.sh");
        stage.script = Some(ScriptStageConfig::new("./run.sh").with_on_failure("nonexistent"));

        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary"), stage]);

        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("on_failure") && e.contains("doesn't exist")));
    }

    #[test]
    fn test_script_stage_cannot_have_ask_questions() {
        use crate::workflow::config::stage::StageCapabilities;

        let stage = StageConfig::new_script("checks", "check_results", "./run.sh")
            .with_capabilities(StageCapabilities::with_questions());

        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary"), stage]);

        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("Script stage") && e.contains("ask_questions")));
    }

    #[test]
    fn test_script_stage_cannot_have_produce_subtasks() {
        use crate::workflow::config::stage::StageCapabilities;

        let stage = StageConfig::new_script("checks", "check_results", "./run.sh")
            .with_capabilities(StageCapabilities::with_subtasks());

        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary"), stage]);

        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("Script stage") && e.contains("produce_subtasks")));
    }

    #[test]
    fn test_stage_cannot_have_both_agent_and_script() {
        use crate::workflow::config::stage::{AgentStageConfig, ScriptStageConfig};

        let mut stage = StageConfig::new("checks", "check_results");
        stage.agent = Some(AgentStageConfig::worker());
        stage.script = Some(ScriptStageConfig::new("./run.sh"));

        let workflow = WorkflowConfig::new(vec![stage]);

        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("has both 'agent' and 'script'")));
    }

    #[test]
    fn test_script_stage_yaml_parsing() {
        let yaml = r#"
version: 1
stages:
  - name: work
    artifact: summary
    agent:
      agent_type: worker
  - name: checks
    artifact: check_results
    inputs: [summary]
    script:
      command: "./scripts/run_checks.sh"
      timeout_seconds: 300
      on_failure: work
  - name: review
    artifact: verdict
    inputs: [check_results]
    agent:
      agent_type: reviewer
integration:
  on_failure: work
"#;
        let workflow: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();

        assert_eq!(workflow.stages.len(), 3);

        let checks = workflow.stage("checks").unwrap();
        assert!(checks.is_script_stage());
        assert!(!checks.is_agent_stage());

        let script = checks.script_config().unwrap();
        assert_eq!(script.command, "./scripts/run_checks.sh");
        assert_eq!(script.timeout_seconds, 300);
        assert_eq!(script.on_failure, Some("work".to_string()));

        assert!(workflow.is_valid());
    }
}
