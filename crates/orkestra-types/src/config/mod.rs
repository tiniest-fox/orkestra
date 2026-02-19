//! Workflow configuration types.
//!
//! Pure data types defining the structure of a workflow as loaded from YAML.
//! No I/O or storage dependencies — just types, serialization, and validation.

pub mod stage;
pub mod workflow;

pub use stage::{
    ApprovalCapabilities, ArtifactConfig, ScriptStageConfig, StageCapabilities, StageConfig,
    SubtaskCapabilities, ToolRestriction,
};
pub use workflow::{
    FlowConfig, FlowIntegrationOverride, FlowStageEntry, FlowStageOverride, IntegrationConfig,
    WorkflowConfig,
};
