//! Stage configuration types.
//!
//! A stage represents a single step in the workflow. Each stage:
//! - Has a unique name (e.g., "planning", "work", "review")
//! - Produces an artifact (e.g., "plan", "summary")
//! - Has capabilities that define what it can do

use serde::{ser::SerializeMap, Deserialize, Deserializer, Serialize, Serializer};

// ============================================================================
// Artifact Configuration
// ============================================================================

/// Configuration for an artifact produced by a stage.
///
/// Accepts both a plain string (just the name) and a map with a `name` key.
/// Unknown fields in the map form cause a deserialization error — old YAML with
/// `display_name` or `description` on the artifact will fail:
///
/// ```yaml
/// # Simple form (preferred)
/// artifact: plan
///
/// # Map form (same result)
/// artifact:
///   name: plan
/// ```
#[derive(Debug, Clone, PartialEq)]
pub struct ArtifactConfig {
    /// Artifact key used for file paths and storage (e.g., "plan", "summary").
    pub name: String,
}

impl ArtifactConfig {
    fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
    }
}

impl<'de> Deserialize<'de> for ArtifactConfig {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Helper {
            Simple(String),
            Full(FullHelper),
        }

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct FullHelper {
            name: String,
        }

        Ok(match Helper::deserialize(deserializer)? {
            Helper::Simple(name) | Helper::Full(FullHelper { name }) => ArtifactConfig { name },
        })
    }
}

impl Serialize for ArtifactConfig {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.name)
    }
}

/// A tool restriction rule for agent stages.
///
/// Each entry specifies a tool pattern that the agent cannot use,
/// plus a message explaining why (injected into the agent's prompt).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolRestriction {
    /// Tool pattern in Claude Code format (e.g., `Bash(cargo *)`, `Edit`, `Write`).
    pub pattern: String,
    /// Optional human-readable reason why this tool is disallowed.
    /// Injected into the agent's system prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Configuration for a single workflow stage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct StageConfig {
    /// Unique identifier for this stage (e.g., "planning", "work").
    /// Used in status, transitions, and artifact references.
    pub name: String,

    /// Human-readable description of what this stage does.
    /// Used in the workflow overview to help agents understand their position.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Artifact this stage produces.
    pub artifact: ArtifactConfig,

    /// What this stage can do.
    #[serde(default)]
    pub capabilities: StageCapabilities,

    /// Path to prompt template file, relative to `.orkestra/agents/`
    /// (e.g., "planner.md"). If not specified, defaults to `{name}.md`
    /// for agent stages. Mutually exclusive with `script`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,

    /// Optional path to custom JSON schema file (relative to .orkestra/schemas/).
    /// If not specified, uses dynamically generated schema based on capabilities.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_file: Option<String>,

    /// Model identifier for this stage (e.g., "claudecode/sonnet", "opencode/kimi-k2").
    /// If not specified, uses the default provider and model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,

    /// Tools that this stage's agent is not allowed to use.
    /// Each entry has a pattern (e.g., `Bash(cargo *)`) and a message explaining why.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disallowed_tools: Vec<ToolRestriction>,

    /// Gate attached to this stage.
    ///
    /// - `gate: true` — Agentic gate: agent assesses, human confirms.
    /// - `gate: { command, timeout_seconds }` — Automated gate: script runs after agent completes.
    ///   On failure, re-queues the task with error feedback.
    /// - Absent or `gate: false` — No gate.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_gate_option"
    )]
    pub gate: Option<GateConfig>,
}

impl StageConfig {
    /// Create a new stage configuration.
    pub fn new(name: impl Into<String>, artifact: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: None,
            artifact: ArtifactConfig::new(artifact),
            capabilities: StageCapabilities::default(),
            prompt: None, // Defaults to {name}.md via prompt_path()
            schema_file: None,
            model: None,
            disallowed_tools: Vec::new(),
            gate: None,
        }
    }

    /// Builder: set description.
    #[must_use]
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Builder: set capabilities.
    #[must_use]
    pub fn with_capabilities(mut self, capabilities: StageCapabilities) -> Self {
        self.capabilities = capabilities;
        self
    }

    /// Builder: set prompt template path.
    #[must_use]
    pub fn with_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.prompt = Some(prompt.into());
        self
    }

    /// Builder: set custom JSON schema file.
    #[must_use]
    pub fn with_schema_file(mut self, path: impl Into<String>) -> Self {
        self.schema_file = Some(path.into());
        self
    }

    /// Builder: set model identifier (e.g., "claudecode/sonnet").
    #[must_use]
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = Some(model.into());
        self
    }

    /// Builder: set disallowed tools.
    #[must_use]
    pub fn with_disallowed_tools(mut self, tools: Vec<ToolRestriction>) -> Self {
        self.disallowed_tools = tools;
        self
    }

    /// Builder: set gate configuration.
    #[must_use]
    pub fn with_gate(mut self, gate: GateConfig) -> Self {
        self.gate = Some(gate);
        self
    }

    /// Get the title-cased display name derived from the stage name.
    pub fn display(&self) -> String {
        title_case(&self.name)
    }

    /// Get the artifact name (key used for file paths and storage).
    pub fn artifact_name(&self) -> &str {
        &self.artifact.name
    }

    /// Get the gate configuration for this stage, if any.
    pub fn gate_config(&self) -> Option<&GateConfig> {
        self.gate.as_ref()
    }

    /// Whether this stage has an agentic gate (human review of agent output).
    pub fn has_agentic_gate(&self) -> bool {
        matches!(self.gate, Some(GateConfig::Agentic))
    }

    /// Get the automated gate command and timeout, if this stage has an automated gate.
    pub fn automated_gate_config(&self) -> Option<(&str, u64)> {
        match &self.gate {
            Some(GateConfig::Automated {
                command,
                timeout_seconds,
            }) => Some((command.as_str(), *timeout_seconds)),
            _ => None,
        }
    }

    /// Get the effective prompt template path for this stage.
    ///
    /// Returns `prompt` if set, otherwise `{name}.md`.
    pub fn prompt_path(&self) -> Option<String> {
        if let Some(ref prompt) = self.prompt {
            return Some(prompt.clone());
        }

        // Default: {stage_name}.md
        Some(format!("{}.md", self.name))
    }
}

/// Capabilities that a stage may have.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct StageCapabilities {
    /// Subtask capabilities. Presence indicates the stage can produce subtasks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtasks: Option<SubtaskCapabilities>,
}

/// Configuration for a stage that produces subtasks.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct SubtaskCapabilities {
    /// Named flow that subtasks created from this stage should use.
    /// If None, subtasks use the default (full) pipeline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flow: Option<String>,
}

impl StageCapabilities {
    /// Create capabilities with subtask production enabled.
    pub fn with_subtasks() -> Self {
        Self {
            subtasks: Some(SubtaskCapabilities::default()),
        }
    }

    /// Whether this stage can produce subtasks.
    pub fn produces_subtasks(&self) -> bool {
        self.subtasks.is_some()
    }

    /// The flow name for subtasks, if configured.
    pub fn subtask_flow(&self) -> Option<&str> {
        self.subtasks.as_ref()?.flow.as_deref()
    }
}

impl SubtaskCapabilities {
    /// Builder: set the subtask flow.
    #[must_use]
    pub fn with_flow(mut self, flow: impl Into<String>) -> Self {
        self.flow = Some(flow.into());
        self
    }
}

// ============================================================================
// Gate Configuration
// ============================================================================

/// Gate attached to a workflow stage.
///
/// - `Agentic` — agent assesses work and produces an approve/reject output.
///   Human confirms before advancing. YAML: `gate: true`
/// - `Automated` — shell script runs after the agent completes.
///   On failure, the task re-queues with error feedback. YAML: `gate: { command, timeout_seconds }`
#[derive(Debug, Clone, PartialEq)]
pub enum GateConfig {
    /// Agentic gate: agent assesses, human confirms. YAML: `gate: true`
    Agentic,
    /// Automated gate: script runs after agent completes. YAML: `gate: { command, timeout_seconds }`
    Automated {
        command: String,
        timeout_seconds: u64,
    },
}

fn default_gate_timeout() -> u64 {
    300
}

impl GateConfig {
    /// Create a new automated gate configuration with the default timeout (300s).
    pub fn new_automated(command: impl Into<String>) -> Self {
        Self::Automated {
            command: command.into(),
            timeout_seconds: default_gate_timeout(),
        }
    }

    /// Builder: set timeout in seconds. Only meaningful for `Automated` variant.
    #[must_use]
    pub fn with_timeout(self, seconds: u64) -> Self {
        match self {
            Self::Automated { command, .. } => Self::Automated {
                command,
                timeout_seconds: seconds,
            },
            other @ Self::Agentic => other,
        }
    }
}

impl Serialize for GateConfig {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            GateConfig::Agentic => serializer.serialize_bool(true),
            GateConfig::Automated {
                command,
                timeout_seconds,
            } => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("command", command)?;
                map.serialize_entry("timeout_seconds", timeout_seconds)?;
                map.end()
            }
        }
    }
}

/// Deserialize `Option<GateConfig>` from YAML gate field.
///
/// - Absent / `false` / `null` → `None`
/// - `true` → `Some(GateConfig::Agentic)`
/// - `{ command, timeout_seconds }` → `Some(GateConfig::Automated { ... })`
fn deserialize_gate_option<'de, D>(deserializer: D) -> Result<Option<GateConfig>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct AutomatedGate {
        command: String,
        #[serde(default = "default_gate_timeout")]
        timeout_seconds: u64,
    }

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum GateHelper {
        Bool(bool),
        Automated(AutomatedGate),
    }

    match Option::<GateHelper>::deserialize(deserializer)? {
        None | Some(GateHelper::Bool(false)) => Ok(None),
        Some(GateHelper::Bool(true)) => Ok(Some(GateConfig::Agentic)),
        Some(GateHelper::Automated(AutomatedGate {
            command,
            timeout_seconds,
        })) => Ok(Some(GateConfig::Automated {
            command,
            timeout_seconds,
        })),
    }
}

/// Convert a `snake_case` or kebab-case name to Title Case.
fn title_case(s: &str) -> String {
    s.split(['_', '-'])
        .filter(|w| !w.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stage_config_new() {
        let stage = StageConfig::new("planning", "plan");
        assert_eq!(stage.name, "planning");
        assert_eq!(stage.artifact_name(), "plan");
        assert!(stage.gate.is_none());
    }

    #[test]
    fn test_stage_config_builder() {
        let stage = StageConfig::new("work", "summary").with_description("Do the work");
        assert_eq!(stage.description, Some("Do the work".to_string()));
    }

    #[test]
    fn test_display_title_cases_name() {
        assert_eq!(StageConfig::new("planning", "plan").display(), "Planning");
        assert_eq!(
            StageConfig::new("work_review", "verdict").display(),
            "Work Review"
        );
        assert_eq!(StageConfig::new("hot-fix", "patch").display(), "Hot Fix");
    }

    #[test]
    fn test_capabilities_default() {
        let caps = StageCapabilities::default();
        assert!(!caps.produces_subtasks());
    }

    #[test]
    fn test_capabilities_with_subtasks() {
        let caps = StageCapabilities::with_subtasks();
        assert!(caps.produces_subtasks());
        assert_eq!(caps.subtask_flow(), None);
    }

    #[test]
    fn test_stage_config_serialization_no_capabilities() {
        // Default capabilities should produce no capabilities field in YAML
        let stage = StageConfig::new("planning", "plan");

        let yaml = serde_yaml::to_string(&stage).unwrap();
        assert!(yaml.contains("name: planning"));
        assert!(yaml.contains("artifact: plan"));

        let parsed: StageConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed, stage);
    }

    #[test]
    fn test_subtask_capabilities() {
        let caps = StageCapabilities {
            subtasks: Some(SubtaskCapabilities::default().with_flow("quick")),
        };

        assert!(caps.produces_subtasks());
        assert_eq!(caps.subtask_flow(), Some("quick"));
    }

    #[test]
    fn test_subtask_capabilities_none() {
        let caps = StageCapabilities::default();
        assert!(!caps.produces_subtasks());
        assert_eq!(caps.subtask_flow(), None);
    }

    #[test]
    fn test_subtask_capabilities_serialization() {
        let caps = StageCapabilities {
            subtasks: Some(SubtaskCapabilities::default().with_flow("subtask")),
        };
        let yaml = serde_yaml::to_string(&caps).unwrap();
        assert!(yaml.contains("subtasks"));
        assert!(yaml.contains("flow: subtask"));

        let parsed: StageCapabilities = serde_yaml::from_str(&yaml).unwrap();
        assert!(parsed.produces_subtasks());
        assert_eq!(parsed.subtask_flow(), Some("subtask"));
    }

    #[test]
    fn test_subtask_capabilities_skipped_when_none() {
        let caps = StageCapabilities::default();
        let yaml = serde_yaml::to_string(&caps).unwrap();
        assert!(!yaml.contains("subtasks"));
    }

    #[test]
    fn test_prompt_path_default() {
        let stage = StageConfig::new("planning", "plan");
        assert_eq!(stage.prompt_path(), Some("planning.md".to_string()));
    }

    #[test]
    fn test_prompt_path_explicit() {
        let stage = StageConfig::new("planning", "plan").with_prompt("planner.md");
        assert_eq!(stage.prompt_path(), Some("planner.md".to_string()));
    }

    #[test]
    fn test_stage_with_prompt() {
        let stage = StageConfig::new("planning", "plan").with_prompt("planner.md");

        assert_eq!(stage.prompt, Some("planner.md".to_string()));
    }

    #[test]
    fn test_schema_file_builder() {
        let stage = StageConfig::new("custom", "output").with_schema_file("custom_schema.json");

        assert_eq!(stage.schema_file, Some("custom_schema.json".to_string()));
    }

    #[test]
    fn test_description_field_serialization() {
        // Test with description present
        let stage_with_desc =
            StageConfig::new("planning", "plan").with_description("Create an implementation plan");

        let yaml = serde_yaml::to_string(&stage_with_desc).unwrap();
        assert!(yaml.contains("description: Create an implementation plan"));

        let parsed: StageConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(
            parsed.description,
            Some("Create an implementation plan".to_string())
        );

        // Test without description (should be omitted from YAML)
        let stage_no_desc = StageConfig::new("work", "summary");
        let yaml_no_desc = serde_yaml::to_string(&stage_no_desc).unwrap();
        assert!(!yaml_no_desc.contains("description:"));
    }

    #[test]
    fn test_description_builder() {
        let stage =
            StageConfig::new("work", "summary").with_description("Implement the approved plan");

        assert_eq!(
            stage.description,
            Some("Implement the approved plan".to_string())
        );
    }

    #[test]
    fn test_disallowed_tools_default_empty() {
        let stage = StageConfig::new("work", "summary");
        assert!(stage.disallowed_tools.is_empty());
    }

    #[test]
    fn test_disallowed_tools_builder() {
        let tools = vec![
            ToolRestriction {
                pattern: "Bash(cargo *)".to_string(),
                message: Some("Use the checks gate script instead".to_string()),
            },
            ToolRestriction {
                pattern: "Edit".to_string(),
                message: Some("Read-only stage".to_string()),
            },
        ];

        let stage = StageConfig::new("work", "summary").with_disallowed_tools(tools.clone());
        assert_eq!(stage.disallowed_tools.len(), 2);
        assert_eq!(stage.disallowed_tools[0].pattern, "Bash(cargo *)");
        assert_eq!(stage.disallowed_tools[1].pattern, "Edit");
    }

    #[test]
    fn test_disallowed_tools_serialization() {
        // Empty vec should be omitted
        let stage_empty = StageConfig::new("work", "summary");
        let yaml = serde_yaml::to_string(&stage_empty).unwrap();
        assert!(!yaml.contains("disallowed_tools"));

        // Non-empty vec should be included
        let stage_with_tools =
            StageConfig::new("work", "summary").with_disallowed_tools(vec![ToolRestriction {
                pattern: "Bash(cargo *)".to_string(),
                message: Some("Use the checks stage".to_string()),
            }]);
        let yaml = serde_yaml::to_string(&stage_with_tools).unwrap();
        assert!(yaml.contains("disallowed_tools"));
        assert!(yaml.contains("pattern:") && yaml.contains("Bash(cargo *)"));
        assert!(yaml.contains("message:") && yaml.contains("Use the checks stage"));

        // Round-trip test
        let parsed: StageConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.disallowed_tools.len(), 1);
        assert_eq!(parsed.disallowed_tools[0].pattern, "Bash(cargo *)");
    }

    #[test]
    fn test_disallowed_tools_yaml_parsing() {
        // Test with explicit messages
        let yaml_with_messages = r"
name: work
artifact: summary
disallowed_tools:
  - pattern: 'Bash(cargo *)'
    message: Use the checks stage
  - pattern: Edit
    message: Read-only stage
";
        let stage: StageConfig = serde_yaml::from_str(yaml_with_messages).unwrap();
        assert_eq!(stage.disallowed_tools.len(), 2);
        assert_eq!(stage.disallowed_tools[0].pattern, "Bash(cargo *)");
        assert_eq!(
            stage.disallowed_tools[0].message,
            Some("Use the checks stage".to_string())
        );
        assert_eq!(stage.disallowed_tools[1].pattern, "Edit");
        assert_eq!(
            stage.disallowed_tools[1].message,
            Some("Read-only stage".to_string())
        );

        // Test without messages (should deserialize to None)
        let yaml_without_messages = r"
name: work
artifact: summary
disallowed_tools:
  - pattern: 'Bash(cargo *)'
  - pattern: Edit
";
        let stage: StageConfig = serde_yaml::from_str(yaml_without_messages).unwrap();
        assert_eq!(stage.disallowed_tools.len(), 2);
        assert_eq!(stage.disallowed_tools[0].pattern, "Bash(cargo *)");
        assert_eq!(stage.disallowed_tools[0].message, None);
        assert_eq!(stage.disallowed_tools[1].pattern, "Edit");
        assert_eq!(stage.disallowed_tools[1].message, None);
    }

    // -- ArtifactConfig serde --

    #[test]
    fn test_artifact_config_simple_deserialization() {
        let yaml = "name: planning
artifact: plan
";
        let stage: StageConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(stage.artifact_name(), "plan");
    }

    #[test]
    fn test_artifact_config_map_form_deserialization() {
        let yaml = "name: planning
artifact:
  name: plan
";
        let stage: StageConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(stage.artifact_name(), "plan");
    }

    #[test]
    fn test_artifact_config_rejects_unknown_fields() {
        let yaml = "name: planning
artifact:
  name: plan
  description: The implementation plan
";
        let result: Result<StageConfig, _> = serde_yaml::from_str(yaml);
        assert!(
            result.is_err(),
            "Expected error when deserializing artifact with unknown field 'description'"
        );
    }

    #[test]
    fn test_artifact_config_roundtrip() {
        let stage = StageConfig::new("planning", "plan");
        let out = serde_yaml::to_string(&stage).unwrap();
        let reparsed: StageConfig = serde_yaml::from_str(&out).unwrap();
        assert_eq!(stage, reparsed);
    }

    // -- Gate config tests --

    #[test]
    fn test_gate_agentic_deserializes_from_true() {
        let yaml = "name: review\nartifact: verdict\ngate: true\n";
        let stage: StageConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(stage.gate, Some(GateConfig::Agentic));
        assert!(stage.has_agentic_gate());
    }

    #[test]
    fn test_gate_false_deserializes_to_none() {
        let yaml = "name: work\nartifact: summary\ngate: false\n";
        let stage: StageConfig = serde_yaml::from_str(yaml).unwrap();
        assert!(stage.gate.is_none());
        assert!(!stage.has_agentic_gate());
    }

    #[test]
    fn test_gate_absent_is_none() {
        let yaml = "name: work\nartifact: summary\n";
        let stage: StageConfig = serde_yaml::from_str(yaml).unwrap();
        assert!(stage.gate.is_none());
    }

    #[test]
    fn test_gate_automated_deserializes_from_map() {
        let yaml = "name: work\nartifact: summary\ngate:\n  command: ./checks.sh\n  timeout_seconds: 600\n";
        let stage: StageConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(
            stage.gate,
            Some(GateConfig::Automated {
                command: "./checks.sh".to_string(),
                timeout_seconds: 600,
            })
        );
        assert!(!stage.has_agentic_gate());
        assert_eq!(stage.automated_gate_config(), Some(("./checks.sh", 600)));
    }

    #[test]
    fn test_gate_automated_default_timeout() {
        let yaml = "name: work\nartifact: summary\ngate:\n  command: ./checks.sh\n";
        let stage: StageConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(
            stage.gate,
            Some(GateConfig::Automated {
                command: "./checks.sh".to_string(),
                timeout_seconds: 300, // default
            })
        );
    }

    #[test]
    fn test_gate_agentic_serializes_to_true() {
        let stage = StageConfig::new("review", "verdict").with_gate(GateConfig::Agentic);
        let yaml = serde_yaml::to_string(&stage).unwrap();
        assert!(yaml.contains("gate: true"));
    }

    #[test]
    fn test_gate_automated_serializes_to_map() {
        let stage = StageConfig::new("work", "summary")
            .with_gate(GateConfig::new_automated("./checks.sh").with_timeout(120));
        let yaml = serde_yaml::to_string(&stage).unwrap();
        assert!(yaml.contains("gate:"));
        assert!(yaml.contains("command: ./checks.sh"));
        assert!(yaml.contains("timeout_seconds: 120"));
    }

    #[test]
    fn test_gate_agentic_roundtrip() {
        let stage = StageConfig::new("review", "verdict").with_gate(GateConfig::Agentic);
        let yaml = serde_yaml::to_string(&stage).unwrap();
        let parsed: StageConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.gate, Some(GateConfig::Agentic));
    }

    #[test]
    fn test_gate_automated_roundtrip() {
        let stage = StageConfig::new("work", "summary")
            .with_gate(GateConfig::new_automated("./checks.sh").with_timeout(600));
        let yaml = serde_yaml::to_string(&stage).unwrap();
        let parsed: StageConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(
            parsed.gate,
            Some(GateConfig::Automated {
                command: "./checks.sh".to_string(),
                timeout_seconds: 600,
            })
        );
    }

    #[test]
    fn test_gate_omitted_when_none() {
        let stage = StageConfig::new("work", "summary");
        let yaml = serde_yaml::to_string(&stage).unwrap();
        assert!(!yaml.contains("gate:"));
    }

    #[test]
    fn test_automated_gate_config_returns_none_for_agentic() {
        let stage = StageConfig::new("review", "verdict").with_gate(GateConfig::Agentic);
        assert!(stage.automated_gate_config().is_none());
    }

    #[test]
    fn test_gate_config_new_automated_defaults() {
        let gate = GateConfig::new_automated("./run_checks.sh");
        assert_eq!(
            gate,
            GateConfig::Automated {
                command: "./run_checks.sh".to_string(),
                timeout_seconds: 300,
            }
        );
    }

    #[test]
    fn test_gate_config_with_timeout() {
        let gate = GateConfig::new_automated("./run.sh").with_timeout(60);
        assert_eq!(
            gate,
            GateConfig::Automated {
                command: "./run.sh".to_string(),
                timeout_seconds: 60,
            }
        );
    }

    // -- StageCapabilities deny_unknown_fields regression tests --

    #[test]
    fn test_stage_capabilities_rejects_unknown_fields() {
        // Old field `ask_questions` should be rejected
        let yaml = "ask_questions: true\n";
        let result: Result<StageCapabilities, _> = serde_yaml::from_str(yaml);
        assert!(
            result.is_err(),
            "Expected error when deserializing StageCapabilities with unknown field 'ask_questions'"
        );
    }

    #[test]
    fn test_gate_automated_rejects_unknown_fields() {
        let yaml = "name: work\nartifact: summary\ngate:\n  command: ./checks.sh\n  retries: 3\n";
        let result: Result<StageConfig, _> = serde_yaml::from_str(yaml);
        assert!(
            result.is_err(),
            "Expected error when gate has unknown field 'retries'"
        );
    }

    #[test]
    fn test_stage_capabilities_rejects_approval_field() {
        // Old field `approval` should be rejected
        let yaml = "approval:\n  rejection_stage: work\n";
        let result: Result<StageCapabilities, _> = serde_yaml::from_str(yaml);
        assert!(
            result.is_err(),
            "Expected error when deserializing StageCapabilities with unknown field 'approval'"
        );
    }

    #[test]
    fn test_stage_config_rejects_is_automated_field() {
        // Old field `is_automated` on StageConfig should be rejected
        let yaml = "name: compound\nartifact: learnings\nis_automated: true\n";
        let result: Result<StageConfig, _> = serde_yaml::from_str(yaml);
        assert!(
            result.is_err(),
            "Expected error when deserializing StageConfig with unknown field 'is_automated'"
        );
    }

    #[test]
    fn test_artifact_config_always_serializes_as_string() {
        let stage = StageConfig::new("planning", "plan");
        let yaml = serde_yaml::to_string(&stage).unwrap();
        // Artifact must always serialize as plain string "plan",
        // not as a map with a "name" key.
        assert!(yaml.contains("artifact: plan"));
        assert!(!yaml.contains("artifact:\n"));
    }
}
