//! Shared types for git operations.
//!
//! Pure data types with no dependencies on other crate internals.

use serde::Serialize;
use std::fmt;

/// Errors that can occur during git operations.
#[derive(Debug, Clone)]
pub enum GitError {
    /// Git repository not found or inaccessible.
    RepositoryNotFound(String),
    /// Branch operation failed (create, delete, find).
    BranchError(String),
    /// Worktree operation failed (create, remove, find).
    WorktreeError(String),
    /// Merge operation failed (non-conflict error).
    MergeError(String),
    /// Merge conflict detected.
    MergeConflict {
        branch: String,
        conflict_files: Vec<String>,
    },
    /// I/O error (filesystem operations).
    IoError(String),
    /// Other git operation error.
    Other(String),
}

impl fmt::Display for GitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RepositoryNotFound(msg) => write!(f, "Repository not found: {msg}"),
            Self::BranchError(msg) => write!(f, "Branch error: {msg}"),
            Self::WorktreeError(msg) => write!(f, "Worktree error: {msg}"),
            Self::MergeError(msg) => write!(f, "Merge error: {msg}"),
            Self::MergeConflict {
                branch,
                conflict_files,
            } => {
                write!(
                    f,
                    "Merge conflict on branch {branch}: {} file(s) in conflict",
                    conflict_files.len()
                )
            }
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::Other(msg) => write!(f, "Git error: {msg}"),
        }
    }
}

impl std::error::Error for GitError {}

impl From<std::io::Error> for GitError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}

/// HEAD SHA and dirty status for a worktree.
#[derive(Debug, Clone)]
pub struct WorktreeState {
    /// The HEAD commit SHA.
    pub head_sha: String,
    /// Whether the worktree has uncommitted changes.
    pub is_dirty: bool,
}

/// Result of a successful worktree creation.
#[derive(Debug, Clone)]
pub struct WorktreeCreated {
    /// The branch name (e.g., "task/TASK-001").
    pub branch_name: String,
    /// Absolute path to the worktree directory.
    pub worktree_path: std::path::PathBuf,
    /// Git commit SHA of the base branch at worktree creation time.
    pub base_commit: String,
}

/// Result of a successful merge operation.
#[derive(Debug, Clone)]
pub struct MergeResult {
    /// The merge commit SHA.
    pub commit_sha: String,
    /// The target branch that was merged into (e.g., "main").
    pub target_branch: String,
    /// RFC3339 timestamp of when the merge occurred.
    pub merged_at: String,
}

/// Type of change made to a file in a diff.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeType {
    /// File was added.
    Added,
    /// File was modified.
    Modified,
    /// File was deleted.
    Deleted,
    /// File was renamed.
    Renamed,
}

/// Diff information for a single file.
#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    /// Path to the file (new path if renamed).
    pub path: String,
    /// Type of change.
    pub change_type: FileChangeType,
    /// Original path (only for renames).
    pub old_path: Option<String>,
    /// Number of lines added.
    pub additions: usize,
    /// Number of lines deleted.
    pub deletions: usize,
    /// Whether the file is binary.
    pub is_binary: bool,
    /// Raw unified diff content (None for binary files).
    pub diff_content: Option<String>,
    /// Total number of lines in the new version of the file (None for deleted/binary).
    ///
    /// Used by the frontend to determine whether a "more below" expand button
    /// should be shown — comparing against the last line number in the last hunk.
    pub total_new_lines: Option<u32>,
}

/// Complete diff for a task branch against its base.
#[derive(Debug, Clone, Serialize)]
pub struct TaskDiff {
    /// List of changed files with their diffs.
    pub files: Vec<FileDiff>,
}

/// Sync status relative to remote tracking branch.
#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    /// Commits ahead of origin (need to push).
    pub ahead: u32,
    /// Commits behind origin (need to pull).
    pub behind: u32,
    /// Whether local and remote have diverged (both ahead and behind).
    pub diverged: bool,
}

/// Metadata for a single git commit.
#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    /// Short commit hash (7 chars).
    pub hash: String,
    /// First line of the commit message.
    pub message: String,
    /// Lines after the subject line, if any.
    pub body: Option<String>,
    /// Author name.
    pub author: String,
    /// ISO 8601 timestamp.
    pub timestamp: String,
    /// Number of files changed in this commit.
    pub file_count: Option<usize>,
}
