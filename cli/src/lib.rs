//! Library crate for shared CLI functionality.
//!
//! This module exports types and functions used by both the CLI binary
//! and integration tests, avoiding duplication.

use orkestra_core::workflow::WorkflowApi;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct GitState {
    pub branch_name: Option<String>,
    pub worktree_path: Option<String>,
    pub base_branch: String,
    pub base_commit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_dirty: Option<bool>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub dirty_files: Vec<String>,
    /// Error message if git commands failed (worktree exists but git is broken).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn get_git_state(api: &WorkflowApi, id: &str) -> Result<GitState, String> {
    let task = api
        .get_task(id)
        .map_err(|e| format!("Failed to get task: {e}"))?;

    let mut state = GitState {
        branch_name: task.branch_name.clone(),
        worktree_path: task.worktree_path.clone(),
        base_branch: task.base_branch.clone(),
        base_commit: task.base_commit.clone(),
        head_commit: None,
        is_dirty: None,
        dirty_files: Vec::new(),
        error: None,
    };

    if let Some(ref worktree_path) = task.worktree_path {
        let path = std::path::Path::new(worktree_path);
        if !path.exists() {
            // Worktree path is set but doesn't exist on disk — not an error,
            // just means setup hasn't run or worktree was removed
            return Ok(state);
        }

        // Get HEAD commit
        match std::process::Command::new("git")
            .args(["-C", worktree_path, "rev-parse", "HEAD"])
            .output()
        {
            Ok(output) if output.status.success() => {
                state.head_commit =
                    Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                state.error = Some(format!("git rev-parse HEAD failed: {}", stderr.trim()));
            }
            Err(e) => {
                state.error = Some(format!("Failed to run git: {e}"));
            }
        }

        // Get dirty status (only if HEAD succeeded)
        if state.error.is_none() {
            match std::process::Command::new("git")
                .args(["-C", worktree_path, "status", "--porcelain"])
                .output()
            {
                Ok(output) if output.status.success() => {
                    let status_output = String::from_utf8_lossy(&output.stdout);
                    let is_clean = status_output.trim().is_empty();
                    state.is_dirty = Some(!is_clean);
                    if !is_clean {
                        state.dirty_files = status_output
                            .lines()
                            .map(|line| line.trim().to_string())
                            .collect();
                    }
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    state.error = Some(format!("git status --porcelain failed: {}", stderr.trim()));
                }
                Err(e) => {
                    state.error = Some(format!("Failed to run git status: {e}"));
                }
            }
        }
    }

    Ok(state)
}
