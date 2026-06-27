//! Workflow configuration and project environment types.
//!
//! Pure data types defining the structure of a workflow as loaded from YAML,
//! plus project environment metadata. No I/O or storage dependencies.

pub mod models;
pub mod project;
pub mod stage;
pub mod workflow;

/// Virtual stage name for vibe mode — not a real pipeline stage.
pub const VIBE_STAGE: &str = "vibe";

pub use project::{ProjectInfo, RUN_SCRIPT_RELATIVE_PATH};
pub use stage::{
    ArtifactConfig, GateConfig, StageCapabilities, StageConfig, SubtaskCapabilities,
    ToolRestriction,
};
pub use workflow::{FlowConfig, IntegrationConfig, VibeConfig, WorkflowConfig};
