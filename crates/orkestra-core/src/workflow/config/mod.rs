//! Workflow configuration types.
//!
//! These types define the structure of a workflow as loaded from YAML.
//! They are pure data types with no behavior beyond serialization.

mod auto_task;
mod loader;
mod stage;
mod workflow;

pub use auto_task::{load_auto_task_templates, AutoTaskTemplate};
pub use loader::{load_workflow, load_workflow_for_project, LoadError};
pub use stage::{
    ScriptStageConfig, StageCapabilities, StageConfig, SubtaskCapabilities, ToolRestriction,
};
pub use workflow::{
    FlowConfig, FlowStageEntry, FlowStageOverride, IntegrationConfig, WorkflowConfig,
    WorkflowStageEntry,
};
