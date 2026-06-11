//! GitHub PR monitoring adapter using the `gh` CLI.

use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;

use crate::workflow::ports::{
    AutoResolveCheckRun, AutoResolveComment, AutoResolveReview, AutoResolveStatus, PrError,
    PrMonitor,
};
use orkestra_types::domain::classify_check;

/// GitHub PR monitor implementation using `gh` CLI.
pub struct GhPrMonitor {
    cached_user: OnceLock<String>,
}

impl GhPrMonitor {
    /// Create a new `GhPrMonitor`.
    pub fn new() -> Self {
        Self {
            cached_user: OnceLock::new(),
        }
    }

    /// Parse a GitHub PR URL into (owner, repo, number).
    fn parse_pr_url(pr_url: &str) -> Result<(String, String, u64), PrError> {
        // Expected format: https://github.com/{owner}/{repo}/pull/{number}
        let parts: Vec<&str> = pr_url.trim_end_matches('/').split('/').collect();
        // Find the index of "pull" in the URL parts
        let pull_idx = parts
            .iter()
            .rposition(|&s| s == "pull")
            .ok_or_else(|| PrError::ReadFailed(format!("Invalid PR URL format: {pr_url}")))?;

        if pull_idx < 2 || pull_idx + 1 >= parts.len() {
            return Err(PrError::ReadFailed(format!(
                "Invalid PR URL format: {pr_url}"
            )));
        }

        let number: u64 = parts[pull_idx + 1]
            .parse()
            .map_err(|_| PrError::ReadFailed(format!("Invalid PR number in URL: {pr_url}")))?;
        let repo = parts[pull_idx - 1].to_string();
        let owner = parts[pull_idx - 2].to_string();

        Ok((owner, repo, number))
    }

    fn run_gh(args: &[&str], cwd: Option<&Path>) -> Result<String, PrError> {
        let mut cmd = Command::new("gh");
        cmd.args(args);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                PrError::CliNotFound
            } else {
                PrError::ReadFailed(format!("Failed to run gh: {e}"))
            }
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(PrError::ReadFailed(format!("gh command failed: {stderr}")));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

impl Default for GhPrMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl PrMonitor for GhPrMonitor {
    fn authenticated_user(&self) -> Result<String, PrError> {
        if let Some(user) = self.cached_user.get() {
            return Ok(user.clone());
        }

        let login = Self::run_gh(&["api", "user", "--jq", ".login"], None)?;
        let _ = self.cached_user.set(login.clone());
        Ok(login)
    }

    fn fetch_auto_resolve_status(
        &self,
        repo_root: &Path,
        pr_url: &str,
    ) -> Result<AutoResolveStatus, PrError> {
        let (owner, repo, number) = Self::parse_pr_url(pr_url)?;

        // Step 1: Get PR state and check statuses
        let pr_json = Self::run_gh(
            &["pr", "view", pr_url, "--json", "state,statusCheckRollup"],
            Some(repo_root),
        )?;

        let pr_data: serde_json::Value = serde_json::from_str(&pr_json)
            .map_err(|e| PrError::ReadFailed(format!("Failed to parse pr view output: {e}")))?;

        let pr_state = pr_data["state"].as_str().unwrap_or("UNKNOWN").to_string();

        // Parse check statuses
        let mut failed_checks = Vec::new();
        let mut all_checks_concluded = true;

        if let Some(checks) = pr_data["statusCheckRollup"].as_array() {
            for check in checks {
                let status = check["status"].as_str();
                let conclusion = check["conclusion"].as_str();
                let check_status = classify_check(status, conclusion);

                if check_status.is_failing() {
                    let id = check["databaseId"].as_i64().unwrap_or(0);
                    let name = check["name"].as_str().unwrap_or("unknown").to_string();
                    failed_checks.push(AutoResolveCheckRun {
                        id,
                        name,
                        log_excerpt: None,
                    });
                } else if check_status == orkestra_types::domain::CheckStatus::Pending {
                    all_checks_concluded = false;
                }
            }
        }

        // Step 2: Get review comments
        let comments_json = Self::run_gh(
            &[
                "api",
                &format!("repos/{owner}/{repo}/pulls/{number}/comments"),
            ],
            None,
        )?;

        let comments_data: serde_json::Value = serde_json::from_str(&comments_json)
            .map_err(|e| PrError::ReadFailed(format!("Failed to parse comments: {e}")))?;

        let mut comments = Vec::new();
        if let Some(arr) = comments_data.as_array() {
            for c in arr {
                let id = c["id"].as_i64().unwrap_or(0);
                let author = c["user"]["login"].as_str().unwrap_or("").to_string();
                let body = c["body"].as_str().unwrap_or("").to_string();
                let path = c["path"].as_str().map(std::string::ToString::to_string);
                let line = c["line"]
                    .as_u64()
                    .or_else(|| c["original_line"].as_u64())
                    .and_then(|l| u32::try_from(l).ok());
                comments.push(AutoResolveComment {
                    id,
                    author,
                    body,
                    path,
                    line,
                });
            }
        }

        // Step 3: Get reviews
        let reviews_json = Self::run_gh(
            &[
                "api",
                &format!("repos/{owner}/{repo}/pulls/{number}/reviews"),
            ],
            None,
        )?;

        let reviews_data: serde_json::Value = serde_json::from_str(&reviews_json)
            .map_err(|e| PrError::ReadFailed(format!("Failed to parse reviews: {e}")))?;

        let mut reviews = Vec::new();
        if let Some(arr) = reviews_data.as_array() {
            for r in arr {
                let id = r["id"].as_i64().unwrap_or(0);
                let author = r["user"]["login"].as_str().unwrap_or("").to_string();
                let state = r["state"].as_str().unwrap_or("COMMENTED").to_string();
                reviews.push(AutoResolveReview { id, author, state });
            }
        }

        Ok(AutoResolveStatus {
            pr_state,
            failed_checks,
            comments,
            reviews,
            all_checks_concluded,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pr_url_extracts_parts() {
        let (owner, repo, number) =
            GhPrMonitor::parse_pr_url("https://github.com/acme/myrepo/pull/42").unwrap();
        assert_eq!(owner, "acme");
        assert_eq!(repo, "myrepo");
        assert_eq!(number, 42);
    }

    #[test]
    fn parse_pr_url_rejects_invalid() {
        assert!(GhPrMonitor::parse_pr_url("https://github.com/missing-pull").is_err());
        assert!(GhPrMonitor::parse_pr_url("not-a-url").is_err());
    }
}
