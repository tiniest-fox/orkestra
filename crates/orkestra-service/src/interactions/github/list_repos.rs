//! List GitHub repositories via the `gh` CLI.

use crate::types::{GithubRepo, ServiceError};

/// List the authenticated user's repositories.
///
/// If `search` is provided it is passed as a positional argument to `gh repo
/// list` to filter results by owner or name. Returns up to 100 repos ordered
/// by most recently updated.
pub fn execute(search: Option<&str>) -> Result<Vec<GithubRepo>, ServiceError> {
    let mut cmd = std::process::Command::new("gh");
    cmd.args([
        "repo",
        "list",
        "--json",
        "name,nameWithOwner,url,description",
        "--limit",
        "100",
    ]);

    if let Some(query) = search {
        cmd.arg(query);
    }

    cmd.stdin(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `gh repo list`: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ServiceError::Other(format!(
            "`gh repo list` failed: {stderr}"
        )));
    }

    let repos: Vec<GithubRepo> = serde_json::from_slice(&output.stdout)
        .map_err(|e| ServiceError::Other(format!("Failed to parse `gh repo list` output: {e}")))?;

    Ok(repos)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use crate::types::GithubRepo;

    #[test]
    fn parses_gh_repo_list_json_output() {
        let json = r#"[
            {
                "name": "my-repo",
                "nameWithOwner": "alice/my-repo",
                "url": "https://github.com/alice/my-repo",
                "description": "A great repo"
            },
            {
                "name": "other-repo",
                "nameWithOwner": "alice/other-repo",
                "url": "https://github.com/alice/other-repo",
                "description": null
            }
        ]"#;

        let repos: Vec<GithubRepo> = serde_json::from_str(json).unwrap();
        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].name, "my-repo");
        assert_eq!(repos[0].name_with_owner, "alice/my-repo");
        assert_eq!(repos[0].description.as_deref(), Some("A great repo"));
        assert!(repos[1].description.is_none());
    }
}
