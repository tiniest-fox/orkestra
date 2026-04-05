//! Auto-task template loading.
//!
//! Loads predefined task templates from `.orkestra/tasks/*.md` files.
//! Each template has YAML frontmatter with metadata and a markdown body
//! that becomes the task description.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::WorkflowConfig;

/// A parsed auto-task template ready for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoTaskTemplate {
    /// Display label for the button.
    pub title: String,
    /// Whether the task starts in auto mode.
    pub auto_run: bool,
    /// Flow name to assign (must match a flow in workflow.yaml).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow: Option<String>,
    /// Task description (markdown body after frontmatter).
    pub description: String,
    /// Source filename (e.g., "code-cleanup.md").
    pub filename: String,
}

/// YAML frontmatter fields parsed from the template file.
#[derive(Debug, Deserialize)]
struct Frontmatter {
    title: Option<String>,
    #[serde(default)]
    auto_run: bool,
    flow: Option<String>,
}

/// Load all valid auto-task templates from `.orkestra/tasks/`.
///
/// Templates are sorted alphabetically by filename. Invalid files are
/// skipped with a log message. Returns an empty list if the directory
/// doesn't exist or can't be read.
pub fn load_auto_task_templates(
    project_root: &Path,
    config: &WorkflowConfig,
) -> Vec<AutoTaskTemplate> {
    let tasks_dir = project_root.join(".orkestra").join("tasks");

    let entries = match std::fs::read_dir(&tasks_dir) {
        Ok(entries) => entries,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                eprintln!("[auto-task] Failed to read {}: {e}", tasks_dir.display());
            }
            return Vec::new();
        }
    };

    let mut templates: Vec<AutoTaskTemplate> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();

            // Only read .md files (not subdirectories)
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
                return None;
            }

            let filename = path.file_name()?.to_str()?.to_string();

            match parse_template_file(&path, &filename, config) {
                Ok(template) => Some(template),
                Err(reason) => {
                    eprintln!("[auto-task] Skipping {filename}: {reason}");
                    None
                }
            }
        })
        .collect();

    templates.sort_by(|a, b| a.filename.cmp(&b.filename));
    templates
}

/// Parse a single template file into an `AutoTaskTemplate`.
///
/// Returns an error message string if the file is invalid.
fn parse_template_file(
    path: &Path,
    filename: &str,
    config: &WorkflowConfig,
) -> Result<AutoTaskTemplate, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("failed to read: {e}"))?;

    let (frontmatter, body) = split_frontmatter(&content)
        .ok_or_else(|| "missing YAML frontmatter (expected --- delimiters)".to_string())?;

    let parsed: Frontmatter =
        serde_yaml::from_str(frontmatter).map_err(|e| format!("invalid YAML frontmatter: {e}"))?;

    let title = parsed
        .title
        .ok_or_else(|| "missing required 'title' field".to_string())?;

    if let Some(ref flow) = parsed.flow {
        if !config.flows.contains_key(flow) {
            return Err(format!("flow \"{flow}\" does not exist in workflow config"));
        }
    }

    Ok(AutoTaskTemplate {
        title,
        auto_run: parsed.auto_run,
        flow: parsed.flow,
        description: body.to_string(),
        filename: filename.to_string(),
    })
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn minimal_config() -> WorkflowConfig {
        use crate::workflow::config::StageConfig;
        WorkflowConfig::new(vec![StageConfig::new("work", "summary")])
    }

    fn config_with_quick_flow() -> WorkflowConfig {
        use crate::workflow::config::{FlowConfig, IntegrationConfig, StageConfig};
        use indexmap::IndexMap;

        let mut flows = IndexMap::new();
        flows.insert(
            "quick".to_string(),
            FlowConfig {
                stages: vec![StageConfig::new("work", "summary")],
                integration: IntegrationConfig::new("work"),
            },
        );

        WorkflowConfig::new(vec![StageConfig::new("work", "summary")]).with_flows(flows)
    }

    #[test]
    fn test_split_frontmatter_valid() {
        let content = "---\ntitle: Hello\n---\nBody here";
        let (fm, body) = split_frontmatter(content).unwrap();
        assert_eq!(fm, "title: Hello");
        assert_eq!(body, "Body here");
    }

    #[test]
    fn test_split_frontmatter_no_delimiters() {
        assert!(split_frontmatter("no frontmatter here").is_none());
    }

    #[test]
    fn test_split_frontmatter_missing_closing() {
        assert!(split_frontmatter("---\ntitle: Hello\nno closing").is_none());
    }

    #[test]
    fn test_load_templates_from_directory() {
        let dir = tempdir().unwrap();
        let tasks_dir = dir.path().join(".orkestra").join("tasks");
        std::fs::create_dir_all(&tasks_dir).unwrap();

        std::fs::write(
            tasks_dir.join("alpha.md"),
            "---\ntitle: Alpha Task\nauto_run: true\n---\nAlpha description",
        )
        .unwrap();

        std::fs::write(
            tasks_dir.join("beta.md"),
            "---\ntitle: Beta Task\n---\nBeta description",
        )
        .unwrap();

        let templates = load_auto_task_templates(dir.path(), &minimal_config());
        assert_eq!(templates.len(), 2);
        assert_eq!(templates[0].filename, "alpha.md");
        assert_eq!(templates[0].title, "Alpha Task");
        assert!(templates[0].auto_run);
        assert_eq!(templates[0].description, "Alpha description");
        assert_eq!(templates[1].filename, "beta.md");
        assert_eq!(templates[1].title, "Beta Task");
        assert!(!templates[1].auto_run);
    }

    #[test]
    fn test_load_templates_missing_directory() {
        let dir = tempdir().unwrap();
        let templates = load_auto_task_templates(dir.path(), &minimal_config());
        assert!(templates.is_empty());
    }

    #[test]
    fn test_load_templates_skips_missing_title() {
        let dir = tempdir().unwrap();
        let tasks_dir = dir.path().join(".orkestra").join("tasks");
        std::fs::create_dir_all(&tasks_dir).unwrap();

        std::fs::write(
            tasks_dir.join("bad.md"),
            "---\nauto_run: true\n---\nNo title",
        )
        .unwrap();

        let templates = load_auto_task_templates(dir.path(), &minimal_config());
        assert!(templates.is_empty());
    }

    #[test]
    fn test_load_templates_skips_bad_yaml() {
        let dir = tempdir().unwrap();
        let tasks_dir = dir.path().join(".orkestra").join("tasks");
        std::fs::create_dir_all(&tasks_dir).unwrap();

        std::fs::write(tasks_dir.join("bad.md"), "---\n{{invalid yaml\n---\nBody").unwrap();

        let templates = load_auto_task_templates(dir.path(), &minimal_config());
        assert!(templates.is_empty());
    }

    #[test]
    fn test_load_templates_skips_no_frontmatter() {
        let dir = tempdir().unwrap();
        let tasks_dir = dir.path().join(".orkestra").join("tasks");
        std::fs::create_dir_all(&tasks_dir).unwrap();

        std::fs::write(tasks_dir.join("plain.md"), "Just plain text").unwrap();

        let templates = load_auto_task_templates(dir.path(), &minimal_config());
        assert!(templates.is_empty());
    }

    #[test]
    fn test_load_templates_skips_invalid_flow() {
        let dir = tempdir().unwrap();
        let tasks_dir = dir.path().join(".orkestra").join("tasks");
        std::fs::create_dir_all(&tasks_dir).unwrap();

        std::fs::write(
            tasks_dir.join("bad-flow.md"),
            "---\ntitle: Bad Flow\nflow: nonexistent\n---\nBody",
        )
        .unwrap();

        let templates = load_auto_task_templates(dir.path(), &minimal_config());
        assert!(templates.is_empty());
    }

    #[test]
    fn test_load_templates_with_valid_flow() {
        let dir = tempdir().unwrap();
        let tasks_dir = dir.path().join(".orkestra").join("tasks");
        std::fs::create_dir_all(&tasks_dir).unwrap();

        std::fs::write(
            tasks_dir.join("quick-task.md"),
            "---\ntitle: Quick Task\nflow: quick\n---\nQuick body",
        )
        .unwrap();

        let templates = load_auto_task_templates(dir.path(), &config_with_quick_flow());
        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0].flow, Some("quick".to_string()));
    }

    #[test]
    fn test_load_templates_ignores_non_md_files() {
        let dir = tempdir().unwrap();
        let tasks_dir = dir.path().join(".orkestra").join("tasks");
        std::fs::create_dir_all(&tasks_dir).unwrap();

        std::fs::write(tasks_dir.join("readme.txt"), "not a template").unwrap();
        std::fs::write(tasks_dir.join("valid.md"), "---\ntitle: Valid\n---\nBody").unwrap();

        let templates = load_auto_task_templates(dir.path(), &minimal_config());
        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0].title, "Valid");
    }

    #[test]
    fn test_load_templates_sorted_by_filename() {
        let dir = tempdir().unwrap();
        let tasks_dir = dir.path().join(".orkestra").join("tasks");
        std::fs::create_dir_all(&tasks_dir).unwrap();

        std::fs::write(tasks_dir.join("z-last.md"), "---\ntitle: Last\n---\nBody").unwrap();

        std::fs::write(tasks_dir.join("a-first.md"), "---\ntitle: First\n---\nBody").unwrap();

        let templates = load_auto_task_templates(dir.path(), &minimal_config());
        assert_eq!(templates[0].filename, "a-first.md");
        assert_eq!(templates[1].filename, "z-last.md");
    }
}
