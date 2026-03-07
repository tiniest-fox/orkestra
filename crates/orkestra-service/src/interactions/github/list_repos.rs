//! List GitHub repositories via the `gh` CLI.

use crate::types::{GithubRepo, ServiceError};

/// List the authenticated user's repositories.
///
/// If `search` is provided it is passed as a positional argument to `gh repo
/// list` to filter results by owner or name. Returns up to 100 repos ordered
/// by most recently updated.
///
/// If `search` is `None`, returns repos from the personal account and all orgs
/// the user is a member of.
pub fn execute(search: Option<&str>) -> Result<Vec<GithubRepo>, ServiceError> {
    if let Some(query) = search {
        return list_for_owner(query);
    }

    let mut repos = list_personal()?;
    for org in fetch_org_names()? {
        repos.extend(list_for_owner(&org)?);
    }
    Ok(repos)
}

// -- Helpers --

fn list_personal() -> Result<Vec<GithubRepo>, ServiceError> {
    let output = std::process::Command::new("gh")
        .args([
            "repo",
            "list",
            "--json",
            "name,nameWithOwner,url,description",
            "--limit",
            "100",
        ])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `gh repo list`: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ServiceError::Other(format!(
            "`gh repo list` failed: {stderr}"
        )));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| ServiceError::Other(format!("Failed to parse `gh repo list` output: {e}")))
}

fn list_for_owner(owner: &str) -> Result<Vec<GithubRepo>, ServiceError> {
    let output = std::process::Command::new("gh")
        .args([
            "repo",
            "list",
            owner,
            "--json",
            "name,nameWithOwner,url,description",
            "--limit",
            "100",
        ])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `gh repo list {owner}`: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ServiceError::Other(format!(
            "`gh repo list {owner}` failed: {stderr}"
        )));
    }

    serde_json::from_slice(&output.stdout).map_err(|e| {
        ServiceError::Other(format!(
            "Failed to parse `gh repo list {owner}` output: {e}"
        ))
    })
}

fn fetch_org_names() -> Result<Vec<String>, ServiceError> {
    let output = std::process::Command::new("gh")
        .args(["api", "/user/orgs", "--jq", ".[].login"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `gh api /user/orgs`: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ServiceError::Other(format!(
            "`gh api /user/orgs` failed: {stderr}"
        )));
    }

    // `--jq '.[].login'` emits one login per line (plain strings, not JSON)
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .map(|l| l.trim().to_owned())
        .filter(|l| !l.is_empty())
        .collect())
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
