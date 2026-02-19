//! Materialize task artifacts as files in the worktree.
//!
//! Writes all task artifacts to `.orkestra/.artifacts/{name}.md` before agent
//! spawn so agents can read them on demand instead of receiving them inline.

use std::fs;
use std::path::Path;

use orkestra_types::runtime::{artifact_file_path, artifacts_directory};

use crate::workflow::domain::Task;

/// Materialize all task artifacts to the worktree.
///
/// Creates `.orkestra/.artifacts/` directory if needed and writes each artifact
/// as `{name}.md`. Overwrites existing files to ensure freshness.
///
/// Returns the list of materialized artifact names (for prompt building).
pub fn execute(task: &Task) -> std::io::Result<Vec<String>> {
    let worktree_path = match &task.worktree_path {
        Some(p) => Path::new(p),
        None => return Ok(Vec::new()), // No worktree = no materialization
    };

    // Gather all artifact names
    let artifact_names: Vec<String> = task.artifacts.all().map(|a| a.name.clone()).collect();

    if artifact_names.is_empty() {
        return Ok(Vec::new());
    }

    // Create artifacts directory
    let artifacts_dir = worktree_path.join(artifacts_directory());
    fs::create_dir_all(&artifacts_dir)?;

    // Write each artifact using canonical path function
    for artifact in task.artifacts.all() {
        let file_path = worktree_path.join(artifact_file_path(&artifact.name));
        fs::write(&file_path, &artifact.content)?;
    }

    Ok(artifact_names)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::domain::Task;
    use orkestra_types::runtime::Artifact;
    use tempfile::TempDir;

    #[test]
    fn test_no_worktree_returns_empty() {
        let task = Task::new("task-1", "Title", "Description", "work", "now");

        let result = execute(&task).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_empty_artifacts_returns_empty() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);

        let result = execute(&task).unwrap();
        assert!(result.is_empty());

        // Directory should not be created for empty artifacts
        let artifacts_dir = temp_dir.path().join(".orkestra/.artifacts");
        assert!(!artifacts_dir.exists());
    }

    #[test]
    fn test_materializes_single_artifact() {
        let temp_dir = TempDir::new().unwrap();
        let worktree_path = temp_dir.path().to_str().unwrap();

        let mut task =
            Task::new("task-1", "Title", "Description", "work", "now").with_worktree(worktree_path);
        task.artifacts
            .set(Artifact::new("plan", "The plan content", "planning", "now"));

        let result = execute(&task).unwrap();
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

        let result = execute(&task).unwrap();
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

        let result = execute(&task).unwrap();
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

        execute(&task).unwrap();

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

        let result = execute(&task);
        assert!(result.is_err());
    }
}
