//! Execution layer for the workflow system.
//!
//! This module provides components for executing workflow stages:
//!
//! - **StageOutput**: Parsed output from agents (artifacts, questions, restage, etc.)
//! - **AgentSpawner**: Trait for spawning agents (port)
//! - **PromptBuilder**: Generates prompts from workflow configuration

mod output;
mod prompt;
mod spawner;

pub use output::{StageOutput, StageOutputError};
pub use prompt::{
    build_complete_prompt, get_agent_schema, load_agent_definition, resolve_stage_agent_config,
    AgentConfigError, ArtifactContext, IntegrationErrorContext, PromptBuilder,
    QuestionAnswerContext, ResolvedAgentConfig, StagePromptContext,
};
pub use spawner::{AgentCompletionCallback, AgentSpawner, SpawnError, SpawnResult};

#[cfg(any(test, feature = "testutil"))]
pub use spawner::mock::MockSpawner;
