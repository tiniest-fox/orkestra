//! Resource storage and retrieval.
//!
//! Resources are named external references (URLs, file paths) registered by agents.
//! They persist at the task level and are visible to all subsequent stages.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// A named external resource registered by an agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Resource {
    /// Unique name for this resource (used as key).
    pub name: String,

    /// URL or file path.
    pub url: String,

    /// What this resource is and why it matters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Which stage registered this resource.
    pub stage: String,

    /// When the resource was registered (RFC3339).
    pub created_at: String,
}

impl Resource {
    /// Create a new resource.
    pub fn new(
        name: impl Into<String>,
        url: impl Into<String>,
        description: Option<impl Into<String>>,
        stage: impl Into<String>,
        created_at: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            url: url.into(),
            description: description.map(Into::into),
            stage: stage.into(),
            created_at: created_at.into(),
        }
    }
}

/// Collection of resources for a task.
///
/// Provides convenient access to resources by name.
/// Serializes as a flat map of resource name to resource.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(transparent)]
pub struct ResourceStore {
    /// Resources keyed by name.
    resources: HashMap<String, Resource>,
}

impl ResourceStore {
    /// Create a new empty resource store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Store a resource, replacing any existing resource with the same name.
    pub fn set(&mut self, resource: Resource) {
        self.resources.insert(resource.name.clone(), resource);
    }

    /// Get a resource by name.
    pub fn get(&self, name: &str) -> Option<&Resource> {
        self.resources.get(name)
    }

    /// Get all resources.
    pub fn all(&self) -> impl Iterator<Item = &Resource> {
        self.resources.values()
    }

    /// Check if the store is empty.
    pub fn is_empty(&self) -> bool {
        self.resources.is_empty()
    }

    /// Get the number of resources.
    pub fn len(&self) -> usize {
        self.resources.len()
    }

    /// Copy all resources from another store, overwriting on name collision.
    pub fn merge_from(&mut self, other: &ResourceStore) {
        for (name, resource) in &other.resources {
            self.resources.insert(name.clone(), resource.clone());
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resource_new() {
        let resource = Resource::new(
            "design-doc",
            "https://docs.example.com/design",
            Some("Architecture decision record"),
            "planning",
            "2025-01-01T00:00:00Z",
        );

        assert_eq!(resource.name, "design-doc");
        assert_eq!(resource.url, "https://docs.example.com/design");
        assert_eq!(
            resource.description,
            Some("Architecture decision record".to_string())
        );
        assert_eq!(resource.stage, "planning");
        assert_eq!(resource.created_at, "2025-01-01T00:00:00Z");
    }

    #[test]
    fn test_resource_new_without_description() {
        let resource = Resource::new(
            "screenshot",
            "/tmp/screenshot.png",
            None::<String>,
            "work",
            "now",
        );

        assert_eq!(resource.name, "screenshot");
        assert!(resource.description.is_none());
    }

    #[test]
    fn test_resource_store_basic() {
        let mut store = ResourceStore::new();
        assert!(store.is_empty());
        assert_eq!(store.len(), 0);

        let resource = Resource::new(
            "doc",
            "https://example.com",
            None::<String>,
            "planning",
            "now",
        );
        store.set(resource);

        assert_eq!(store.len(), 1);
        assert!(!store.is_empty());
    }

    #[test]
    fn test_resource_store_get() {
        let mut store = ResourceStore::new();
        store.set(Resource::new(
            "doc",
            "https://example.com",
            None::<String>,
            "planning",
            "now",
        ));

        let resource = store.get("doc");
        assert!(resource.is_some());
        assert_eq!(resource.unwrap().url, "https://example.com");

        assert!(store.get("missing").is_none());
    }

    #[test]
    fn test_resource_store_upsert() {
        let mut store = ResourceStore::new();
        store.set(Resource::new(
            "doc",
            "https://v1.example.com",
            None::<String>,
            "planning",
            "now",
        ));
        store.set(Resource::new(
            "doc",
            "https://v2.example.com",
            None::<String>,
            "work",
            "later",
        ));

        assert_eq!(store.len(), 1);
        assert_eq!(store.get("doc").unwrap().url, "https://v2.example.com");
    }

    #[test]
    fn test_resource_store_all() {
        let mut store = ResourceStore::new();
        store.set(Resource::new(
            "doc1",
            "https://a.com",
            None::<String>,
            "planning",
            "now",
        ));
        store.set(Resource::new(
            "doc2",
            "https://b.com",
            None::<String>,
            "work",
            "now",
        ));

        let all: Vec<_> = store.all().collect();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_resource_store_merge_from() {
        let mut store_a = ResourceStore::new();
        store_a.set(Resource::new(
            "doc1",
            "https://a.com",
            None::<String>,
            "planning",
            "now",
        ));
        store_a.set(Resource::new(
            "shared",
            "https://a-shared.com",
            None::<String>,
            "planning",
            "now",
        ));

        let mut store_b = ResourceStore::new();
        store_b.set(Resource::new(
            "doc2",
            "https://b.com",
            None::<String>,
            "work",
            "now",
        ));
        store_b.set(Resource::new(
            "shared",
            "https://b-shared.com",
            None::<String>,
            "work",
            "later",
        ));

        store_a.merge_from(&store_b);

        // Both doc1 and doc2 should be present
        assert_eq!(store_a.len(), 3);
        assert!(store_a.get("doc1").is_some());
        assert!(store_a.get("doc2").is_some());

        // store_b's "shared" overwrites store_a's "shared"
        assert_eq!(store_a.get("shared").unwrap().url, "https://b-shared.com");
    }

    #[test]
    fn test_resource_serialization() {
        let resource = Resource::new(
            "doc",
            "https://example.com",
            Some("A document"),
            "planning",
            "2025-01-01T00:00:00Z",
        );
        let json = serde_json::to_string(&resource).unwrap();

        assert!(json.contains("\"name\":\"doc\""));
        assert!(json.contains("\"url\":\"https://example.com\""));
        assert!(json.contains("\"description\":\"A document\""));

        let parsed: Resource = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, resource);
    }

    #[test]
    fn test_resource_store_serialization() {
        let mut store = ResourceStore::new();
        store.set(Resource::new(
            "doc",
            "https://example.com",
            None::<String>,
            "planning",
            "now",
        ));

        let json = serde_json::to_string(&store).unwrap();
        let parsed: ResourceStore = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.get("doc").unwrap().url, "https://example.com");
    }

    #[test]
    fn test_resource_store_empty_serialization() {
        let store = ResourceStore::new();
        let json = serde_json::to_string(&store).unwrap();
        assert_eq!(json, "{}");

        let parsed: ResourceStore = serde_json::from_str("{}").unwrap();
        assert!(parsed.is_empty());
    }
}
