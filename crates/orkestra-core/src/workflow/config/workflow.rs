//! Workflow configuration.
//!
//! A workflow is an ordered collection of stages that define the task lifecycle.
//! Stages are processed in order, with optional stages being skippable.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use super::stage::{DisallowedToolEntry, StageCapabilities, StageConfig};

/// A stage entry for the workflow overview in agent prompts.
/// Contains the stage name, description, and whether it's the current stage.
#[derive(Debug, Clone, Serialize)]
pub struct WorkflowStageEntry {
    /// Stage name (e.g., "plan", "work").
    pub name: String,
    /// Human-readable description of what this stage does.
    pub description: String,
    /// Whether this is the current stage being executed.
    pub is_current: bool,
}

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
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub flows: IndexMap<String, FlowConfig>,
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
    /// Override model identifier (e.g., "claudecode/haiku" for cheaper model in quick flow).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Override input artifacts (full replace, not merge).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inputs: Option<Vec<String>>,
    /// Override disallowed tools (full replace, not merge).
    /// `Some(vec![])` means "explicitly no restrictions" (overrides global config).
    /// `None` means "inherit from global stage config".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disallowed_tools: Option<Vec<DisallowedToolEntry>>,
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
            flows: IndexMap::new(),
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
    pub fn with_flows(mut self, flows: IndexMap<String, FlowConfig>) -> Self {
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

    /// Get the previous stage in a flow before the given stage name.
    ///
    /// For default flow (None), uses linear ordering.
    /// For named flows, uses the flow's stage list ordering.
    pub fn previous_stage_in_flow(
        &self,
        current: &str,
        flow: Option<&str>,
    ) -> Option<&StageConfig> {
        match flow {
            None => {
                let idx = self.stage_index(current)?;
                if idx == 0 {
                    return None;
                }
                self.stages.get(idx - 1)
            }
            Some(flow_name) => {
                let flow_config = self.flows.get(flow_name)?;
                let idx = flow_config
                    .stages
                    .iter()
                    .position(|e| e.stage_name == current)?;
                if idx == 0 {
                    return None;
                }
                let prev_entry = flow_config.stages.get(idx - 1)?;
                self.stage(&prev_entry.stage_name)
            }
        }
    }

    /// Resolve a flow-level override for a stage field.
    ///
    /// This is the generic core of all `effective_*` methods. It checks whether
    /// the flow has an override for the given stage, and if so, extracts the
    /// field using the provided closure. Returns `None` if:
    /// - No flow is specified
    /// - The flow doesn't exist
    /// - The flow doesn't include this stage
    /// - The stage has no overrides
    /// - The extractor returns `None` (field not overridden)
    fn flow_override<T>(
        &self,
        stage_name: &str,
        flow: Option<&str>,
        extractor: impl FnOnce(&FlowStageOverride) -> Option<T>,
    ) -> Option<T> {
        let flow_name = flow?;
        let flow_config = self.flows.get(flow_name)?;
        let entry = flow_config
            .stages
            .iter()
            .find(|e| e.stage_name == stage_name)?;
        let overrides = entry.overrides.as_ref()?;
        extractor(overrides)
    }

    /// Get the effective prompt path for a stage in a flow.
    ///
    /// Returns the flow override if one exists, otherwise the global stage's prompt path.
    pub fn effective_prompt_path(&self, stage_name: &str, flow: Option<&str>) -> Option<String> {
        self.flow_override(stage_name, flow, |o| o.prompt.clone())
            .or_else(|| self.stage(stage_name).and_then(StageConfig::prompt_path))
    }

    /// Get the effective capabilities for a stage in a flow.
    ///
    /// Flow overrides fully replace (not merge) the global capabilities.
    pub fn effective_capabilities(
        &self,
        stage_name: &str,
        flow: Option<&str>,
    ) -> Option<StageCapabilities> {
        self.flow_override(stage_name, flow, |o| o.capabilities.clone())
            .or_else(|| self.stage(stage_name).map(|s| s.capabilities.clone()))
    }

    /// Get the effective model for a stage in a flow.
    ///
    /// Flow overrides take precedence over the global stage config.
    /// Returns None if no model is configured (use provider default).
    pub fn effective_model(&self, stage_name: &str, flow: Option<&str>) -> Option<String> {
        self.flow_override(stage_name, flow, |o| o.model.clone())
            .or_else(|| self.stage(stage_name).and_then(|s| s.model.clone()))
    }

    /// Get the effective inputs for a stage in a flow.
    ///
    /// Flow overrides fully replace (not merge) the global inputs.
    pub fn effective_inputs(&self, stage_name: &str, flow: Option<&str>) -> Option<Vec<String>> {
        self.flow_override(stage_name, flow, |o| o.inputs.clone())
            .or_else(|| self.stage(stage_name).map(|s| s.inputs.clone()))
    }

    /// Get the effective disallowed tools for a stage in a flow.
    ///
    /// Flow overrides fully replace (not merge) the global disallowed tools.
    /// Returns empty vec if no restrictions are configured.
    pub fn effective_disallowed_tools(
        &self,
        stage_name: &str,
        flow: Option<&str>,
    ) -> Vec<DisallowedToolEntry> {
        self.flow_override(stage_name, flow, |o| o.disallowed_tools.clone())
            .or_else(|| self.stage(stage_name).map(|s| s.disallowed_tools.clone()))
            .unwrap_or_default()
    }

    /// Get the effective model specs for all agent (non-script) stages in the given flow.
    ///
    /// For default flow (None), iterates all global stages.
    /// For named flows, iterates only the stages listed in that flow.
    /// Returns model specs in stage order (None means "use provider default").
    pub fn agent_model_specs(&self, flow: Option<&str>) -> Vec<Option<String>> {
        match flow {
            None => {
                // Default flow: iterate all global stages
                self.stages
                    .iter()
                    .filter(|s| s.script.is_none())
                    .map(|s| s.model.clone())
                    .collect()
            }
            Some(flow_name) => {
                let Some(flow_config) = self.flows.get(flow_name) else {
                    return Vec::new();
                };
                flow_config
                    .stages
                    .iter()
                    .filter_map(|entry| {
                        let stage = self.stage(&entry.stage_name)?;
                        if stage.script.is_some() {
                            return None;
                        }
                        // Check flow model override, fall back to global stage model
                        let model = entry
                            .overrides
                            .as_ref()
                            .and_then(|o| o.model.clone())
                            .or_else(|| stage.model.clone());
                        Some(model)
                    })
                    .collect()
            }
        }
    }

    /// Get workflow stage entries for the prompt overview.
    ///
    /// Returns a list of all stages in the given flow (or default flow if None),
    /// with their names, descriptions, and a flag indicating the current stage.
    pub fn workflow_stage_entries(
        &self,
        current_stage: &str,
        flow: Option<&str>,
    ) -> Vec<WorkflowStageEntry> {
        match flow {
            None => {
                // Default flow: iterate all global stages
                self.stages
                    .iter()
                    .map(|stage| WorkflowStageEntry {
                        name: stage.name.clone(),
                        description: stage.description.clone().unwrap_or_else(|| stage.display()),
                        is_current: stage.name == current_stage,
                    })
                    .collect()
            }
            Some(flow_name) => {
                let Some(flow_config) = self.flows.get(flow_name) else {
                    return Vec::new();
                };
                flow_config
                    .stages
                    .iter()
                    .filter_map(|entry| {
                        let stage = self.stage(&entry.stage_name)?;
                        Some(WorkflowStageEntry {
                            name: stage.name.clone(),
                            description: stage
                                .description
                                .clone()
                                .unwrap_or_else(|| stage.display()),
                            is_current: stage.name == current_stage,
                        })
                    })
                    .collect()
            }
        }
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
        self.validate_approval_targets(&stage_names, &stage_names_set, &mut errors);
        self.validate_integration_on_failure(&stage_names, &stage_names_set, &mut errors);
        self.validate_script_stages(&stage_names, &stage_names_set, &mut errors);
        self.validate_flows(&stage_names_set, &artifact_names_set, &mut errors);
        self.validate_subtask_flows(&mut errors);
        self.validate_model_fields(&mut errors);
        self.validate_disallowed_tools(&mut errors);

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

    /// Check that all approval `rejection_stage` targets reference valid stage names.
    fn validate_approval_targets(
        &self,
        stage_names: &[&str],
        stage_names_set: &std::collections::HashSet<&str>,
        errors: &mut Vec<String>,
    ) {
        for stage in &self.stages {
            if let Some(ref approval) = stage.capabilities.approval {
                if let Some(ref target) = approval.rejection_stage {
                    if !stage_names_set.contains(target.as_str()) {
                        errors.push(format!(
                            "Stage \"{}\" has approval rejection_stage \"{}\" which doesn't exist. \
                             Valid stages: {:?}",
                            stage.name, target, stage_names
                        ));
                    }
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
                if stage.capabilities.produces_subtasks() {
                    errors.push(format!(
                        "Script stage \"{}\" cannot have subtask capabilities. \
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
        artifact_names_set: &std::collections::HashSet<&str>,
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

                    // Validate that input overrides reference existing artifact names
                    if let Some(ref inputs) = overrides.inputs {
                        for input in inputs {
                            if !artifact_names_set.contains(input.as_str()) {
                                errors.push(format!(
                                    "Flow \"{flow_name}\" stage \"{}\" overrides inputs with \"{input}\" which doesn't match any stage artifact",
                                    entry.stage_name
                                ));
                            }
                        }
                    }

                    // Validate that capability overrides with approval rejection_stage reference stages in the flow
                    if let Some(ref caps) = overrides.capabilities {
                        if let Some(ref approval) = caps.approval {
                            if let Some(ref target) = approval.rejection_stage {
                                if !flow_stage_names.contains(target.as_str()) {
                                    errors.push(format!(
                                        "Flow \"{flow_name}\" stage \"{}\" has approval rejection_stage \"{target}\", but \"{target}\" is not in flow \"{flow_name}\"",
                                        entry.stage_name
                                    ));
                                }
                            }
                        }
                    }
                }

                // Validate approval rejection_stage from global capabilities are in the flow
                if entry
                    .overrides
                    .as_ref()
                    .and_then(|o| o.capabilities.as_ref())
                    .is_none()
                {
                    if let Some(global_stage) = self.stage(&entry.stage_name) {
                        if let Some(ref approval) = global_stage.capabilities.approval {
                            if let Some(ref target) = approval.rejection_stage {
                                if !flow_stage_names.contains(target.as_str()) {
                                    errors.push(format!(
                                        "Flow \"{flow_name}\" includes stage \"{}\" with approval rejection_stage \"{target}\", but \"{target}\" is not in flow \"{flow_name}\"",
                                        entry.stage_name
                                    ));
                                }
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

    /// Validate subtask capability references on stages and flow overrides.
    fn validate_subtask_flows(&self, errors: &mut Vec<String>) {
        let stage_names_set: std::collections::HashSet<&str> =
            self.stages.iter().map(|s| s.name.as_str()).collect();

        for stage in &self.stages {
            if let Some(ref subtask_caps) = stage.capabilities.subtasks {
                if let Some(ref flow_name) = subtask_caps.flow {
                    if !self.flows.contains_key(flow_name) {
                        errors.push(format!(
                            "Stage \"{}\" has subtasks.flow=\"{flow_name}\" but flow \"{flow_name}\" doesn't exist. \
                             Define the flow under 'flows:' or remove subtasks.flow.",
                            stage.name
                        ));
                    }
                }
                if let Some(ref target) = subtask_caps.completion_stage {
                    if !stage_names_set.contains(target.as_str()) {
                        errors.push(format!(
                            "Stage \"{}\" has subtasks.completion_stage=\"{target}\" but stage \"{target}\" doesn't exist.",
                            stage.name
                        ));
                    }
                }
            }
        }

        // Also validate flow overrides that set subtask capabilities
        for (flow_name, flow) in &self.flows {
            for entry in &flow.stages {
                if let Some(ref overrides) = entry.overrides {
                    if let Some(ref caps) = overrides.capabilities {
                        if let Some(ref subtask_caps) = caps.subtasks {
                            if let Some(ref subtask_flow) = subtask_caps.flow {
                                if !self.flows.contains_key(subtask_flow) {
                                    errors.push(format!(
                                        "Flow \"{flow_name}\" stage \"{}\" has subtasks.flow=\"{subtask_flow}\" \
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
    }

    /// Validate model fields on stages and flow overrides.
    fn validate_model_fields(&self, errors: &mut Vec<String>) {
        // Script stages should not have model or restart_on_reentry set
        for stage in &self.stages {
            if stage.model.is_some() && stage.is_script_stage() {
                errors.push(format!(
                    "Script stage \"{}\" has a model field, but model is only used by agent stages.",
                    stage.name
                ));
            }

            if stage.restart_on_reentry && stage.is_script_stage() {
                errors.push(format!(
                    "Script stage \"{}\" has restart_on_reentry set, but restart_on_reentry is only meaningful for agent stages.",
                    stage.name
                ));
            }

            // Validate model format: must be non-empty if present
            if let Some(ref model) = stage.model {
                if model.trim().is_empty() {
                    errors.push(format!(
                        "Stage \"{}\" has an empty model field. Remove the field or specify a model identifier.",
                        stage.name
                    ));
                }
            }
        }

        // Validate model in flow overrides
        for (flow_name, flow) in &self.flows {
            for entry in &flow.stages {
                if let Some(ref overrides) = entry.overrides {
                    if let Some(ref model) = overrides.model {
                        // Check that the overridden stage is not a script stage
                        let is_script = self
                            .stage(&entry.stage_name)
                            .is_some_and(super::stage::StageConfig::is_script_stage);
                        if is_script {
                            errors.push(format!(
                                "Flow \"{flow_name}\" overrides model on script stage \"{}\", but model is only used by agent stages.",
                                entry.stage_name
                            ));
                        }

                        if model.trim().is_empty() {
                            errors.push(format!(
                                "Flow \"{flow_name}\" stage \"{}\" has an empty model override. Remove the field or specify a model identifier.",
                                entry.stage_name
                            ));
                        }
                    }
                }
            }
        }
    }

    /// Validate `disallowed_tools` fields on stages and flow overrides.
    fn validate_disallowed_tools(&self, errors: &mut Vec<String>) {
        for stage in &self.stages {
            if !stage.disallowed_tools.is_empty() && stage.is_script_stage() {
                errors.push(format!(
                    "Script stage \"{}\" has disallowed_tools, but tool restrictions are only used by agent stages.",
                    stage.name
                ));
            }
            // Validate entries have non-empty patterns
            for (i, entry) in stage.disallowed_tools.iter().enumerate() {
                if entry.pattern.trim().is_empty() {
                    errors.push(format!(
                        "Stage \"{}\" has disallowed_tools[{}] with an empty pattern.",
                        stage.name, i
                    ));
                }
            }
        }

        // Validate disallowed_tools in flow overrides
        for (flow_name, flow) in &self.flows {
            for entry in &flow.stages {
                if let Some(ref overrides) = entry.overrides {
                    if let Some(ref tools) = overrides.disallowed_tools {
                        for (i, tool_entry) in tools.iter().enumerate() {
                            if tool_entry.pattern.trim().is_empty() {
                                errors.push(format!(
                                    "Flow \"{}\" stage \"{}\" has disallowed_tools[{}] with an empty pattern.",
                                    flow_name, entry.stage_name, i
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::fixtures::test_default_workflow;
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
        let workflow = test_default_workflow();

        let planning = workflow.stage("planning");
        assert!(planning.is_some());
        assert_eq!(planning.unwrap().artifact, "plan");

        let missing = workflow.stage("nonexistent");
        assert!(missing.is_none());
    }

    #[test]
    fn test_workflow_next_stage() {
        let workflow = test_default_workflow();

        let next = workflow.next_stage("planning");
        assert!(next.is_some());
        assert_eq!(next.unwrap().name, "breakdown");

        let next = workflow.next_stage("review");
        assert!(next.is_none()); // Last stage
    }

    #[test]
    fn test_workflow_stage_names() {
        let workflow = test_default_workflow();
        let names = workflow.stage_names();
        assert_eq!(names, vec!["planning", "breakdown", "work", "review"]);
    }

    #[test]
    fn test_workflow_validation_valid() {
        let workflow = test_default_workflow();
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
        let workflow = test_default_workflow();
        let yaml = serde_yaml::to_string(&workflow).unwrap();

        assert!(yaml.contains("version: 1"));
        assert!(yaml.contains("- name: planning"));
        assert!(yaml.contains("artifact: plan"));

        let parsed: WorkflowConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed, workflow);
    }

    #[test]
    fn test_default_workflow_matches_orkestra() {
        let workflow = test_default_workflow();

        // Should have 4 stages
        assert_eq!(workflow.stages.len(), 4);

        // Planning can ask questions
        let planning = workflow.stage("planning").unwrap();
        assert!(planning.capabilities.ask_questions);
        assert!(!planning.capabilities.produces_subtasks());

        // Breakdown can produce subtasks
        let breakdown = workflow.stage("breakdown").unwrap();
        assert!(breakdown.capabilities.produces_subtasks());

        // Review is automated and has approval capability
        let review = workflow.stage("review").unwrap();
        assert!(review.is_automated);
        assert!(review.capabilities.has_approval());
        assert_eq!(review.capabilities.rejection_stage(), Some("work"));
    }

    #[test]
    fn test_default_workflow_has_prompt_paths() {
        let workflow = test_default_workflow();

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
    fn test_workflow_validation_invalid_approval_target() {
        use crate::workflow::config::stage::StageCapabilities;

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_approval(Some("nonexistent".into()))),
        ]);
        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("rejection_stage") && e.contains("doesn't exist")));
    }

    #[test]
    fn test_workflow_validation_valid_approval_target() {
        use crate::workflow::config::stage::StageCapabilities;

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
            StageConfig::new("review", "verdict")
                .with_capabilities(StageCapabilities::with_approval(Some("work".into()))),
        ]);
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
    fn test_workflow_validation_restart_on_reentry_on_script_stage() {
        let mut script_stage = StageConfig::new_script("checks", "check_results", "cargo test");
        script_stage.restart_on_reentry = true; // Manually set (invalid)

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            script_stage,
            StageConfig::new("work", "summary"),
        ]);

        let errors = workflow.validate();
        assert!(
            errors.iter().any(|e| e.contains("restart_on_reentry")
                && e.contains("checks")
                && e.contains("only meaningful for agent stages")),
            "Expected validation error for restart_on_reentry on script stage. Got: {errors:?}"
        );
    }

    #[test]
    fn test_workflow_validation_restart_on_reentry_on_agent_stage_valid() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").restart_on_reentry(),
        ]);

        let errors = workflow.validate();
        assert!(
            errors.is_empty(),
            "restart_on_reentry should be valid on agent stages. Got errors: {errors:?}"
        );
    }

    #[test]
    fn test_integration_config_serialization() {
        let workflow = test_default_workflow();
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
    fn test_script_stage_cannot_have_subtask_capabilities() {
        use crate::workflow::config::stage::StageCapabilities;

        let stage = StageConfig::new_script("checks", "check_results", "./run.sh")
            .with_capabilities(StageCapabilities::with_subtasks());

        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary"), stage]);

        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("Script stage") && e.contains("subtask")));
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
        let workflow = test_default_workflow();

        // Breakdown stage should have subtasks.flow pointing to "subtask"
        let breakdown = workflow.stage("breakdown").unwrap();
        assert_eq!(breakdown.capabilities.subtask_flow(), Some("subtask"));

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
        use crate::workflow::config::stage::{StageCapabilities, SubtaskCapabilities};

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
    fn test_completion_stage_references_existing_stage() {
        use crate::workflow::config::stage::{StageCapabilities, SubtaskCapabilities};

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
            .any(|e| e.contains("completion_stage") && e.contains("doesn't exist")));
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
      subtasks:
        flow: subtask
  - name: work
    artifact: summary
  - name: review
    artifact: verdict
    capabilities:
      approval:
        rejection_stage: work
flows:
  subtask:
    description: Simplified pipeline for subtasks
    stages:
      - work
      - review
integration:
  on_failure: work
";
        let workflow: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
        assert!(workflow.is_valid(), "errors: {:?}", workflow.validate());

        let breakdown = workflow.stage("breakdown").unwrap();
        assert_eq!(breakdown.capabilities.subtask_flow(), Some("subtask"));
        assert!(workflow.flow("subtask").is_some());
    }

    #[test]
    fn test_agent_model_specs_default_flow() {
        let planning = StageConfig::new("planning", "plan").with_model("sonnet");
        let checks = StageConfig::new_script("checks", "check_results", "./run.sh");
        let work = StageConfig::new("work", "summary").with_model("opus");

        let workflow = WorkflowConfig::new(vec![planning, checks, work]);

        let specs = workflow.agent_model_specs(None);
        assert_eq!(specs.len(), 2); // script stage excluded
        assert_eq!(specs[0], Some("sonnet".to_string()));
        assert_eq!(specs[1], Some("opus".to_string()));
    }

    #[test]
    fn test_agent_model_specs_named_flow() {
        let planning = StageConfig::new("planning", "plan").with_model("sonnet");
        let checks = StageConfig::new_script("checks", "check_results", "./run.sh");
        let work = StageConfig::new("work", "summary").with_model("opus");

        let mut flows = IndexMap::new();
        flows.insert(
            "quick".to_string(),
            FlowConfig {
                description: "Quick flow".to_string(),
                icon: None,
                stages: vec![
                    FlowStageEntry {
                        stage_name: "planning".to_string(),
                        overrides: None,
                    },
                    FlowStageEntry {
                        stage_name: "work".to_string(),
                        overrides: None,
                    },
                ],
            },
        );

        let workflow = WorkflowConfig::new(vec![planning, checks, work]).with_flows(flows);

        let specs = workflow.agent_model_specs(Some("quick"));
        assert_eq!(specs.len(), 2); // only planning and work from flow
        assert_eq!(specs[0], Some("sonnet".to_string()));
        assert_eq!(specs[1], Some("opus".to_string()));
    }

    #[test]
    fn test_agent_model_specs_with_flow_override() {
        let planning = StageConfig::new("planning", "plan").with_model("sonnet");
        let work = StageConfig::new("work", "summary").with_model("opus");

        let mut flows = IndexMap::new();
        flows.insert(
            "cheap".to_string(),
            FlowConfig {
                description: "Cheap flow".to_string(),
                icon: None,
                stages: vec![
                    FlowStageEntry {
                        stage_name: "planning".to_string(),
                        overrides: Some(FlowStageOverride {
                            prompt: None,
                            capabilities: None,
                            model: Some("haiku".to_string()),
                            inputs: None,
                            disallowed_tools: None,
                        }),
                    },
                    FlowStageEntry {
                        stage_name: "work".to_string(),
                        overrides: None,
                    },
                ],
            },
        );

        let workflow = WorkflowConfig::new(vec![planning, work]).with_flows(flows);

        let specs = workflow.agent_model_specs(Some("cheap"));
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0], Some("haiku".to_string())); // overridden
        assert_eq!(specs[1], Some("opus".to_string())); // not overridden
    }

    #[test]
    fn test_agent_model_specs_nonexistent_flow() {
        let planning = StageConfig::new("planning", "plan").with_model("sonnet");
        let workflow = WorkflowConfig::new(vec![planning]);

        let specs = workflow.agent_model_specs(Some("nonexistent"));
        assert!(specs.is_empty());
    }

    #[test]
    fn test_workflow_stage_entries_default_flow() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict"),
        ]);

        let entries = workflow.workflow_stage_entries("work", None);
        assert_eq!(entries.len(), 3);

        // Check first stage
        assert_eq!(entries[0].name, "plan");
        assert_eq!(entries[0].description, "Create a plan");
        assert!(!entries[0].is_current);

        // Check current stage
        assert_eq!(entries[1].name, "work");
        assert_eq!(entries[1].description, "Implement the plan");
        assert!(entries[1].is_current);

        // Check stage without description (should use display())
        assert_eq!(entries[2].name, "review");
        assert_eq!(entries[2].description, "Review");
        assert!(!entries[2].is_current);
    }

    #[test]
    fn test_workflow_stage_entries_with_flow() {
        let mut flows = IndexMap::new();
        flows.insert(
            "quick".into(),
            FlowConfig {
                description: "Skip breakdown".into(),
                icon: Some("zap".into()),
                stages: vec![
                    FlowStageEntry {
                        stage_name: "plan".into(),
                        overrides: None,
                    },
                    FlowStageEntry {
                        stage_name: "work".into(),
                        overrides: None,
                    },
                ],
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("plan", "plan").with_description("Create a plan"),
            StageConfig::new("task", "breakdown"),
            StageConfig::new("work", "summary").with_description("Implement the plan"),
            StageConfig::new("review", "verdict"),
        ])
        .with_flows(flows);

        let entries = workflow.workflow_stage_entries("work", Some("quick"));
        assert_eq!(entries.len(), 2);

        // Should only include plan and work, not task or review
        assert_eq!(entries[0].name, "plan");
        assert_eq!(entries[0].description, "Create a plan");
        assert!(!entries[0].is_current);

        assert_eq!(entries[1].name, "work");
        assert_eq!(entries[1].description, "Implement the plan");
        assert!(entries[1].is_current);
    }

    #[test]
    fn test_workflow_stage_entries_nonexistent_flow() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("plan", "plan")]);

        let entries = workflow.workflow_stage_entries("plan", Some("nonexistent"));
        assert!(entries.is_empty());
    }

    #[test]
    fn test_workflow_stage_entries_description_fallback() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"), // No display_name, should fall back to "Planning"
            StageConfig::new("work", "summary").with_display_name("Work Stage"), // Should fall back to "Work Stage"
        ]);

        let entries = workflow.workflow_stage_entries("work", None);
        assert_eq!(entries[0].description, "Planning");
        assert_eq!(entries[1].description, "Work Stage");
    }

    // ========================================================================
    // Disallowed tools tests
    // ========================================================================

    #[test]
    fn test_effective_disallowed_tools_no_flow() {
        use crate::workflow::config::stage::DisallowedToolEntry;

        let tools = vec![DisallowedToolEntry {
            pattern: "Bash(cargo *)".to_string(),
            message: "Use checks stage".to_string(),
        }];

        let stage = StageConfig::new("work", "summary").with_disallowed_tools(tools.clone());
        let workflow = WorkflowConfig::new(vec![stage]);

        let effective = workflow.effective_disallowed_tools("work", None);
        assert_eq!(effective.len(), 1);
        assert_eq!(effective[0].pattern, "Bash(cargo *)");
    }

    #[test]
    fn test_effective_disallowed_tools_flow_override() {
        use crate::workflow::config::stage::DisallowedToolEntry;

        let global_tools = vec![DisallowedToolEntry {
            pattern: "Bash(cargo *)".to_string(),
            message: "Global restriction".to_string(),
        }];

        let flow_tools = vec![DisallowedToolEntry {
            pattern: "Edit".to_string(),
            message: "Flow restriction".to_string(),
        }];

        let stage = StageConfig::new("work", "summary").with_disallowed_tools(global_tools);

        let mut flows = IndexMap::new();
        flows.insert(
            "restricted".to_string(),
            FlowConfig {
                description: "Restricted flow".to_string(),
                icon: None,
                stages: vec![FlowStageEntry {
                    stage_name: "work".to_string(),
                    overrides: Some(FlowStageOverride {
                        prompt: None,
                        capabilities: None,
                        model: None,
                        inputs: None,
                        disallowed_tools: Some(flow_tools),
                    }),
                }],
            },
        );

        let workflow = WorkflowConfig::new(vec![stage]).with_flows(flows);

        let effective = workflow.effective_disallowed_tools("work", Some("restricted"));
        assert_eq!(effective.len(), 1);
        assert_eq!(effective[0].pattern, "Edit");
    }

    #[test]
    fn test_effective_disallowed_tools_flow_no_override() {
        use crate::workflow::config::stage::DisallowedToolEntry;

        let global_tools = vec![DisallowedToolEntry {
            pattern: "Bash(cargo *)".to_string(),
            message: "Global restriction".to_string(),
        }];

        let stage = StageConfig::new("work", "summary").with_disallowed_tools(global_tools);

        let mut flows = IndexMap::new();
        flows.insert(
            "normal".to_string(),
            FlowConfig {
                description: "Normal flow".to_string(),
                icon: None,
                stages: vec![FlowStageEntry {
                    stage_name: "work".to_string(),
                    overrides: None,
                }],
            },
        );

        let workflow = WorkflowConfig::new(vec![stage]).with_flows(flows);

        let effective = workflow.effective_disallowed_tools("work", Some("normal"));
        assert_eq!(effective.len(), 1);
        assert_eq!(effective[0].pattern, "Bash(cargo *)");
    }

    #[test]
    fn test_effective_disallowed_tools_flow_empty_override() {
        use crate::workflow::config::stage::DisallowedToolEntry;

        let global_tools = vec![DisallowedToolEntry {
            pattern: "Bash(cargo *)".to_string(),
            message: "Global restriction".to_string(),
        }];

        let stage = StageConfig::new("work", "summary").with_disallowed_tools(global_tools);

        let mut flows = IndexMap::new();
        flows.insert(
            "unrestricted".to_string(),
            FlowConfig {
                description: "Unrestricted flow".to_string(),
                icon: None,
                stages: vec![FlowStageEntry {
                    stage_name: "work".to_string(),
                    overrides: Some(FlowStageOverride {
                        prompt: None,
                        capabilities: None,
                        model: None,
                        inputs: None,
                        disallowed_tools: Some(vec![]),
                    }),
                }],
            },
        );

        let workflow = WorkflowConfig::new(vec![stage]).with_flows(flows);

        let effective = workflow.effective_disallowed_tools("work", Some("unrestricted"));
        assert!(effective.is_empty());
    }

    #[test]
    fn test_validate_disallowed_tools_on_script_stage() {
        use crate::workflow::config::stage::DisallowedToolEntry;

        let mut script_stage = StageConfig::new_script("checks", "check_results", "cargo test");
        script_stage.disallowed_tools = vec![DisallowedToolEntry {
            pattern: "Edit".to_string(),
            message: "Read-only".to_string(),
        }];

        let workflow = WorkflowConfig::new(vec![script_stage]);

        let errors = workflow.validate();
        assert!(
            errors.iter().any(|e| e.contains("disallowed_tools")
                && e.contains("checks")
                && e.contains("only used by agent stages")),
            "Expected validation error. Got: {errors:?}"
        );
    }

    #[test]
    fn test_validate_disallowed_tools_empty_pattern() {
        use crate::workflow::config::stage::DisallowedToolEntry;

        let stage = StageConfig::new("work", "summary").with_disallowed_tools(vec![
            DisallowedToolEntry {
                pattern: "Bash(cargo *)".to_string(),
                message: "Valid".to_string(),
            },
            DisallowedToolEntry {
                pattern: "  ".to_string(),
                message: "Invalid".to_string(),
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
        use crate::workflow::config::stage::DisallowedToolEntry;

        let stage =
            StageConfig::new("work", "summary").with_disallowed_tools(vec![DisallowedToolEntry {
                pattern: "Bash(cargo *)".to_string(),
                message: "Use checks stage".to_string(),
            }]);

        let workflow = WorkflowConfig::new(vec![stage]);

        let errors = workflow.validate();
        assert!(
            errors.is_empty(),
            "Expected no errors for agent stage with disallowed_tools. Got: {errors:?}"
        );
    }

    #[test]
    fn test_validate_disallowed_tools_empty_pattern_in_flow_override() {
        use crate::workflow::config::stage::DisallowedToolEntry;

        let stage = StageConfig::new("work", "summary");

        let mut flows = IndexMap::new();
        flows.insert(
            "restricted".to_string(),
            FlowConfig {
                description: "Restricted flow".to_string(),
                icon: None,
                stages: vec![FlowStageEntry {
                    stage_name: "work".to_string(),
                    overrides: Some(FlowStageOverride {
                        prompt: None,
                        capabilities: None,
                        model: None,
                        inputs: None,
                        disallowed_tools: Some(vec![
                            DisallowedToolEntry {
                                pattern: "Edit".to_string(),
                                message: "Valid".to_string(),
                            },
                            DisallowedToolEntry {
                                pattern: "  ".to_string(),
                                message: "Invalid".to_string(),
                            },
                        ]),
                    }),
                }],
            },
        );

        let workflow = WorkflowConfig::new(vec![stage]).with_flows(flows);

        let errors = workflow.validate();
        assert!(
            errors.iter().any(|e| e.contains("empty pattern")
                && e.contains("restricted")
                && e.contains("work")),
            "Expected validation error for empty pattern in flow override. Got: {errors:?}"
        );
    }

    #[test]
    fn test_flow_stage_override_disallowed_tools_serialization() {
        use crate::workflow::config::stage::DisallowedToolEntry;

        let tools = vec![DisallowedToolEntry {
            pattern: "Edit".to_string(),
            message: "Read-only".to_string(),
        }];

        let override_with_tools = FlowStageOverride {
            prompt: None,
            capabilities: None,
            model: None,
            inputs: None,
            disallowed_tools: Some(tools),
        };

        let yaml = serde_yaml::to_string(&override_with_tools).unwrap();
        assert!(yaml.contains("disallowed_tools"));
        assert!(yaml.contains("pattern: Edit"));
        assert!(yaml.contains("message: Read-only"));

        let parsed: FlowStageOverride = serde_yaml::from_str(&yaml).unwrap();
        assert!(parsed.disallowed_tools.is_some());
        assert_eq!(parsed.disallowed_tools.unwrap().len(), 1);

        // Test with None (should be omitted)
        let override_none = FlowStageOverride {
            prompt: None,
            capabilities: None,
            model: None,
            inputs: None,
            disallowed_tools: None,
        };

        let yaml_none = serde_yaml::to_string(&override_none).unwrap();
        assert!(!yaml_none.contains("disallowed_tools"));
    }

    #[test]
    fn test_flow_override_returns_none_for_missing_flow() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")]);
        // No flows defined — all effective_* should fall back to global
        assert_eq!(workflow.effective_model("work", Some("nonexistent")), None);
        assert!(workflow
            .effective_disallowed_tools("work", Some("nonexistent"))
            .is_empty());
    }

    #[test]
    fn test_flow_override_returns_none_for_no_overrides() {
        let mut flows = IndexMap::new();
        flows.insert(
            "simple".to_string(),
            FlowConfig {
                description: "Simple".to_string(),
                icon: None,
                stages: vec![FlowStageEntry {
                    stage_name: "work".to_string(),
                    overrides: None,
                }],
            },
        );
        let workflow =
            WorkflowConfig::new(vec![StageConfig::new("work", "summary").with_model("opus")])
                .with_flows(flows);
        // Flow entry exists but has no overrides — should fall back to global
        assert_eq!(
            workflow.effective_model("work", Some("simple")),
            Some("opus".to_string())
        );
    }
}
