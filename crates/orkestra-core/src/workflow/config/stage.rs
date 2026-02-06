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

    /// Path to prompt template file, relative to `.orkestra/agents/`
    /// (e.g., "planner.md"). If not specified, defaults to `{name}.md`
    /// for agent stages. Mutually exclusive with `script`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,

    /// Optional path to custom JSON schema file (relative to .orkestra/schemas/).
    /// If not specified, uses dynamically generated schema based on capabilities.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_file: Option<String>,

    /// Script configuration for this stage (mutually exclusive with `prompt`).
    /// Script stages run shell commands instead of spawning agents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<ScriptStageConfig>,

    /// Whether this stage runs automatically without human approval.
    /// Script stages always auto-advance on success regardless of this setting.
    #[serde(default)]
    pub is_automated: bool,

    /// Model identifier for agent stages (e.g., "claudecode/sonnet", "opencode/kimi-k2").
    /// If not specified, uses the default provider and model.
    /// Ignored for script stages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

impl StageConfig {
    /// Create a new agent-based stage configuration.
    pub fn new(name: impl Into<String>, artifact: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            display_name: None,
            artifact: artifact.into(),
            inputs: Vec::new(),
            capabilities: StageCapabilities::default(),
            prompt: None, // Defaults to {name}.md via prompt_path()
            schema_file: None,
            script: None,
            is_automated: false,
            model: None,
        }
    }

    /// Create a new script-based stage configuration.
    pub fn new_script(
        name: impl Into<String>,
        artifact: impl Into<String>,
        command: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            display_name: None,
            artifact: artifact.into(),
            inputs: Vec::new(),
            capabilities: StageCapabilities::default(),
            prompt: None,
            schema_file: None,
            script: Some(ScriptStageConfig::new(command)),
            is_automated: false,
            model: None,
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

    /// Builder: set script configuration.
    #[must_use]
    pub fn with_script(mut self, script: ScriptStageConfig) -> Self {
        self.script = Some(script);
        self
    }

    /// Get the display name, falling back to capitalized name.
    pub fn display(&self) -> String {
        self.display_name
            .clone()
            .unwrap_or_else(|| capitalize(&self.name))
    }

    /// Check if this is a script stage.
    pub fn is_script_stage(&self) -> bool {
        self.script.is_some()
    }

    /// Check if this is an agent stage.
    pub fn is_agent_stage(&self) -> bool {
        !self.is_script_stage()
    }

    /// Get the script configuration if this is a script stage.
    pub fn script_config(&self) -> Option<&ScriptStageConfig> {
        self.script.as_ref()
    }

    /// Get the effective prompt template path for this stage.
    ///
    /// Returns `prompt` if set, otherwise `{name}.md`.
    /// Returns None for script stages.
    pub fn prompt_path(&self) -> Option<String> {
        if self.script.is_some() {
            return None;
        }

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
// Script Configuration
// ============================================================================

/// Configuration for a script-based stage.
///
/// Script stages run shell commands instead of spawning Claude agents.
/// Used for automated checks like linting, testing, and type checking.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScriptStageConfig {
    /// Shell command to execute (runs via `sh -c`).
    pub command: String,

    /// Timeout in seconds. Defaults to 120.
    #[serde(default = "default_script_timeout")]
    pub timeout_seconds: u32,

    /// Stage to transition to on script failure.
    /// If not specified, the task fails permanently.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_failure: Option<String>,
}

fn default_script_timeout() -> u32 {
    120
}

impl ScriptStageConfig {
    /// Create a new script configuration.
    pub fn new(command: impl Into<String>) -> Self {
        Self {
            command: command.into(),
            timeout_seconds: default_script_timeout(),
            on_failure: None,
        }
    }

    /// Builder: set timeout in seconds.
    #[must_use]
    pub fn with_timeout(mut self, seconds: u32) -> Self {
        self.timeout_seconds = seconds;
        self
    }

    /// Builder: set the stage to go to on failure.
    #[must_use]
    pub fn with_on_failure(mut self, stage: impl Into<String>) -> Self {
        self.on_failure = Some(stage.into());
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
        assert_eq!(stage.artifact, "plan");
        assert!(stage.inputs.is_empty());
        assert!(!stage.is_automated);
        assert!(stage.is_agent_stage());
        assert!(!stage.is_script_stage());
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
    fn test_prompt_path_script_stage() {
        let stage = StageConfig::new_script("checks", "check_results", "./run.sh");
        assert_eq!(stage.prompt_path(), None);
    }

    #[test]
    fn test_stage_with_prompt() {
        let stage = StageConfig::new("planning", "plan").with_prompt("planner.md");

        assert!(stage.is_agent_stage());
        assert!(!stage.is_script_stage());
        assert_eq!(stage.prompt, Some("planner.md".to_string()));
    }

    #[test]
    fn test_stage_with_script() {
        let stage = StageConfig::new_script("checks", "check_results", "./run_checks.sh")
            .with_inputs(vec!["summary".into()]);

        assert!(stage.is_script_stage());
        assert!(!stage.is_agent_stage());
        assert_eq!(stage.script_config().unwrap().command, "./run_checks.sh");
    }

    #[test]
    fn test_script_config() {
        let script = ScriptStageConfig::new("npm test")
            .with_timeout(300)
            .with_on_failure("work");

        assert_eq!(script.command, "npm test");
        assert_eq!(script.timeout_seconds, 300);
        assert_eq!(script.on_failure, Some("work".to_string()));
    }

    #[test]
    fn test_script_config_defaults() {
        let script = ScriptStageConfig::new("cargo test");
        assert_eq!(script.timeout_seconds, 120);
        assert!(script.on_failure.is_none());
    }

    #[test]
    fn test_script_stage_serialization() {
        let stage = StageConfig::new_script("lint", "lint_results", "npm run lint")
            .with_display_name("Linting");

        let yaml = serde_yaml::to_string(&stage).unwrap();
        assert!(yaml.contains("name: lint"));
        assert!(yaml.contains("command: npm run lint"));

        let parsed: StageConfig = serde_yaml::from_str(&yaml).unwrap();
        assert!(parsed.is_script_stage());
        assert_eq!(parsed.script_config().unwrap().command, "npm run lint");
    }

    #[test]
    fn test_schema_file_builder() {
        let stage = StageConfig::new("custom", "output").with_schema_file("custom_schema.json");

        assert_eq!(stage.schema_file, Some("custom_schema.json".to_string()));
    }
}
