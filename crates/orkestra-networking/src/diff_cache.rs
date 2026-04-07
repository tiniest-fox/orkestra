//! Two-tier per-task diff cache for the daemon.
//!
//! Stores up to `MAX_CACHED_TASKS` entries keyed by `task_id`, so multiple
//! WebSocket clients viewing different Traks don't thrash each other's cache.
//! Oldest-insert eviction keeps memory bounded.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::diff_types::HighlightedFileDiff;

// ============================================================================
// Cache Types
// ============================================================================

const MAX_CACHED_TASKS: usize = 8;

struct CachedFileDiff {
    content_hash: u64,
    result: HighlightedFileDiff,
}

struct TaskDiffCache {
    head_sha: String,
    ordered_paths: Vec<String>,
    files: HashMap<String, CachedFileDiff>,
}

struct DiffCacheInner {
    entries: HashMap<String, TaskDiffCache>,
    insertion_order: Vec<String>,
}

// ============================================================================
// DiffCacheState
// ============================================================================

/// Per-task diff cache with two tiers of invalidation. Holds up to
/// `MAX_CACHED_TASKS` entries keyed by `task_id`; oldest entry is evicted on
/// overflow so multiple concurrent clients don't thrash each other.
///
/// Tier 1: If HEAD SHA matches and the worktree is clean, return the full
/// cached diff without running a git subprocess.
///
/// Tier 2: If the worktree is dirty or the SHA changed, run git diff but only
/// re-highlight files whose content hash changed.
pub struct DiffCacheState(Mutex<DiffCacheInner>);

impl DiffCacheState {
    pub fn new() -> Self {
        Self(Mutex::new(DiffCacheInner {
            entries: HashMap::new(),
            insertion_order: Vec::new(),
        }))
    }

    /// Tier 1: clean worktree + matching SHA → all files still valid.
    pub fn get_all_if_clean(
        &self,
        task_id: &str,
        head_sha: &str,
    ) -> Option<Vec<HighlightedFileDiff>> {
        let cache = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let entry = cache.entries.get(task_id)?;
        if entry.head_sha != head_sha {
            return None;
        }
        let files = entry
            .ordered_paths
            .iter()
            .filter_map(|p| entry.files.get(p).map(|f| f.result.clone()))
            .collect();
        Some(files)
    }

    /// Tier 2: per-file content hash — return cached results for unchanged files.
    pub fn get_files_by_hash(
        &self,
        task_id: &str,
        file_hashes: &[(String, u64)],
    ) -> HashMap<String, Option<HighlightedFileDiff>> {
        let cache = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let entry = cache.entries.get(task_id);
        file_hashes
            .iter()
            .map(|(path, hash)| {
                let cached = entry
                    .and_then(|e| e.files.get(path))
                    .filter(|f| f.content_hash == *hash)
                    .map(|f| f.result.clone());
                (path.clone(), cached)
            })
            .collect()
    }

    /// Store highlighted files. If `task_id` is already cached, updates in
    /// place. If new and at capacity, evicts the oldest entry first.
    pub fn store(
        &self,
        task_id: &str,
        head_sha: &str,
        files: Vec<(String, u64, HighlightedFileDiff)>,
    ) {
        let mut cache = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        let is_new = !cache.entries.contains_key(task_id);

        if is_new && cache.entries.len() >= MAX_CACHED_TASKS {
            if let Some(oldest_key) = cache.insertion_order.first().cloned() {
                cache.entries.remove(&oldest_key);
                cache.insertion_order.remove(0);
            }
        }

        if is_new {
            cache.insertion_order.push(task_id.to_string());
        }

        let ordered_paths: Vec<String> = files.iter().map(|(p, _, _)| p.clone()).collect();
        let file_map = files
            .into_iter()
            .map(|(path, hash, result)| {
                (
                    path,
                    CachedFileDiff {
                        content_hash: hash,
                        result,
                    },
                )
            })
            .collect();

        cache.entries.insert(
            task_id.to_string(),
            TaskDiffCache {
                head_sha: head_sha.to_string(),
                ordered_paths,
                files: file_map,
            },
        );
    }
}

impl Default for DiffCacheState {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use orkestra_core::workflow::ports::FileChangeType;

    fn make_diff(path: &str) -> HighlightedFileDiff {
        HighlightedFileDiff {
            path: path.to_string(),
            change_type: FileChangeType::Modified,
            old_path: None,
            additions: 1,
            deletions: 0,
            is_binary: false,
            hunks: vec![],
            total_new_lines: None,
        }
    }

    fn store_task(cache: &DiffCacheState, task_id: &str) {
        cache.store(
            task_id,
            "sha-abc",
            vec![("file.rs".to_string(), 42, make_diff("file.rs"))],
        );
    }

    #[test]
    fn test_multiple_tasks_cached() {
        let cache = DiffCacheState::new();
        cache.store(
            "task-a",
            "sha-a",
            vec![("a.rs".to_string(), 1, make_diff("a.rs"))],
        );
        cache.store(
            "task-b",
            "sha-b",
            vec![("b.rs".to_string(), 2, make_diff("b.rs"))],
        );

        let a = cache.get_all_if_clean("task-a", "sha-a").unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].path, "a.rs");

        let b = cache.get_all_if_clean("task-b", "sha-b").unwrap();
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].path, "b.rs");
    }

    #[test]
    fn test_eviction_removes_oldest() {
        let cache = DiffCacheState::new();

        // Fill to capacity
        for i in 0..MAX_CACHED_TASKS {
            store_task(&cache, &format!("task-{i}"));
        }

        // Oldest (task-0) should be present
        assert!(cache.get_all_if_clean("task-0", "sha-abc").is_some());

        // Insert one more — task-0 should be evicted
        store_task(&cache, "task-overflow");

        assert!(cache.get_all_if_clean("task-0", "sha-abc").is_none());
        assert!(cache.get_all_if_clean("task-overflow", "sha-abc").is_some());
        // task-1 through task-(MAX-1) should still be present
        assert!(cache
            .get_all_if_clean(&format!("task-{}", MAX_CACHED_TASKS - 1), "sha-abc")
            .is_some());
    }

    #[test]
    fn test_update_existing_does_not_evict() {
        let cache = DiffCacheState::new();

        // Fill to capacity
        for i in 0..MAX_CACHED_TASKS {
            store_task(&cache, &format!("task-{i}"));
        }

        // Update an existing task — no eviction should occur
        store_task(&cache, "task-0");

        // All entries still present
        for i in 0..MAX_CACHED_TASKS {
            assert!(
                cache
                    .get_all_if_clean(&format!("task-{i}"), "sha-abc")
                    .is_some(),
                "task-{i} should still be cached"
            );
        }
    }

    #[test]
    fn test_get_files_by_hash_cross_task() {
        let cache = DiffCacheState::new();
        cache.store(
            "task-a",
            "sha-a",
            vec![("shared.rs".to_string(), 100, make_diff("shared.rs"))],
        );
        cache.store(
            "task-b",
            "sha-b",
            vec![("shared.rs".to_string(), 200, make_diff("shared.rs"))],
        );

        // task-a uses hash 100; querying with 100 for task-a should hit
        let result_a = cache.get_files_by_hash("task-a", &[("shared.rs".to_string(), 100)]);
        assert!(result_a["shared.rs"].is_some());

        // task-b uses hash 200; querying task-b with task-a's hash should miss
        let result_b_wrong_hash =
            cache.get_files_by_hash("task-b", &[("shared.rs".to_string(), 100)]);
        assert!(result_b_wrong_hash["shared.rs"].is_none());

        // task-b with correct hash 200 should hit
        let result_b = cache.get_files_by_hash("task-b", &[("shared.rs".to_string(), 200)]);
        assert!(result_b["shared.rs"].is_some());
    }
}
