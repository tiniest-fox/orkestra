//! Schema generation configuration types.

/// Configuration for schema generation.
///
/// Callers construct this from their stage configuration types.
/// The schema crate only needs these flags — it doesn't depend on
/// the full `StageCapabilities` type.
#[derive(Debug, Clone)]
pub struct SchemaConfig<'a> {
    /// Name of the artifact this stage produces.
    pub artifact_name: &'a str,
    /// Whether the stage produces subtasks.
    pub produces_subtasks: bool,
    /// Whether the stage has approval capability (agentic gate).
    pub has_approval: bool,
    /// Valid stage names for the `route_to` field on approval output.
    /// When non-empty and `has_approval` is true, a `route_to` enum property is added.
    pub route_to_stages: &'a [String],
}
