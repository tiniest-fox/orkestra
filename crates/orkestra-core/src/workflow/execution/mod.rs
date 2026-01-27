//! Execution layer for the workflow system.
//!
//! This module provides components for executing workflow stages:
//!
//! - **`StageOutput`**: Parsed output from agents (artifacts, questions, restage, etc.)
//! - **`AgentRunner`**: Runs agents via `ProcessSpawner`
//! - **`ScriptHandle`**: Async script execution for script-based stages
//! - **`PromptBuilder`**: Generates prompts from workflow configuration
//! - **parser**: Output parsing utilities

mod breakdown;
mod output;
mod parser;
mod prompt;
mod runner;
mod script_runner;

pub use breakdown::subtasks_to_markdown;
pub use output::{StageOutput, StageOutputError, SubtaskOutput};
pub use parser::parse_agent_output;
pub use prompt::{
    build_complete_prompt, build_resume_prompt, determine_resume_type, get_agent_schema,
    load_agent_definition, resolve_stage_agent_config, AgentConfigError, ArtifactContext,
    IntegrationErrorContext, PromptBuilder, QuestionAnswerContext, ResolvedAgentConfig,
    ResumeQuestionAnswer, ResumeType, StagePromptContext,
};
pub use runner::{AgentRunner, AgentRunnerTrait, RunConfig, RunError, RunEvent, RunResult};
pub use script_runner::{ScriptEnv, ScriptHandle, ScriptResult};

#[cfg(any(test, feature = "testutil"))]
pub use runner::mock::MockAgentRunner;
