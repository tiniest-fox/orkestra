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

        // Check for duplicate stage names
        let mut seen_names = std::collections::HashSet::new();
        for stage in &self.stages {
            if !seen_names.insert(&stage.name) {
                errors.push(format!("Duplicate stage name: {}", stage.name));
            }
        }

        // Check for duplicate artifact names
        let mut seen_artifacts = std::collections::HashSet::new();
        for stage in &self.stages {
            if !seen_artifacts.insert(&stage.artifact) {
                errors.push(format!("Duplicate artifact name: {}", stage.artifact));
            }
        }

        // Check that input references exist
        let artifact_names: std::collections::HashSet<_> =
            self.stages.iter().map(|s| s.artifact.as_str()).collect();

        for stage in &self.stages {
            for input in &stage.inputs {
                if !artifact_names.contains(input.as_str()) {
                    errors.push(format!(
                        "Stage '{}' references unknown input artifact: {}",
                        stage.name, input
                    ));
                }
            }
        }

        // Check that inputs come from earlier stages
        for (idx, stage) in self.stages.iter().enumerate() {
            let earlier_artifacts: std::collections::HashSet<_> = self.stages[..idx]
                .iter()
                .map(|s| s.artifact.as_str())
                .collect();

            for input in &stage.inputs {
                if !earlier_artifacts.contains(input.as_str()) {
                    // It exists but comes from a later stage
                    if artifact_names.contains(input.as_str()) {
                        errors.push(format!(
                            "Stage '{}' references input '{}' from a later stage",
                            stage.name, input
                        ));
                    }
                }
            }
        }

        // Check that restage targets are valid stage names
        let stage_names: std::collections::HashSet<_> =
            self.stages.iter().map(|s| s.name.as_str()).collect();

        for stage in &self.stages {
            for target in &stage.capabilities.supports_restage {
                if !stage_names.contains(target.as_str()) {
                    errors.push(format!(
                        "Stage '{}' has restage target for unknown stage: {}",
                        stage.name, target
                    ));
                }
            }
        }

        // Check that integration.on_failure is a valid stage
        if !stage_names.contains(self.integration.on_failure.as_str()) {
            errors.push(format!(
                "Integration on_failure references unknown stage: {}",
                self.integration.on_failure
            ));
        }

        errors
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
                .with_capabilities(StageCapabilities::with_subtasks())
                .optional(),
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
        assert!(errors.iter().any(|e| e.contains("unknown input artifact")));
    }

    #[test]
    fn test_workflow_validation_forward_reference() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan").with_inputs(vec!["summary".into()]), // References later artifact
            StageConfig::new("work", "summary"),
        ]);
        let errors = workflow.validate();
        assert!(errors.iter().any(|e| e.contains("from a later stage")));
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

        // Breakdown is optional and can produce subtasks
        let breakdown = workflow.stage("breakdown").unwrap();
        assert!(breakdown.is_optional);
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
        assert_eq!(planning.agent.agent_type, "planner");

        let breakdown = workflow.stage("breakdown").unwrap();
        assert_eq!(breakdown.agent.agent_type, "breakdown");

        let work = workflow.stage("work").unwrap();
        assert_eq!(work.agent.agent_type, "worker");

        let review = workflow.stage("review").unwrap();
        assert_eq!(review.agent.agent_type, "reviewer");
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
            .any(|e| e.contains("restage target for unknown stage")));
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
        assert!(
            errors.is_empty(),
            "Expected no errors, got: {:?}",
            errors
        );
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
            .any(|e| e.contains("Integration on_failure references unknown stage")));
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
        let yaml = r#"
version: 1
stages:
  - name: planning
    artifact: plan
  - name: work
    artifact: summary
integration:
  on_failure: planning
"#;
        let workflow: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(workflow.integration.on_failure, "planning");
        assert!(workflow.is_valid());
    }
}
