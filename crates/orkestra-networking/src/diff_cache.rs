//! Two-tier per-task diff cache for the daemon.
//!
//! Mirrors the Tauri `DiffCacheState` but scoped to a single project.
//! Uses the constant key `"main"` in place of Tauri window labels.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::diff_types::HighlightedFileDiff;

// ============================================================================
// Cache Types
// ============================================================================

struct CachedFileDiff {
    content_hash: u64,
    result: HighlightedFileDiff,
}

struct TaskDiffCache {
    task_id: String,
    head_sha: String,
    ordered_paths: Vec<String>,
    files: HashMap<String, CachedFileDiff>,
}

// ============================================================================
// DiffCacheState
// ============================================================================

/// Single-project diff cache with two tiers of invalidation.
///
/// Tier 1: If HEAD SHA matches and the worktree is clean, return the full
/// cached diff without running a git subprocess.
///
/// Tier 2: If the worktree is dirty or the SHA changed, run git diff but only
/// re-highlight files whose content hash changed.
pub struct DiffCacheState(Mutex<Option<TaskDiffCache>>);

impl DiffCacheState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
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
        let entry = cache.as_ref()?;
        if entry.task_id != task_id || entry.head_sha != head_sha {
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
        let entry = cache.as_ref().filter(|e| e.task_id == task_id);
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
        let entry = cache.get_or_insert_with(|| TaskDiffCache {
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

impl Default for DiffCacheState {
    fn default() -> Self {
        Self::new()
    }
}
