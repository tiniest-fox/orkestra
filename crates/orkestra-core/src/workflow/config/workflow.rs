//! Workflow configuration.
//!
//! A workflow is an ordered collection of stages that define the task lifecycle.
//! Stages are processed in order, with optional stages being skippable.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::stage::{StageCapabilities, StageConfig};

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

    /// Named alternate flows (shortened pipelines).
    /// Each flow defines a subset of stages with optional overrides.
    /// The full pipeline is the implicit default flow.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub flows: HashMap<String, FlowConfig>,
}

/// Configuration for an alternate flow (shortened pipeline).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowConfig {
    /// Human-readable description of when to use this flow.
    #[serde(default)]
    pub description: String,

    /// Optional lucide-react icon name (e.g., "zap", "rocket").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    /// Ordered list of stages in this flow.
    /// Each entry is either a stage name (string) or a map with one key
    /// (stage name) whose value contains overrides.
    pub stages: Vec<FlowStageEntry>,
}

/// A stage entry in a flow definition.
///
/// Can be a plain stage name (no overrides) or a stage name with overrides.
#[derive(Debug, Clone, PartialEq)]
pub struct FlowStageEntry {
    /// The stage name (must reference a top-level stage).
    pub stage_name: String,
    /// Optional overrides for this stage in this flow.
    pub overrides: Option<FlowStageOverride>,
}

/// Overridable fields for a stage within a flow.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowStageOverride {
    /// Override prompt template path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// Override capabilities (full replace, not merge).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<StageCapabilities>,
}

// Custom serde for FlowStageEntry to handle the YAML format:
// - Simple string: "work" → FlowStageEntry { stage_name: "work", overrides: None }
// - Map with overrides: { work: { prompt: "worker_quick.md" } } → FlowStageEntry { stage_name: "work", overrides: Some(...) }
impl Serialize for FlowStageEntry {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        match &self.overrides {
            None => serializer.serialize_str(&self.stage_name),
            Some(overrides) => {
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry(&self.stage_name, overrides)?;
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for FlowStageEntry {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de;

        struct FlowStageEntryVisitor;

        impl<'de> de::Visitor<'de> for FlowStageEntryVisitor {
            type Value = FlowStageEntry;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a stage name string or a map with one stage name key")
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(FlowStageEntry {
                    stage_name: v.to_string(),
                    overrides: None,
                })
            }

            fn visit_map<M: de::MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let (stage_name, overrides): (String, FlowStageOverride) = map
                    .next_entry()?
                    .ok_or_else(|| de::Error::custom("expected a stage name key"))?;
                Ok(FlowStageEntry {
                    stage_name,
                    overrides: Some(overrides),
                })
            }
        }

        deserializer.deserialize_any(FlowStageEntryVisitor)
    }
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
            flows: HashMap::new(),
        }
    }

    /// Builder: set integration config.
    #[must_use]
    pub fn with_integration(mut self, integration: IntegrationConfig) -> Self {
        self.integration = integration;
        self
    }

    /// Builder: set flows.
    #[must_use]
    pub fn with_flows(mut self, flows: HashMap<String, FlowConfig>) -> Self {
        self.flows = flows;
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

    /// Get the next stage after the given stage name (default flow).
    /// Returns None if this is the last stage or stage not found.
    pub fn next_stage(&self, current: &str) -> Option<&StageConfig> {
        let idx = self.stage_index(current)?;
        self.stages.get(idx + 1)
    }

    /// Get the first stage in the workflow (default flow).
    pub fn first_stage(&self) -> Option<&StageConfig> {
        self.stages.first()
    }

    /// Get all stage names in order.
    pub fn stage_names(&self) -> Vec<&str> {
        self.stages.iter().map(|s| s.name.as_str()).collect()
    }

    // ========================================================================
    // Flow-aware stage navigation
    // ========================================================================

    /// Get the first stage in a flow, or the first global stage for default flow.
    pub fn first_stage_in_flow(&self, flow: Option<&str>) -> Option<&StageConfig> {
        match flow {
            None => self.first_stage(),
            Some(flow_name) => {
                let flow_config = self.flows.get(flow_name)?;
                let first_entry = flow_config.stages.first()?;
                self.stage(&first_entry.stage_name)
            }
        }
    }

    /// Get the next stage in a flow after the given stage name.
    ///
    /// For default flow (None), uses linear ordering.
    /// For named flows, uses the flow's stage list ordering.
    pub fn next_stage_in_flow(&self, current: &str, flow: Option<&str>) -> Option<&StageConfig> {
        match flow {
            None => self.next_stage(current),
            Some(flow_name) => {
                let flow_config = self.flows.get(flow_name)?;
                let idx = flow_config
                    .stages
                    .iter()
                    .position(|e| e.stage_name == current)?;
                let next_entry = flow_config.stages.get(idx + 1)?;
                self.stage(&next_entry.stage_name)
            }
        }
    }

    /// Get the effective prompt path for a stage in a flow.
    ///
    /// Returns the flow override if one exists, otherwise the global stage's prompt path.
    pub fn effective_prompt_path(&self, stage_name: &str, flow: Option<&str>) -> Option<String> {
        // Check flow override first
        if let Some(flow_name) = flow {
            if let Some(flow_config) = self.flows.get(flow_name) {
                if let Some(entry) = flow_config
                    .stages
                    .iter()
                    .find(|e| e.stage_name == stage_name)
                {
                    if let Some(ref overrides) = entry.overrides {
                        if let Some(ref prompt) = overrides.prompt {
                            return Some(prompt.clone());
                        }
                    }
                }
            }
        }

        // Fall back to global stage config
        self.stage(stage_name)
            .and_then(super::stage::StageConfig::prompt_path)
    }

    /// Get the effective capabilities for a stage in a flow.
    ///
    /// Flow overrides fully replace (not merge) the global capabilities.
    pub fn effective_capabilities(
        &self,
        stage_name: &str,
        flow: Option<&str>,
    ) -> Option<StageCapabilities> {
        // Check flow override first
        if let Some(flow_name) = flow {
            if let Some(flow_config) = self.flows.get(flow_name) {
                if let Some(entry) = flow_config
                    .stages
                    .iter()
                    .find(|e| e.stage_name == stage_name)
                {
                    if let Some(ref overrides) = entry.overrides {
                        if let Some(ref caps) = overrides.capabilities {
                            return Some(caps.clone());
                        }
                    }
                }
            }
        }

        // Fall back to global stage config
        self.stage(stage_name).map(|s| s.capabilities.clone())
    }

    /// Check whether a given stage is in the specified flow.
    pub fn stage_in_flow(&self, stage_name: &str, flow: Option<&str>) -> bool {
        match flow {
            None => self.stage(stage_name).is_some(),
            Some(flow_name) => self
                .flows
                .get(flow_name)
                .is_some_and(|f| f.stages.iter().any(|e| e.stage_name == stage_name)),
        }
    }

    /// Get flow config by name.
    pub fn flow(&self, name: &str) -> Option<&FlowConfig> {
        self.flows.get(name)
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
        self.validate_flows(&stage_names_set, &mut errors);
        self.validate_subtask_flows(&mut errors);

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
            // Check that stage doesn't have both prompt and script
            if stage.prompt.is_some() && stage.script.is_some() {
                errors.push(format!(
                    "Stage \"{}\" has both prompt and script configuration. \
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

    /// Validate flow configurations.
    fn validate_flows(
        &self,
        stage_names_set: &std::collections::HashSet<&str>,
        errors: &mut Vec<String>,
    ) {
        for (flow_name, flow) in &self.flows {
            // Reserved name
            if flow_name == "default" {
                errors.push("Flow name \"default\" is reserved for the full pipeline".to_string());
            }

            // Must have at least one stage
            if flow.stages.is_empty() {
                errors.push(format!("Flow \"{flow_name}\" has no stages"));
                continue;
            }

            let flow_stage_names: std::collections::HashSet<&str> =
                flow.stages.iter().map(|e| e.stage_name.as_str()).collect();

            for entry in &flow.stages {
                // Stage must exist globally
                if !stage_names_set.contains(entry.stage_name.as_str()) {
                    errors.push(format!(
                        "Flow \"{flow_name}\" references stage \"{}\" which doesn't exist",
                        entry.stage_name
                    ));
                    continue;
                }

                // Script stages cannot have overrides
                if let Some(ref overrides) = entry.overrides {
                    let is_script = self
                        .stage(&entry.stage_name)
                        .is_some_and(super::stage::StageConfig::is_script_stage);
                    if is_script {
                        errors.push(format!(
                            "Flow \"{flow_name}\" cannot override stage \"{}\" — script stages don't support overrides",
                            entry.stage_name
                        ));
                    }

                    // Validate that capability overrides with restage targets reference stages in the flow
                    if let Some(ref caps) = overrides.capabilities {
                        for target in &caps.supports_restage {
                            if !flow_stage_names.contains(target.as_str()) {
                                errors.push(format!(
                                    "Flow \"{flow_name}\" stage \"{}\" can restage to \"{target}\", but \"{target}\" is not in flow \"{flow_name}\"",
                                    entry.stage_name
                                ));
                            }
                        }
                    }
                }

                // Validate restage targets from global capabilities are in the flow
                if entry
                    .overrides
                    .as_ref()
                    .and_then(|o| o.capabilities.as_ref())
                    .is_none()
                {
                    if let Some(global_stage) = self.stage(&entry.stage_name) {
                        for target in &global_stage.capabilities.supports_restage {
                            if !flow_stage_names.contains(target.as_str()) {
                                errors.push(format!(
                                    "Flow \"{flow_name}\" includes stage \"{}\" which can restage to \"{target}\", but \"{target}\" is not in flow \"{flow_name}\"",
                                    entry.stage_name
                                ));
                            }
                        }
                    }
                }

                // Validate script on_failure targets are in the flow
                if let Some(global_stage) = self.stage(&entry.stage_name) {
                    if let Some(ref script) = global_stage.script {
                        if let Some(ref on_failure) = script.on_failure {
                            if !flow_stage_names.contains(on_failure.as_str()) {
                                errors.push(format!(
                                    "Flow \"{flow_name}\" includes script stage \"{}\" with on_failure=\"{on_failure}\", but \"{on_failure}\" is not in flow \"{flow_name}\"",
                                    entry.stage_name
                                ));
                            }
                        }
                    }
                }
            }
        }
    }

    /// Validate `subtask_flow` references on stages.
    fn validate_subtask_flows(&self, errors: &mut Vec<String>) {
        for stage in &self.stages {
            if let Some(ref flow_name) = stage.capabilities.subtask_flow {
                if !stage.capabilities.produce_subtasks {
                    errors.push(format!(
                        "Stage \"{}\" has subtask_flow=\"{flow_name}\" but produce_subtasks is false. \
                         Set produce_subtasks: true or remove subtask_flow.",
                        stage.name
                    ));
                }
                if !self.flows.contains_key(flow_name) {
                    errors.push(format!(
                        "Stage \"{}\" has subtask_flow=\"{flow_name}\" but flow \"{flow_name}\" doesn't exist. \
                         Define the flow under 'flows:' or remove subtask_flow.",
                        stage.name
                    ));
                }
            }
        }

        // Also validate flow overrides that set subtask_flow
        for (flow_name, flow) in &self.flows {
            for entry in &flow.stages {
                if let Some(ref overrides) = entry.overrides {
                    if let Some(ref caps) = overrides.capabilities {
                        if let Some(ref subtask_flow) = caps.subtask_flow {
                            if !caps.produce_subtasks {
                                errors.push(format!(
                                    "Flow \"{flow_name}\" stage \"{}\" has subtask_flow=\"{subtask_flow}\" \
                                     but produce_subtasks is false.",
                                    entry.stage_name
                                ));
                            }
                            if !self.flows.contains_key(subtask_flow) {
                                errors.push(format!(
                                    "Flow \"{flow_name}\" stage \"{}\" has subtask_flow=\"{subtask_flow}\" \
                                     but flow \"{subtask_flow}\" doesn't exist.",
                                    entry.stage_name
                                ));
                            }
                        }
                    }
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
        use super::stage::{StageCapabilities, StageConfig};

        let mut flows = HashMap::new();
        flows.insert(
            "subtask".to_string(),
            FlowConfig {
                description: "Simplified pipeline for subtasks (work → review)".to_string(),
                icon: Some("git-branch".to_string()),
                stages: vec![
                    FlowStageEntry {
                        stage_name: "work".to_string(),
                        overrides: None,
                    },
                    FlowStageEntry {
                        stage_name: "review".to_string(),
                        overrides: Some(FlowStageOverride {
                            prompt: None,
                            capabilities: Some(StageCapabilities::with_restage(
                                vec!["work".into()],
                            )),
                        }),
                    },
                ],
            },
        );

        Self::new(vec![
            StageConfig::new("planning", "plan")
                .with_display_name("Planning")
                .with_prompt("planner.md")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("breakdown", "breakdown")
                .with_display_name("Breaking Down")
                .with_prompt("breakdown.md")
                .with_inputs(vec!["plan".into()])
                .with_capabilities(StageCapabilities::with_subtasks().with_subtask_flow("subtask")),
            StageConfig::new("work", "summary")
                .with_display_name("Working")
                .with_prompt("worker.md")
                .with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_display_name("Reviewing")
                .with_prompt("reviewer.md")
                .with_inputs(vec!["plan".into(), "summary".into()])
                .with_capabilities(StageCapabilities::with_restage(vec!["work".into()]))
                .automated(),
        ])
        .with_flows(flows)
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
    fn test_default_workflow_has_prompt_paths() {
        let workflow = WorkflowConfig::default();

        // Each stage should have the correct prompt path
        let planning = workflow.stage("planning").unwrap();
        assert_eq!(planning.prompt_path(), Some("planner.md".to_string()));

        let breakdown = workflow.stage("breakdown").unwrap();
        assert_eq!(breakdown.prompt_path(), Some("breakdown.md".to_string()));

        let work = workflow.stage("work").unwrap();
        assert_eq!(work.prompt_path(), Some("worker.md".to_string()));

        let review = workflow.stage("review").unwrap();
        assert_eq!(review.prompt_path(), Some("reviewer.md".to_string()));
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
    fn test_stage_cannot_have_both_prompt_and_script() {
        use crate::workflow::config::stage::ScriptStageConfig;

        let mut stage = StageConfig::new("checks", "check_results");
        stage.prompt = Some("worker.md".to_string());
        stage.script = Some(ScriptStageConfig::new("./run.sh"));

        let workflow = WorkflowConfig::new(vec![stage]);

        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("has both prompt and script")));
    }

    #[test]
    fn test_script_stage_yaml_parsing() {
        let yaml = r#"
version: 1
stages:
  - name: work
    artifact: summary
    prompt: worker.md
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
    prompt: reviewer.md
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

    // ========================================================================
    // Subtask flow validation tests
    // ========================================================================

    #[test]
    fn test_default_workflow_has_subtask_flow() {
        let workflow = WorkflowConfig::default();

        // Breakdown stage should have subtask_flow pointing to "subtask"
        let breakdown = workflow.stage("breakdown").unwrap();
        assert_eq!(
            breakdown.capabilities.subtask_flow,
            Some("subtask".to_string())
        );

        // The "subtask" flow should exist
        let subtask_flow = workflow.flow("subtask");
        assert!(subtask_flow.is_some());
        let subtask_flow = subtask_flow.unwrap();
        assert_eq!(subtask_flow.stages.len(), 2);
        assert_eq!(subtask_flow.stages[0].stage_name, "work");
        assert_eq!(subtask_flow.stages[1].stage_name, "review");
    }

    #[test]
    fn test_subtask_flow_references_existing_flow() {
        use crate::workflow::config::stage::StageCapabilities;

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("breakdown", "breakdown").with_capabilities(
                StageCapabilities::with_subtasks().with_subtask_flow("nonexistent"),
            ),
            StageConfig::new("work", "summary"),
        ]);

        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("subtask_flow") && e.contains("doesn't exist")));
    }

    #[test]
    fn test_subtask_flow_requires_produce_subtasks() {
        use crate::workflow::config::stage::StageCapabilities;

        let caps = StageCapabilities {
            subtask_flow: Some("subtask".to_string()),
            ..Default::default()
        };

        let mut flows = HashMap::new();
        flows.insert(
            "subtask".to_string(),
            FlowConfig {
                description: "test".to_string(),
                icon: None,
                stages: vec![FlowStageEntry {
                    stage_name: "work".to_string(),
                    overrides: None,
                }],
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan").with_capabilities(caps),
            StageConfig::new("work", "summary"),
        ])
        .with_flows(flows);

        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("subtask_flow") && e.contains("produce_subtasks is false")));
    }

    #[test]
    fn test_subtask_flow_yaml_round_trip() {
        let yaml = r"
version: 1
stages:
  - name: planning
    artifact: plan
  - name: breakdown
    artifact: breakdown
    inputs: [plan]
    capabilities:
      produce_subtasks: true
      subtask_flow: subtask
  - name: work
    artifact: summary
  - name: review
    artifact: verdict
    capabilities:
      supports_restage: [work]
flows:
  subtask:
    description: Simplified pipeline for subtasks
    stages:
      - work
      - review:
          capabilities:
            supports_restage: [work]
integration:
  on_failure: work
";
        let workflow: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
        assert!(workflow.is_valid(), "errors: {:?}", workflow.validate());

        let breakdown = workflow.stage("breakdown").unwrap();
        assert_eq!(
            breakdown.capabilities.subtask_flow,
            Some("subtask".to_string())
        );
        assert!(workflow.flow("subtask").is_some());
    }
}
