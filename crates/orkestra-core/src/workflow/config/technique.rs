//! Technique, check-script, and model-registry parsing and resolution.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use orkestra_types::config::ToolRestriction;

// ============================================================================
// Public Types
// ============================================================================

/// A parsed technique ready for use in stage configuration.
#[derive(Debug, Clone)]
pub struct Technique {
    /// Derived from filename: "red-green.md" → "red-green".
    pub name: String,
    pub title: String,
    pub description: String,
    pub check: Option<String>,
    pub disallowed_tools: Vec<ToolRestriction>,
    pub model: Option<String>,
    /// Prompt content after frontmatter.
    pub body: String,
}

/// Metadata parsed from a check script's embedded YAML block.
#[derive(Debug, Clone)]
pub struct CheckMetadata {
    pub title: String,
    pub description: String,
    pub timeout_seconds: u64,
}

/// Registry of model identifiers ranked by preference.
#[derive(Debug, Clone, Deserialize)]
pub struct ModelRegistry {
    pub default: String,
    pub ranked: Vec<String>,
}

// ============================================================================
// Error Type
// ============================================================================

/// Errors that can occur when loading or parsing technique files.
#[derive(Debug, thiserror::Error)]
pub enum TechniqueLoadError {
    #[error("technique file not found: {0}")]
    NotFound(PathBuf),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("failed to parse technique frontmatter: {0}")]
    Parse(#[from] serde_yaml::Error),
    #[error("invalid technique: {0}")]
    Validation(String),
}

// ============================================================================
// Private Types
// ============================================================================

#[derive(Debug, Deserialize)]
struct TechniqueFrontmatter {
    title: String,
    description: String,
    check: Option<String>,
    #[serde(default)]
    disallowed_tools: Vec<ToolRestriction>,
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CheckMetadataRaw {
    title: String,
    description: String,
    timeout_seconds: u64,
}

// ============================================================================
// Public Functions
// ============================================================================

/// Parse a technique file from the given path.
///
/// Returns `TechniqueLoadError::NotFound` if the file does not exist.
/// Derives `name` from the filename stem (e.g., "red-green.md" → "red-green").
pub fn parse_technique(path: &Path) -> Result<Technique, TechniqueLoadError> {
    if !path.exists() {
        return Err(TechniqueLoadError::NotFound(path.to_path_buf()));
    }

    let content = std::fs::read_to_string(path)?;

    let (frontmatter_str, body) = split_frontmatter(&content).ok_or_else(|| {
        TechniqueLoadError::Validation(
            "missing YAML frontmatter (expected --- delimiters)".to_string(),
        )
    })?;

    let frontmatter: TechniqueFrontmatter = serde_yaml::from_str(frontmatter_str)?;

    let name = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    Ok(Technique {
        name,
        title: frontmatter.title,
        description: frontmatter.description,
        check: frontmatter.check,
        disallowed_tools: frontmatter.disallowed_tools,
        model: frontmatter.model,
        body: body.to_string(),
    })
}

/// Parse check metadata from check script content.
///
/// Expects the script to contain a `# ---` delimited YAML metadata block
/// after the shebang line. Strips leading `# ` from each line before parsing.
pub fn parse_check_metadata(content: &str) -> Result<CheckMetadata, TechniqueLoadError> {
    let lines: Vec<&str> = content.lines().collect();

    // Find the first `# ---` delimiter
    let start = lines.iter().position(|l| *l == "# ---").ok_or_else(|| {
        TechniqueLoadError::Validation(
            "check script missing '# ---' metadata delimiters".to_string(),
        )
    })?;

    // Find the closing `# ---` delimiter after the opening one
    let end = lines[start + 1..]
        .iter()
        .position(|l| *l == "# ---")
        .ok_or_else(|| {
            TechniqueLoadError::Validation(
                "check script missing closing '# ---' delimiter".to_string(),
            )
        })?
        + start
        + 1;

    // Strip leading `# ` from each line between the delimiters
    let yaml_lines: Vec<&str> = lines[start + 1..end]
        .iter()
        .map(|l| l.strip_prefix("# ").unwrap_or(l))
        .collect();
    let yaml = yaml_lines.join("\n");

    let raw: CheckMetadataRaw = serde_yaml::from_str(&yaml).map_err(|e| {
        TechniqueLoadError::Validation(format!("failed to parse check metadata YAML: {e}"))
    })?;

    Ok(CheckMetadata {
        title: raw.title,
        description: raw.description,
        timeout_seconds: raw.timeout_seconds,
    })
}

/// Parse a model registry from YAML content.
///
/// Validates that `default` and `ranked` are non-empty.
pub fn parse_model_registry(content: &str) -> Result<ModelRegistry, TechniqueLoadError> {
    let registry: ModelRegistry = serde_yaml::from_str(content)?;

    if registry.default.is_empty() {
        return Err(TechniqueLoadError::Validation(
            "model registry 'default' must not be empty".to_string(),
        ));
    }
    if registry.ranked.is_empty() {
        return Err(TechniqueLoadError::Validation(
            "model registry 'ranked' must not be empty".to_string(),
        ));
    }

    Ok(registry)
}

// -- Helpers --

/// Split a markdown file into YAML frontmatter and body.
///
/// Expects the file to start with `---`, followed by YAML, then `---`,
/// then the body content.
fn split_frontmatter(content: &str) -> Option<(&str, &str)> {
    let content = content.strip_prefix("---")?;
    let end = content.find("\n---")?;
    let frontmatter = content[..end].trim();
    let body = content[end + 4..].trim(); // skip past "\n---"
    Some((frontmatter, body))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_parse_technique_valid() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("red-green.md");
        std::fs::write(
            &path,
            "---\ntitle: Red Green\ndescription: TDD cycle\ncheck: checks.sh\ndisallowed_tools:\n  - pattern: 'Bash(cargo *)'\n    message: Use the gate\nmodel: claudecode/sonnet\n---\nWrite failing tests first.",
        )
        .unwrap();

        let t = parse_technique(&path).unwrap();
        assert_eq!(t.name, "red-green");
        assert_eq!(t.title, "Red Green");
        assert_eq!(t.description, "TDD cycle");
        assert_eq!(t.check, Some("checks.sh".to_string()));
        assert_eq!(t.disallowed_tools.len(), 1);
        assert_eq!(t.disallowed_tools[0].pattern, "Bash(cargo *)");
        assert_eq!(t.model, Some("claudecode/sonnet".to_string()));
        assert_eq!(t.body, "Write failing tests first.");
    }

    #[test]
    fn test_parse_technique_missing_title() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("no-title.md");
        std::fs::write(&path, "---\ndescription: No title here\n---\nBody").unwrap();

        let result = parse_technique(&path);
        assert!(matches!(result, Err(TechniqueLoadError::Parse(_))));
    }

    #[test]
    fn test_parse_technique_not_found() {
        let path = Path::new("/nonexistent/path/technique.md");
        let result = parse_technique(path);
        assert!(matches!(result, Err(TechniqueLoadError::NotFound(_))));
    }

    #[test]
    fn test_parse_technique_no_frontmatter() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("plain.md");
        std::fs::write(&path, "Just plain text without frontmatter").unwrap();

        let result = parse_technique(&path);
        assert!(matches!(result, Err(TechniqueLoadError::Validation(_))));
    }

    #[test]
    fn test_parse_technique_minimal() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("minimal.md");
        std::fs::write(
            &path,
            "---\ntitle: Minimal\ndescription: Bare minimum\n---\nBody content",
        )
        .unwrap();

        let t = parse_technique(&path).unwrap();
        assert_eq!(t.name, "minimal");
        assert_eq!(t.title, "Minimal");
        assert_eq!(t.description, "Bare minimum");
        assert!(t.check.is_none());
        assert!(t.disallowed_tools.is_empty());
        assert!(t.model.is_none());
        assert_eq!(t.body, "Body content");
    }

    #[test]
    fn test_parse_check_metadata_valid() {
        let content = "#!/bin/bash\n# ---\n# title: Run Tests\n# description: Runs the full test suite\n# timeout_seconds: 300\n# ---\necho 'running'";
        let meta = parse_check_metadata(content).unwrap();
        assert_eq!(meta.title, "Run Tests");
        assert_eq!(meta.description, "Runs the full test suite");
        assert_eq!(meta.timeout_seconds, 300);
    }

    #[test]
    fn test_parse_check_metadata_no_delimiters() {
        let content = "#!/bin/bash\necho 'no metadata here'";
        let result = parse_check_metadata(content);
        assert!(matches!(result, Err(TechniqueLoadError::Validation(_))));
    }

    #[test]
    fn test_parse_model_registry_valid() {
        let yaml = "default: claudecode/sonnet\nranked:\n  - claudecode/opus\n  - claudecode/sonnet\n  - claudecode/haiku\n";
        let registry = parse_model_registry(yaml).unwrap();
        assert_eq!(registry.default, "claudecode/sonnet");
        assert_eq!(registry.ranked.len(), 3);
        assert_eq!(registry.ranked[0], "claudecode/opus");
    }

    #[test]
    fn test_parse_model_registry_empty_ranked() {
        let yaml = "default: claudecode/sonnet\nranked: []\n";
        let result = parse_model_registry(yaml);
        assert!(matches!(result, Err(TechniqueLoadError::Validation(_))));
    }
}
