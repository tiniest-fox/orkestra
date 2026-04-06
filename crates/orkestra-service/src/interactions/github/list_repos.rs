//! List GitHub repositories via the `gh` CLI.

use crate::types::{GithubRepo, ServiceError};

/// List all repositories accessible to the authenticated user.
///
/// Returns repos where the user is an owner, collaborator, or organization
/// member in a single API call. Uses `--paginate` to handle users with more
/// than 100 repos.
pub fn execute() -> Result<Vec<GithubRepo>, ServiceError> {
    let output = std::process::Command::new("gh")
        .args([
            "api",
            "/user/repos?affiliation=owner,collaborator,organization_member&per_page=100",
            "--paginate",
            "--jq",
            r"[.[] | {name, nameWithOwner: .full_name, url: .html_url, description}]",
        ])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .output()
        .map_err(|e| ServiceError::Other(format!("Failed to run `gh api /user/repos`: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ServiceError::Other(format!(
            "`gh api /user/repos` failed: {stderr}"
        )));
    }

    parse_paginated_output(&output.stdout)
}

// -- Helpers --

/// Parse `--paginate` output, which emits one JSON array per page.
///
/// With `--jq`, `gh api --paginate` outputs a separate JSON array per page
/// (e.g. `[...][...]`). We wrap these in an outer array to make valid JSON,
/// then flatten.
fn parse_paginated_output(stdout: &[u8]) -> Result<Vec<GithubRepo>, ServiceError> {
    let text = String::from_utf8_lossy(stdout);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    // Single page: already valid JSON array
    if let Ok(repos) = serde_json::from_str::<Vec<GithubRepo>>(trimmed) {
        return Ok(repos);
    }

    // Multiple pages: concatenated arrays like `[...][...]`
    // Insert commas between arrays, wrap, and parse as Vec<Vec<GithubRepo>>
    let joined = trimmed.replace("][", "],[");
    let wrapped = format!("[{joined}]");
    let pages: Vec<Vec<GithubRepo>> = serde_json::from_str(&wrapped)
        .map_err(|e| ServiceError::Other(format!("Failed to parse repo list output: {e}")))?;

    Ok(pages.into_iter().flatten().collect())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_page_output() {
        let json = r#"[
            {
                "name": "my-repo",
                "nameWithOwner": "alice/my-repo",
                "url": "https://github.com/alice/my-repo",
                "description": "A great repo"
            },
            {
                "name": "collab-repo",
                "nameWithOwner": "bob/collab-repo",
                "url": "https://github.com/bob/collab-repo",
                "description": null
            }
        ]"#;

        let repos = parse_paginated_output(json.as_bytes()).unwrap();
        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].name_with_owner, "alice/my-repo");
        assert_eq!(repos[0].description.as_deref(), Some("A great repo"));
        assert!(repos[1].description.is_none());
    }

    #[test]
    fn parses_multi_page_output() {
        // --paginate with --jq emits one array per page, concatenated
        let json = r#"[{"name":"a","nameWithOwner":"x/a","url":"https://github.com/x/a","description":null}][{"name":"b","nameWithOwner":"y/b","url":"https://github.com/y/b","description":"B"}]"#;

        let repos = parse_paginated_output(json.as_bytes()).unwrap();
        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].name_with_owner, "x/a");
        assert_eq!(repos[1].name_with_owner, "y/b");
    }

    #[test]
    fn parses_empty_output() {
        let repos = parse_paginated_output(b"").unwrap();
        assert!(repos.is_empty());

        let repos = parse_paginated_output(b"  ").unwrap();
        assert!(repos.is_empty());
    }
}
