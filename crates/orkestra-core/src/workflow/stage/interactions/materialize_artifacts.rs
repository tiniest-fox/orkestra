//! Materialize task artifacts as files in the worktree.
//!
//! Writes all task artifacts to `.orkestra/.artifacts/{name}.md` before agent
//! spawn so agents can read them on demand instead of receiving them inline.
//! Always writes `trak.md` with task identity and description. Also writes
//! the activity log to `activity_log.md` when entries exist. When resources
//! exist (own or inherited from parent), writes `resources.md`.

use std::fmt::Write as _;
use std::fs;
use std::path::Path;

use orkestra_types::runtime::{
    artifact_file_path, artifacts_directory, ResourceStore, ACTIVITY_LOG_ARTIFACT_NAME,
    RESOURCES_ARTIFACT_NAME, TASK_ARTIFACT_NAME,
};

use crate::workflow::domain::Task;
use crate::workflow::stage::types::ActivityLogEntry;

/// Materialize all task artifacts, the activity log, and resources to the worktree.
///
/// Creates `.orkestra/.artifacts/` directory and writes each artifact as
/// `{name}.md`. Always writes `trak.md` with task identity metadata (not
/// included in returned names). When `activity_logs` is non-empty, writes
/// `activity_log.md` and includes `"activity_log"` in the returned names.
/// When resources exist (task's own or parent's), writes `resources.md` and
/// includes `"resources"` in the returned names.
/// Overwrites existing files to ensure freshness.
///
/// Returns the list of materialized stage artifact names (for prompt building).
/// `trak.md` is excluded from the returned list — it is referenced directly
/// by the prompt template, not listed in the "Input Artifacts" section.
pub fn execute(
    task: &Task,
    activity_logs: &[ActivityLogEntry],
    parent_resources: Option<&ResourceStore>,
) -> std::io::Result<Vec<String>> {
    let worktree_path = if let Some(p) = &task.worktree_path {
        Path::new(p)
    } else {
        debug_assert!(
            activity_logs.is_empty(),
            "activity logs present but no worktree to write them to"
        );
        return Ok(Vec::new());
    };

    // Gather all stage artifact names (trak.md is NOT included)
    let mut artifact_names: Vec<String> = task.artifacts.all().map(|a| a.name.clone()).collect();
    let has_activity_logs = !activity_logs.is_empty();

    // Create artifacts directory (always needed — trak.md is always written)
    let artifacts_dir = worktree_path.join(artifacts_directory());
    fs::create_dir_all(&artifacts_dir)
        .map_err(|e| std::io::Error::other(format!("{}: {}", artifacts_dir.display(), e)))?;

    // Always write trak.md (not included in returned artifact_names)
    let task_content = format_task_definition(task);
    let task_file_path = worktree_path.join(artifact_file_path(TASK_ARTIFACT_NAME));
    fs::write(&task_file_path, task_content)
        .map_err(|e| std::io::Error::other(format!("{}: {}", task_file_path.display(), e)))?;

    // Write regular artifacts
    for artifact in task.artifacts.all() {
        let file_path = worktree_path.join(artifact_file_path(&artifact.name));
        fs::write(&file_path, &artifact.content)
            .map_err(|e| std::io::Error::other(format!("{}: {}", file_path.display(), e)))?;
    }

    // Write activity log file
    if has_activity_logs {
        let content = format_activity_log(activity_logs);
        let file_path = worktree_path.join(artifact_file_path(ACTIVITY_LOG_ARTIFACT_NAME));
        fs::write(&file_path, content)
            .map_err(|e| std::io::Error::other(format!("{}: {}", file_path.display(), e)))?;
        artifact_names.push(ACTIVITY_LOG_ARTIFACT_NAME.to_string());
    }

    // Write resources file (merged: parent + task's own, task overrides parent on collision)
    let has_resources =
        !task.resources.is_empty() || parent_resources.is_some_and(|pr| !pr.is_empty());
    if has_resources {
        let mut merged = ResourceStore::new();
        if let Some(parent) = parent_resources {
            merged.merge_from(parent);
        }
        merged.merge_from(&task.resources);

        if !merged.is_empty() {
            let content = format_resources(&merged);
            let file_path = worktree_path.join(artifact_file_path(RESOURCES_ARTIFACT_NAME));
            fs::write(&file_path, content)
                .map_err(|e| std::io::Error::other(format!("{}: {}", file_path.display(), e)))?;
            artifact_names.push(RESOURCES_ARTIFACT_NAME.to_string());
        }
    }

    Ok(artifact_names)
}

// -- Helpers --

/// Format the task definition as a markdown file.
///
/// Produces a stable, human-readable file at `.orkestra/.artifacts/trak.md`
/// so agents can read task identity on demand rather than receiving it inline.
fn format_task_definition(task: &Task) -> String {
    format!(
        "**Trak ID**: {}\n**Title**: {}\n\n### Description\n{}",
        task.id, task.title, task.description
    )
}

/// Format resources into markdown content.
///
/// Renders each resource as a heading with URL and optional description.
/// Resources are sorted by name for deterministic output.
fn format_resources(resources: &ResourceStore) -> String {
    let mut content = String::from("# Resources\n\n");
    let mut sorted: Vec<_> = resources.all().collect();
    sorted.sort_by_key(|r| &r.name);
    for resource in sorted {
        writeln!(content, "## {}", resource.name).expect("write to String is infallible");
        writeln!(content, "**URL**: {}", resource.url).expect("write to String is infallible");
        if let Some(desc) = &resource.description {
            writeln!(content, "{desc}").expect("write to String is infallible");
        }
        write!(content, "*Registered by stage: {}*\n\n", resource.stage)
            .expect("write to String is infallible");
    }
    content
}

/// Format activity log entries into markdown content.
///
/// Each entry is formatted as `[{stage}]\n{content}\n\n`.
fn format_activity_log(logs: &[ActivityLogEntry]) -> String {
    logs.iter().fold(String::new(), |mut s, log| {
        write!(s, "[{}]\n{}\n\n", log.stage, log.content).expect("write to String is infallible");
        s
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::domain::Task;
    use orkestra_types::runtime::{Artifact, ResourceStore, ACTIVITY_LOG_ARTIFACT_NAME};
    use tempfile::TempDir;

    #[test]
    fn test_no_worktree_returns_empty() {
        let task = Task::new("task-1", "Title", "Description", "work", "now");

        let result = execute(&task, &[], None).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_empty_artifacts_writes_trak_md() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);

        let result = execute(&task, &[], None).unwrap();
        // trak.md is not included in returned names
        assert!(result.is_empty());

        // Directory is created and trak.md is written even with no stage artifacts
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(artifacts_dir.exists());
        assert!(artifacts_dir.join("trak.md").exists());
    }

    #[test]
    fn test_trak_md_content_format() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let task = Task::new(
            "task-abc",
            "My Task Title",
            "A detailed description of the task.",
            "work",
            "now",
        )
        .with_worktree(worktree_path);

        execute(&task, &[], None).unwrap();

        let trak_md =
            fs::read_to_string(temp_dir.path().join(".orkestra/.artifacts/trak.md")).unwrap();
        assert!(trak_md.contains("**Trak ID**: task-abc"));
        assert!(trak_md.contains("**Title**: My Task Title"));
        assert!(trak_md.contains("### Description"));
        assert!(trak_md.contains("A detailed description of the task."));
    }

    #[test]
    fn test_trak_md_not_in_returned_names() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "Plan content", "planning", "now"));

        let result = execute(&task, &[], None).unwrap();
        assert_eq!(result, vec!["plan"]);
        assert!(!result.contains(&"trak".to_string()));

        // trak.md is written but not returned
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(artifacts_dir.join("trak.md").exists());
        assert!(artifacts_dir.join("plan.md").exists());
    }

    #[test]
    fn test_materializes_single_artifact() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "The plan content", "planning", "now"));

        let result = execute(&task, &[], None).unwrap();
        assert_eq!(result, vec!["plan"]);

        // Verify file was created with correct content
        let file_path = temp_dir.path().join(".orkestra/.artifacts/plan.md");
        assert!(file_path.exists());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "The plan content");
    }

    #[test]
    fn test_materializes_multiple_artifacts() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "Plan content", "planning", "now"));
        task.artifacts.set(Artifact::new(
            "breakdown",
            "Breakdown content",
            "breakdown",
            "now",
        ));
        task.artifacts
            .set(Artifact::new("summary", "Summary content", "work", "now"));

        let result = execute(&task, &[], None).unwrap();
        assert_eq!(result.len(), 3);
        assert!(result.contains(&"plan".to_string()));
        assert!(result.contains(&"breakdown".to_string()));
        assert!(result.contains(&"summary".to_string()));

        // Verify all files exist with correct content
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert_eq!(
            fs::read_to_string(artifacts_dir.join("plan.md")).unwrap(),
            "Plan content"
        );
        assert_eq!(
            fs::read_to_string(artifacts_dir.join("breakdown.md")).unwrap(),
            "Breakdown content"
        );
        assert_eq!(
            fs::read_to_string(artifacts_dir.join("summary.md")).unwrap(),
            "Summary content"
        );
    }

    #[test]
    fn test_overwrites_existing_files() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        // Pre-create artifacts directory with stale file
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        fs::create_dir_all(&artifacts_dir).unwrap();
        let file_path = artifacts_dir.join("plan.md");
        fs::write(&file_path, "Old content").unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "New content", "planning", "now"));

        let result = execute(&task, &[], None).unwrap();
        assert_eq!(result, vec!["plan"]);

        // Verify file was overwritten
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "New content");
    }

    #[test]
    fn test_creates_nested_directory() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "Content", "planning", "now"));

        // Directory doesn't exist yet
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(!artifacts_dir.exists());

        execute(&task, &[], None).unwrap();

        // Directory should now exist
        assert!(artifacts_dir.exists());
    }

    #[test]
    fn test_error_propagates_for_invalid_worktree() {
        // Use a path that exists but where we can't create subdirectories
        // On Unix, /dev/null is a file, not a directory
        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree("/dev/null");
        task.artifacts
            .set(Artifact::new("plan", "content", "planning", "now"));

        let result = execute(&task, &[], None);
        assert!(result.is_err());
    }

    #[test]
    fn test_materializes_activity_log() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);

        let logs = vec![ActivityLogEntry {
            stage: "work".to_string(),
            iteration_number: 1,
            content: "- Implemented the feature".to_string(),
        }];

        let result = execute(&task, &logs, None).unwrap();
        assert_eq!(result, vec![ACTIVITY_LOG_ARTIFACT_NAME]);

        // Directory should be created
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(artifacts_dir.exists());

        // Activity log file should exist with correct content
        let file_path = artifacts_dir.join("activity_log.md");
        assert!(file_path.exists());
        assert_eq!(
            fs::read_to_string(&file_path).unwrap(),
            "[work]\n- Implemented the feature\n\n"
        );
    }

    #[test]
    fn test_activity_log_with_regular_artifacts() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "Plan content", "planning", "now"));

        let logs = vec![ActivityLogEntry {
            stage: "work".to_string(),
            iteration_number: 1,
            content: "- Did the work".to_string(),
        }];

        let result = execute(&task, &logs, None).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.contains(&"plan".to_string()));
        assert!(result.contains(&ACTIVITY_LOG_ARTIFACT_NAME.to_string()));

        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(artifacts_dir.join("plan.md").exists());
        assert!(artifacts_dir.join("activity_log.md").exists());
    }

    #[test]
    fn test_empty_activity_logs_no_file() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "Plan content", "planning", "now"));

        let result = execute(&task, &[], None).unwrap();
        assert_eq!(result, vec!["plan"]);

        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(artifacts_dir.join("plan.md").exists());
        assert!(!artifacts_dir.join("activity_log.md").exists());
        assert!(!result.contains(&ACTIVITY_LOG_ARTIFACT_NAME.to_string()));
    }

    #[test]
    fn test_activity_log_format() {
        let logs = vec![
            ActivityLogEntry {
                stage: "work".to_string(),
                iteration_number: 1,
                content: "- Line one".to_string(),
            },
            ActivityLogEntry {
                stage: "review".to_string(),
                iteration_number: 2,
                content: "- Line two".to_string(),
            },
        ];

        let formatted = format_activity_log(&logs);
        assert_eq!(formatted, "[work]\n- Line one\n\n[review]\n- Line two\n\n");
    }

    // =========================================================================
    // Resources tests
    // =========================================================================

    #[test]
    fn test_no_resources_no_file() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);

        let result = execute(&task, &[], None).unwrap();

        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(!artifacts_dir.join("resources.md").exists());
        assert!(!result.contains(&"resources".to_string()));
    }

    #[test]
    fn test_task_resources_written() {
        use orkestra_types::runtime::Resource;

        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.resources.set(Resource::new(
            "blog-doc",
            "https://docs.google.com/blog",
            Some("Draft blog post"),
            "planning",
            "now",
        ));

        let result = execute(&task, &[], None).unwrap();

        assert!(result.contains(&"resources".to_string()));
        let content =
            fs::read_to_string(temp_dir.path().join(".orkestra/.artifacts/resources.md")).unwrap();
        assert!(content.contains("## blog-doc"));
        assert!(content.contains("https://docs.google.com/blog"));
        assert!(content.contains("Draft blog post"));
        assert!(content.contains("*Registered by stage: planning*"));
    }

    #[test]
    fn test_parent_resources_included_for_subtask() {
        use orkestra_types::runtime::Resource;

        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        // Subtask has no own resources, but parent does
        let task = Task::new("subtask-1", "Title", "Description", "work", "now")
            .with_worktree(worktree_path);

        let mut parent_resources = ResourceStore::new();
        parent_resources.set(Resource::new(
            "parent-doc",
            "https://parent.example.com",
            None::<String>,
            "planning",
            "now",
        ));

        let result = execute(&task, &[], Some(&parent_resources)).unwrap();

        assert!(result.contains(&"resources".to_string()));
        let content =
            fs::read_to_string(temp_dir.path().join(".orkestra/.artifacts/resources.md")).unwrap();
        assert!(content.contains("## parent-doc"));
        assert!(content.contains("https://parent.example.com"));
    }

    #[test]
    fn test_task_resources_override_parent_on_collision() {
        use orkestra_types::runtime::Resource;

        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task = Task::new("subtask-1", "Title", "Description", "work", "now")
            .with_worktree(worktree_path);
        task.resources.set(Resource::new(
            "shared-doc",
            "https://task-version.example.com",
            None::<String>,
            "work",
            "now",
        ));

        let mut parent_resources = ResourceStore::new();
        parent_resources.set(Resource::new(
            "shared-doc",
            "https://parent-version.example.com",
            None::<String>,
            "planning",
            "now",
        ));

        execute(&task, &[], Some(&parent_resources)).unwrap();

        let content =
            fs::read_to_string(temp_dir.path().join(".orkestra/.artifacts/resources.md")).unwrap();
        // Task's version should win over parent's
        assert!(content.contains("https://task-version.example.com"));
        assert!(!content.contains("https://parent-version.example.com"));
    }

    #[test]
    fn test_resources_format() {
        use orkestra_types::runtime::Resource;

        let mut resources = ResourceStore::new();
        resources.set(Resource::new(
            "my-doc",
            "https://example.com/doc",
            Some("A useful document"),
            "planning",
            "2025-01-01",
        ));

        let formatted = format_resources(&resources);
        assert!(formatted.starts_with("# Resources\n\n"));
        assert!(formatted.contains("## my-doc\n"));
        assert!(formatted.contains("**URL**: https://example.com/doc\n"));
        assert!(formatted.contains("A useful document\n"));
        assert!(formatted.contains("*Registered by stage: planning*\n\n"));
    }
}
