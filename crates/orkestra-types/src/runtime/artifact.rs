//! Artifact storage and retrieval.
//!
//! Artifacts are named outputs from stages. Each stage produces an artifact
//! (e.g., "plan", "summary") that can be consumed by later stages.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::markdown::markdown_to_html;

/// The relative directory path for materialized artifact files.
const ARTIFACTS_DIR: &str = ".orkestra/.artifacts";

/// The artifact name used for the materialized activity log file.
pub const ACTIVITY_LOG_ARTIFACT_NAME: &str = "activity_log";

/// Returns the relative directory path for materialized artifact files.
///
/// This is the canonical definition of the artifacts directory path.
pub fn artifacts_directory() -> &'static str {
    ARTIFACTS_DIR
}

/// Returns the relative file path for a named artifact.
///
/// Artifacts are materialized to the worktree before agent spawn.
/// This is the canonical definition of the artifact path format.
///
/// # Example
/// ```
/// use orkestra_types::runtime::artifact_file_path;
/// assert_eq!(artifact_file_path("plan"), ".orkestra/.artifacts/plan.md");
/// ```
///
/// # Panics
/// Panics if `name` contains path separators (`/`, `\`) or parent references (`..`).
pub fn artifact_file_path(name: &str) -> String {
    assert!(
        !name.contains('/') && !name.contains('\\') && !name.contains(".."),
        "artifact name must not contain path separators or parent references: {name}"
    );
    format!("{ARTIFACTS_DIR}/{name}.md")
}

/// Returns the absolute file path for a named artifact, given the worktree path.
///
/// Use this when constructing artifact paths for display in agent prompts.
/// The absolute path removes ambiguity when agents run in nested worktrees.
///
/// # Example
/// ```
/// use orkestra_types::runtime::absolute_artifact_file_path;
/// assert_eq!(
///     absolute_artifact_file_path("/path/to/worktree", "plan"),
///     "/path/to/worktree/.orkestra/.artifacts/plan.md"
/// );
/// ```
///
/// # Panics
/// Panics if `name` contains path separators (`/`, `\`) or parent references (`..`).
pub fn absolute_artifact_file_path(worktree_path: &str, name: &str) -> String {
    use std::path::Path;
    Path::new(worktree_path)
        .join(artifact_file_path(name))
        .to_string_lossy()
        .into_owned()
}

/// A named artifact produced by a stage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Artifact {
    /// Name of the artifact (e.g., "plan", "summary").
    pub name: String,

    /// The artifact content (markdown).
    pub content: String,

    /// Pre-rendered HTML from the markdown content.
    /// Populated at write time; computed on-the-fly for older artifacts missing it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,

    /// Which stage produced this artifact.
    pub stage: String,

    /// When the artifact was created (RFC3339).
    pub created_at: String,

    /// Which iteration produced this artifact.
    #[serde(default)]
    pub iteration: u32,
}

impl Artifact {
    /// Create a new artifact with pre-rendered HTML.
    pub fn new(
        name: impl Into<String>,
        content: impl Into<String>,
        stage: impl Into<String>,
        created_at: impl Into<String>,
    ) -> Self {
        let content = content.into();
        let html = Some(markdown_to_html(&content));
        Self {
            name: name.into(),
            content,
            html,
            stage: stage.into(),
            created_at: created_at.into(),
            iteration: 1,
        }
    }

    /// Create an artifact with a specific iteration.
    #[must_use]
    pub fn with_iteration(mut self, iteration: u32) -> Self {
        self.iteration = iteration;
        self
    }
}

/// Collection of artifacts for a task.
///
/// Provides convenient access to artifacts by name.
/// Serializes as a flat map of artifact name to artifact.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(transparent)]
pub struct ArtifactStore {
    /// Artifacts keyed by name.
    artifacts: HashMap<String, Artifact>,
}

impl ArtifactStore {
    /// Create a new empty artifact store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Store an artifact, replacing any existing artifact with the same name.
    pub fn set(&mut self, artifact: Artifact) {
        self.artifacts.insert(artifact.name.clone(), artifact);
    }

    /// Get an artifact by name.
    pub fn get(&self, name: &str) -> Option<&Artifact> {
        self.artifacts.get(name)
    }

    /// Get the content of an artifact by name.
    pub fn content(&self, name: &str) -> Option<&str> {
        self.artifacts.get(name).map(|a| a.content.as_str())
    }

    /// Remove an artifact by name.
    pub fn remove(&mut self, name: &str) -> Option<Artifact> {
        self.artifacts.remove(name)
    }

    /// Check if an artifact exists.
    pub fn contains(&self, name: &str) -> bool {
        self.artifacts.contains_key(name)
    }

    /// Get all artifact names.
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.artifacts.keys().map(String::as_str)
    }

    /// Get all artifacts.
    pub fn all(&self) -> impl Iterator<Item = &Artifact> {
        self.artifacts.values()
    }

    /// Get the number of artifacts.
    pub fn len(&self) -> usize {
        self.artifacts.len()
    }

    /// Check if the store is empty.
    pub fn is_empty(&self) -> bool {
        self.artifacts.is_empty()
    }

    /// Get multiple artifacts by name, in order.
    /// Missing artifacts are skipped.
    pub fn get_many(&self, names: &[String]) -> Vec<&Artifact> {
        names
            .iter()
            .filter_map(|name| self.artifacts.get(name))
            .collect()
    }

    /// Check if all required artifacts are present.
    pub fn has_all(&self, names: &[String]) -> bool {
        names.iter().all(|name| self.artifacts.contains_key(name))
    }

    /// Get missing artifact names from a list.
    pub fn missing<'a>(&self, names: &'a [String]) -> Vec<&'a str> {
        names
            .iter()
            .filter(|name| !self.artifacts.contains_key(*name))
            .map(String::as_str)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_artifact_new() {
        let artifact = Artifact::new(
            "plan",
            "My plan content",
            "planning",
            "2025-01-01T00:00:00Z",
        );

        assert_eq!(artifact.name, "plan");
        assert_eq!(artifact.content, "My plan content");
        assert_eq!(artifact.stage, "planning");
        assert_eq!(artifact.iteration, 1);
    }

    #[test]
    fn test_artifact_with_iteration() {
        let artifact = Artifact::new("plan", "content", "planning", "now").with_iteration(3);
        assert_eq!(artifact.iteration, 3);
    }

    #[test]
    fn test_artifact_store_basic() {
        let mut store = ArtifactStore::new();
        assert!(store.is_empty());

        let artifact = Artifact::new("plan", "content", "planning", "now");
        store.set(artifact);

        assert_eq!(store.len(), 1);
        assert!(!store.is_empty());
        assert!(store.contains("plan"));
        assert!(!store.contains("summary"));
    }

    #[test]
    fn test_artifact_store_get() {
        let mut store = ArtifactStore::new();
        store.set(Artifact::new("plan", "My plan", "planning", "now"));

        let artifact = store.get("plan");
        assert!(artifact.is_some());
        assert_eq!(artifact.unwrap().content, "My plan");

        let content = store.content("plan");
        assert_eq!(content, Some("My plan"));

        assert!(store.get("missing").is_none());
        assert!(store.content("missing").is_none());
    }

    #[test]
    fn test_artifact_store_replace() {
        let mut store = ArtifactStore::new();
        store.set(Artifact::new("plan", "First plan", "planning", "now"));
        store.set(Artifact::new("plan", "Updated plan", "planning", "later"));

        assert_eq!(store.len(), 1);
        assert_eq!(store.content("plan"), Some("Updated plan"));
    }

    #[test]
    fn test_artifact_store_remove() {
        let mut store = ArtifactStore::new();
        store.set(Artifact::new("plan", "content", "planning", "now"));

        let removed = store.remove("plan");
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().content, "content");
        assert!(store.is_empty());

        assert!(store.remove("missing").is_none());
    }

    #[test]
    fn test_artifact_store_names() {
        let mut store = ArtifactStore::new();
        store.set(Artifact::new("plan", "p", "planning", "now"));
        store.set(Artifact::new("summary", "s", "work", "now"));

        let names: Vec<_> = store.names().collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"plan"));
        assert!(names.contains(&"summary"));
    }

    #[test]
    fn test_artifact_store_get_many() {
        let mut store = ArtifactStore::new();
        store.set(Artifact::new("plan", "p", "planning", "now"));
        store.set(Artifact::new("summary", "s", "work", "now"));
        store.set(Artifact::new("verdict", "v", "review", "now"));

        let artifacts = store.get_many(&["plan".into(), "summary".into()]);
        assert_eq!(artifacts.len(), 2);

        // Missing artifacts are skipped
        let artifacts = store.get_many(&["plan".into(), "missing".into()]);
        assert_eq!(artifacts.len(), 1);
    }

    #[test]
    fn test_artifact_store_has_all() {
        let mut store = ArtifactStore::new();
        store.set(Artifact::new("plan", "p", "planning", "now"));
        store.set(Artifact::new("summary", "s", "work", "now"));

        assert!(store.has_all(&["plan".into()]));
        assert!(store.has_all(&["plan".into(), "summary".into()]));
        assert!(!store.has_all(&["plan".into(), "missing".into()]));
    }

    #[test]
    fn test_artifact_store_missing() {
        let mut store = ArtifactStore::new();
        store.set(Artifact::new("plan", "p", "planning", "now"));

        let names: Vec<String> = vec!["plan".into(), "summary".into(), "verdict".into()];
        let missing = store.missing(&names);
        assert_eq!(missing, vec!["summary", "verdict"]);
    }

    #[test]
    fn test_artifact_serialization() {
        let artifact = Artifact::new("plan", "content", "planning", "2025-01-01T00:00:00Z");
        let json = serde_json::to_string(&artifact).unwrap();

        assert!(json.contains("\"name\":\"plan\""));
        assert!(json.contains("\"content\":\"content\""));

        let parsed: Artifact = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, artifact);
    }

    #[test]
    fn test_artifact_store_serialization() {
        let mut store = ArtifactStore::new();
        store.set(Artifact::new("plan", "content", "planning", "now"));

        let json = serde_json::to_string(&store).unwrap();
        let parsed: ArtifactStore = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.content("plan"), Some("content"));
    }

    #[test]
    fn test_artifact_file_path() {
        assert_eq!(artifact_file_path("plan"), ".orkestra/.artifacts/plan.md");
        assert_eq!(
            artifact_file_path("summary"),
            ".orkestra/.artifacts/summary.md"
        );
    }

    #[test]
    fn test_absolute_artifact_file_path() {
        assert_eq!(
            absolute_artifact_file_path("/path/to/worktree", "plan"),
            "/path/to/worktree/.orkestra/.artifacts/plan.md"
        );
        assert_eq!(
            absolute_artifact_file_path("/home/user/project", "summary"),
            "/home/user/project/.orkestra/.artifacts/summary.md"
        );
    }

    #[test]
    #[should_panic(expected = "artifact name must not contain path separators")]
    fn test_artifact_file_path_rejects_slash() {
        artifact_file_path("foo/bar");
    }

    #[test]
    #[should_panic(expected = "artifact name must not contain path separators")]
    fn test_artifact_file_path_rejects_backslash() {
        artifact_file_path("foo\\bar");
    }

    #[test]
    #[should_panic(expected = "artifact name must not contain path separators")]
    fn test_artifact_file_path_rejects_parent_ref() {
        artifact_file_path("..plan");
    }

    #[test]
    fn test_artifacts_directory() {
        assert_eq!(artifacts_directory(), ".orkestra/.artifacts");
    }
}
