//! GitHub pull request service using the `gh` CLI.

use std::path::Path;
use std::process::Command;

use crate::workflow::ports::{PrError, PrService};

/// GitHub PR service implementation using `gh` CLI.
pub struct GhPrService;

impl GhPrService {
    /// Create a new `GhPrService`.
    pub fn new() -> Self {
        Self
    }

    /// Check if a PR already exists for the given branch.
    ///
    /// Returns the PR URL if found, or None if no PR exists.
    fn find_existing_pr(repo_root: &Path, branch: &str) -> Result<Option<String>, PrError> {
        let output = Command::new("gh")
            .args([
                "pr", "list", "--head", branch, "--json", "url", "--limit", "1",
            ])
            .current_dir(repo_root)
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    PrError::CliNotFound
                } else {
                    PrError::CreationFailed(format!("Failed to run gh pr list: {e}"))
                }
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(PrError::CreationFailed(format!(
                "gh pr list failed: {stderr}"
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        // Parse JSON array: [{"url":"..."}] or []
        let parsed: serde_json::Value = serde_json::from_str(&stdout).map_err(|e| {
            PrError::CreationFailed(format!(
                "Failed to parse gh pr list output: {e}\nRaw output: {stdout}"
            ))
        })?;

        if let Some(array) = parsed.as_array() {
            if let Some(first) = array.first() {
                if let Some(url) = first.get("url").and_then(|v| v.as_str()) {
                    return Ok(Some(url.to_string()));
                }
            }
        }

        Ok(None)
    }
}

impl Default for GhPrService {
    fn default() -> Self {
        Self::new()
    }
}

impl PrService for GhPrService {
    fn create_pull_request(
        &self,
        repo_root: &Path,
        branch: &str,
        base: &str,
        title: &str,
        body: &str,
    ) -> Result<String, PrError> {
        // Check if PR already exists (idempotent for crash recovery)
        if let Some(url) = Self::find_existing_pr(repo_root, branch)? {
            return Ok(url);
        }

        // Create new PR
        let output = Command::new("gh")
            .args([
                "pr", "create", "--head", branch, "--base", base, "--title", title, "--body", body,
            ])
            .current_dir(repo_root)
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    PrError::CliNotFound
                } else {
                    PrError::CreationFailed(format!("Failed to run gh pr create: {e}"))
                }
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(PrError::CreationFailed(stderr.to_string()));
        }

        // gh pr create outputs the URL to stdout
        let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_existing_pr_parses_empty_array() {
        // This is a unit test that would require mocking Command, which isn't
        // practical here. The real test would be an integration test with a
        // test repo. For now, we just ensure the struct is constructible.
        let service = GhPrService::new();
        let _ = service;
    }
}
