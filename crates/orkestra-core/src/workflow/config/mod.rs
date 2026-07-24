//! Workflow configuration.
//!
//! Config types live in `orkestra-types::config` and are re-exported here.
//! I/O operations (loading from disk) stay local.

mod auto_task;
mod loader;
pub mod technique;

/// Split a markdown file into YAML frontmatter and body.
///
/// Expects the file to start with `---`, followed by YAML, then `---`,
/// then the body content.
pub(crate) fn split_frontmatter(content: &str) -> Option<(&str, &str)> {
    let content = content.strip_prefix("---")?;
    let end = content.find("\n---")?;
    let frontmatter = content[..end].trim();
    let body = content[end + 4..].trim(); // skip past "\n---"
    Some((frontmatter, body))
}

// Re-export config types from orkestra-types
pub use orkestra_types::config::stage;
pub use orkestra_types::config::workflow;

pub use orkestra_types::config::{
    FlowConfig, GateConfig, IntegrationConfig, StageCapabilities, StageConfig, SubtaskCapabilities,
    ToolRestriction, VibeConfig, WorkflowConfig,
};

// Local I/O operations
pub use auto_task::{load_auto_task_templates, AutoTaskTemplate};
pub use loader::{load_workflow, load_workflow_for_project, LoadError};
pub use technique::{
    parse_check_metadata, parse_model_registry, parse_technique, resolve_checks,
    resolve_disallowed_tools, resolve_model, CheckMetadata, ModelRegistry, Technique,
    TechniqueLoadError,
};
