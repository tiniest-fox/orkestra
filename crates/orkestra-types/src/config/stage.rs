//! Stage configuration types.
//!
//! A stage represents a single step in the workflow. Each stage:
//! - Has a unique name (e.g., "planning", "work", "review")
//! - Produces an artifact (e.g., "plan", "summary")
//! - Has capabilities that define what it can do

use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

// ============================================================================
// Artifact Configuration
// ============================================================================

/// Configuration for an artifact produced by a stage.
///
/// Accepts both a plain string (just the name) and a rich struct:
///
/// ```yaml
/// # Simple form
/// artifact: plan
///
/// # Rich form
/// artifact:
///   name: plan
///   display_name: PRD
///   description: High-level product plan for this task
/// ```
#[derive(Debug, Clone, PartialEq)]
pub struct ArtifactConfig {
    /// Artifact key used for file paths and storage (e.g., "plan", "summary").
    pub name: String,
    /// Human-readable display name (e.g., "PRD"). Defaults to `name` if not set.
    pub display_name: Option<String>,
    /// Short description shown to agents alongside the file path.
    pub description: Option<String>,
}

impl ArtifactConfig {
    fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            display_name: None,
            description: None,
        }
    }
}

impl<'de> Deserialize<'de> for ArtifactConfig {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Helper {
            Simple(String),
            Full {
                name: String,
                #[serde(default)]
                display_name: Option<String>,
                #[serde(default)]
                description: Option<String>,
            },
        }
        Ok(match Helper::deserialize(deserializer)? {
            Helper::Simple(name) => ArtifactConfig {
                name,
                display_name: None,
                description: None,
            },
            Helper::Full {
                name,
                display_name,
                description,
            } => ArtifactConfig {
                name,
                display_name,
                description,
            },
        })
    }
}

impl Serialize for ArtifactConfig {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if self.display_name.is_none() && self.description.is_none() {
            serializer.serialize_str(&self.name)
        } else {
            let mut map = serializer.serialize_map(None)?;
            map.serialize_entry("name", &self.name)?;
            if let Some(ref dn) = self.display_name {
                map.serialize_entry("display_name", dn)?;
            }
            if let Some(ref desc) = self.description {
                map.serialize_entry("description", desc)?;
            }
            map.end()
        }
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
pub struct StageConfig {
    /// Unique identifier for this stage (e.g., "planning", "work").
    /// Used in status, transitions, and artifact references.
    pub name: String,

    /// Human-readable display name (e.g., "Planning", "Working").
    /// Defaults to capitalized `name` if not specified.
    #[serde(default)]
    pub display_name: Option<String>,

    /// Optional lucide-react icon name (e.g., "pencil-ruler", "hammer").
    /// Used by the frontend to render stage indicators.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

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

    /// Whether this stage runs automatically without human approval.
    #[serde(default)]
    pub is_automated: bool,

    /// Model identifier for this stage (e.g., "claudecode/sonnet", "opencode/kimi-k2").
    /// If not specified, uses the default provider and model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,

    /// When true, re-entering this stage after a full pipeline cycle starts a
    /// completely new agent session instead of resuming the existing one.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub restart_on_reentry: bool,

    /// Tools that this stage's agent is not allowed to use.
    /// Each entry has a pattern (e.g., `Bash(cargo *)`) and a message explaining why.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disallowed_tools: Vec<ToolRestriction>,

    /// Gate script attached to this stage.
    /// Runs after the agent completes. On failure, re-queues the task with error feedback.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate: Option<GateConfig>,
}

impl StageConfig {
    /// Create a new stage configuration.
    pub fn new(name: impl Into<String>, artifact: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            display_name: None,
            icon: None,
            description: None,
            artifact: ArtifactConfig::new(artifact),
            capabilities: StageCapabilities::default(),
            prompt: None, // Defaults to {name}.md via prompt_path()
            schema_file: None,
            is_automated: false,
            model: None,
            restart_on_reentry: false,
            disallowed_tools: Vec::new(),
            gate: None,
        }
    }

    /// Builder: set display name.
    #[must_use]
    pub fn with_display_name(mut self, name: impl Into<String>) -> Self {
        self.display_name = Some(name.into());
        self
    }

    /// Builder: set icon.
    #[must_use]
    pub fn with_icon(mut self, icon: impl Into<String>) -> Self {
        self.icon = Some(icon.into());
        self
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

    /// Builder: mark as automated (no human approval).
    #[must_use]
    pub fn automated(mut self) -> Self {
        self.is_automated = true;
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

    /// Builder: enable restart on stage re-entry.
    #[must_use]
    pub fn restart_on_reentry(mut self) -> Self {
        self.restart_on_reentry = true;
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

    /// Get the display name, falling back to capitalized name.
    pub fn display(&self) -> String {
        self.display_name
            .clone()
            .unwrap_or_else(|| capitalize(&self.name))
    }

    /// Get the artifact name (key used for file paths and storage).
    pub fn artifact_name(&self) -> &str {
        &self.artifact.name
    }

    /// Get the gate configuration for this stage, if any.
    pub fn gate_config(&self) -> Option<&GateConfig> {
        self.gate.as_ref()
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
pub struct StageCapabilities {
    /// Stage can ask clarifying questions before producing output.
    #[serde(default)]
    pub ask_questions: bool,

    /// Subtask capabilities. Presence indicates the stage can produce subtasks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtasks: Option<SubtaskCapabilities>,

    /// Approval capability. When present, the stage must produce an approve/reject
    /// decision instead of a plain artifact. On reject, the task moves to the
    /// `rejection_stage` (or the previous stage in the flow if not specified).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<ApprovalCapabilities>,
}

/// Configuration for a stage with approval capability.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ApprovalCapabilities {
    /// Stage to move to on rejection. If None, defaults to the previous stage in the flow.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rejection_stage: Option<String>,
    /// When true, rejection supersedes the target stage's session so the next
    /// spawn starts fresh (full initial prompt) instead of resuming.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub reset_session: bool,
}

/// Configuration for a stage that produces subtasks.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct SubtaskCapabilities {
    /// Named flow that subtasks created from this stage should use.
    /// If None, subtasks use the default (full) pipeline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flow: Option<String>,

    /// Stage the parent resumes at after subtasks complete.
    /// If None, parent advances to the default next stage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completion_stage: Option<String>,
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
            subtasks: Some(SubtaskCapabilities::default()),
            ..Default::default()
        }
    }

    /// Create capabilities with both questions and subtasks.
    pub fn all() -> Self {
        Self {
            ask_questions: true,
            subtasks: Some(SubtaskCapabilities::default()),
            approval: None,
        }
    }

    /// Create capabilities with approval (approve/reject decision).
    pub fn with_approval(rejection_stage: Option<String>) -> Self {
        Self {
            approval: Some(ApprovalCapabilities {
                rejection_stage,
                reset_session: false,
            }),
            ..Default::default()
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

    /// The stage the parent resumes at after subtasks complete, if configured.
    pub fn completion_stage(&self) -> Option<&str> {
        self.subtasks.as_ref()?.completion_stage.as_deref()
    }

    /// Whether this stage has approval capability.
    pub fn has_approval(&self) -> bool {
        self.approval.is_some()
    }

    /// The explicit rejection stage, if configured.
    pub fn rejection_stage(&self) -> Option<&str> {
        self.approval.as_ref()?.rejection_stage.as_deref()
    }

    /// Whether rejection should reset (supersede) the target stage's session.
    pub fn rejection_resets_session(&self) -> bool {
        self.approval.as_ref().is_some_and(|a| a.reset_session)
    }
}

impl SubtaskCapabilities {
    /// Builder: set the subtask flow.
    #[must_use]
    pub fn with_flow(mut self, flow: impl Into<String>) -> Self {
        self.flow = Some(flow.into());
        self
    }

    /// Builder: set the completion stage.
    #[must_use]
    pub fn with_completion_stage(mut self, stage: impl Into<String>) -> Self {
        self.completion_stage = Some(stage.into());
        self
    }
}

// ============================================================================
// Gate Configuration
// ============================================================================

/// Configuration for a gate script attached to an agent stage.
///
/// After the agent completes, the gate script runs. If it passes, the task
/// enters the commit pipeline. If it fails, the task re-queues with error feedback.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GateConfig {
    /// Shell command to execute (runs via `sh -c`).
    pub command: String,

    /// Timeout in seconds. Defaults to 300 (5 minutes).
    #[serde(default = "default_gate_timeout")]
    pub timeout_seconds: u64,
}

fn default_gate_timeout() -> u64 {
    300
}

impl GateConfig {
    /// Create a new gate configuration.
    pub fn new(command: impl Into<String>) -> Self {
        Self {
            command: command.into(),
            timeout_seconds: default_gate_timeout(),
        }
    }

    /// Builder: set timeout in seconds.
    #[must_use]
    pub fn with_timeout(mut self, seconds: u64) -> Self {
        self.timeout_seconds = seconds;
        self
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
        assert_eq!(stage.artifact_name(), "plan");
        assert!(!stage.is_automated);
    }

    #[test]
    fn test_stage_config_builder() {
        let stage = StageConfig::new("work", "summary").with_display_name("Working");

        assert_eq!(stage.display(), "Working");
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
        assert!(!caps.produces_subtasks());
    }

    #[test]
    fn test_capabilities_builders() {
        let with_questions = StageCapabilities::with_questions();
        assert!(with_questions.ask_questions);
        assert!(!with_questions.produces_subtasks());

        let with_subtasks = StageCapabilities::with_subtasks();
        assert!(!with_subtasks.ask_questions);
        assert!(with_subtasks.produces_subtasks());

        let all = StageCapabilities::all();
        assert!(all.ask_questions);
        assert!(all.produces_subtasks());
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
    fn test_capabilities_with_approval() {
        let caps = StageCapabilities::with_approval(Some("work".into()));
        assert!(caps.has_approval());
        assert_eq!(caps.rejection_stage(), Some("work"));
        assert!(!caps.ask_questions);
        assert!(!caps.produces_subtasks());
    }

    #[test]
    fn test_capabilities_approval_default_rejection() {
        let caps = StageCapabilities::with_approval(None);
        assert!(caps.has_approval());
        assert_eq!(caps.rejection_stage(), None);
    }

    #[test]
    fn test_capabilities_approval_default_none() {
        let caps = StageCapabilities::default();
        assert!(!caps.has_approval());
        assert_eq!(caps.rejection_stage(), None);
    }

    #[test]
    fn test_capabilities_approval_serialization() {
        let caps = StageCapabilities::with_approval(Some("work".into()));
        let yaml = serde_yaml::to_string(&caps).unwrap();
        assert!(yaml.contains("approval"));
        assert!(yaml.contains("rejection_stage: work"));

        let parsed: StageCapabilities = serde_yaml::from_str(&yaml).unwrap();
        assert!(parsed.has_approval());
        assert_eq!(parsed.rejection_stage(), Some("work"));
    }

    #[test]
    fn test_capabilities_approval_skipped_when_none() {
        let caps = StageCapabilities::default();
        let yaml = serde_yaml::to_string(&caps).unwrap();
        assert!(!yaml.contains("approval"));
    }

    #[test]
    fn test_reset_session_defaults_to_false() {
        let caps = StageCapabilities::with_approval(Some("work".into()));
        assert!(!caps.rejection_resets_session());
    }

    #[test]
    fn test_reset_session_true() {
        let caps = StageCapabilities {
            approval: Some(ApprovalCapabilities {
                rejection_stage: Some("work".into()),
                reset_session: true,
            }),
            ..Default::default()
        };
        assert!(caps.rejection_resets_session());
        assert_eq!(caps.rejection_stage(), Some("work"));
    }

    #[test]
    fn test_reset_session_serialization() {
        let caps = StageCapabilities {
            approval: Some(ApprovalCapabilities {
                rejection_stage: Some("work".into()),
                reset_session: true,
            }),
            ..Default::default()
        };
        let yaml = serde_yaml::to_string(&caps).unwrap();
        assert!(yaml.contains("reset_session: true"));

        let parsed: StageCapabilities = serde_yaml::from_str(&yaml).unwrap();
        assert!(parsed.rejection_resets_session());
    }

    #[test]
    fn test_reset_session_skipped_when_false() {
        let caps = StageCapabilities::with_approval(Some("work".into()));
        let yaml = serde_yaml::to_string(&caps).unwrap();
        assert!(!yaml.contains("reset_session"));
    }

    #[test]
    fn test_subtask_capabilities() {
        let caps = StageCapabilities {
            subtasks: Some(
                SubtaskCapabilities::default()
                    .with_flow("quick")
                    .with_completion_stage("review"),
            ),
            ..Default::default()
        };

        assert!(caps.produces_subtasks());
        assert_eq!(caps.subtask_flow(), Some("quick"));
        assert_eq!(caps.completion_stage(), Some("review"));
    }

    #[test]
    fn test_subtask_capabilities_none() {
        let caps = StageCapabilities::default();
        assert!(!caps.produces_subtasks());
        assert_eq!(caps.subtask_flow(), None);
        assert_eq!(caps.completion_stage(), None);
    }

    #[test]
    fn test_subtask_capabilities_serialization() {
        let caps = StageCapabilities {
            subtasks: Some(SubtaskCapabilities::default().with_flow("subtask")),
            ..Default::default()
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
    fn test_icon_field_serialization() {
        // Test with icon present
        let stage_with_icon = StageConfig::new("planning", "plan").with_icon("pencil-ruler");

        let yaml = serde_yaml::to_string(&stage_with_icon).unwrap();
        assert!(yaml.contains("icon: pencil-ruler"));

        let parsed: StageConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.icon, Some("pencil-ruler".to_string()));

        // Test without icon (should be omitted from YAML)
        let stage_no_icon = StageConfig::new("work", "summary");
        let yaml_no_icon = serde_yaml::to_string(&stage_no_icon).unwrap();
        assert!(!yaml_no_icon.contains("icon:"));
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
    fn test_restart_on_reentry_defaults_to_false() {
        let stage = StageConfig::new("work", "summary");
        assert!(!stage.restart_on_reentry);
    }

    #[test]
    fn test_restart_on_reentry_builder() {
        let stage = StageConfig::new("work", "summary").restart_on_reentry();
        assert!(stage.restart_on_reentry);
    }

    #[test]
    fn test_restart_on_reentry_serialization() {
        // False value should be omitted (skip_serializing_if)
        let stage_false = StageConfig::new("work", "summary");
        let yaml = serde_yaml::to_string(&stage_false).unwrap();
        assert!(!yaml.contains("restart_on_reentry"));

        // True value should be included
        let stage_true = StageConfig::new("work", "summary").restart_on_reentry();
        let yaml = serde_yaml::to_string(&stage_true).unwrap();
        assert!(yaml.contains("restart_on_reentry: true"));

        // Round-trip test
        let parsed: StageConfig = serde_yaml::from_str(&yaml).unwrap();
        assert!(parsed.restart_on_reentry);
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
                message: Some("Use the checks script stage instead".to_string()),
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
        assert!(stage.artifact.description.is_none());
        assert!(stage.artifact.display_name.is_none());
    }

    #[test]
    fn test_artifact_config_rich_description_only() {
        let yaml = "name: planning
artifact:
  name: plan
  description: The implementation plan
";
        let stage: StageConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(stage.artifact_name(), "plan");
        assert_eq!(
            stage.artifact.description.as_deref(),
            Some("The implementation plan")
        );
        assert!(stage.artifact.display_name.is_none());
    }

    #[test]
    fn test_artifact_config_rich_all_fields() {
        let yaml = "name: planning
artifact:
  name: plan
  display_name: PRD
  description: High-level plan
";
        let stage: StageConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(stage.artifact_name(), "plan");
        assert_eq!(stage.artifact.display_name.as_deref(), Some("PRD"));
        assert_eq!(
            stage.artifact.description.as_deref(),
            Some("High-level plan")
        );
    }

    #[test]
    fn test_artifact_config_rich_roundtrip() {
        let yaml = "name: planning
artifact:
  name: plan
  description: The implementation plan
";
        let stage: StageConfig = serde_yaml::from_str(yaml).unwrap();
        let out = serde_yaml::to_string(&stage).unwrap();
        let reparsed: StageConfig = serde_yaml::from_str(&out).unwrap();
        assert_eq!(stage, reparsed);
    }

    // -- Gate config tests --

    #[test]
    fn test_gate_config_defaults() {
        let gate = GateConfig::new("./run_checks.sh");
        assert_eq!(gate.command, "./run_checks.sh");
        assert_eq!(gate.timeout_seconds, 300);
    }

    #[test]
    fn test_gate_config_builder() {
        let gate = GateConfig::new("./run.sh").with_timeout(60);
        assert_eq!(gate.timeout_seconds, 60);
    }

    #[test]
    fn test_gate_config_serialization() {
        let gate = GateConfig::new("./checks.sh").with_timeout(120);
        let yaml = serde_yaml::to_string(&gate).unwrap();
        assert!(yaml.contains("command: ./checks.sh"));
        assert!(yaml.contains("timeout_seconds: 120"));

        let parsed: GateConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.command, "./checks.sh");
        assert_eq!(parsed.timeout_seconds, 120);
    }

    #[test]
    fn test_stage_with_gate() {
        let gate = GateConfig::new("./gate.sh");
        let stage = StageConfig::new("work", "summary").with_gate(gate.clone());

        assert_eq!(stage.gate_config().unwrap().command, "./gate.sh");
    }

    #[test]
    fn test_gate_omitted_when_none() {
        let stage = StageConfig::new("work", "summary");
        let yaml = serde_yaml::to_string(&stage).unwrap();
        assert!(!yaml.contains("gate:"));
    }

    #[test]
    fn test_gate_serialized_when_present() {
        let stage = StageConfig::new("work", "summary").with_gate(GateConfig::new("./checks.sh"));
        let yaml = serde_yaml::to_string(&stage).unwrap();
        assert!(yaml.contains("gate:"));
        assert!(yaml.contains("command: ./checks.sh"));

        let parsed: StageConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.gate_config().unwrap().command, "./checks.sh");
    }

    #[test]
    fn test_artifact_config_simple_serializes_as_string() {
        let stage = StageConfig::new("planning", "plan");
        let yaml = serde_yaml::to_string(&stage).unwrap();
        // Simple artifact (no optional fields) must serialize as plain string "plan",
        // not as a map with a "name" key.
        assert!(yaml.contains("artifact: plan"));
        // Ensure artifact is not serialized as a map (which would produce "artifact:\n  name: ...")
        assert!(!yaml.contains("artifact:\n"));
    }

    #[test]
    fn test_artifact_config_rich_serializes_as_map() {
        let mut stage = StageConfig::new("planning", "plan");
        stage.artifact.description = Some("The implementation plan".to_string());
        let yaml = serde_yaml::to_string(&stage).unwrap();
        assert!(yaml.contains("description: The implementation plan"));
        assert!(yaml.contains("name: plan"));
    }
}
