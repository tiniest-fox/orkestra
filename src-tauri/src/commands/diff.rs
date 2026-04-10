//! Tauri commands for git diff operations.

use std::sync::Arc;

use orkestra_core::workflow::ports::CommitInfo;
use orkestra_networking::diff as shared_diff;
use orkestra_networking::diff_types::{
    cache_key_for_sha, combined_diff_sha, file_content_hash, highlight_file_diff,
    HighlightedFileDiff, HighlightedLine, HighlightedTaskDiff, LineType, SyntaxCss,
};
use serde_json::Value;
use tauri::State;

use crate::diff_cache::DiffCacheState;
use crate::error::TauriError;
use crate::highlight::SyntaxHighlighter;
use crate::project_registry::ProjectRegistry;

// =============================================================================
// Tauri Commands
// =============================================================================

/// Get the diff for a task with syntax highlighting.
///
/// Uses a two-tier cache to avoid redundant git subprocesses and re-highlighting:
///
/// - Tier 1: If HEAD SHA matches and worktree is clean, return cached result immediately.
/// - Tier 2: Run git diff, but only re-highlight files whose content hash changed.
///
/// Accepts an optional `last_sha` `ETag` parameter. When `last_sha` matches the current
/// diff fingerprint, returns `{ "unchanged": true, "diff_sha": "..." }` immediately.
/// Full diff responses include a `diff_sha` field for use as `last_sha` on the next poll.
#[tauri::command]
pub async fn workflow_get_task_diff(
    task_id: String,
    context_lines: Option<u32>,
    last_sha: Option<String>,
    registry: tauri::State<'_, ProjectRegistry>,
    window: tauri::Window,
    highlighter: tauri::State<'_, SyntaxHighlighter>,
    diff_cache: tauri::State<'_, DiffCacheState>,
) -> Result<Value, TauriError> {
    let context_lines = context_lines.unwrap_or(3);
    registry.with_project(window.label(), |state| {
        let (task, git) = {
            let api = state.api()?;
            let git = api
                .git_service()
                .ok_or_else(|| {
                    orkestra_core::workflow::ports::WorkflowError::GitError(
                        "No git service configured".into(),
                    )
                })?
                .clone();
            let task = api.get_task(&task_id)?;
            (task, git)
        }; // mutex released — git operations run off the lock

        let worktree_path = std::path::Path::new(task.worktree_path.as_ref().ok_or(
            orkestra_core::workflow::ports::WorkflowError::GitError("Task has no worktree".into()),
        )?);
        let branch_name = task.branch_name.as_ref().ok_or(
            orkestra_core::workflow::ports::WorkflowError::GitError("Task has no branch".into()),
        )?;

        // Tier 1: SHA check — skip git subprocess if clean + unchanged.
        // Use ok() so a transient git2 error doesn't block the diff.
        if let Ok(wt_state) = git.get_worktree_state(worktree_path) {
            if !wt_state.is_dirty {
                let cache_sha = cache_key_for_sha(&wt_state.head_sha, context_lines);
                // ETag short-circuit: unchanged since last poll.
                if last_sha.as_deref() == Some(&cache_sha) {
                    return Ok(serde_json::json!({ "unchanged": true, "diff_sha": cache_sha }));
                }
                if let Some(files) =
                    diff_cache.get_all_if_clean(window.label(), &task_id, &cache_sha)
                {
                    return Ok(serde_json::to_value(HighlightedTaskDiff {
                        files,
                        diff_sha: Some(cache_sha),
                    })
                    .unwrap_or(Value::Null));
                }

                // Tier 1 miss — run git diff subprocess then apply Tier 2 caching.
                let raw_diff = git
                    .diff_against_base(worktree_path, branch_name, &task.base_branch, context_lines)
                    .map_err(|e| {
                        orkestra_core::workflow::ports::WorkflowError::GitError(e.to_string())
                    })?;

                return Ok(highlight_with_tier2_cache(
                    raw_diff,
                    context_lines,
                    last_sha.as_deref(),
                    &cache_sha,
                    window.label(),
                    &task_id,
                    &highlighter,
                    &diff_cache,
                ));
            }

            // Worktree is dirty — run git diff subprocess without Tier 1 caching.
            let raw_diff = git
                .diff_against_base(worktree_path, branch_name, &task.base_branch, context_lines)
                .map_err(|e| {
                    orkestra_core::workflow::ports::WorkflowError::GitError(e.to_string())
                })?;

            // Store with dirty-state cache key for Tier 2 re-use only.
            let dirty_cache_key = cache_key_for_sha(&wt_state.head_sha, context_lines);
            return Ok(highlight_with_tier2_cache(
                raw_diff,
                context_lines,
                last_sha.as_deref(),
                &dirty_cache_key,
                window.label(),
                &task_id,
                &highlighter,
                &diff_cache,
            ));
        }

        // get_worktree_state failed — fall back to direct diff with no caching.
        let raw_diff = git
            .diff_against_base(worktree_path, branch_name, &task.base_branch, context_lines)
            .map_err(|e| orkestra_core::workflow::ports::WorkflowError::GitError(e.to_string()))?;

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
}

/// Get the content of a file at HEAD in a task's worktree, with syntax highlighting.
#[tauri::command]
pub async fn workflow_get_file_content(
    task_id: String,
    file_path: String,
    registry: tauri::State<'_, ProjectRegistry>,
    window: tauri::Window,
    highlighter: tauri::State<'_, SyntaxHighlighter>,
) -> Result<Option<Vec<HighlightedLine>>, TauriError> {
    registry.with_project(window.label(), |state| {
        let api = state.api()?;
        let content = api.get_file_content(&task_id, &file_path)?;

        let Some(content) = content else {
            return Ok(None);
        };

        // Extract file extension for syntax highlighting
        let extension = std::path::Path::new(&file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        // Highlight each line as context
        #[allow(clippy::cast_possible_truncation)]
        let lines: Vec<HighlightedLine> = content
            .lines()
            .enumerate()
            .map(|(i, line)| {
                let line_with_newline = format!("{line}\n");
                let html = highlighter.highlight_line(&line_with_newline, extension);
                HighlightedLine {
                    line_type: LineType::Context,
                    content: line.to_string(),
                    html,
                    old_line_number: Some((i + 1) as u32),
                    new_line_number: Some((i + 1) as u32),
                }
            })
            .collect();

        Ok(Some(lines))
    })
}

/// Get the syntax CSS for light and dark themes.
#[tauri::command]
pub async fn workflow_get_syntax_css(
    highlighter: tauri::State<'_, SyntaxHighlighter>,
) -> Result<SyntaxCss, TauriError> {
    Ok(SyntaxCss {
        light: highlighter.light_css.clone(),
        dark: highlighter.dark_css.clone(),
    })
}

// =============================================================================
// Diff Parsing and Highlighting
// =============================================================================

/// Run Tier 2 per-file highlight caching: compare file content hashes, reuse cached
/// highlights for unchanged files, re-highlight only changed files, then store results.
#[allow(clippy::too_many_arguments)]
fn highlight_with_tier2_cache(
    raw_diff: orkestra_core::workflow::ports::TaskDiff,
    context_lines: u32,
    last_sha: Option<&str>,
    store_key: &str,
    window_label: &str,
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

    let mut cached_files = diff_cache.get_files_by_hash(window_label, task_id, &file_hashes);

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

    diff_cache.store(window_label, task_id, store_key, to_store);
    serde_json::to_value(HighlightedTaskDiff {
        files,
        diff_sha: Some(diff_sha),
    })
    .unwrap_or(Value::Null)
}

// =============================================================================
// Commit History Commands
// =============================================================================

/// Get commits on a task's branch since it diverged from the base branch.
///
/// Returns commits plus whether the worktree has uncommitted changes.
#[tauri::command]
pub fn workflow_get_branch_commits(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
    task_id: String,
) -> Result<Value, TauriError> {
    let params = serde_json::json!({ "task_id": task_id });
    registry.with_project(window.label(), |state| {
        shared_diff::get_branch_commits(state.command_context(), &params).map_err(Into::into)
    })
}

/// Get the syntax-highlighted diff of uncommitted changes in a task's worktree.
#[tauri::command]
pub fn workflow_get_uncommitted_diff(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
    task_id: String,
) -> Result<Value, TauriError> {
    let params = serde_json::json!({ "task_id": task_id });
    registry.with_project(window.label(), |state| {
        shared_diff::get_uncommitted_diff(state.command_context(), &params).map_err(Into::into)
    })
}

/// Get recent commit history for the main repository.
///
/// Returns the 20 most recent commits on the current branch.
#[tauri::command]
pub fn workflow_get_commit_log(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
) -> Result<Vec<CommitInfo>, TauriError> {
    registry.with_project(window.label(), |state| {
        let git = {
            let api = state.api()?;
            let Some(git) = api.git_service() else {
                return Ok(vec![]);
            };
            Arc::clone(git)
        }; // mutex released here — git subprocess runs off the lock
        git.commit_log(20).map_err(|e| {
            orkestra_core::workflow::ports::WorkflowError::GitError(e.to_string()).into()
        })
    })
}

/// Get file change counts for a batch of commit hashes.
///
/// Returns a map from commit hash to the number of files changed.
/// Used for lazy-loading file counts after the commit list populates.
#[tauri::command]
pub fn workflow_get_batch_file_counts(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
    hashes: Vec<String>,
) -> Result<std::collections::HashMap<String, usize>, TauriError> {
    registry.with_project(window.label(), |state| {
        let git = {
            let api = state.api()?;
            let Some(git) = api.git_service() else {
                return Ok(std::collections::HashMap::new());
            };
            Arc::clone(git)
        }; // mutex released here — git subprocess runs off the lock
        git.batch_file_counts(&hashes).map_err(|e| {
            orkestra_core::workflow::ports::WorkflowError::GitError(e.to_string()).into()
        })
    })
}

/// Get the syntax-highlighted diff for a specific commit.
#[tauri::command]
pub fn workflow_get_commit_diff(
    registry: State<ProjectRegistry>,
    window: tauri::Window,
    commit_hash: String,
    context_lines: Option<u32>,
    highlighter: State<SyntaxHighlighter>,
) -> Result<HighlightedTaskDiff, TauriError> {
    let context_lines = context_lines.unwrap_or(3);
    registry.with_project(window.label(), |state| {
        let git = {
            let api = state.api()?;
            let Some(git) = api.git_service() else {
                return Ok(HighlightedTaskDiff {
                    files: vec![],
                    diff_sha: None,
                });
            };
            Arc::clone(git)
        }; // mutex released here — git subprocess runs off the lock
        let task_diff = git
            .commit_diff(&commit_hash, context_lines)
            .map_err(|e| orkestra_core::workflow::ports::WorkflowError::GitError(e.to_string()))?;

        let files = task_diff
            .files
            .into_iter()
            .map(|f| highlight_file_diff(f, &|line, ext| highlighter.highlight_line(line, ext)))
            .collect();

        Ok(HighlightedTaskDiff {
            files,
            diff_sha: None,
        })
    })
}
