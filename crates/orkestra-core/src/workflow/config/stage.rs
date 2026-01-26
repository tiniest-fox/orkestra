//! Stage configuration types.
//!
//! A stage represents a single step in the workflow. Each stage:
//! - Has a unique name (e.g., "planning", "work", "review")
//! - Produces an artifact (e.g., "plan", "summary")
//! - May require inputs from previous stages
//! - Has capabilities that define what it can do

use serde::{Deserialize, Serialize};

/// Configuration for a single workflow stage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StageConfig {
    /// Unique identifier for this stage (e.g., "planning", "work").
    /// Used in status, transitions, and artifact references.
    pub name: String,

    /// Human-readable display name (e.g., "Planning", "Working").
    /// Defaults to capitalized `name` if not specified.
    #[serde(default)]
    pub display_name: Option<String>,

    /// Name of the artifact this stage produces (e.g., "plan", "summary").
    /// The artifact content is stored with this key.
    pub artifact: String,

    /// Names of artifacts from previous stages that this stage requires.
    /// These are passed to the agent prompt.
    #[serde(default)]
    pub inputs: Vec<String>,

    /// What this stage can do.
    #[serde(default)]
    pub capabilities: StageCapabilities,

    /// Agent configuration for this stage.
    #[serde(default)]
    pub agent: AgentStageConfig,

    /// Whether this stage runs automatically without human approval.
    #[serde(default)]
    pub is_automated: bool,
}

impl StageConfig {
    /// Create a new stage configuration.
    pub fn new(name: impl Into<String>, artifact: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            display_name: None,
            artifact: artifact.into(),
            inputs: Vec::new(),
            capabilities: StageCapabilities::default(),
            agent: AgentStageConfig::default(),
            is_automated: false,
        }
    }

    /// Builder: set display name.
    #[must_use]
    pub fn with_display_name(mut self, name: impl Into<String>) -> Self {
        self.display_name = Some(name.into());
        self
    }

    /// Builder: add required inputs.
    #[must_use]
    pub fn with_inputs(mut self, inputs: Vec<String>) -> Self {
        self.inputs = inputs;
        self
    }

    /// Builder: set capabilities.
    #[must_use]
    pub fn with_capabilities(mut self, capabilities: StageCapabilities) -> Self {
        self.capabilities = capabilities;
        self
    }

    /// Builder: mark as automated (no human approval).
    #[must_use]
    pub fn automated(mut self) -> Self {
        self.is_automated = true;
        self
    }

    /// Builder: set agent configuration.
    #[must_use]
    pub fn with_agent(mut self, agent: AgentStageConfig) -> Self {
        self.agent = agent;
        self
    }

    /// Get the display name, falling back to capitalized name.
    pub fn display(&self) -> String {
        self.display_name
            .clone()
            .unwrap_or_else(|| capitalize(&self.name))
    }
}

/// Capabilities that a stage may have.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct StageCapabilities {
    /// Stage can ask clarifying questions before producing output.
    #[serde(default)]
    pub ask_questions: bool,

    /// Stage can propose subtasks to create.
    #[serde(default)]
    pub produce_subtasks: bool,

    /// Stages this agent can redirect to (e.g., reviewer can send back to work).
    /// Empty means no restaging capability.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub supports_restage: Vec<String>,
}

impl StageCapabilities {
    /// Create capabilities with questions enabled.
    pub fn with_questions() -> Self {
        Self {
            ask_questions: true,
            ..Default::default()
        }
    }

    /// Create capabilities with subtask production enabled.
    pub fn with_subtasks() -> Self {
        Self {
            produce_subtasks: true,
            ..Default::default()
        }
    }

    /// Create capabilities with both questions and subtasks.
    pub fn all() -> Self {
        Self {
            ask_questions: true,
            produce_subtasks: true,
            supports_restage: Vec::new(),
        }
    }

    /// Create capabilities with restaging to specific stages.
    pub fn with_restage(stages: Vec<String>) -> Self {
        Self {
            supports_restage: stages,
            ..Default::default()
        }
    }

    /// Check if this stage can restage to the given target.
    pub fn can_restage_to(&self, target: &str) -> bool {
        self.supports_restage.iter().any(|s| s == target)
    }
}

// ============================================================================
// Agent Configuration
// ============================================================================

/// Agent configuration for a stage.
///
/// Specifies which agent type handles this stage and how to configure it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentStageConfig {
    /// Agent type name: "planner", "worker", "reviewer", or custom.
    /// Used to load agent definition and select JSON schema.
    /// Defaults to "worker".
    #[serde(default = "default_agent_type")]
    pub agent_type: String,

    /// Optional path to custom agent definition file (relative to .orkestra/agents/).
    /// If not specified, uses `{agent_type}.md`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition_file: Option<String>,

    /// Optional path to custom JSON schema file (relative to .orkestra/schemas/).
    /// If not specified, uses built-in schema for known agent types.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_file: Option<String>,

    /// Optional custom template name to use instead of inferring from agent_type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
}

fn default_agent_type() -> String {
    "worker".to_string()
}

impl Default for AgentStageConfig {
    fn default() -> Self {
        Self {
            agent_type: default_agent_type(),
            definition_file: None,
            schema_file: None,
            template: None,
        }
    }
}

impl AgentStageConfig {
    /// Create a new agent configuration with the specified type.
    pub fn new(agent_type: impl Into<String>) -> Self {
        Self {
            agent_type: agent_type.into(),
            definition_file: None,
            schema_file: None,
            template: None,
        }
    }

    /// Create a planner agent configuration.
    pub fn planner() -> Self {
        Self::new("planner")
    }

    /// Create a worker agent configuration.
    pub fn worker() -> Self {
        Self::new("worker")
    }

    /// Create a reviewer agent configuration.
    pub fn reviewer() -> Self {
        Self::new("reviewer")
    }

    /// Create a breakdown agent configuration.
    pub fn breakdown() -> Self {
        Self::new("breakdown")
    }

    /// Builder: set custom definition file.
    #[must_use]
    pub fn with_definition_file(mut self, path: impl Into<String>) -> Self {
        self.definition_file = Some(path.into());
        self
    }

    /// Builder: set custom JSON schema file.
    #[must_use]
    pub fn with_schema_file(mut self, path: impl Into<String>) -> Self {
        self.schema_file = Some(path.into());
        self
    }

    /// Builder: set custom template name.
    #[must_use]
    pub fn with_template(mut self, template: impl Into<String>) -> Self {
        self.template = Some(template.into());
        self
    }

    /// Get the effective definition file path.
    /// Returns the custom definition_file if set, otherwise "{agent_type}.md".
    pub fn definition_path(&self) -> String {
        self.definition_file
            .clone()
            .unwrap_or_else(|| format!("{}.md", self.agent_type))
    }

    /// Check if this is a known/built-in agent type with a predefined schema.
    pub fn has_builtin_schema(&self) -> bool {
        matches!(
            self.agent_type.as_str(),
            "planner" | "worker" | "reviewer" | "breakdown"
        )
    }
}

/// Capitalize the first letter of a string.
fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stage_config_new() {
        let stage = StageConfig::new("planning", "plan");
        assert_eq!(stage.name, "planning");
        assert_eq!(stage.artifact, "plan");
        assert!(stage.inputs.is_empty());
        assert!(!stage.is_automated);
    }

    #[test]
    fn test_stage_config_builder() {
        let stage = StageConfig::new("work", "summary")
            .with_display_name("Working")
            .with_inputs(vec!["plan".into()]);

        assert_eq!(stage.display(), "Working");
        assert_eq!(stage.inputs, vec!["plan"]);
    }

    #[test]
    fn test_display_name_fallback() {
        let stage = StageConfig::new("planning", "plan");
        assert_eq!(stage.display(), "Planning");
    }

    #[test]
    fn test_capabilities_default() {
        let caps = StageCapabilities::default();
        assert!(!caps.ask_questions);
        assert!(!caps.produce_subtasks);
    }

    #[test]
    fn test_capabilities_builders() {
        let with_questions = StageCapabilities::with_questions();
        assert!(with_questions.ask_questions);
        assert!(!with_questions.produce_subtasks);

        let with_subtasks = StageCapabilities::with_subtasks();
        assert!(!with_subtasks.ask_questions);
        assert!(with_subtasks.produce_subtasks);

        let all = StageCapabilities::all();
        assert!(all.ask_questions);
        assert!(all.produce_subtasks);
    }

    #[test]
    fn test_stage_config_serialization() {
        let stage = StageConfig::new("planning", "plan")
            .with_capabilities(StageCapabilities::with_questions());

        let yaml = serde_yaml::to_string(&stage).unwrap();
        assert!(yaml.contains("name: planning"));
        assert!(yaml.contains("artifact: plan"));
        assert!(yaml.contains("ask_questions: true"));

        let parsed: StageConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed, stage);
    }

    #[test]
    fn test_capabilities_with_restage() {
        let caps = StageCapabilities::with_restage(vec!["work".into(), "planning".into()]);
        assert!(caps.can_restage_to("work"));
        assert!(caps.can_restage_to("planning"));
        assert!(!caps.can_restage_to("review"));
        assert!(!caps.ask_questions);
        assert!(!caps.produce_subtasks);
    }

    #[test]
    fn test_capabilities_restage_default_empty() {
        let caps = StageCapabilities::default();
        assert!(caps.supports_restage.is_empty());
        assert!(!caps.can_restage_to("work"));
    }

    #[test]
    fn test_capabilities_restage_serialization() {
        let caps = StageCapabilities::with_restage(vec!["work".into()]);
        let yaml = serde_yaml::to_string(&caps).unwrap();
        assert!(yaml.contains("supports_restage"));
        assert!(yaml.contains("work"));

        let parsed: StageCapabilities = serde_yaml::from_str(&yaml).unwrap();
        assert!(parsed.can_restage_to("work"));
    }

    #[test]
    fn test_capabilities_restage_skipped_when_empty() {
        let caps = StageCapabilities::default();
        let yaml = serde_yaml::to_string(&caps).unwrap();
        // Empty supports_restage should not appear in serialized output
        assert!(!yaml.contains("supports_restage"));
    }

    // ========================================================================
    // AgentStageConfig tests
    // ========================================================================

    #[test]
    fn test_agent_config_default() {
        let agent = AgentStageConfig::default();
        assert_eq!(agent.agent_type, "worker");
        assert!(agent.definition_file.is_none());
        assert!(agent.schema_file.is_none());
        assert!(agent.template.is_none());
    }

    #[test]
    fn test_agent_config_constructors() {
        assert_eq!(AgentStageConfig::planner().agent_type, "planner");
        assert_eq!(AgentStageConfig::worker().agent_type, "worker");
        assert_eq!(AgentStageConfig::reviewer().agent_type, "reviewer");
        assert_eq!(AgentStageConfig::breakdown().agent_type, "breakdown");
    }

    #[test]
    fn test_agent_config_builder() {
        let agent = AgentStageConfig::new("custom")
            .with_definition_file("custom_agent.md")
            .with_schema_file("custom_schema.json")
            .with_template("custom_template");

        assert_eq!(agent.agent_type, "custom");
        assert_eq!(agent.definition_file, Some("custom_agent.md".to_string()));
        assert_eq!(agent.schema_file, Some("custom_schema.json".to_string()));
        assert_eq!(agent.template, Some("custom_template".to_string()));
    }

    #[test]
    fn test_agent_config_definition_path() {
        // Default path
        let agent = AgentStageConfig::planner();
        assert_eq!(agent.definition_path(), "planner.md");

        // Custom path
        let agent = AgentStageConfig::new("custom").with_definition_file("my_custom.md");
        assert_eq!(agent.definition_path(), "my_custom.md");
    }

    #[test]
    fn test_agent_config_has_builtin_schema() {
        assert!(AgentStageConfig::planner().has_builtin_schema());
        assert!(AgentStageConfig::worker().has_builtin_schema());
        assert!(AgentStageConfig::reviewer().has_builtin_schema());
        assert!(AgentStageConfig::breakdown().has_builtin_schema());
        assert!(!AgentStageConfig::new("custom").has_builtin_schema());
    }

    #[test]
    fn test_stage_with_agent() {
        let stage = StageConfig::new("planning", "plan").with_agent(AgentStageConfig::planner());

        assert_eq!(stage.agent.agent_type, "planner");
    }

    #[test]
    fn test_agent_config_serialization() {
        let agent = AgentStageConfig::planner();
        let yaml = serde_yaml::to_string(&agent).unwrap();
        assert!(yaml.contains("agent_type: planner"));
        // Optional fields should not appear
        assert!(!yaml.contains("definition_file"));
        assert!(!yaml.contains("schema_file"));
        assert!(!yaml.contains("template"));

        let parsed: AgentStageConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.agent_type, "planner");
    }

    #[test]
    fn test_agent_config_serialization_with_options() {
        let agent = AgentStageConfig::new("custom")
            .with_definition_file("custom.md")
            .with_schema_file("custom.json");

        let yaml = serde_yaml::to_string(&agent).unwrap();
        assert!(yaml.contains("definition_file: custom.md"));
        assert!(yaml.contains("schema_file: custom.json"));

        let parsed: AgentStageConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.definition_file, Some("custom.md".to_string()));
    }
}
