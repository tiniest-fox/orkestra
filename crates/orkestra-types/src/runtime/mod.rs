//! Runtime types for workflow execution.
//!
//! These types are used during task execution to track state and outcomes.
//! They are stage-agnostic and work with any workflow configuration.

mod artifact;
mod markdown;
mod outcome;
mod resource;
mod status;

pub use artifact::{
    absolute_artifact_file_path, artifact_file_path, artifacts_directory, resolve_artifact_path,
    Artifact, ArtifactStore, ACTIVITY_LOG_ARTIFACT_NAME, TASK_ARTIFACT_NAME,
};
pub use markdown::markdown_to_html;
pub use outcome::Outcome;
pub use resource::{Resource, ResourceStore, RESOURCES_ARTIFACT_NAME};
pub use status::TaskState;
