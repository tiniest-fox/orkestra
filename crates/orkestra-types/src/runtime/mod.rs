//! Runtime types for workflow execution.
//!
//! These types are used during task execution to track state and outcomes.
//! They are stage-agnostic and work with any workflow configuration.

mod artifact;
mod markdown;
mod outcome;
mod status;

pub use artifact::{Artifact, ArtifactStore};
pub use markdown::markdown_to_html;
pub use outcome::Outcome;
pub use status::{ParsePhaseError, Phase, Status};
