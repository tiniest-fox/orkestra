//! Workflow configuration types.
//!
//! These types define the structure of a workflow as loaded from YAML.
//! They are pure data types with no behavior beyond serialization.

mod loader;
mod stage;
mod workflow;

pub use loader::{load_workflow, load_workflow_for_project, LoadError};
pub use stage::{AgentStageConfig, StageCapabilities, StageConfig};
pub use workflow::{IntegrationConfig, WorkflowConfig};
