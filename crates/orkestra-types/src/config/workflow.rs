//! Workflow configuration.
//!
//! A workflow is a collection of named flows. Each flow independently defines
//! its own ordered stages and integration config. The first flow in the map is
//! the primary pipeline; alternate flows (e.g., "quick", "hotfix") define
//! shorter pipelines.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use super::stage::StageConfig;
use crate::runtime::{ACTIVITY_LOG_ARTIFACT_NAME, TASK_ARTIFACT_NAME};

/// Name used by `WorkflowConfig::new()` for its single created flow.
/// Not a required name — the "default flow" is always the first flow in the map.
const NEW_WORKFLOW_DEFAULT_FLOW: &str = "default";

// ============================================================================
// Top-level types
// ============================================================================

/// Complete workflow configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowConfig {
    /// Schema version for future compatibility.
    #[serde(default = "default_version")]
    pub version: u32,

    /// Named flows. Each flow is an independent pipeline with its own stages
    /// and integration config.
    pub flows: IndexMap<String, FlowConfig>,
}

/// Configuration for a named flow (pipeline).
///
/// Each flow owns its full stage list and integration config independently —
/// there is no global stage list or override layer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct FlowConfig {
    /// Ordered list of stages in this flow.
    pub stages: Vec<StageConfig>,

    /// Integration (merge) configuration for this flow.
    pub integration: IntegrationConfig,
}

/// Configuration for task integration (merging branches).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IntegrationConfig {
    /// Stage to return to when integration fails (e.g., merge conflict).
    /// The failure details (error, conflict files) are passed to this stage's prompt.
    pub on_failure: String,
    /// Whether to automatically merge (rebase + merge) when tasks reach Done.
    /// When false, tasks pause at Done until user chooses "Merge" or "Open PR".
    #[serde(default = "default_auto_merge")]
    pub auto_merge: bool,
}

fn default_version() -> u32 {
    1
}

fn default_auto_merge() -> bool {
    false
}

// ============================================================================
// IntegrationConfig impl
// ============================================================================

impl IntegrationConfig {
    /// Create integration config with the given failure recovery stage.
    pub fn new(on_failure: impl Into<String>) -> Self {
        Self {
            on_failure: on_failure.into(),
            auto_merge: default_auto_merge(),
        }
    }
}

impl Default for IntegrationConfig {
    /// Default integration config — `on_failure` is empty, which will fail validation.
    /// Use `IntegrationConfig::new("stage_name")` or `with_integration()` to set it.
    fn default() -> Self {
        Self {
            on_failure: String::new(),
            auto_merge: default_auto_merge(),
        }
    }
}

// ============================================================================
// FlowConfig impl
// ============================================================================

impl FlowConfig {
    /// Look up a stage by name within this flow.
    pub fn stage(&self, name: &str) -> Option<&StageConfig> {
        self.stages.iter().find(|s| s.name == name)
    }
}

// ============================================================================
// WorkflowConfig impl
// ============================================================================

impl WorkflowConfig {
    /// Create a workflow with a single default flow containing the given stages.
    ///
    /// Uses the first stage name as `integration.on_failure`. Override with
    /// `with_integration()` if a different recovery stage is needed.
    pub fn new(stages: Vec<StageConfig>) -> Self {
        let on_failure = stages.first().map_or_else(String::new, |s| s.name.clone());
        let mut flows = IndexMap::new();
        flows.insert(
            NEW_WORKFLOW_DEFAULT_FLOW.to_string(),
            FlowConfig {
                stages,
                integration: IntegrationConfig::new(on_failure),
            },
        );
        Self {
            version: default_version(),
            flows,
        }
    }

    /// Builder: set integration config on the first flow.
    #[must_use]
    pub fn with_integration(mut self, integration: IntegrationConfig) -> Self {
        if let Some((_, flow)) = self.flows.iter_mut().next() {
            flow.integration = integration;
        }
        self
    }

    /// Builder: merge additional flows into this workflow.
    #[must_use]
    pub fn with_flows(mut self, flows: IndexMap<String, FlowConfig>) -> Self {
        for (name, flow) in flows {
            self.flows.insert(name, flow);
        }
        self
    }

    // -- Stage navigation --

    /// Get a stage by name within the given flow.
    pub fn stage(&self, flow: &str, name: &str) -> Option<&StageConfig> {
        self.flows.get(flow)?.stages.iter().find(|s| s.name == name)
    }

    /// Get the stage description for the stage that produces the given artifact.
    ///
    /// Returns `None` if no stage in the flow produces that artifact, or the
    /// stage has no description configured.
    pub fn stage_description_for_artifact(&self, flow: &str, artifact_name: &str) -> Option<&str> {
        self.flows
            .get(flow)?
            .stages
            .iter()
            .find(|s| s.artifact_name() == artifact_name)
            .and_then(|s| s.description.as_deref())
    }

    /// Get the first stage in a flow.
    pub fn first_stage(&self, flow: &str) -> Option<&StageConfig> {
        self.flows.get(flow)?.stages.first()
    }

    /// Get the next stage after the given stage in a flow.
    pub fn next_stage(&self, flow: &str, current: &str) -> Option<&StageConfig> {
        let flow_config = self.flows.get(flow)?;
        let idx = flow_config.stages.iter().position(|s| s.name == current)?;
        flow_config.stages.get(idx + 1)
    }

    /// Get the previous stage before the given stage in a flow.
    pub fn previous_stage(&self, flow: &str, current: &str) -> Option<&StageConfig> {
        let flow_config = self.flows.get(flow)?;
        let idx = flow_config.stages.iter().position(|s| s.name == current)?;
        if idx == 0 {
            return None;
        }
        flow_config.stages.get(idx - 1)
    }

    /// Get all stages in a flow, in order.
    pub fn stages_in_flow(&self, flow: &str) -> Vec<&StageConfig> {
        match self.flows.get(flow) {
            None => Vec::new(),
            Some(f) => f.stages.iter().collect(),
        }
    }

    /// Check whether a stage name exists in the given flow.
    pub fn has_stage(&self, flow: &str, stage_name: &str) -> bool {
        self.flows
            .get(flow)
            .is_some_and(|f| f.stages.iter().any(|s| s.name == stage_name))
    }

    /// Get the recovery stage for integration failures in the given flow.
    ///
    /// Returns `on_failure` if it names a valid stage in the flow, otherwise
    /// falls back to the first stage. Returns `None` if the flow does not exist
    /// or has no stages.
    pub fn recovery_stage(&self, flow: &str) -> Option<String> {
        let flow_config = self.flows.get(flow)?;
        let configured = &flow_config.integration.on_failure;
        if flow_config.stages.iter().any(|s| s.name == *configured) {
            return Some(configured.clone());
        }
        flow_config.stages.first().map(|s| s.name.clone())
    }

    /// Get the model specs for all stages in the given flow.
    ///
    /// Returns model specs in stage order (`None` means "use provider default").
    pub fn agent_model_specs(&self, flow: &str) -> Vec<Option<String>> {
        self.stages_in_flow(flow)
            .into_iter()
            .map(|s| s.model.clone())
            .collect()
    }

    // -- Flow access --

    /// Get flow config by name.
    pub fn flow(&self, name: &str) -> Option<&FlowConfig> {
        self.flows.get(name)
    }

    /// Get mutable flow config by name.
    pub fn flow_mut(&mut self, name: &str) -> Option<&mut FlowConfig> {
        self.flows.get_mut(name)
    }

    /// Get the name of the first flow in insertion order.
    pub fn first_flow_name(&self) -> Option<&str> {
        self.flows.keys().next().map(String::as_str)
    }

    /// Get all flow names in insertion order.
    pub fn flow_names(&self) -> Vec<&str> {
        self.flows.keys().map(String::as_str).collect()
    }

    /// Get all unique stages across all flows, deduplicated by name.
    ///
    /// Deduplication is first-occurrence wins (insertion order across flows).
    /// Used for creating stub agent files in test helpers.
    pub fn all_unique_stages(&self) -> Vec<&StageConfig> {
        let mut seen = std::collections::HashSet::new();
        let mut result = Vec::new();
        for flow in self.flows.values() {
            for stage in &flow.stages {
                if seen.insert(stage.name.as_str()) {
                    result.push(stage);
                }
            }
        }
        result
    }

    // -- Validation --

    /// Validate the workflow configuration.
    /// Returns a list of validation errors, empty if valid.
    pub fn validate(&self) -> Vec<String> {
        let mut errors = Vec::new();

        if self.flows.is_empty() {
            errors.push("Workflow must have at least one flow".into());
            return errors;
        }

        for (flow_name, flow) in &self.flows {
            Self::validate_flow(flow_name, flow, &mut errors);
        }

        self.validate_subtask_flows(&mut errors);
        self.validate_model_fields(&mut errors);
        self.validate_disallowed_tools(&mut errors);
        self.validate_gates(&mut errors);

        errors
    }

    /// Check if the workflow is valid.
    pub fn is_valid(&self) -> bool {
        self.validate().is_empty()
    }

    // -- Validation helpers --

    fn validate_flow(flow_name: &str, flow: &FlowConfig, errors: &mut Vec<String>) {
        if flow.stages.is_empty() {
            errors.push(format!("Flow \"{flow_name}\" has no stages"));
            return;
        }

        let stage_names: Vec<&str> = flow.stages.iter().map(|s| s.name.as_str()).collect();

        // Unique stage names per flow
        let mut seen_names = std::collections::HashSet::new();
        for stage in &flow.stages {
            if !seen_names.insert(stage.name.as_str()) {
                errors.push(format!(
                    "Flow \"{flow_name}\" has duplicate stage name \"{}\". Each stage must have a unique name.",
                    stage.name
                ));
            }
        }

        // Unique artifact names per flow (and reserved name check)
        let mut seen_artifacts = std::collections::HashSet::new();
        for stage in &flow.stages {
            let name = stage.artifact_name();
            if name.is_empty() {
                errors.push(format!(
                    "Flow \"{flow_name}\" stage \"{}\" has an empty artifact name. Artifact names must be non-empty.",
                    stage.name
                ));
                continue;
            }
            if name == ACTIVITY_LOG_ARTIFACT_NAME || name == TASK_ARTIFACT_NAME {
                errors.push(format!(
                    "Flow \"{flow_name}\" stage \"{}\" uses reserved artifact name \"{name}\". This name is used internally.",
                    stage.name
                ));
                continue;
            }
            if !seen_artifacts.insert(name) {
                errors.push(format!(
                    "Flow \"{flow_name}\" has duplicate artifact name \"{name}\". Each stage must produce a unique artifact."
                ));
            }
        }

        let stage_names_set: std::collections::HashSet<&str> =
            stage_names.iter().copied().collect();

        // Validate approval rejection_stage targets are within this flow
        for stage in &flow.stages {
            if let Some(ref approval) = stage.capabilities.approval {
                if let Some(ref target) = approval.rejection_stage {
                    if !stage_names_set.contains(target.as_str()) {
                        errors.push(format!(
                            "Flow \"{flow_name}\" stage \"{}\" has approval rejection_stage \"{}\" which is not in flow \"{flow_name}\". \
                             Valid stages: {stage_names:?}",
                            stage.name, target
                        ));
                    }
                }
            }
        }

        // Validate integration.on_failure is in this flow
        if !flow.integration.on_failure.is_empty()
            && !stage_names_set.contains(flow.integration.on_failure.as_str())
        {
            errors.push(format!(
                "Flow \"{flow_name}\" has integration.on_failure=\"{}\" which is not in this flow. \
                 Valid stages: {stage_names:?}",
                flow.integration.on_failure
            ));
        } else if flow.integration.on_failure.is_empty() {
            errors.push(format!(
                "Flow \"{flow_name}\" has an empty integration.on_failure. \
                 Use IntegrationConfig::new(\"stage_name\") to set it."
            ));
        }
    }

    fn validate_subtask_flows(&self, errors: &mut Vec<String>) {
        for (flow_name, flow) in &self.flows {
            for stage in &flow.stages {
                if let Some(ref subtask_caps) = stage.capabilities.subtasks {
                    if let Some(ref subtask_flow) = subtask_caps.flow {
                        if !self.flows.contains_key(subtask_flow) {
                            errors.push(format!(
                                "Flow \"{flow_name}\" stage \"{}\" has subtasks.flow=\"{subtask_flow}\" \
                                 but flow \"{subtask_flow}\" doesn't exist. \
                                 Define the flow under 'flows:' or remove subtasks.flow.",
                                stage.name
                            ));
                        }
                    }
                    if let Some(ref target) = subtask_caps.completion_stage {
                        let stage_names: Vec<&str> =
                            flow.stages.iter().map(|s| s.name.as_str()).collect();
                        if !stage_names.contains(&target.as_str()) {
                            errors.push(format!(
                                "Flow \"{flow_name}\" stage \"{}\" has subtasks.completion_stage=\"{target}\" \
                                 but stage \"{target}\" is not in flow \"{flow_name}\".",
                                stage.name
                            ));
                        }
                    }
                }
            }
        }
    }

    fn validate_model_fields(&self, errors: &mut Vec<String>) {
        for (flow_name, flow) in &self.flows {
            for stage in &flow.stages {
                if let Some(ref model) = stage.model {
                    if model.trim().is_empty() {
                        errors.push(format!(
                            "Flow \"{flow_name}\" stage \"{}\" has an empty model field. \
                             Remove the field or specify a model identifier.",
                            stage.name
                        ));
                    }
                }
            }
        }
    }

    fn validate_disallowed_tools(&self, errors: &mut Vec<String>) {
        for (flow_name, flow) in &self.flows {
            for stage in &flow.stages {
                for (i, entry) in stage.disallowed_tools.iter().enumerate() {
                    if entry.pattern.trim().is_empty() {
                        errors.push(format!(
                            "Flow \"{flow_name}\" stage \"{}\" has disallowed_tools[{i}] with an empty pattern.",
                            stage.name
                        ));
                    }
                }
            }
        }
    }

    fn validate_gates(&self, errors: &mut Vec<String>) {
        for (flow_name, flow) in &self.flows {
            for stage in &flow.stages {
                if let Some(ref gate) = stage.gate {
                    if gate.command.trim().is_empty() {
                        errors.push(format!(
                            "Flow \"{flow_name}\" stage \"{}\" has a gate with an empty command.",
                            stage.name
                        ));
                    }
                    if gate.timeout_seconds == 0 {
                        errors.push(format!(
                            "Flow \"{flow_name}\" stage \"{}\" has a gate with timeout_seconds of 0. \
                             Timeout must be greater than 0.",
                            stage.name
                        ));
                    }
                }
            }
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::stage::{
        GateConfig, StageCapabilities, StageConfig, SubtaskCapabilities, ToolRestriction,
    };

    // -- Test helpers --

    /// Build a `FlowConfig` for the standard 4-stage pipeline (planning → breakdown → work → review).
    fn default_flow() -> FlowConfig {
        FlowConfig {
            stages: vec![
                StageConfig::new("planning", "plan")
                    .with_prompt("planner.md")
                    .with_capabilities(StageCapabilities::with_questions()),
                StageConfig::new("breakdown", "breakdown")
                    .with_prompt("breakdown.md")
                    .with_capabilities(StageCapabilities {
                        subtasks: Some(SubtaskCapabilities::default().with_flow("subtask")),
                        ..Default::default()
                    }),
                StageConfig::new("work", "summary").with_prompt("worker.md"),
                StageConfig::new("review", "verdict")
                    .with_prompt("reviewer.md")
                    .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
                    .automated(),
            ],
            integration: IntegrationConfig::new("work"),
        }
    }

    /// Build a `FlowConfig` for the subtask flow (work → review).
    fn subtask_flow() -> FlowConfig {
        FlowConfig {
            stages: vec![
                StageConfig::new("work", "summary").with_prompt("worker.md"),
                StageConfig::new("review", "verdict")
                    .with_prompt("reviewer.md")
                    .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
                    .automated(),
            ],
            integration: IntegrationConfig::new("work"),
        }
    }

    /// Standard workflow used by most tests: default flow + subtask flow.
    fn test_default_workflow() -> WorkflowConfig {
        let mut flows = IndexMap::new();
        flows.insert("default".to_string(), default_flow());
        flows.insert("subtask".to_string(), subtask_flow());
        WorkflowConfig { version: 1, flows }
    }

    // ========================================================================
    // Construction and basic access
    // ========================================================================

    #[test]
    fn test_workflow_new() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ]);

        assert_eq!(workflow.version, 1);
        // new() creates a single default flow
        assert_eq!(workflow.flows.len(), 1);
        assert!(workflow.flows.contains_key("default"));
        let flow = workflow.flow("default").unwrap();
        assert_eq!(flow.stages.len(), 2);
    }

    #[test]
    fn test_workflow_new_first_flow_is_default() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")]);
        // new() creates a flow named "default" by convention — the "default flow" is always
        // the first in the map, not any specific name
        assert_eq!(workflow.first_flow_name(), Some("default"));
    }

    #[test]
    fn test_workflow_new_integration_on_failure_is_first_stage() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ]);
        let flow = workflow.flow("default").unwrap();
        assert_eq!(flow.integration.on_failure, "planning");
    }

    #[test]
    fn test_workflow_stage_lookup() {
        let workflow = test_default_workflow();

        let planning = workflow.stage("default", "planning");
        assert!(planning.is_some());
        assert_eq!(planning.unwrap().artifact_name(), "plan");

        let missing = workflow.stage("default", "nonexistent");
        assert!(missing.is_none());

        // Cross-flow: subtask flow doesn't have "planning"
        assert!(workflow.stage("subtask", "planning").is_none());
        assert!(workflow.stage("subtask", "work").is_some());
    }

    #[test]
    fn test_first_flow_name() {
        let workflow = test_default_workflow();
        assert_eq!(workflow.first_flow_name(), Some("default"));
    }

    #[test]
    fn test_flow_names() {
        let workflow = test_default_workflow();
        let names = workflow.flow_names();
        assert!(names.contains(&"default"));
        assert!(names.contains(&"subtask"));
    }

    #[test]
    fn test_all_unique_stages() {
        let workflow = test_default_workflow();
        let stages = workflow.all_unique_stages();
        // planning, breakdown, work, review — work/review appear in both flows but deduplicated
        assert_eq!(stages.len(), 4);
        let names: Vec<&str> = stages.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"planning"));
        assert!(names.contains(&"breakdown"));
        assert!(names.contains(&"work"));
        assert!(names.contains(&"review"));
    }

    #[test]
    fn test_all_unique_stages_deduplicates_by_name() {
        // workflow with a stage appearing in two flows
        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")]).with_flows(
            IndexMap::from([(
                "quick".to_string(),
                FlowConfig {
                    stages: vec![StageConfig::new("work", "summary")],
                    integration: IntegrationConfig::new("work"),
                },
            )]),
        );
        let stages = workflow.all_unique_stages();
        // "work" should appear only once
        assert_eq!(stages.len(), 1);
    }

    // ========================================================================
    // Navigation methods
    // ========================================================================

    #[test]
    fn test_workflow_first_stage() {
        let workflow = test_default_workflow();
        let first = workflow.first_stage("default");
        assert!(first.is_some());
        assert_eq!(first.unwrap().name, "planning");

        let subtask_first = workflow.first_stage("subtask");
        assert_eq!(subtask_first.unwrap().name, "work");

        assert!(workflow.first_stage("nonexistent").is_none());
    }

    #[test]
    fn test_workflow_next_stage() {
        let workflow = test_default_workflow();

        let next = workflow.next_stage("default", "planning");
        assert_eq!(next.unwrap().name, "breakdown");

        let next = workflow.next_stage("default", "review");
        assert!(next.is_none()); // Last stage

        // Subtask flow
        let next_subtask = workflow.next_stage("subtask", "work");
        assert_eq!(next_subtask.unwrap().name, "review");

        assert!(workflow.next_stage("subtask", "review").is_none());
    }

    #[test]
    fn test_workflow_previous_stage() {
        let workflow = test_default_workflow();

        let prev = workflow.previous_stage("default", "breakdown");
        assert_eq!(prev.unwrap().name, "planning");

        // First stage has no previous
        assert!(workflow.previous_stage("default", "planning").is_none());

        // Subtask flow
        let prev_subtask = workflow.previous_stage("subtask", "review");
        assert_eq!(prev_subtask.unwrap().name, "work");
    }

    #[test]
    fn test_stages_in_flow() {
        let workflow = test_default_workflow();

        let stages = workflow.stages_in_flow("default");
        assert_eq!(stages.len(), 4);
        assert_eq!(stages[0].name, "planning");

        let subtask_stages = workflow.stages_in_flow("subtask");
        assert_eq!(subtask_stages.len(), 2);
        assert_eq!(subtask_stages[0].name, "work");

        // Nonexistent flow returns empty
        assert!(workflow.stages_in_flow("nonexistent").is_empty());
    }

    #[test]
    fn test_has_stage() {
        let workflow = test_default_workflow();

        assert!(workflow.has_stage("default", "planning"));
        assert!(workflow.has_stage("default", "work"));
        assert!(!workflow.has_stage("default", "nonexistent"));

        // Subtask flow has work but not planning
        assert!(workflow.has_stage("subtask", "work"));
        assert!(!workflow.has_stage("subtask", "planning"));
    }

    #[test]
    fn test_agent_model_specs() {
        let planning = StageConfig::new("planning", "plan").with_model("sonnet");
        let work = StageConfig::new("work", "summary").with_model("opus");

        let workflow = WorkflowConfig::new(vec![planning, work]);

        let specs = workflow.agent_model_specs("default");
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0], Some("sonnet".to_string()));
        assert_eq!(specs[1], Some("opus".to_string()));
    }

    #[test]
    fn test_agent_model_specs_nonexistent_flow() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("planning", "plan")]);
        let specs = workflow.agent_model_specs("nonexistent");
        assert!(specs.is_empty());
    }

    #[test]
    fn test_agent_model_specs_per_flow() {
        let mut flows = IndexMap::new();
        flows.insert(
            "default".to_string(),
            FlowConfig {
                stages: vec![
                    StageConfig::new("planning", "plan").with_model("sonnet"),
                    StageConfig::new("work", "summary").with_model("opus"),
                ],
                integration: IntegrationConfig::new("planning"),
            },
        );
        flows.insert(
            "quick".to_string(),
            FlowConfig {
                stages: vec![StageConfig::new("work", "summary").with_model("haiku")],
                integration: IntegrationConfig::new("work"),
            },
        );
        let workflow = WorkflowConfig { version: 1, flows };

        let default_specs = workflow.agent_model_specs("default");
        assert_eq!(
            default_specs,
            vec![Some("sonnet".to_string()), Some("opus".to_string())]
        );

        let quick_specs = workflow.agent_model_specs("quick");
        assert_eq!(quick_specs, vec![Some("haiku".to_string())]);
    }

    // ========================================================================
    // Stage description for artifact
    // ========================================================================

    #[test]
    fn test_stage_description_for_artifact_returns_none_for_unknown_artifact() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("planning", "plan")]);
        assert!(workflow
            .stage_description_for_artifact("default", "unknown")
            .is_none());
    }

    #[test]
    fn test_stage_description_for_artifact_returns_none_when_no_description_set() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("planning", "plan")]);
        assert!(workflow
            .stage_description_for_artifact("default", "plan")
            .is_none());
    }

    #[test]
    fn test_stage_description_for_artifact_returns_description_when_present() {
        let stage =
            StageConfig::new("planning", "plan").with_description("The implementation plan");
        let workflow = WorkflowConfig::new(vec![stage]);
        assert_eq!(
            workflow.stage_description_for_artifact("default", "plan"),
            Some("The implementation plan")
        );
    }

    #[test]
    fn test_stage_description_for_artifact_matches_by_artifact_name_not_stage_name() {
        let stage = StageConfig::new("planning", "plan").with_description("The plan");
        let workflow = WorkflowConfig::new(vec![stage]);
        assert!(workflow
            .stage_description_for_artifact("default", "planning")
            .is_none());
        assert_eq!(
            workflow.stage_description_for_artifact("default", "plan"),
            Some("The plan")
        );
    }

    // ========================================================================
    // Serialization
    // ========================================================================

    #[test]
    fn test_workflow_serialization() {
        let workflow = test_default_workflow();
        let yaml = serde_yaml::to_string(&workflow).unwrap();

        assert!(yaml.contains("version: 1"));
        assert!(yaml.contains("flows:"));
        assert!(yaml.contains("default:"));
        assert!(yaml.contains("- name: planning"));
        assert!(yaml.contains("artifact: plan"));

        let parsed: WorkflowConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed, workflow);
    }

    #[test]
    fn test_v2_yaml_deserialization() {
        let yaml = r"
version: 2
flows:
  default:
    stages:
      - name: planning
        artifact: plan
      - name: work
        artifact: summary
    integration:
      on_failure: planning
  quick:
    stages:
      - name: work
        artifact: summary
    integration:
      on_failure: work
";
        let workflow: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(workflow.version, 2);
        assert!(workflow.flows.contains_key("default"));
        assert!(workflow.flows.contains_key("quick"));
        assert!(workflow.is_valid(), "errors: {:?}", workflow.validate());
    }

    #[test]
    fn test_yaml_anchors_deserialization() {
        // serde_yaml should resolve YAML anchors transparently
        let yaml = r"
version: 2
flows:
  default:
    stages:
      - &work_stage
        name: work
        artifact: summary
      - name: review
        artifact: verdict
    integration:
      on_failure: work
  quick:
    stages:
      - *work_stage
    integration:
      on_failure: work
";
        let workflow: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
        // Both flows should have the work stage resolved from the anchor
        assert_eq!(workflow.flow("default").unwrap().stages[0].name, "work");
        assert_eq!(workflow.flow("quick").unwrap().stages[0].name, "work");
    }

    #[test]
    fn test_integration_config_default() {
        let config = IntegrationConfig::default();
        assert!(config.on_failure.is_empty());
        assert!(!config.auto_merge);
    }

    #[test]
    fn test_integration_config_new() {
        let config = IntegrationConfig::new("work");
        assert_eq!(config.on_failure, "work");
        assert!(!config.auto_merge);
    }

    #[test]
    fn test_workflow_with_integration_config() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig {
            on_failure: "planning".to_string(),
            auto_merge: true,
        });

        let flow = workflow.flow("default").unwrap();
        assert_eq!(flow.integration.on_failure, "planning");
        assert!(workflow.is_valid());
    }

    #[test]
    fn test_integration_config_serialization() {
        let workflow = test_default_workflow();
        let yaml = serde_yaml::to_string(&workflow).unwrap();

        assert!(yaml.contains("integration:"));
        assert!(yaml.contains("on_failure: work"));

        let parsed: WorkflowConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(
            parsed.flow("default").unwrap().integration.on_failure,
            "work"
        );
    }

    // ========================================================================
    // Default workflow structure
    // ========================================================================

    #[test]
    fn test_default_workflow_matches_orkestra() {
        let workflow = test_default_workflow();

        let flow = workflow.flow("default").unwrap();
        assert_eq!(flow.stages.len(), 4);

        // Planning can ask questions
        let planning = workflow.stage("default", "planning").unwrap();
        assert!(planning.capabilities.ask_questions);
        assert!(!planning.capabilities.produces_subtasks());

        // Breakdown can produce subtasks
        let breakdown = workflow.stage("default", "breakdown").unwrap();
        assert!(breakdown.capabilities.produces_subtasks());

        // Review is automated and has approval capability
        let review = workflow.stage("default", "review").unwrap();
        assert!(review.is_automated);
        assert!(review.capabilities.has_approval());
        assert_eq!(review.capabilities.rejection_stage(), Some("work"));
    }

    #[test]
    fn test_default_workflow_has_prompt_paths() {
        let workflow = test_default_workflow();

        let planning = workflow.stage("default", "planning").unwrap();
        assert_eq!(planning.prompt_path(), Some("planner.md".to_string()));

        let breakdown = workflow.stage("default", "breakdown").unwrap();
        assert_eq!(breakdown.prompt_path(), Some("breakdown.md".to_string()));

        let work = workflow.stage("default", "work").unwrap();
        assert_eq!(work.prompt_path(), Some("worker.md".to_string()));

        let review = workflow.stage("default", "review").unwrap();
        assert_eq!(review.prompt_path(), Some("reviewer.md".to_string()));
    }

    #[test]
    fn test_default_workflow_has_subtask_flow() {
        let workflow = test_default_workflow();

        // Breakdown stage should have subtasks.flow pointing to "subtask"
        let breakdown = workflow.stage("default", "breakdown").unwrap();
        assert_eq!(breakdown.capabilities.subtask_flow(), Some("subtask"));

        // The "subtask" flow should exist
        let subtask_flow = workflow.flow("subtask");
        assert!(subtask_flow.is_some());
        let subtask_flow = subtask_flow.unwrap();
        assert_eq!(subtask_flow.stages.len(), 2);
        assert_eq!(subtask_flow.stages[0].name, "work");
        assert_eq!(subtask_flow.stages[1].name, "review");
    }

    #[test]
    fn test_flow_config_stage_lookup() {
        let flow = default_flow();
        assert!(flow.stage("planning").is_some());
        assert!(flow.stage("work").is_some());
        assert!(flow.stage("nonexistent").is_none());
    }

    // ========================================================================
    // Validation tests
    // ========================================================================

    #[test]
    fn test_workflow_validation_valid() {
        let workflow = test_default_workflow();
        assert!(workflow.is_valid(), "errors: {:?}", workflow.validate());
    }

    #[test]
    fn test_workflow_validation_empty_flows() {
        let workflow = WorkflowConfig {
            version: 1,
            flows: IndexMap::new(),
        };
        let errors = workflow.validate();
        assert!(!errors.is_empty());
        assert!(errors[0].contains("at least one flow"), "got: {errors:?}");
    }

    #[test]
    fn test_workflow_validation_empty_stages_in_flow() {
        let mut flows = IndexMap::new();
        flows.insert(
            "default".to_string(),
            FlowConfig {
                stages: vec![],
                integration: IntegrationConfig::new("work"),
            },
        );
        let workflow = WorkflowConfig { version: 1, flows };
        let errors = workflow.validate();
        assert!(errors.iter().any(|e| e.contains("has no stages")));
    }

    #[test]
    fn test_workflow_validation_duplicate_stage_name() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("planning", "other"), // Duplicate name in same flow
        ]);
        let errors = workflow.validate();
        assert!(errors.iter().any(|e| e.contains("duplicate stage name")));
    }

    #[test]
    fn test_workflow_validation_duplicate_artifact() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "plan"), // Duplicate artifact name in same flow
        ]);
        let errors = workflow.validate();
        assert!(errors.iter().any(|e| e.contains("duplicate artifact name")));
    }

    #[test]
    fn test_workflow_validation_invalid_approval_target() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_approval(Some("nonexistent".into()))),
        ]);
        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("rejection_stage") && e.contains("not in flow")));
    }

    #[test]
    fn test_workflow_validation_valid_approval_target() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_approval(Some("work".into()))),
        ])
        .with_integration(IntegrationConfig::new("work"));
        let errors = workflow.validate();
        assert!(errors.is_empty(), "Expected no errors, got: {errors:?}");
    }

    #[test]
    fn test_workflow_validation_approval_no_rejection_stage() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_approval(None)),
        ])
        .with_integration(IntegrationConfig::new("work"));
        let errors = workflow.validate();
        assert!(errors.is_empty(), "Expected no errors, got: {errors:?}");
    }

    #[test]
    fn test_workflow_validation_invalid_integration_on_failure() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig {
            on_failure: "nonexistent".to_string(),
            auto_merge: false,
        });

        let errors = workflow.validate();
        assert!(
            errors
                .iter()
                .any(|e| e.contains("integration.on_failure") && e.contains("not in this flow")),
            "got: {errors:?}"
        );
    }

    #[test]
    fn test_validate_integration_on_failure_not_in_flow() {
        // approval rejection_stage in a flow that doesn't have it
        let mut flows = IndexMap::new();
        flows.insert(
            "default".to_string(),
            FlowConfig {
                stages: vec![StageConfig::new("work", "summary")],
                integration: IntegrationConfig::new("planning"), // "planning" not in this flow!
            },
        );
        let workflow = WorkflowConfig { version: 1, flows };
        let errors = workflow.validate();
        assert!(
            errors
                .iter()
                .any(|e| e.contains("integration.on_failure") && e.contains("not in this flow")),
            "got: {errors:?}"
        );
    }

    #[test]
    fn test_reserved_artifact_name_rejected() {
        let config = WorkflowConfig::new(vec![StageConfig::new("work", "activity_log")]);
        let errors = config.validate();
        assert!(!errors.is_empty());
        assert!(errors[0].contains("reserved artifact name"));
    }

    #[test]
    fn test_reserved_task_artifact_name_rejected() {
        let config = WorkflowConfig::new(vec![StageConfig::new("work", "trak")]);
        let errors = config.validate();
        assert!(!errors.is_empty());
        assert!(errors[0].contains("reserved artifact name"));
    }

    // ========================================================================
    // Subtask flow validation
    // ========================================================================

    #[test]
    fn test_subtask_flow_references_existing_flow() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("breakdown", "breakdown").with_capabilities(StageCapabilities {
                subtasks: Some(SubtaskCapabilities::default().with_flow("nonexistent")),
                ..Default::default()
            }),
            StageConfig::new("work", "summary"),
        ]);

        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("subtasks.flow") && e.contains("doesn't exist")));
    }

    #[test]
    fn test_completion_stage_not_in_flow() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("breakdown", "breakdown").with_capabilities(StageCapabilities {
                subtasks: Some(SubtaskCapabilities::default().with_completion_stage("nonexistent")),
                ..Default::default()
            }),
            StageConfig::new("work", "summary"),
        ]);

        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("completion_stage") && e.contains("not in flow")));
    }

    #[test]
    fn test_subtask_flow_yaml_round_trip() {
        let yaml = r"
version: 2
flows:
  default:
    stages:
      - name: planning
        artifact: plan
      - name: breakdown
        artifact: breakdown
        capabilities:
          subtasks:
            flow: subtask
      - name: work
        artifact: summary
      - name: review
        artifact: verdict
        capabilities:
          approval:
            rejection_stage: work
    integration:
      on_failure: work
  subtask:
    stages:
      - name: work
        artifact: summary
      - name: review
        artifact: verdict
        capabilities:
          approval:
            rejection_stage: work
    integration:
      on_failure: work
";
        let workflow: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
        assert!(workflow.is_valid(), "errors: {:?}", workflow.validate());

        let breakdown = workflow.stage("default", "breakdown").unwrap();
        assert_eq!(breakdown.capabilities.subtask_flow(), Some("subtask"));
        assert!(workflow.flow("subtask").is_some());
    }

    // ========================================================================
    // Disallowed tools validation
    // ========================================================================

    #[test]
    fn test_validate_disallowed_tools_empty_pattern() {
        let stage = StageConfig::new("work", "summary").with_disallowed_tools(vec![
            ToolRestriction {
                pattern: "Bash(cargo *)".to_string(),
                message: Some("Valid".to_string()),
            },
            ToolRestriction {
                pattern: "  ".to_string(),
                message: Some("Invalid".to_string()),
            },
        ]);

        let workflow = WorkflowConfig::new(vec![stage]);
        let errors = workflow.validate();
        assert!(
            errors
                .iter()
                .any(|e| e.contains("empty pattern") && e.contains("work")),
            "Expected validation error. Got: {errors:?}"
        );
    }

    #[test]
    fn test_validate_disallowed_tools_on_agent_stage_valid() {
        let stage =
            StageConfig::new("work", "summary").with_disallowed_tools(vec![ToolRestriction {
                pattern: "Bash(cargo *)".to_string(),
                message: Some("Use checks stage".to_string()),
            }]);

        let workflow =
            WorkflowConfig::new(vec![stage]).with_integration(IntegrationConfig::new("work"));

        let errors = workflow.validate();
        assert!(
            errors.is_empty(),
            "Expected no errors for agent stage with disallowed_tools. Got: {errors:?}"
        );
    }

    // ========================================================================
    // Gate validation
    // ========================================================================

    #[test]
    fn test_validate_gate_empty_command() {
        let mut gate = GateConfig::new("./checks.sh");
        gate.command = String::new();
        let workflow =
            WorkflowConfig::new(vec![StageConfig::new("work", "summary").with_gate(gate)])
                .with_integration(IntegrationConfig::new("work"));

        let errors = workflow.validate();
        assert!(
            errors
                .iter()
                .any(|e| e.contains("work") && e.contains("empty command")),
            "expected empty command error, got: {errors:?}"
        );
    }

    #[test]
    fn test_validate_gate_zero_timeout() {
        let mut gate = GateConfig::new("./checks.sh");
        gate.timeout_seconds = 0;
        let workflow =
            WorkflowConfig::new(vec![StageConfig::new("work", "summary").with_gate(gate)])
                .with_integration(IntegrationConfig::new("work"));

        let errors = workflow.validate();
        assert!(
            errors
                .iter()
                .any(|e| e.contains("work") && e.contains("timeout_seconds of 0")),
            "expected zero timeout error, got: {errors:?}"
        );
    }

    #[test]
    fn test_validate_gate_valid_config() {
        let gate = GateConfig::new("./checks.sh");
        let workflow =
            WorkflowConfig::new(vec![StageConfig::new("work", "summary").with_gate(gate)])
                .with_integration(IntegrationConfig::new("work"));

        let errors = workflow.validate();
        assert!(
            !errors.iter().any(|e| e.contains("gate")),
            "expected no gate errors, got: {errors:?}"
        );
    }

    // ========================================================================
    // Approval in flow validation
    // ========================================================================

    #[test]
    fn test_approval_rejection_stage_not_in_flow() {
        let mut flows = IndexMap::new();
        flows.insert(
            "quick".to_string(),
            FlowConfig {
                stages: vec![
                    // "work" has approval with rejection_stage "planning", but "planning" is not in this flow
                    StageConfig::new("work", "summary").with_capabilities(
                        StageCapabilities::with_approval(Some("planning".into())),
                    ),
                ],
                integration: IntegrationConfig::new("work"),
            },
        );
        let workflow = WorkflowConfig { version: 1, flows };
        let errors = workflow.validate();
        assert!(
            errors.iter().any(|e| e.contains("quick")
                && e.contains("rejection_stage")
                && e.contains("planning")),
            "got: {errors:?}"
        );
    }

    // ========================================================================
    // with_integration / with_flows builders
    // ========================================================================

    #[test]
    fn test_with_integration_applies_to_default_flow() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig::new("work"));

        let flow = workflow.flow("default").unwrap();
        assert_eq!(flow.integration.on_failure, "work");
    }

    #[test]
    fn test_with_flows_merges_additional_flows() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")]).with_flows(
            IndexMap::from([(
                "quick".to_string(),
                FlowConfig {
                    stages: vec![StageConfig::new("work", "summary")],
                    integration: IntegrationConfig::new("work"),
                },
            )]),
        );

        assert!(workflow.flows.contains_key("default"));
        assert!(workflow.flows.contains_key("quick"));
    }

    // ========================================================================
    // Integration config within flow
    // ========================================================================

    #[test]
    fn test_integration_config_custom_on_failure_yaml() {
        let yaml = r"
version: 2
flows:
  default:
    stages:
      - name: planning
        artifact: plan
      - name: work
        artifact: summary
    integration:
      on_failure: planning
";
        let workflow: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(
            workflow.flow("default").unwrap().integration.on_failure,
            "planning"
        );
        assert!(workflow.is_valid());
    }
}
