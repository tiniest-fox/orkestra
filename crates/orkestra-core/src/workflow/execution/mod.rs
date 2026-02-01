//! Execution layer for the workflow system.
//!
//! This module provides components for executing workflow stages:
//!
//! - **`StageOutput`**: Parsed output from agents (artifacts, questions, restage, etc.)
//! - **`AgentRunner`**: Runs agents via `ProcessSpawner`
//! - **`ScriptHandle`**: Async script execution for script-based stages
//! - **`PromptBuilder`**: Generates prompts from workflow configuration
//! - **`ProviderRegistry`**: Maps provider names to `ProcessSpawner` implementations
//! - **parser**: Output parsing utilities

mod output;
mod parser;
mod prompt;
mod provider_registry;
mod runner;
mod script_runner;

pub use output::{StageOutput, StageOutputError, SubtaskOutput};
pub use parser::parse_agent_output;
pub use prompt::{
    build_complete_prompt, build_resume_prompt, determine_resume_type, get_agent_schema,
    load_agent_definition, resolve_stage_agent_config, resolve_stage_agent_config_for,
    AgentConfigError, ArtifactContext, FlowOverrides, IntegrationErrorContext, PromptBuilder,
    QuestionAnswerContext, ResolvedAgentConfig, ResumeQuestionAnswer, ResumeType,
    StagePromptContext,
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
