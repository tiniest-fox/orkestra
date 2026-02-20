//! Two-tier per-file diff cache. One entry per window, evicted on task change.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::commands::HighlightedFileDiff;

// ============================================================================
// Cache Types
// ============================================================================

struct CachedFileDiff {
    content_hash: u64,
    result: HighlightedFileDiff,
}

struct WindowDiffCache {
    task_id: String,
    head_sha: String,
    /// Paths in the order git produced them. Used by `get_all_if_clean` to
    /// return files in a stable, consistent order on every Tier 1 hit.
    ordered_paths: Vec<String>,
    files: HashMap<String, CachedFileDiff>, // file_path → cached file
}

// ============================================================================
// DiffCacheState
// ============================================================================

/// Per-window diff cache with two tiers of invalidation.
///
/// Tier 1: If HEAD SHA matches and the worktree is clean, the entire cached diff
/// is still valid — return it without running a git subprocess.
///
/// Tier 2: If the worktree is dirty or the SHA changed, run the git diff but only
/// re-highlight files whose content hash changed. Unchanged files reuse cached HTML.
///
/// Cache is bounded to one entry per window. When `task_id` changes, all prior
/// file entries are evicted.
pub struct DiffCacheState(Mutex<HashMap<String, WindowDiffCache>>); // window_label → cache

impl DiffCacheState {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }

    /// Tier 1: clean worktree + matching SHA → all files still valid.
    ///
    /// Returns all cached file diffs in their original git order if `task_id` and
    /// `head_sha` both match the stored entry.
    pub fn get_all_if_clean(
        &self,
        window: &str,
        task_id: &str,
        head_sha: &str,
    ) -> Option<Vec<HighlightedFileDiff>> {
        let cache = self.0.lock().unwrap();
        let entry = cache.get(window)?;
        if entry.task_id != task_id || entry.head_sha != head_sha {
            return None;
        }
        // Iterate in insertion order so the frontend sees files in the same
        // order as git produces them, not HashMap's arbitrary order.
        let files = entry
            .ordered_paths
            .iter()
            .filter_map(|p| entry.files.get(p).map(|f| f.result.clone()))
            .collect();
        Some(files)
    }

    /// Tier 2: for each file in the new diff, return the cached result if the
    /// content hash still matches. Returns a map of path → Option<cached result>
    /// for callers to fill in on cache misses.
    pub fn get_files_by_hash(
        &self,
        window: &str,
        task_id: &str,
        file_hashes: &[(String, u64)],
    ) -> HashMap<String, Option<HighlightedFileDiff>> {
        let cache = self.0.lock().unwrap();
        let entry = cache.get(window).filter(|e| e.task_id == task_id);
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

    /// Store highlighted files. Evicts all previous file entries if `task_id` changed.
    ///
    /// `files` must be in the order they should be returned by `get_all_if_clean`
    /// (i.e., the order git produced them).
    pub fn store(
        &self,
        window: &str,
        task_id: &str,
        head_sha: &str,
        files: Vec<(String, u64, HighlightedFileDiff)>, // (path, content_hash, result)
    ) {
        let mut cache = self.0.lock().unwrap();
        let entry = cache
            .entry(window.to_string())
            .or_insert_with(|| WindowDiffCache {
                task_id: task_id.to_string(),
                head_sha: head_sha.to_string(),
                ordered_paths: Vec::new(),
                files: HashMap::new(),
            });
        if entry.task_id != task_id {
            entry.task_id = task_id.to_string();
            entry.ordered_paths.clear();
            entry.files.clear();
        }
        entry.head_sha = head_sha.to_string();
        entry.ordered_paths = files.iter().map(|(p, _, _)| p.clone()).collect();
        // Rebuild the map each call so files that disappeared from the diff
        // don't accumulate as stale entries across polls.
        entry.files = files
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
    }
}
