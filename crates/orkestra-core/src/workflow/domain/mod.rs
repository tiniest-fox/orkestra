//! Domain types for workflow tasks.
//!
//! These types represent the runtime state of tasks in the workflow system.
//! They use the stage-agnostic primitives from `workflow::runtime`.

mod iteration;
mod log_entry;
mod question;
mod stage_session;
pub(crate) mod task;
pub(crate) mod task_view;

pub use iteration::{Iteration, IterationTrigger};
pub use log_entry::{LogEntry, OrkAction, TodoItem, ToolInput};
pub use question::{Question, QuestionAnswer, QuestionOption};
pub use stage_session::{SessionState, StageSession};
pub use task::Task;
pub use task_view::{DerivedTaskState, PendingRejection, SubtaskProgress, TaskView};
