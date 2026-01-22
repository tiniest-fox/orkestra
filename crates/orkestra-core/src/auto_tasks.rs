//! Auto-tasks module for reusable task templates stored as markdown files.
//!
//! Auto-tasks are markdown files in `.orkestra/tasks/` with YAML frontmatter
//! that define reusable task templates. They can be quickly created from the UI.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// An auto-task template loaded from a markdown file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoTask {
    /// The filename without the .md extension (used as identifier)
    pub name: String,
    /// Display title from frontmatter
    pub title: String,
    /// Task description (markdown body after frontmatter)
    pub description: String,
    /// Whether to auto-run (auto-approve) tasks created from this template
    pub auto_run: bool,
}

/// YAML frontmatter structure for auto-task files.
#[derive(Debug, Deserialize)]
struct AutoTaskFrontmatter {
    title: String,
    #[serde(default)]
    auto_run: bool,
}

/// Lists all auto-tasks from the `.orkestra/tasks/` directory.
///
/// Reads all `.md` files from the tasks directory, parses their YAML frontmatter,
/// and returns a list of auto-task definitions. Invalid files are skipped with
/// a warning printed to stderr.
pub fn list_auto_tasks(project_root: &Path) -> crate::Result<Vec<AutoTask>> {
    let tasks_dir = project_root.join(".orkestra").join("tasks");

    // If the directory doesn't exist, return empty list
    if !tasks_dir.exists() {
        return Ok(vec![]);
    }

    let mut auto_tasks = Vec::new();

    let entries = fs::read_dir(&tasks_dir).map_err(|e| {
        crate::OrkestraError::Io(std::io::Error::new(
            e.kind(),
            format!("Failed to read auto-tasks directory: {e}"),
        ))
    })?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                eprintln!("[auto_tasks] Warning: Failed to read directory entry: {e}");
                continue;
            }
        };

        let path = entry.path();

        // Skip non-.md files
        if path.extension().is_none_or(|ext| ext != "md") {
            continue;
        }

        // Get the filename without extension as the name
        let name = match path.file_stem().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        // Read and parse the file
        match parse_auto_task_file(&path, &name) {
            Ok(auto_task) => auto_tasks.push(auto_task),
            Err(e) => {
                eprintln!(
                    "[auto_tasks] Warning: Failed to parse {}: {e}",
                    path.display()
                );
            }
        }
    }

    // Sort by name for consistent ordering
    auto_tasks.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(auto_tasks)
}

/// Gets a specific auto-task by name.
pub fn get_auto_task(project_root: &Path, name: &str) -> crate::Result<AutoTask> {
    let tasks_dir = project_root.join(".orkestra").join("tasks");
    let path = tasks_dir.join(format!("{name}.md"));

    if !path.exists() {
        return Err(crate::OrkestraError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Auto-task '{name}' not found"),
        )));
    }

    parse_auto_task_file(&path, name)
}

/// Parses a single auto-task markdown file.
fn parse_auto_task_file(path: &Path, name: &str) -> crate::Result<AutoTask> {
    let content = fs::read_to_string(path).map_err(|e| {
        crate::OrkestraError::Io(std::io::Error::new(
            e.kind(),
            format!("Failed to read auto-task file: {e}"),
        ))
    })?;

    parse_auto_task_content(&content, name)
}

/// Parses auto-task content (frontmatter + body).
fn parse_auto_task_content(content: &str, name: &str) -> crate::Result<AutoTask> {
    // Check for YAML frontmatter (starts with ---)
    if !content.starts_with("---") {
        return Err(crate::OrkestraError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Auto-task file must start with YAML frontmatter (---)",
        )));
    }

    // Find the end of frontmatter
    let rest = &content[3..];
    let end_index = rest.find("\n---").ok_or_else(|| {
        crate::OrkestraError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Auto-task file missing closing frontmatter (---)",
        ))
    })?;

    let frontmatter_str = &rest[..end_index];
    let body = rest[end_index + 4..].trim(); // Skip the closing ---

    // Parse YAML frontmatter manually (simple key: value parsing)
    let frontmatter = parse_simple_yaml(frontmatter_str)?;

    Ok(AutoTask {
        name: name.to_string(),
        title: frontmatter.title,
        description: body.to_string(),
        auto_run: frontmatter.auto_run,
    })
}

/// Simple YAML parser for frontmatter (avoids adding `serde_yaml` dependency).
fn parse_simple_yaml(yaml: &str) -> crate::Result<AutoTaskFrontmatter> {
    let mut title: Option<String> = None;
    let mut auto_run = false;

    for line in yaml.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim();
            let value = value.trim();
            // Remove quotes if present
            let value = value
                .trim_start_matches('"')
                .trim_end_matches('"')
                .trim_start_matches('\'')
                .trim_end_matches('\'');

            match key {
                "title" => title = Some(value.to_string()),
                "auto_run" => {
                    auto_run = matches!(value.to_lowercase().as_str(), "true" | "yes" | "1");
                }
                _ => {} // Ignore unknown keys
            }
        }
    }

    let title = title.ok_or_else(|| {
        crate::OrkestraError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Auto-task frontmatter missing required 'title' field",
        ))
    })?;

    Ok(AutoTaskFrontmatter { title, auto_run })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_parse_auto_task_content() {
        let content = r#"---
title: "Code Cleanup"
auto_run: true
---

Clean up the codebase by running linters and formatters."#;

        let result = parse_auto_task_content(content, "code-cleanup").unwrap();
        assert_eq!(result.name, "code-cleanup");
        assert_eq!(result.title, "Code Cleanup");
        assert!(result.auto_run);
        assert!(result.description.contains("Clean up the codebase"));
    }

    #[test]
    fn test_parse_auto_task_default_auto_run() {
        let content = r#"---
title: "Update Dependencies"
---

Check for outdated dependencies."#;

        let result = parse_auto_task_content(content, "update-deps").unwrap();
        assert_eq!(result.title, "Update Dependencies");
        assert!(!result.auto_run); // Default is false
    }

    #[test]
    fn test_parse_auto_task_missing_title() {
        let content = r"---
auto_run: true
---

Some description.";

        let result = parse_auto_task_content(content, "test");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_auto_task_no_frontmatter() {
        let content = "Just some markdown without frontmatter.";

        let result = parse_auto_task_content(content, "test");
        assert!(result.is_err());
    }

    #[test]
    fn test_list_auto_tasks_empty_dir() {
        let temp_dir = TempDir::new().unwrap();
        let result = list_auto_tasks(temp_dir.path()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_list_auto_tasks_with_files() {
        let temp_dir = TempDir::new().unwrap();
        let tasks_dir = temp_dir.path().join(".orkestra").join("tasks");
        fs::create_dir_all(&tasks_dir).unwrap();

        // Create a valid auto-task file
        fs::write(
            tasks_dir.join("cleanup.md"),
            r#"---
title: "Cleanup"
auto_run: false
---

Run cleanup."#,
        )
        .unwrap();

        // Create another file
        fs::write(
            tasks_dir.join("build.md"),
            r#"---
title: "Build"
auto_run: true
---

Run build."#,
        )
        .unwrap();

        let result = list_auto_tasks(temp_dir.path()).unwrap();
        assert_eq!(result.len(), 2);
        // Should be sorted by name
        assert_eq!(result[0].name, "build");
        assert_eq!(result[1].name, "cleanup");
    }
}
