//! Pure prompt building for orkestra.
//!
//! Assembles prompts from workflow configuration and task state.
//! No filesystem I/O — template loading and agent definition reading
//! stay in orkestra-core.

pub mod interactions;
pub mod service;
pub mod types;

// Re-export public API
pub use interactions::build::context::PromptBuilder;
pub use service::PromptService;
pub use types::{
    sibling_status_display, AgentConfigError, IntegrationErrorContext, PrCheckContext, PrComment,
    QuestionAnswerContext, ResolvedAgentConfig, ResumeQuestionAnswer, ResumeType,
    SiblingTaskContext, StagePromptContext, WorkflowStageEntry,
};
