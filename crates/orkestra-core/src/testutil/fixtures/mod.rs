//! Composable test fixtures organized by domain type.
//!
//! Each sub-module provides factory functions that create and persist
//! domain objects through a `WorkflowStore`. Tests compose them freely:
//!
//! ```ignore
//! use orkestra_core::testutil::fixtures::{tasks, sessions, iterations};
//!
//! let task = tasks::save_planning_task(&store, "t1")?;
//! let sess = sessions::save_session(&store, "s1", "t1", "planning")?;
//! let iter = iterations::save_iteration(&store, "i1", "t1", "planning", 1, "s1")?;
//! ```

pub mod iterations;
pub mod sessions;
pub mod tasks;

/// Deterministic timestamp for test fixtures.
pub const FIXTURE_TIMESTAMP: &str = "2025-01-24T10:00:00Z";

/// Build the standard 4-stage workflow used by most tests.
///
/// This is the same pipeline that `WorkflowConfig` previously provided as
/// its `Default` impl: planning → breakdown → work → review, with a
/// "subtask" flow for child tasks.
pub fn test_default_workflow() -> crate::workflow::config::WorkflowConfig {
    use crate::workflow::config::{
        FlowConfig, GateConfig, IntegrationConfig, StageCapabilities, StageConfig,
        SubtaskCapabilities, WorkflowConfig,
    };
    use indexmap::IndexMap;

    let mut flows = IndexMap::new();
    flows.insert(
        "subtask".to_string(),
        FlowConfig {
            stages: vec![
                StageConfig::new("work", "summary")
                    .with_prompt("worker.md")
                    .with_gate(GateConfig::Agentic),
                StageConfig::new("review", "verdict")
                    .with_prompt("reviewer.md")
                    .with_gate(GateConfig::Agentic),
            ],
            integration: IntegrationConfig::new("work"),
        },
    );

    WorkflowConfig::new(vec![
        StageConfig::new("planning", "plan")
            .with_prompt("planner.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("breakdown", "breakdown")
            .with_prompt("breakdown.md")
            .with_gate(GateConfig::Agentic)
            .with_capabilities(StageCapabilities {
                subtasks: Some(SubtaskCapabilities::default().with_flow("subtask")),
            }),
        StageConfig::new("work", "summary")
            .with_prompt("worker.md")
            .with_gate(GateConfig::Agentic),
        StageConfig::new("review", "verdict")
            .with_prompt("reviewer.md")
            .with_gate(GateConfig::Agentic),
    ])
    .with_integration(IntegrationConfig::new("work"))
    .with_flows(flows)
}
