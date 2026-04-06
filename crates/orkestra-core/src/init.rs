use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::Path;

const DEFAULT_WORKTREE_SETUP: &str = include_str!("defaults/worktree_setup.sh");
const DEFAULT_WORKTREE_CLEANUP: &str = include_str!("defaults/worktree_cleanup.sh");
const DEFAULT_CHECKS: &str = include_str!("defaults/checks.sh");
const DEFAULT_WORKFLOW: &str = include_str!("defaults/workflow.yaml");
const DEFAULT_README: &str = include_str!("defaults/README.md");

const DEFAULT_PROMPTS: &[(&str, &str)] = &[
    ("planner.md", include_str!("defaults/agents/planner.md")),
    ("breakdown.md", include_str!("defaults/agents/breakdown.md")),
    ("worker.md", include_str!("defaults/agents/worker.md")),
    ("reviewer.md", include_str!("defaults/agents/reviewer.md")),
    ("compound.md", include_str!("defaults/agents/compound.md")),
];

/// Subdirectories created inside `.orkestra/` on init.
const ORKESTRA_SUBDIRS: &[&str] = &[".database", ".logs", "scripts", "agents"];

/// Lines that must appear in the project's `.gitignore`.
const REQUIRED_GITIGNORE_ENTRIES: &[&str] = &[
    ".orkestra/.database/",
    ".orkestra/.logs/",
    ".orkestra/.worktrees/",
    ".orkestra/.artifacts/",
];

/// Ensures `.orkestra/` has its full directory structure and default files.
///
/// Creates subdirs, writes default `workflow.yaml`, agent prompts,
/// `worktree_setup.sh`, `checks.sh`, and `README.md` — all skip if the file already exists.
/// Also ensures the project's `.gitignore` contains entries for Orkestra runtime data.
pub fn ensure_orkestra_project(orkestra_dir: &Path) -> std::io::Result<()> {
    let first_init = !orkestra_dir.exists();

    fs::create_dir_all(orkestra_dir)?;
    for subdir in ORKESTRA_SUBDIRS {
        fs::create_dir_all(orkestra_dir.join(subdir))?;
    }

    write_default_executable(
        orkestra_dir,
        "scripts/worktree_setup.sh",
        DEFAULT_WORKTREE_SETUP,
    )?;
    write_default_executable(
        orkestra_dir,
        "scripts/worktree_cleanup.sh",
        DEFAULT_WORKTREE_CLEANUP,
    )?;
    write_default_executable(orkestra_dir, "scripts/checks.sh", DEFAULT_CHECKS)?;
    write_default(orkestra_dir, "workflow.yaml", DEFAULT_WORKFLOW)?;
    write_default(orkestra_dir, "README.md", DEFAULT_README)?;

    for (filename, content) in DEFAULT_PROMPTS {
        write_default(orkestra_dir, &format!("agents/{filename}"), content)?;
    }

    if first_init {
        ensure_gitignore_entries(orkestra_dir)?;
    }

    Ok(())
}

/// Write a default file only if it doesn't already exist.
fn write_default(orkestra_dir: &Path, relative_path: &str, content: &str) -> std::io::Result<()> {
    let path = orkestra_dir.join(relative_path);
    if !path.exists() {
        fs::write(&path, content)?;
    }
    Ok(())
}

/// Write a default file only if it doesn't already exist, with executable permission.
///
/// Delegates content writing to [`write_default`], then unconditionally applies
/// executable permissions so partial writes (content written, permissions failed)
/// self-heal on the next call.
fn write_default_executable(
    orkestra_dir: &Path,
    relative_path: &str,
    content: &str,
) -> std::io::Result<()> {
    let path = orkestra_dir.join(relative_path);
    write_default(orkestra_dir, relative_path, content)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&path)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&path, perms)?;
    }
    Ok(())
}

/// Appends missing Orkestra entries to the project's `.gitignore`.
///
/// Scans for each line in [`REQUIRED_GITIGNORE_ENTRIES`]. Any that are absent
/// get appended under an `# Orkestra internals` comment.
fn ensure_gitignore_entries(orkestra_dir: &Path) -> std::io::Result<()> {
    let Some(project_root) = orkestra_dir.parent() else {
        return Ok(());
    };

    let gitignore_path = project_root.join(".gitignore");
    let existing_content = if gitignore_path.exists() {
        fs::read_to_string(&gitignore_path)?
    } else {
        String::new()
    };

    let existing_lines: HashSet<&str> = existing_content.lines().map(str::trim).collect();

    let missing: Vec<&str> = REQUIRED_GITIGNORE_ENTRIES
        .iter()
        .filter(|entry| !existing_lines.contains(**entry))
        .copied()
        .collect();

    if missing.is_empty() {
        return Ok(());
    }

    let mut appendix = String::new();
    if !existing_content.is_empty() && !existing_content.ends_with('\n') {
        appendix.push('\n');
    }
    appendix.push_str("\n# Orkestra internals\n");
    for entry in &missing {
        appendix.push_str(entry);
        appendix.push('\n');
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&gitignore_path)?;
    file.write_all(appendix.as_bytes())?;

    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_ensure_gitignore_creates_new_file() {
        let temp_dir = TempDir::new().unwrap();
        let orkestra_dir = temp_dir.path().join(".orkestra");
        fs::create_dir_all(&orkestra_dir).unwrap();

        ensure_gitignore_entries(&orkestra_dir).unwrap();

        let gitignore_path = temp_dir.path().join(".gitignore");
        assert!(gitignore_path.exists());
        let content = fs::read_to_string(&gitignore_path).unwrap();
        assert!(content.contains("# Orkestra internals"));
        for entry in REQUIRED_GITIGNORE_ENTRIES {
            assert!(content.contains(entry), "Missing entry: {entry}");
        }
    }

    #[test]
    fn test_ensure_gitignore_appends_to_existing() {
        let temp_dir = TempDir::new().unwrap();
        let orkestra_dir = temp_dir.path().join(".orkestra");
        fs::create_dir_all(&orkestra_dir).unwrap();

        // Create existing gitignore with unrelated content
        let gitignore_path = temp_dir.path().join(".gitignore");
        fs::write(&gitignore_path, "node_modules/\ntarget/\n").unwrap();

        ensure_gitignore_entries(&orkestra_dir).unwrap();

        let content = fs::read_to_string(&gitignore_path).unwrap();
        assert!(content.contains("node_modules/"));
        assert!(content.contains("target/"));
        assert!(content.contains("# Orkestra internals"));
        for entry in REQUIRED_GITIGNORE_ENTRIES {
            assert!(content.contains(entry), "Missing entry: {entry}");
        }
    }

    #[test]
    fn test_ensure_gitignore_idempotent() {
        let temp_dir = TempDir::new().unwrap();
        let orkestra_dir = temp_dir.path().join(".orkestra");
        fs::create_dir_all(&orkestra_dir).unwrap();

        // Run twice
        ensure_gitignore_entries(&orkestra_dir).unwrap();
        ensure_gitignore_entries(&orkestra_dir).unwrap();

        let content = fs::read_to_string(temp_dir.path().join(".gitignore")).unwrap();
        // Count occurrences of each entry - should appear exactly once
        for entry in REQUIRED_GITIGNORE_ENTRIES {
            let count = content.matches(entry).count();
            assert_eq!(count, 1, "Entry {entry} appears {count} times");
        }
    }

    #[test]
    fn test_ensure_gitignore_handles_missing_trailing_newline() {
        let temp_dir = TempDir::new().unwrap();
        let orkestra_dir = temp_dir.path().join(".orkestra");
        fs::create_dir_all(&orkestra_dir).unwrap();

        // Create gitignore without trailing newline
        let gitignore_path = temp_dir.path().join(".gitignore");
        fs::write(&gitignore_path, "node_modules/").unwrap(); // No newline

        ensure_gitignore_entries(&orkestra_dir).unwrap();

        let content = fs::read_to_string(&gitignore_path).unwrap();
        // Should have added newline before Orkestra section
        assert!(
            content.contains("node_modules/\n"),
            "Missing newline after existing content"
        );
    }

    #[test]
    fn test_default_workflow_parses_with_gate() {
        let config: crate::workflow::config::WorkflowConfig =
            serde_yaml::from_str(DEFAULT_WORKFLOW).expect("Default workflow.yaml should parse");

        // Verify gate on work stage (check in the default flow)
        let work_stage = config
            .stage("default", "work")
            .expect("Should have work stage in default flow");
        assert!(work_stage.gate.is_some(), "Work stage should have a gate");
        let gate = work_stage.gate.as_ref().unwrap();
        assert!(
            gate.command.contains("checks.sh"),
            "Gate should reference checks.sh"
        );

        // Verify descriptions on all unique stages
        for stage in config.all_unique_stages() {
            assert!(
                stage.description.is_some(),
                "Stage '{}' should have a description",
                stage.name
            );
        }
    }

    #[test]
    fn test_checks_script_is_executable() {
        let temp_dir = TempDir::new().unwrap();
        let orkestra_dir = temp_dir.path().join(".orkestra");

        ensure_orkestra_project(&orkestra_dir).unwrap();

        let checks_path = orkestra_dir.join("scripts/checks.sh");
        assert!(checks_path.exists(), "checks.sh should be created");

        let worktree_setup_path = orkestra_dir.join("scripts/worktree_setup.sh");
        assert!(
            worktree_setup_path.exists(),
            "worktree_setup.sh should be created"
        );

        let worktree_cleanup_path = orkestra_dir.join("scripts/worktree_cleanup.sh");
        assert!(
            worktree_cleanup_path.exists(),
            "worktree_cleanup.sh should be created"
        );

        let readme_path = orkestra_dir.join("README.md");
        assert!(readme_path.exists(), "README.md should be created");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&checks_path).unwrap().permissions().mode();
            assert_eq!(mode & 0o111, 0o111, "checks.sh should be executable");

            let mode = fs::metadata(&worktree_setup_path)
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(
                mode & 0o111,
                0o111,
                "worktree_setup.sh should be executable"
            );

            let mode = fs::metadata(&worktree_cleanup_path)
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(
                mode & 0o111,
                0o111,
                "worktree_cleanup.sh should be executable"
            );
        }
    }

    #[test]
    fn test_init_does_not_overwrite_existing_checks() {
        let temp_dir = TempDir::new().unwrap();
        let orkestra_dir = temp_dir.path().join(".orkestra");
        fs::create_dir_all(orkestra_dir.join("scripts")).unwrap();

        let checks_path = orkestra_dir.join("scripts/checks.sh");
        fs::write(&checks_path, "#!/bin/bash\nmy custom checks").unwrap();

        ensure_orkestra_project(&orkestra_dir).unwrap();

        let content = fs::read_to_string(&checks_path).unwrap();
        assert!(
            content.contains("my custom checks"),
            "Should not overwrite existing checks.sh"
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&checks_path).unwrap().permissions().mode();
            assert_eq!(
                mode & 0o111,
                0o111,
                "write_default_executable should apply executable bit to pre-existing files"
            );
        }
    }
}
