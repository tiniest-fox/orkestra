//! Execution layer for the workflow system.
//!
//! This module provides components for executing workflow stages:
//!
//! - **`StageOutput`**: Parsed output from agents (artifacts, questions, approval, etc.)
//! - **`AgentRunner`**: Runs agents via `ProcessSpawner`
//! - **`ScriptHandle`**: Async script execution for script-based stages
//! - **`PromptBuilder`**: Generates prompts from workflow configuration
//! - **`ProviderRegistry`**: Maps provider names to `ProcessSpawner` implementations
//! - **parser**: Agent output parsing with provider-specific extraction

mod prompt;

pub use crate::workflow::stage::{deduplicate_activity_logs_by_stage, ActivityLogEntry};
pub use orkestra_parser::{
    AgentParser, ClaudeParserService as ClaudeAgentParser,
    OpenCodeParserService as OpenCodeAgentParser, StageOutput, StageOutputError, SubtaskOutput,
};
pub use prompt::{
    build_resume_prompt, build_user_message, determine_resume_type, get_agent_schema,
    load_agent_definition, resolve_stage_agent_config_for, sibling_status_display,
    AgentConfigError, ArtifactContext, FlowOverrides, IntegrationErrorContext, PrComment,
    PromptBuilder, QuestionAnswerContext, ResolvedAgentConfig, ResumeQuestionAnswer, ResumeType,
    SiblingTaskContext, StagePromptContext,
};

// Re-exports from orkestra-agent (backward-compatible aliases)
pub use orkestra_agent::AgentRunner as AgentRunnerTrait;
pub use orkestra_agent::ProcessAgentRunner as AgentRunner;
pub use orkestra_agent::{
    claudecode_aliases, claudecode_capabilities, opencode_aliases, opencode_capabilities,
    ProviderCapabilities, ProviderRegistry, RegistryError, ResolvedProvider, RunConfig, RunError,
    RunEvent, RunResult, ScriptEnv, ScriptHandle, ScriptPollState, ScriptResult,
};

#[cfg(any(test, feature = "testutil"))]
pub use orkestra_agent::{default_test_registry, MockAgentRunner};
