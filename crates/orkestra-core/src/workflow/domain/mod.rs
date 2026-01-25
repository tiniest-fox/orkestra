//! Domain types for workflow tasks.
//!
//! These types represent the runtime state of tasks in the workflow system.
//! They use the stage-agnostic primitives from `workflow::runtime`.

mod iteration;
mod question;
mod task;

pub use iteration::Iteration;
pub use question::{Question, QuestionAnswer, QuestionOption};
pub use task::Task;
