//! Domain types for workflow tasks.
//!
//! These types represent the runtime state of tasks in the workflow system.
//! They use the stage-agnostic primitives from `runtime`.

mod assistant_session;
mod iteration;
mod log_entry;
mod question;
mod stage_session;
pub(crate) mod task;

pub use assistant_session::AssistantSession;
pub use iteration::{GateResult, Iteration, IterationTrigger, PrCommentData};
pub use log_entry::{LogEntry, OrkAction, TodoItem, ToolInput};
pub use question::{Question, QuestionAnswer, QuestionOption};
pub use stage_session::{SessionState, StageSession};
pub use task::{extract_short_id, Task, TaskHeader, TickSnapshot};
