//! Diff command handlers: task diffs, file content, syntax CSS, commit history.

use std::sync::Arc;

use serde_json::Value;

use crate::diff_cache::DiffCacheState;
use crate::diff_types::{
    cache_key_for_sha, combined_diff_sha, file_content_hash, highlight_file_content,
    highlight_file_diff, HighlightedFileDiff, HighlightedTaskDiff, SyntaxCss,
};
use crate::highlight::SyntaxHighlighter;
use crate::types::ErrorPayload;

use super::dispatch::CommandContext;

// ============================================================================
// Task diff
// ============================================================================

/// Handle the `get_task_diff` method — returns a syntax-highlighted diff for a task.
///
/// Uses two-tier caching: SHA check (Tier 1) and per-file content hash (Tier 2).
///
/// Expected params: `{ "task_id": "<id>", "context_lines": <n> }`
pub(super) async fn handle_get_task_diff(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(&params)?;
    let context_lines = params
        .get("context_lines")
        .and_then(serde_json::Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or(3);
    let last_sha = params
        .get("last_sha")
        .and_then(|v| v.as_str())
        .map(String::from);
    let api = Arc::clone(&ctx.api);
    let highlighter = Arc::clone(&ctx.highlighter);
    let diff_cache = Arc::clone(&ctx.diff_cache);

    tokio::task::spawn_blocking(move || {
        let (task, git) = {
            let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
            let git = api
                .git_service()
                .ok_or_else(|| ErrorPayload::new("NO_GIT", "No git service configured"))?
                .clone();
            let task = api.get_task(&task_id).map_err(ErrorPayload::from)?;
            (task, git)
        }; // lock released — git operations run off the lock

        let worktree_path = std::path::Path::new(
            task.worktree_path
                .as_ref()
                .ok_or_else(|| ErrorPayload::new("NO_WORKTREE", "Task has no worktree"))?,
        );
        let branch_name = task
            .branch_name
            .as_ref()
            .ok_or_else(|| ErrorPayload::new("NO_BRANCH", "Task has no branch"))?;

        // Tier 1: clean worktree + matching SHA → return full cached result.
        if let Ok(wt_state) = git.get_worktree_state(worktree_path) {
            if !wt_state.is_dirty {
                let cache_sha = cache_key_for_sha(&wt_state.head_sha, context_lines);
                // ETag short-circuit: unchanged since last poll.
                if last_sha.as_deref() == Some(&cache_sha) {
                    return Ok(serde_json::json!({ "unchanged": true, "diff_sha": cache_sha }));
                }
                if let Some(files) = diff_cache.get_all_if_clean(&task_id, &cache_sha) {
                    return Ok(serde_json::to_value(HighlightedTaskDiff {
                        files,
                        diff_sha: Some(cache_sha),
                    })
                    .unwrap_or(Value::Null));
                }

                // Tier 1 miss — run git diff subprocess then apply Tier 2 caching.
                let raw_diff = git
                    .diff_against_base(worktree_path, branch_name, &task.base_branch, context_lines)
                    .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;

                return Ok(highlight_with_tier2_cache(
                    raw_diff,
                    context_lines,
                    last_sha.as_deref(),
                    &cache_sha,
                    &task_id,
                    &highlighter,
                    &diff_cache,
                ));
            }

            // Worktree is dirty — run git diff subprocess without Tier 1 caching.
            let cache_sha = cache_key_for_sha(&wt_state.head_sha, context_lines);
            let raw_diff = git
                .diff_against_base(worktree_path, branch_name, &task.base_branch, context_lines)
                .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;

            return Ok(highlight_with_tier2_cache(
                raw_diff,
                context_lines,
                last_sha.as_deref(),
                &cache_sha,
                &task_id,
                &highlighter,
                &diff_cache,
            ));
        }

        // get_worktree_state failed — fall back to direct diff with no caching.
        let raw_diff = git
            .diff_against_base(worktree_path, branch_name, &task.base_branch, context_lines)
            .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;

        let files = raw_diff
            .files
            .into_iter()
            .map(|file| {
                highlight_file_diff(file, &|line, ext| highlighter.highlight_line(line, ext))
            })
            .collect();

        Ok(serde_json::to_value(HighlightedTaskDiff {
            files,
            diff_sha: None,
        })
        .unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Run Tier 2 per-file highlight caching: compare file content hashes, reuse cached
/// highlights for unchanged files, re-highlight only changed files, then store results.
fn highlight_with_tier2_cache(
    raw_diff: orkestra_core::workflow::ports::TaskDiff,
    context_lines: u32,
    last_sha: Option<&str>,
    store_key: &str,
    task_id: &str,
    highlighter: &SyntaxHighlighter,
    diff_cache: &DiffCacheState,
) -> Value {
    let file_hashes: Vec<(String, u64)> = raw_diff
        .files
        .iter()
        .map(|f| (f.path.clone(), file_content_hash(f)))
        .collect();
    let diff_sha = combined_diff_sha(&file_hashes, context_lines);

    // ETag short-circuit.
    if last_sha == Some(&diff_sha) {
        return serde_json::json!({ "unchanged": true, "diff_sha": diff_sha });
    }

    let mut cached_files = diff_cache.get_files_by_hash(task_id, &file_hashes);

    let mut to_store: Vec<(String, u64, HighlightedFileDiff)> = Vec::new();
    let files: Vec<HighlightedFileDiff> = raw_diff
        .files
        .into_iter()
        .zip(file_hashes.iter())
        .map(|(file, (path, hash))| {
            if let Some(Some(cached)) = cached_files.remove(path) {
                to_store.push((path.clone(), *hash, cached.clone()));
                cached
            } else {
                let result =
                    highlight_file_diff(file, &|line, ext| highlighter.highlight_line(line, ext));
                to_store.push((path.clone(), *hash, result.clone()));
                result
            }
        })
        .collect();

    diff_cache.store(task_id, store_key, to_store);
    serde_json::to_value(HighlightedTaskDiff {
        files,
        diff_sha: Some(diff_sha),
    })
    .unwrap_or(Value::Null)
}

// ============================================================================
// File content
// ============================================================================

/// Handle the `get_file_content` method — returns file content with syntax highlighting.
///
/// Expected params: `{ "task_id": "<id>", "file_path": "<path>" }`
pub(super) async fn handle_get_file_content(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(&params)?;
    let file_path = params
        .get("file_path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: file_path"))?
        .to_string();

    let api = Arc::clone(&ctx.api);
    let highlighter = Arc::clone(&ctx.highlighter);

    tokio::task::spawn_blocking(move || {
        let content = {
            let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
            api.get_file_content(&task_id, &file_path)
                .map_err(ErrorPayload::from)?
        };

        let Some(content) = content else {
            return Ok(Value::Null);
        };

        let extension = std::path::Path::new(&file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        let lines = highlight_file_content(&content, extension, &|line, ext| {
            highlighter.highlight_line(line, ext)
        });

        Ok(serde_json::to_value(lines).unwrap_or(Value::Array(vec![])))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `get_project_file_content` method — returns project root file with syntax highlighting.
///
/// Expected params: `{ "file_path": "<path>" }`
pub(super) async fn handle_get_project_file_content(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let file_path = params
        .get("file_path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: file_path"))?
        .to_string();

    let api = Arc::clone(&ctx.api);
    let highlighter = Arc::clone(&ctx.highlighter);

    tokio::task::spawn_blocking(move || {
        let content = {
            let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
            api.get_project_file_content(&file_path)
                .map_err(ErrorPayload::from)?
        };

        let Some(content) = content else {
            return Ok(Value::Null);
        };

        let extension = std::path::Path::new(&file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        let lines = highlight_file_content(&content, extension, &|line, ext| {
            highlighter.highlight_line(line, ext)
        });

        Ok(serde_json::to_value(lines).unwrap_or(Value::Array(vec![])))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

// ============================================================================
// Syntax CSS
// ============================================================================

/// Handle the `get_syntax_css` method — returns CSS for light and dark themes.
pub(super) fn handle_get_syntax_css(ctx: &Arc<CommandContext>, _params: Value) -> Value {
    let css = SyntaxCss {
        light: ctx.highlighter.light_css.clone(),
        dark: ctx.highlighter.dark_css.clone(),
    };
    serde_json::to_value(css).unwrap_or(Value::Null)
}

// ============================================================================
// Commit history
// ============================================================================

/// Shared handler for `get_branch_commits`.
///
/// Returns `{ "commits": [...], "has_uncommitted_changes": bool }`.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn get_branch_commits(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
    let response = api
        .get_branch_commits(&task_id)
        .map_err(ErrorPayload::from)?;
    Ok(serde_json::to_value(response).unwrap_or(Value::Null))
}

/// Shared handler for `get_uncommitted_diff` — returns highlighted uncommitted changes.
///
/// Expected params: `{ "task_id": "<id>" }`
pub fn get_uncommitted_diff(ctx: &CommandContext, params: &Value) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(params)?;
    let raw_diff = {
        let api = ctx.api.lock().map_err(|_| ErrorPayload::lock_error())?;
        api.get_uncommitted_diff(&task_id)
            .map_err(ErrorPayload::from)?
    }; // lock released — highlighting runs off the lock
    let files: Vec<_> = raw_diff
        .files
        .into_iter()
        .map(|f| highlight_file_diff(f, &|line, ext| ctx.highlighter.highlight_line(line, ext)))
        .collect();
    Ok(serde_json::to_value(HighlightedTaskDiff {
        files,
        diff_sha: None,
    })
    .unwrap_or(Value::Null))
}

/// Handle the `get_commit_log` method — returns the 20 most recent commits.
pub(super) async fn handle_get_commit_log(
    ctx: Arc<CommandContext>,
    _params: Value,
) -> Result<Value, ErrorPayload> {
    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let git = {
            let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
            let Some(git) = api.git_service() else {
                return Ok(Value::Array(vec![]));
            };
            Arc::clone(git)
        }; // lock released — git subprocess runs off the lock
        let commits = git
            .commit_log(20)
            .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;
        Ok(serde_json::to_value(commits).unwrap_or(Value::Array(vec![])))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `get_batch_file_counts` method — returns file-change counts per commit hash.
///
/// Expected params: `{ "hashes": ["<hash1>", "<hash2>", ...] }`
pub(super) async fn handle_get_batch_file_counts(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let hashes: Vec<String> = params
        .get("hashes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(ToString::to_string))
                .collect()
        })
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: hashes"))?;

    let api = Arc::clone(&ctx.api);
    tokio::task::spawn_blocking(move || {
        let git = {
            let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
            let Some(git) = api.git_service() else {
                return Ok(serde_json::json!({}));
            };
            Arc::clone(git)
        }; // lock released — git subprocess runs off the lock
        let counts = git
            .batch_file_counts(&hashes)
            .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;
        Ok(serde_json::to_value(counts).unwrap_or(serde_json::json!({})))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

/// Handle the `get_commit_diff` method — returns the highlighted diff for a commit.
///
/// Expected params: `{ "commit_hash": "<hash>", "context_lines": <n> }`
pub(super) async fn handle_get_commit_diff(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let commit_hash = params
        .get("commit_hash")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: commit_hash"))?
        .to_string();
    let context_lines = params
        .get("context_lines")
        .and_then(serde_json::Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or(3);

    let api = Arc::clone(&ctx.api);
    let highlighter = Arc::clone(&ctx.highlighter);

    tokio::task::spawn_blocking(move || {
        let git = {
            let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
            let Some(git) = api.git_service() else {
                return Ok(serde_json::to_value(HighlightedTaskDiff {
                    files: vec![],
                    diff_sha: None,
                })
                .unwrap_or(Value::Null));
            };
            Arc::clone(git)
        }; // lock released — git subprocess runs off the lock

        let task_diff = git
            .commit_diff(&commit_hash, context_lines)
            .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;

        let files = task_diff
            .files
            .into_iter()
            .map(|f| highlight_file_diff(f, &|line, ext| highlighter.highlight_line(line, ext)))
            .collect();

        Ok(serde_json::to_value(HighlightedTaskDiff {
            files,
            diff_sha: None,
        })
        .unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff_types::{combined_diff_sha, file_content_hash};
    use orkestra_core::workflow::ports::{FileChangeType, FileDiff, TaskDiff};

    fn make_task_diff(path: &str, content: &str) -> TaskDiff {
        TaskDiff {
            files: vec![FileDiff {
                path: path.to_string(),
                change_type: FileChangeType::Modified,
                old_path: None,
                additions: 1,
                deletions: 0,
                is_binary: false,
                diff_content: Some(content.to_string()),
                total_new_lines: None,
            }],
        }
    }

    #[test]
    fn tier2_etag_match_returns_unchanged() {
        let highlighter = SyntaxHighlighter::new();
        let cache = DiffCacheState::new();
        let diff = make_task_diff("src/main.rs", "@@ -1 +1 @@\n-old\n+new\n");

        let file_hashes: Vec<(String, u64)> = diff
            .files
            .iter()
            .map(|f| (f.path.clone(), file_content_hash(f)))
            .collect();
        let expected_sha = combined_diff_sha(&file_hashes, 3);

        let result = highlight_with_tier2_cache(
            diff,
            3,
            Some(&expected_sha),
            &expected_sha,
            "task-1",
            &highlighter,
            &cache,
        );

        assert_eq!(result["unchanged"], true);
        assert_eq!(result["diff_sha"], expected_sha);
        assert!(
            result.get("files").is_none(),
            "unchanged response should not include files"
        );
    }

    #[test]
    fn tier2_no_last_sha_returns_full_diff() {
        let highlighter = SyntaxHighlighter::new();
        let cache = DiffCacheState::new();
        let diff = make_task_diff("src/main.rs", "@@ -1 +1 @@\n-old\n+new\n");

        let file_hashes: Vec<(String, u64)> = diff
            .files
            .iter()
            .map(|f| (f.path.clone(), file_content_hash(f)))
            .collect();
        let store_key = combined_diff_sha(&file_hashes, 3);

        let result =
            highlight_with_tier2_cache(diff, 3, None, &store_key, "task-2", &highlighter, &cache);

        assert!(
            result.get("files").is_some(),
            "full diff response should include files"
        );
        assert!(
            result["files"].as_array().is_some_and(|a| !a.is_empty()),
            "files array should be non-empty"
        );
        assert!(result["diff_sha"].is_string(), "diff_sha should be present");
        assert!(
            result.get("unchanged").is_none(),
            "unchanged field should not be present"
        );
    }

    #[test]
    fn tier2_different_sha_returns_full_diff() {
        let highlighter = SyntaxHighlighter::new();
        let cache = DiffCacheState::new();
        let diff = make_task_diff("src/main.rs", "@@ -1 +1 @@\n-old\n+new\n");

        let file_hashes: Vec<(String, u64)> = diff
            .files
            .iter()
            .map(|f| (f.path.clone(), file_content_hash(f)))
            .collect();
        let store_key = combined_diff_sha(&file_hashes, 3);

        let result = highlight_with_tier2_cache(
            diff,
            3,
            Some("wrong-sha-value"),
            &store_key,
            "task-3",
            &highlighter,
            &cache,
        );

        assert!(
            result.get("files").is_some(),
            "full diff response should include files"
        );
        assert!(
            result["files"].as_array().is_some_and(|a| !a.is_empty()),
            "files array should be non-empty"
        );
        assert!(result["diff_sha"].is_string(), "diff_sha should be present");
        assert!(
            result.get("unchanged").is_none(),
            "unchanged field should not be present"
        );
    }

    #[test]
    fn tier2_diff_sha_is_consistent() {
        let highlighter = SyntaxHighlighter::new();
        let cache = DiffCacheState::new();

        let file_hashes: Vec<(String, u64)> =
            make_task_diff("src/main.rs", "@@ -1 +1 @@\n-old\n+new\n")
                .files
                .iter()
                .map(|f| (f.path.clone(), file_content_hash(f)))
                .collect();
        let store_key = combined_diff_sha(&file_hashes, 3);

        let result1 = highlight_with_tier2_cache(
            make_task_diff("src/main.rs", "@@ -1 +1 @@\n-old\n+new\n"),
            3,
            None,
            &store_key,
            "task-4",
            &highlighter,
            &cache,
        );
        let result2 = highlight_with_tier2_cache(
            make_task_diff("src/main.rs", "@@ -1 +1 @@\n-old\n+new\n"),
            3,
            None,
            &store_key,
            "task-4",
            &highlighter,
            &cache,
        );

        assert_eq!(
            result1["diff_sha"], result2["diff_sha"],
            "same inputs should produce the same diff_sha"
        );
    }
}
