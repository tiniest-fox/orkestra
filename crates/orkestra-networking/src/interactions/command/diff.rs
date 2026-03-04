//! Diff command handlers: task diffs, file content, syntax CSS, commit history.

use std::sync::Arc;

use orkestra_core::workflow::ports::FileDiff;
use serde_json::Value;

use crate::diff_types::{
    HighlightedFileDiff, HighlightedHunk, HighlightedLine, HighlightedTaskDiff, LineType, SyntaxCss,
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
/// Expected params: `{ "task_id": "<id>" }`
pub(super) async fn handle_get_task_diff(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let task_id = super::extract_task_id(&params)?;
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
                if let Some(files) = diff_cache.get_all_if_clean(&task_id, &wt_state.head_sha) {
                    return Ok(
                        serde_json::to_value(HighlightedTaskDiff { files }).unwrap_or(Value::Null)
                    );
                }
            }

            let raw_diff = git
                .diff_against_base(worktree_path, branch_name, &task.base_branch)
                .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;

            // Tier 2: per-file content hash — only re-highlight changed files.
            let file_hashes: Vec<(String, u64)> = raw_diff
                .files
                .iter()
                .map(|f| (f.path.clone(), file_content_hash(f)))
                .collect();
            let mut cached_files = diff_cache.get_files_by_hash(&task_id, &file_hashes);

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
                        let result = highlight_file_diff(file, &highlighter);
                        to_store.push((path.clone(), *hash, result.clone()));
                        result
                    }
                })
                .collect();

            diff_cache.store(&task_id, &wt_state.head_sha, to_store);
            return Ok(serde_json::to_value(HighlightedTaskDiff { files }).unwrap_or(Value::Null));
        }

        // get_worktree_state failed — fall back to direct diff with no caching.
        let raw_diff = git
            .diff_against_base(worktree_path, branch_name, &task.base_branch)
            .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;

        let files = raw_diff
            .files
            .into_iter()
            .map(|file| highlight_file_diff(file, &highlighter))
            .collect();

        Ok(serde_json::to_value(HighlightedTaskDiff { files }).unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
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

        Ok(serde_json::to_value(lines).unwrap_or(Value::Array(vec![])))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

// ============================================================================
// Syntax CSS
// ============================================================================

/// Handle the `get_syntax_css` method — returns CSS for light and dark themes.
pub fn handle_get_syntax_css(ctx: &Arc<CommandContext>, _params: Value) -> Value {
    let css = SyntaxCss {
        light: ctx.highlighter.light_css.clone(),
        dark: ctx.highlighter.dark_css.clone(),
    };
    serde_json::to_value(css).unwrap_or(Value::Null)
}

// ============================================================================
// Commit history
// ============================================================================

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
/// Expected params: `{ "commit_hash": "<hash>" }`
pub(super) async fn handle_get_commit_diff(
    ctx: Arc<CommandContext>,
    params: Value,
) -> Result<Value, ErrorPayload> {
    let commit_hash = params
        .get("commit_hash")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ErrorPayload::invalid_params("missing field: commit_hash"))?
        .to_string();

    let api = Arc::clone(&ctx.api);
    let highlighter = Arc::clone(&ctx.highlighter);

    tokio::task::spawn_blocking(move || {
        let git = {
            let api = api.lock().map_err(|_| ErrorPayload::lock_error())?;
            let Some(git) = api.git_service() else {
                return Ok(serde_json::to_value(HighlightedTaskDiff { files: vec![] })
                    .unwrap_or(Value::Null));
            };
            Arc::clone(git)
        }; // lock released — git subprocess runs off the lock

        let task_diff = git
            .commit_diff(&commit_hash)
            .map_err(|e| ErrorPayload::new("GIT_ERROR", e.to_string()))?;

        let files = task_diff
            .files
            .into_iter()
            .map(|f| highlight_file_diff(f, &highlighter))
            .collect();

        Ok(serde_json::to_value(HighlightedTaskDiff { files }).unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| ErrorPayload::internal(e.to_string()))?
}

// ============================================================================
// Diff parsing and highlighting
// ============================================================================

/// Stable content hash for a `FileDiff` entry.
fn file_content_hash(file: &FileDiff) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    file.path.hash(&mut h);
    file.old_path.hash(&mut h);
    file.change_type.hash(&mut h);
    file.is_binary.hash(&mut h);
    file.diff_content.hash(&mut h);
    h.finish()
}

/// Convert a raw `FileDiff` into a highlighted `HighlightedFileDiff` with parsed hunks.
fn highlight_file_diff(file: FileDiff, highlighter: &SyntaxHighlighter) -> HighlightedFileDiff {
    let hunks = match file.diff_content {
        Some(ref content) if !file.is_binary => {
            parse_and_highlight_diff(content, &file.path, highlighter)
        }
        _ => vec![],
    };

    HighlightedFileDiff {
        path: file.path,
        change_type: file.change_type,
        old_path: file.old_path,
        additions: file.additions,
        deletions: file.deletions,
        is_binary: file.is_binary,
        hunks,
    }
}

/// Parse unified diff content and highlight each line.
fn parse_and_highlight_diff(
    diff_content: &str,
    file_path: &str,
    highlighter: &SyntaxHighlighter,
) -> Vec<HighlightedHunk> {
    let extension = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let mut hunks = Vec::new();
    let mut current_hunk: Option<HighlightedHunk> = None;
    let mut old_line = 0u32;
    let mut new_line = 0u32;

    for line in diff_content.lines() {
        if line.starts_with("@@") {
            if let Some(hunk) = current_hunk.take() {
                hunks.push(hunk);
            }
            if let Some((old_start, old_count, new_start, new_count)) = parse_hunk_header(line) {
                old_line = old_start;
                new_line = new_start;
                current_hunk = Some(HighlightedHunk {
                    old_start,
                    old_count,
                    new_start,
                    new_count,
                    lines: Vec::new(),
                });
            }
            continue;
        }

        if line.starts_with("diff --git")
            || line.starts_with("index ")
            || line.starts_with("---")
            || line.starts_with("+++")
        {
            continue;
        }

        if let Some(ref mut hunk) = current_hunk {
            let (line_type, content, old_num, new_num) =
                if let Some(content) = line.strip_prefix('+') {
                    let num = new_line;
                    new_line += 1;
                    (LineType::Add, content, None, Some(num))
                } else if let Some(content) = line.strip_prefix('-') {
                    let num = old_line;
                    old_line += 1;
                    (LineType::Delete, content, Some(num), None)
                } else if let Some(content) = line.strip_prefix(' ') {
                    let old_num = old_line;
                    let new_num = new_line;
                    old_line += 1;
                    new_line += 1;
                    (LineType::Context, content, Some(old_num), Some(new_num))
                } else {
                    continue;
                };

            let content_with_newline = format!("{content}\n");
            let html = highlighter.highlight_line(&content_with_newline, extension);

            hunk.lines.push(HighlightedLine {
                line_type,
                content: content.to_string(),
                html,
                old_line_number: old_num,
                new_line_number: new_num,
            });
        }
    }

    if let Some(hunk) = current_hunk {
        hunks.push(hunk);
    }

    hunks
}

/// Parse a hunk header line: `@@ -old_start,old_count +new_start,new_count @@`.
fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    let parts: Vec<&str> = line.split("@@").collect();
    if parts.len() < 2 {
        return None;
    }
    let ranges = parts[1].trim();
    let mut iter = ranges.split_whitespace();
    let old_range = iter.next()?.strip_prefix('-')?;
    let (old_start, old_count) = parse_range(old_range)?;
    let new_range = iter.next()?.strip_prefix('+')?;
    let (new_start, new_count) = parse_range(new_range)?;
    Some((old_start, old_count, new_start, new_count))
}

/// Parse a range like `"1,5"` or `"1"` (count defaults to 1).
fn parse_range(range: &str) -> Option<(u32, u32)> {
    if let Some((start, count)) = range.split_once(',') {
        Some((start.parse().ok()?, count.parse().ok()?))
    } else {
        Some((range.parse().ok()?, 1))
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_range_with_count() {
        assert_eq!(parse_range("10,5"), Some((10, 5)));
    }

    #[test]
    fn parse_range_single_line() {
        assert_eq!(parse_range("42"), Some((42, 1)));
    }

    #[test]
    fn parse_range_invalid() {
        assert_eq!(parse_range("abc"), None);
        assert_eq!(parse_range(""), None);
    }

    #[test]
    fn parse_hunk_header_standard() {
        let result = parse_hunk_header("@@ -1,3 +1,4 @@");
        assert_eq!(result, Some((1, 3, 1, 4)));
    }

    #[test]
    fn parse_hunk_header_single_line() {
        let result = parse_hunk_header("@@ -1 +1 @@");
        assert_eq!(result, Some((1, 1, 1, 1)));
    }

    #[test]
    fn parse_hunk_header_with_context() {
        let result = parse_hunk_header("@@ -10,5 +12,7 @@ fn main() {");
        assert_eq!(result, Some((10, 5, 12, 7)));
    }

    #[test]
    fn parse_hunk_header_invalid() {
        assert_eq!(parse_hunk_header("not a header"), None);
        assert_eq!(parse_hunk_header(""), None);
    }
}
