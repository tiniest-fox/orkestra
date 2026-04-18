//! Domain types for workflow tasks.
//!
//! These types represent the runtime state of tasks in the workflow system.
//! They use the stage-agnostic primitives from `runtime`.

mod artifact;
mod assistant_session;
mod check_status;
mod iteration;
mod log_entry;
mod question;
mod stage_session;
pub(crate) mod task;

pub use artifact::WorkflowArtifact;
pub use assistant_session::{AssistantSession, SessionType};
pub use check_status::{classify_check, CheckStatus};
pub use iteration::{GateResult, Iteration, IterationTrigger, PrCheckData, PrCommentData};
pub use log_entry::{AnnotatedLogEntry, LogEntry, OrkAction, PromptSection, TodoItem, ToolInput};
pub use question::{Question, QuestionAnswer, QuestionOption};
pub use stage_session::{SessionState, StageSession};
pub use task::{extract_short_id, Task, TaskCreationMode, TaskHeader, TickSnapshot};
