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

mod output;
pub mod parser;
mod prompt;
mod provider_registry;
mod runner;
mod script_runner;

pub use output::{StageOutput, StageOutputError, SubtaskOutput};
pub use parser::{AgentParser, ClaudeAgentParser, OpenCodeAgentParser};
pub use prompt::{
    build_complete_prompt, build_resume_prompt, build_system_prompt, build_user_message,
    determine_resume_type, get_agent_schema, load_agent_definition, resolve_stage_agent_config,
    resolve_stage_agent_config_for, ActivityLogEntry, AgentConfigError, ArtifactContext,
    FlowOverrides, IntegrationErrorContext, PromptBuilder, QuestionAnswerContext,
    ResolvedAgentConfig, ResumeQuestionAnswer, ResumeType, StagePromptContext,
};
pub use provider_registry::{
    claudecode_aliases, claudecode_capabilities, opencode_aliases, opencode_capabilities,
    ProviderCapabilities, ProviderRegistry, RegistryError, ResolvedProvider,
};
pub use runner::{AgentRunner, AgentRunnerTrait, RunConfig, RunError, RunEvent, RunResult};
pub use script_runner::{ScriptEnv, ScriptHandle, ScriptPollState, ScriptResult};

#[cfg(any(test, feature = "testutil"))]
pub use provider_registry::default_test_registry;
#[cfg(any(test, feature = "testutil"))]
pub use runner::mock::MockAgentRunner;
