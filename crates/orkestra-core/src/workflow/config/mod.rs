//! Workflow configuration.
//!
//! Config types live in `orkestra-types::config` and are re-exported here.
//! I/O operations (loading from disk) stay local.

mod auto_task;
mod loader;

// Re-export config types from orkestra-types
pub use orkestra_types::config::stage;
pub use orkestra_types::config::workflow;

pub use orkestra_types::config::{
    ApprovalCapabilities, FlowConfig, GateConfig, IntegrationConfig, StageCapabilities,
    StageConfig, SubtaskCapabilities, ToolRestriction, WorkflowConfig,
};

// Local I/O operations
pub use auto_task::{load_auto_task_templates, AutoTaskTemplate};
pub use loader::{load_workflow, load_workflow_for_project, LoadError};
