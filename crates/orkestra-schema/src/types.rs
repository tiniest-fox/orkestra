//! Schema generation configuration types.

/// Configuration for schema generation.
///
/// Callers construct this from their stage configuration types.
/// The schema crate only needs these boolean flags — it doesn't
/// depend on the full `StageCapabilities` type.
#[derive(Debug, Clone)]
pub struct SchemaConfig<'a> {
    /// Name of the artifact this stage produces.
    pub artifact_name: &'a str,
    /// Whether the stage can ask clarifying questions.
    pub ask_questions: bool,
    /// Whether the stage produces subtasks.
    pub produces_subtasks: bool,
    /// Whether the stage has approval capability.
    pub has_approval: bool,
}
