//! Runtime types for workflow execution.
//!
//! These types are used during task execution to track state and outcomes.
//! They are stage-agnostic and work with any workflow configuration.

mod artifact;
mod outcome;
mod status;
mod transition;

pub use artifact::{Artifact, ArtifactStore};
pub use outcome::Outcome;
pub use status::{Phase, Status};
pub use transition::{Transition, TransitionError, TransitionTrigger, TransitionValidator};
