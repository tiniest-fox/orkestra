use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::Path;

const DEFAULT_WORKTREE_SETUP: &str = include_str!("defaults/worktree_setup.sh");
const DEFAULT_WORKFLOW: &str = include_str!("defaults/workflow.yaml");

const DEFAULT_PROMPTS: &[(&str, &str)] = &[
    ("planner.md", include_str!("defaults/agents/planner.md")),
    ("breakdown.md", include_str!("defaults/agents/breakdown.md")),
    ("worker.md", include_str!("defaults/agents/worker.md")),
    ("reviewer.md", include_str!("defaults/agents/reviewer.md")),
];

/// Subdirectories created inside `.orkestra/` on init.
const ORKESTRA_SUBDIRS: &[&str] = &[".database", ".logs", "scripts", "agents"];

/// Lines that must appear in the project's `.gitignore`.
const REQUIRED_GITIGNORE_ENTRIES: &[&str] = &[
    ".orkestra/.database/",
    ".orkestra/.logs/",
    ".orkestra/.worktrees/",
];

/// Ensures `.orkestra/` has its full directory structure and default files.
///
/// Creates subdirs, writes default `workflow.yaml`, agent prompts, and
/// `worktree_setup.sh` — all skip if the file already exists. Also ensures
/// the project's `.gitignore` contains entries for Orkestra runtime data.
pub fn ensure_orkestra_project(orkestra_dir: &Path) -> std::io::Result<()> {
    let first_init = !orkestra_dir.exists();

    fs::create_dir_all(orkestra_dir)?;
    for subdir in ORKESTRA_SUBDIRS {
        fs::create_dir_all(orkestra_dir.join(subdir))?;
    }

    write_default(
        orkestra_dir,
        "scripts/worktree_setup.sh",
        DEFAULT_WORKTREE_SETUP,
    )?;
    write_default(orkestra_dir, "workflow.yaml", DEFAULT_WORKFLOW)?;

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
