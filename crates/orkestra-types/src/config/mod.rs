//! Workflow configuration and project environment types.
//!
//! Pure data types defining the structure of a workflow as loaded from YAML,
//! plus project environment metadata. No I/O or storage dependencies.

pub mod models;
pub mod project;
pub mod stage;
pub mod workflow;

pub use project::{ProjectInfo, RUN_SCRIPT_RELATIVE_PATH};
pub use stage::{
    ArtifactConfig, GateConfig, StageCapabilities, StageConfig, SubtaskCapabilities,
    ToolRestriction,
};
pub use workflow::{FlowConfig, IntegrationConfig, WorkflowConfig};
