//! Workflow configuration.
//!
//! A workflow is an ordered collection of stages that define the task lifecycle.
//! Stages are processed in order, with optional stages being skippable.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use super::stage::{GateConfig, StageCapabilities, StageConfig, ToolRestriction};
use crate::runtime::ACTIVITY_LOG_ARTIFACT_NAME;

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

    /// Per-flow integration overrides. Unset fields inherit from global `integration`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration: Option<FlowIntegrationOverride>,
}

/// Per-flow overrides for integration configuration.
///
/// All fields are optional — unset fields inherit from the global `IntegrationConfig`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowIntegrationOverride {
    /// Override for global `integration.on_failure`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_failure: Option<String>,
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
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct FlowStageOverride {
    /// Override prompt template path (agent stages only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// Override capabilities (full replace, not merge; agent stages only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<StageCapabilities>,
    /// Override model identifier (agent stages only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Override disallowed tools (full replace, not merge).
    /// `Some(vec![])` means "explicitly no restrictions" (overrides global config).
    /// `None` means "inherit from global stage config".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disallowed_tools: Option<Vec<ToolRestriction>>,

    /// Gate override for this stage in this flow.
    /// `Some(Some(config))` overrides the global gate config.
    /// `Some(None)` disables the gate for this flow.
    /// `None` inherits from global stage config.
    ///
    /// Uses `serde_double_option` to distinguish `null` (disable) from absent (inherit).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "serde_double_option"
    )]
    pub gate: Option<Option<GateConfig>>,
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
    /// Required — validation rejects workflows where this references a non-existent stage.
    pub on_failure: String,
    /// Whether to automatically merge (rebase + merge) when tasks reach Done.
    /// When false, tasks pause at Done until user chooses "Merge" or "Open PR".
    #[serde(default = "default_auto_merge")]
    pub auto_merge: bool,
}

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

fn default_version() -> u32 {
    1
}

fn default_auto_merge() -> bool {
    false
}

impl WorkflowConfig {
    /// Create a new workflow with the given stages.
    ///
    /// Uses the first stage name as `integration.on_failure`. Override with
    /// `with_integration()` if a different recovery stage is needed.
    pub fn new(stages: Vec<StageConfig>) -> Self {
        let on_failure = stages.first().map_or_else(String::new, |s| s.name.clone());
        Self {
            version: 1,
            stages,
            integration: IntegrationConfig::new(on_failure),
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

    /// Get the effective disallowed tools for a stage in a flow.
    ///
    /// Flow overrides fully replace (not merge) the global disallowed tools.
    /// Returns empty vec if no restrictions are configured.
    pub fn effective_disallowed_tools(
        &self,
        stage_name: &str,
        flow: Option<&str>,
    ) -> Vec<ToolRestriction> {
        self.flow_override(stage_name, flow, |o| o.disallowed_tools.clone())
            .or_else(|| self.stage(stage_name).map(|s| s.disallowed_tools.clone()))
            .unwrap_or_default()
    }

    /// Get the effective gate configuration for a stage, checking flow overrides first.
    ///
    /// - Flow `Some(Some(cfg))` → returns `Some(&cfg)` (override)
    /// - Flow `Some(None)` → returns `None` (gate disabled for this flow)
    /// - Flow `None` (no override) → falls through to global stage config
    /// - No flow → uses global stage config
    pub fn effective_gate_config(
        &self,
        stage_name: &str,
        flow: Option<&str>,
    ) -> Option<&GateConfig> {
        // Check for a flow-level override
        if let Some(flow_name) = flow {
            if let Some(flow_config) = self.flows.get(flow_name) {
                if let Some(entry) = flow_config
                    .stages
                    .iter()
                    .find(|e| e.stage_name == stage_name)
                {
                    if let Some(overrides) = &entry.overrides {
                        if let Some(gate_override) = &overrides.gate {
                            // Some(Some(cfg)) → override; Some(None) → disabled
                            return gate_override.as_ref();
                        }
                    }
                }
            }
        }
        // Fall through to global stage config
        self.stage(stage_name).and_then(|s| s.gate_config())
    }

    /// Get ordered stage references for a given flow.
    ///
    /// Returns all stages in the default pipeline when `flow` is None,
    /// or the flow's subset of stages when a flow name is given.
    /// Returns an empty vec if the flow name doesn't exist.
    pub fn stages_in_flow(&self, flow: Option<&str>) -> Vec<&StageConfig> {
        match flow {
            None => self.stages.iter().collect(),
            Some(flow_name) => {
                let Some(flow_config) = self.flows.get(flow_name) else {
                    return Vec::new();
                };
                flow_config
                    .stages
                    .iter()
                    .filter_map(|entry| self.stage(&entry.stage_name))
                    .collect()
            }
        }
    }

    /// Get the effective model specs for all stages in the given flow.
    ///
    /// For default flow (None), iterates all global stages.
    /// For named flows, iterates only the stages listed in that flow.
    /// Returns model specs in stage order (None means "use provider default").
    pub fn agent_model_specs(&self, flow: Option<&str>) -> Vec<Option<String>> {
        self.stages_in_flow(flow)
            .into_iter()
            .map(|s| {
                // For flow stages, check for model override
                match flow {
                    Some(flow_name) => self.effective_model(&s.name, Some(flow_name)),
                    None => s.model.clone(),
                }
            })
            .collect()
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

    /// Get the effective integration `on_failure` stage for a flow.
    ///
    /// Returns the flow's override if set, otherwise the global `integration.on_failure`.
    pub fn effective_integration_on_failure(&self, flow: Option<&str>) -> &str {
        if let Some(flow_name) = flow {
            if let Some(flow_config) = self.flows.get(flow_name) {
                if let Some(on_failure) = flow_config
                    .integration
                    .as_ref()
                    .and_then(|i| i.on_failure.as_deref())
                {
                    return on_failure;
                }
            }
        }
        &self.integration.on_failure
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

        // Run all validations
        self.validate_no_duplicate_stage_names(&mut errors);
        self.validate_no_duplicate_artifact_names(&mut errors);
        self.validate_approval_targets(&stage_names, &stage_names_set, &mut errors);
        self.validate_integration_on_failure(&stage_names, &stage_names_set, &mut errors);
        self.validate_flows(&stage_names_set, &mut errors);
        self.validate_subtask_flows(&mut errors);
        self.validate_model_fields(&mut errors);
        self.validate_disallowed_tools(&mut errors);
        self.validate_gates(&mut errors);

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
            let name = stage.artifact_name();
            if name.is_empty() {
                errors.push(format!(
                    "Stage \"{}\" has an empty artifact name. Artifact names must be non-empty.",
                    stage.name
                ));
                continue;
            }
            if name == ACTIVITY_LOG_ARTIFACT_NAME {
                errors.push(format!(
                    "Stage \"{}\" uses reserved artifact name \"{name}\". This name is used internally for the activity log.",
                    stage.name
                ));
                continue;
            }
            if !seen.insert(name) {
                errors.push(format!(
                    "Duplicate artifact name \"{name}\". Each stage must produce a unique artifact."
                ));
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

                if let Some(ref overrides) = entry.overrides {
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
            }

            self.validate_flow_integration_on_failure(flow_name, flow, &flow_stage_names, errors);
        }
    }

    /// Validate integration `on_failure` for a single flow.
    fn validate_flow_integration_on_failure(
        &self,
        flow_name: &str,
        flow: &FlowConfig,
        flow_stage_names: &std::collections::HashSet<&str>,
        errors: &mut Vec<String>,
    ) {
        // Validate flow integration.on_failure (if set) references a stage in this flow
        if let Some(on_failure) = flow
            .integration
            .as_ref()
            .and_then(|i| i.on_failure.as_ref())
        {
            if !flow_stage_names.contains(on_failure.as_str()) {
                errors.push(format!(
                    "Flow \"{flow_name}\" has on_failure=\"{on_failure}\", but \"{on_failure}\" is not in flow \"{flow_name}\""
                ));
            }
        }

        // Validate global integration.on_failure is in flow (unless flow overrides it)
        if flow
            .integration
            .as_ref()
            .and_then(|i| i.on_failure.as_ref())
            .is_none()
        {
            let global_on_failure = &self.integration.on_failure;
            if !flow_stage_names.contains(global_on_failure.as_str()) {
                errors.push(format!(
                    "Flow \"{flow_name}\" does not include global integration.on_failure stage \"{global_on_failure}\" and has no override. \
                     Either add \"{global_on_failure}\" to the flow's stages or set integration.on_failure on the flow."
                ));
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
        for stage in &self.stages {
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

    /// Validate `gate` configs on stages and flow overrides.
    fn validate_gates(&self, errors: &mut Vec<String>) {
        for stage in &self.stages {
            if let Some(ref gate) = stage.gate {
                if gate.command.trim().is_empty() {
                    errors.push(format!(
                        "Stage \"{}\" has a gate with an empty command.",
                        stage.name
                    ));
                }
                if gate.timeout_seconds == 0 {
                    errors.push(format!(
                        "Stage \"{}\" has a gate with timeout_seconds of 0. Timeout must be greater than 0.",
                        stage.name
                    ));
                }
            }
        }

        // Validate gate overrides in flows
        for (flow_name, flow) in &self.flows {
            for entry in &flow.stages {
                if let Some(ref overrides) = entry.overrides {
                    if let Some(Some(ref gate)) = overrides.gate {
                        if gate.command.trim().is_empty() {
                            errors.push(format!(
                                "Flow \"{}\" stage \"{}\" has a gate override with an empty command.",
                                flow_name, entry.stage_name
                            ));
                        }
                        if gate.timeout_seconds == 0 {
                            errors.push(format!(
                                "Flow \"{}\" stage \"{}\" has a gate override with timeout_seconds of 0. Timeout must be greater than 0.",
                                flow_name, entry.stage_name
                            ));
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

// ============================================================================
// Double-option serde helper
// ============================================================================

/// Custom serde for `Option<Option<T>>` to distinguish absent, null, and present.
///
/// Standard serde maps both absent and `null` to `Option::None`. This module
/// fixes that for fields where the distinction matters:
///
/// - Absent (field missing) → `None`     — "inherit from global config"
/// - `null` in YAML/JSON  → `Some(None)` — "explicitly disabled"
/// - A value              → `Some(Some(v))` — "override with this value"
///
/// Pair with `#[serde(default, skip_serializing_if = "Option::is_none", with = "serde_double_option")]`.
mod serde_double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    #[allow(clippy::option_option, clippy::ref_option)]
    pub fn serialize<T, S>(value: &Option<Option<T>>, serializer: S) -> Result<S::Ok, S::Error>
    where
        T: Serialize,
        S: Serializer,
    {
        match value {
            // skip_serializing_if guards the None case — this branch is unreachable
            None => serializer.serialize_none(),
            Some(inner) => inner.serialize(serializer),
        }
    }

    #[allow(clippy::option_option)]
    pub fn deserialize<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
    where
        T: Deserialize<'de>,
        D: Deserializer<'de>,
    {
        // This function is only called when the field IS present in the input.
        // Absent fields are handled by #[serde(default)] → None.
        // Here: null → Some(None), value → Some(Some(v)).
        let inner: Option<T> = Option::deserialize(deserializer)?;
        Ok(Some(inner))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::stage::{
        StageCapabilities, StageConfig, SubtaskCapabilities, ToolRestriction,
    };

    /// Standard 4-stage workflow used by most tests.
    fn test_default_workflow() -> WorkflowConfig {
        let mut flows = IndexMap::new();
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
                        overrides: None,
                    },
                ],
                integration: None,
            },
        );

        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_display_name("Planning")
                .with_prompt("planner.md")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("breakdown", "breakdown")
                .with_display_name("Breaking Down")
                .with_prompt("breakdown.md")
                .with_capabilities(StageCapabilities {
                    subtasks: Some(SubtaskCapabilities::default().with_flow("subtask")),
                    ..Default::default()
                }),
            StageConfig::new("work", "summary")
                .with_display_name("Working")
                .with_prompt("worker.md"),
            StageConfig::new("review", "verdict")
                .with_display_name("Reviewing")
                .with_prompt("reviewer.md")
                .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
                .automated(),
        ])
        .with_integration(IntegrationConfig::new("work"))
        .with_flows(flows)
    }

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
        assert_eq!(planning.unwrap().artifact_name(), "plan");

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
    fn test_integration_config_default() {
        let config = IntegrationConfig::default();
        assert!(
            config.on_failure.is_empty(),
            "Default on_failure should be empty (requires explicit config)"
        );
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
            auto_merge: true,
        });

        let errors = workflow.validate();
        assert!(errors
            .iter()
            .any(|e| e.contains("Integration on_failure") && e.contains("doesn't exist")));
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
        let work = StageConfig::new("work", "summary").with_model("opus");

        let workflow = WorkflowConfig::new(vec![planning, work]);

        let specs = workflow.agent_model_specs(None);
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0], Some("sonnet".to_string()));
        assert_eq!(specs[1], Some("opus".to_string()));
    }

    #[test]
    fn test_agent_model_specs_named_flow() {
        let planning = StageConfig::new("planning", "plan").with_model("sonnet");
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
                integration: None,
            },
        );

        let workflow = WorkflowConfig::new(vec![planning, work]).with_flows(flows);

        let specs = workflow.agent_model_specs(Some("quick"));
        assert_eq!(specs.len(), 2);
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
                            model: Some("haiku".to_string()),
                            ..Default::default()
                        }),
                    },
                    FlowStageEntry {
                        stage_name: "work".to_string(),
                        overrides: None,
                    },
                ],
                integration: None,
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

    // ========================================================================
    // Disallowed tools tests
    // ========================================================================

    #[test]
    fn test_effective_disallowed_tools_no_flow() {
        let tools = vec![ToolRestriction {
            pattern: "Bash(cargo *)".to_string(),
            message: Some("Use checks stage".to_string()),
        }];

        let stage = StageConfig::new("work", "summary").with_disallowed_tools(tools.clone());
        let workflow = WorkflowConfig::new(vec![stage]);

        let effective = workflow.effective_disallowed_tools("work", None);
        assert_eq!(effective.len(), 1);
        assert_eq!(effective[0].pattern, "Bash(cargo *)");
    }

    #[test]
    fn test_effective_disallowed_tools_flow_override() {
        let global_tools = vec![ToolRestriction {
            pattern: "Bash(cargo *)".to_string(),
            message: Some("Global restriction".to_string()),
        }];

        let flow_tools = vec![ToolRestriction {
            pattern: "Edit".to_string(),
            message: Some("Flow restriction".to_string()),
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
                        disallowed_tools: Some(flow_tools),
                        ..Default::default()
                    }),
                }],
                integration: None,
            },
        );

        let workflow = WorkflowConfig::new(vec![stage]).with_flows(flows);

        let effective = workflow.effective_disallowed_tools("work", Some("restricted"));
        assert_eq!(effective.len(), 1);
        assert_eq!(effective[0].pattern, "Edit");
    }

    #[test]
    fn test_effective_disallowed_tools_flow_no_override() {
        let global_tools = vec![ToolRestriction {
            pattern: "Bash(cargo *)".to_string(),
            message: Some("Global restriction".to_string()),
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
                integration: None,
            },
        );

        let workflow = WorkflowConfig::new(vec![stage]).with_flows(flows);

        let effective = workflow.effective_disallowed_tools("work", Some("normal"));
        assert_eq!(effective.len(), 1);
        assert_eq!(effective[0].pattern, "Bash(cargo *)");
    }

    #[test]
    fn test_effective_disallowed_tools_flow_empty_override() {
        let global_tools = vec![ToolRestriction {
            pattern: "Bash(cargo *)".to_string(),
            message: Some("Global restriction".to_string()),
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
                        disallowed_tools: Some(vec![]),
                        ..Default::default()
                    }),
                }],
                integration: None,
            },
        );

        let workflow = WorkflowConfig::new(vec![stage]).with_flows(flows);

        let effective = workflow.effective_disallowed_tools("work", Some("unrestricted"));
        assert!(effective.is_empty());
    }

    #[test]
    fn test_reserved_artifact_name_rejected() {
        let config = WorkflowConfig::new(vec![StageConfig::new("work", "activity_log")]);
        let errors = config.validate();
        assert!(!errors.is_empty());
        assert!(errors[0].contains("reserved artifact name"));
    }

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

    #[test]
    fn test_validate_disallowed_tools_empty_pattern_in_flow_override() {
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
                        disallowed_tools: Some(vec![
                            ToolRestriction {
                                pattern: "Edit".to_string(),
                                message: Some("Valid".to_string()),
                            },
                            ToolRestriction {
                                pattern: "  ".to_string(),
                                message: Some("Invalid".to_string()),
                            },
                        ]),
                        ..Default::default()
                    }),
                }],
                integration: None,
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
        let tools = vec![ToolRestriction {
            pattern: "Edit".to_string(),
            message: Some("Read-only".to_string()),
        }];

        let override_with_tools = FlowStageOverride {
            disallowed_tools: Some(tools),
            ..Default::default()
        };

        let yaml = serde_yaml::to_string(&override_with_tools).unwrap();
        assert!(yaml.contains("disallowed_tools"));
        assert!(yaml.contains("pattern: Edit"));
        assert!(yaml.contains("message: Read-only"));

        let parsed: FlowStageOverride = serde_yaml::from_str(&yaml).unwrap();
        assert!(parsed.disallowed_tools.is_some());
        assert_eq!(parsed.disallowed_tools.unwrap().len(), 1);

        // Test with None (should be omitted)
        let override_none = FlowStageOverride::default();

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
                integration: None,
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

    // ========================================================================
    // Flow integration on_failure tests
    // ========================================================================

    #[test]
    fn test_effective_integration_on_failure_no_flow() {
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig {
            on_failure: "planning".to_string(),
            auto_merge: false,
        });

        assert_eq!(workflow.effective_integration_on_failure(None), "planning");
    }

    #[test]
    fn test_effective_integration_on_failure_flow_with_override() {
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
                integration: Some(FlowIntegrationOverride {
                    on_failure: Some("planning".to_string()),
                }),
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig {
            on_failure: "work".to_string(),
            auto_merge: false,
        })
        .with_flows(flows);

        // Flow override takes precedence
        assert_eq!(
            workflow.effective_integration_on_failure(Some("quick")),
            "planning"
        );
        // Default flow uses global
        assert_eq!(workflow.effective_integration_on_failure(None), "work");
    }

    #[test]
    fn test_effective_integration_on_failure_flow_without_override() {
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
                integration: None, // No override
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig {
            on_failure: "work".to_string(),
            auto_merge: false,
        })
        .with_flows(flows);

        // No flow override → falls back to global
        assert_eq!(
            workflow.effective_integration_on_failure(Some("quick")),
            "work"
        );
    }

    #[test]
    fn test_effective_integration_on_failure_nonexistent_flow() {
        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")])
            .with_integration(IntegrationConfig {
                on_failure: "work".to_string(),
                auto_merge: false,
            });

        // Nonexistent flow → falls back to global
        assert_eq!(
            workflow.effective_integration_on_failure(Some("nonexistent")),
            "work"
        );
    }

    #[test]
    fn test_flow_on_failure_yaml_round_trip() {
        let yaml = r"
version: 1
stages:
  - name: planning
    artifact: plan
  - name: work
    artifact: summary
integration:
  on_failure: work
flows:
  quick:
    description: Quick flow
    integration:
      on_failure: planning
    stages:
      - planning
      - work
";
        let workflow: WorkflowConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(
            workflow
                .flows
                .get("quick")
                .unwrap()
                .integration
                .as_ref()
                .and_then(|i| i.on_failure.as_deref()),
            Some("planning")
        );

        // Round-trip
        let serialized = serde_yaml::to_string(&workflow).unwrap();
        assert!(serialized.contains("on_failure: planning"));

        let reparsed: WorkflowConfig = serde_yaml::from_str(&serialized).unwrap();
        assert_eq!(
            reparsed
                .flows
                .get("quick")
                .unwrap()
                .integration
                .as_ref()
                .and_then(|i| i.on_failure.as_deref()),
            Some("planning")
        );
    }

    // ========================================================================
    // Flow on_failure validation tests
    // ========================================================================

    #[test]
    fn test_validate_flow_on_failure_not_in_flow() {
        let mut flows = IndexMap::new();
        flows.insert(
            "quick".to_string(),
            FlowConfig {
                description: "Quick flow".to_string(),
                icon: None,
                stages: vec![FlowStageEntry {
                    stage_name: "work".to_string(),
                    overrides: None,
                }],
                integration: Some(FlowIntegrationOverride {
                    on_failure: Some("planning".to_string()),
                }), // Not in flow!
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig {
            on_failure: "work".to_string(),
            auto_merge: false,
        })
        .with_flows(flows);

        let errors = workflow.validate();
        assert!(
            errors
                .iter()
                .any(|e| e.contains("quick") && e.contains("on_failure") && e.contains("planning")),
            "Expected error about flow on_failure not in flow. Got: {errors:?}"
        );
    }

    #[test]
    fn test_validate_flow_global_on_failure_not_in_flow_no_override() {
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
                    // Missing "work" which is global on_failure
                ],
                integration: None, // No override
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig {
            on_failure: "work".to_string(), // Not in quick flow!
            auto_merge: false,
        })
        .with_flows(flows);

        let errors = workflow.validate();
        assert!(
            errors.iter().any(|e| e.contains("quick")
                && e.contains("integration.on_failure")
                && e.contains("work")),
            "Expected error about global on_failure not in flow. Got: {errors:?}"
        );
    }

    #[test]
    fn test_validate_flow_global_on_failure_not_in_flow_with_override_valid() {
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
                    // Missing "work" which is global on_failure, but flow has override
                ],
                integration: Some(FlowIntegrationOverride {
                    on_failure: Some("planning".to_string()),
                }), // Override present and valid
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig {
            on_failure: "work".to_string(), // Not in quick flow, but overridden
            auto_merge: false,
        })
        .with_flows(flows);

        let errors = workflow.validate();
        assert!(
            errors.is_empty(),
            "Flow with valid on_failure override should be valid even if global on_failure is not in flow. Got: {errors:?}"
        );
    }

    #[test]
    fn test_validate_flow_with_global_on_failure_in_flow_valid() {
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
                integration: None, // No override, but global is in flow
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary"),
        ])
        .with_integration(IntegrationConfig {
            on_failure: "work".to_string(), // In quick flow
            auto_merge: false,
        })
        .with_flows(flows);

        let errors = workflow.validate();
        assert!(
            errors.is_empty(),
            "Flow containing global on_failure should be valid. Got: {errors:?}"
        );
    }

    // -- Gate config tests --

    #[test]
    fn test_effective_gate_config_no_gate() {
        let workflow = test_default_workflow();
        // No gate configured on any stage
        assert!(workflow.effective_gate_config("work", None).is_none());
        assert!(workflow
            .effective_gate_config("work", Some("subtask"))
            .is_none());
    }

    #[test]
    fn test_effective_gate_config_global() {
        let gate = GateConfig::new("./run_checks.sh").with_timeout(120);
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("work", "summary").with_gate(gate.clone()),
            StageConfig::new("review", "verdict"),
        ])
        .with_integration(IntegrationConfig::new("work"));

        // No flow → returns global gate
        let cfg = workflow.effective_gate_config("work", None);
        assert!(cfg.is_some());
        assert_eq!(cfg.unwrap().command, "./run_checks.sh");
        assert_eq!(cfg.unwrap().timeout_seconds, 120);

        // Stage without gate → None
        assert!(workflow.effective_gate_config("review", None).is_none());
    }

    #[test]
    fn test_effective_gate_config_flow_override() {
        use indexmap::IndexMap;

        let global_gate = GateConfig::new("./global_checks.sh");
        let flow_gate = GateConfig::new("./quick_checks.sh");

        let mut flows = IndexMap::new();
        flows.insert(
            "quick".to_string(),
            FlowConfig {
                description: "Quick flow".to_string(),
                icon: None,
                stages: vec![FlowStageEntry {
                    stage_name: "work".to_string(),
                    overrides: Some(FlowStageOverride {
                        gate: Some(Some(flow_gate.clone())),
                        ..Default::default()
                    }),
                }],
                integration: None,
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("work", "summary").with_gate(global_gate)
        ])
        .with_integration(IntegrationConfig::new("work"))
        .with_flows(flows);

        // No flow → returns global gate
        let global = workflow.effective_gate_config("work", None);
        assert_eq!(global.unwrap().command, "./global_checks.sh");

        // Flow override → returns flow gate
        let overridden = workflow.effective_gate_config("work", Some("quick"));
        assert_eq!(overridden.unwrap().command, "./quick_checks.sh");
    }

    #[test]
    fn test_effective_gate_config_flow_disables_gate() {
        use indexmap::IndexMap;

        let global_gate = GateConfig::new("./global_checks.sh");

        let mut flows = IndexMap::new();
        flows.insert(
            "no-gate".to_string(),
            FlowConfig {
                description: "Flow with gate disabled".to_string(),
                icon: None,
                stages: vec![FlowStageEntry {
                    stage_name: "work".to_string(),
                    overrides: Some(FlowStageOverride {
                        gate: Some(None), // explicitly disable
                        ..Default::default()
                    }),
                }],
                integration: None,
            },
        );

        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("work", "summary").with_gate(global_gate)
        ])
        .with_integration(IntegrationConfig::new("work"))
        .with_flows(flows);

        // Global still has a gate
        assert!(workflow.effective_gate_config("work", None).is_some());
        // Flow disables it
        assert!(workflow
            .effective_gate_config("work", Some("no-gate"))
            .is_none());
    }

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

    #[test]
    fn test_validate_flow_gate_override_empty_command() {
        use indexmap::IndexMap;

        let mut flow_gate = GateConfig::new("./checks.sh");
        flow_gate.command = String::new();

        let mut flows = IndexMap::new();
        flows.insert(
            "quick".to_string(),
            FlowConfig {
                description: "Quick flow".to_string(),
                icon: None,
                stages: vec![FlowStageEntry {
                    stage_name: "work".to_string(),
                    overrides: Some(FlowStageOverride {
                        gate: Some(Some(flow_gate)),
                        ..Default::default()
                    }),
                }],
                integration: None,
            },
        );

        let workflow = WorkflowConfig::new(vec![StageConfig::new("work", "summary")])
            .with_integration(IntegrationConfig::new("work"))
            .with_flows(flows);

        let errors = workflow.validate();
        assert!(
            errors
                .iter()
                .any(|e| e.contains("quick") && e.contains("work") && e.contains("empty command")),
            "expected flow gate empty command error, got: {errors:?}"
        );
    }
}
