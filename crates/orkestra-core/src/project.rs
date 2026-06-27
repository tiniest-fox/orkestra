use std::fs;
use std::path::PathBuf;

/// Finds the project root by looking for workspace Cargo.toml or .orkestra directory.
///
/// **Important**: If running inside a git worktree, this returns the MAIN repo root,
/// not the worktree path. This ensures all worktrees share the same database.
pub fn find_project_root() -> std::io::Result<PathBuf> {
    let mut current = std::env::current_dir()?;

    loop {
        // Check for .orkestra directory
        if current.join(".orkestra").exists() {
            // Found .orkestra, but check if we're in a worktree
            if let Some(main_repo) = find_main_repo_if_worktree(&current) {
                return Ok(main_repo);
            }
            return Ok(current);
        }

        // Check for workspace Cargo.toml (contains [workspace])
        let cargo_toml = current.join("Cargo.toml");
        if cargo_toml.exists() {
            if let Ok(content) = fs::read_to_string(&cargo_toml) {
                if content.contains("[workspace]") {
                    // Found workspace root, but check if we're in a worktree
                    if let Some(main_repo) = find_main_repo_if_worktree(&current) {
                        return Ok(main_repo);
                    }
                    return Ok(current);
                }
            }
        }

        // Move up to parent
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => break,
        }
    }

    // Fall back to current directory if nothing found
    std::env::current_dir()
}

/// If the given path is inside a git worktree, returns the project root.
///
/// For Orkestra worktrees (`<project_root>/.orkestra/.worktrees/<task_id>/`), returns the
/// directory containing `.orkestra/` by walking up from the worktree. For non-Orkestra
/// worktrees, falls back to extracting the git root from the gitdir path.
/// Returns `None` if not a worktree (i.e., `.git` is a directory, not a file).
fn find_main_repo_if_worktree(path: &std::path::Path) -> Option<PathBuf> {
    let git_path = path.join(".git");

    // .git as a directory means this is a main repo, not a worktree
    if git_path.is_dir() {
        return None;
    }

    if !git_path.is_file() {
        return None;
    }

    let content = fs::read_to_string(&git_path).ok()?;
    let gitdir = content.strip_prefix("gitdir: ")?.trim();

    // Confirm this is a worktree .git file
    let worktree_marker_pos = gitdir.find("/.git/worktrees/")?;

    // Walk up from path to find the project root (directory containing .orkestra/)
    let mut ancestor = path.parent();
    while let Some(dir) = ancestor {
        if dir.join(".orkestra").is_dir() {
            return Some(dir.to_path_buf());
        }
        ancestor = dir.parent();
    }

    // Fallback: extract git root from gitdir path (non-Orkestra worktrees)
    let main_repo = PathBuf::from(&gitdir[..worktree_marker_pos]);
    if main_repo.exists() {
        Some(main_repo)
    } else {
        None
    }
}

/// Find the git root by walking up from `from` looking for a `.git` directory.
///
/// Returns `None` if no git repository is found. Skips `.git` files
/// (worktree markers) — only returns the path where `.git` is a directory.
pub fn find_git_root(from: &std::path::Path) -> Option<PathBuf> {
    let mut current = from.to_path_buf();
    loop {
        if current.join(".git").is_dir() {
            return Some(current);
        }
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => return None,
        }
    }
}

/// Compute the relative subpath from the git root to `project_root`.
///
/// Returns `None` when `project_root` is the git root itself (no subpath), or
/// when no git repository is found.
pub fn compute_project_subpath(project_root: &std::path::Path) -> Option<PathBuf> {
    find_git_root(project_root).and_then(|git_root| {
        project_root
            .strip_prefix(&git_root)
            .ok()
            .filter(|p| !p.as_os_str().is_empty())
            .map(std::path::Path::to_path_buf)
    })
}

/// Gets the .orkestra directory path at the project root.
/// Always returns the MAIN repo's .orkestra, even if called from a worktree.
///
/// # Panics
///
/// Panics if unable to determine the current directory.
pub fn get_orkestra_dir() -> PathBuf {
    find_project_root()
        .unwrap_or_else(|_| std::env::current_dir().expect("Failed to get current directory"))
        .join(".orkestra")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    #[test]
    fn test_find_main_repo_from_worktree() {
        // Create a temp git repo
        let temp_dir = TempDir::new().unwrap();
        let main_repo = temp_dir.path();

        // Initialize git repo
        Command::new("git")
            .args(["init"])
            .current_dir(main_repo)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(main_repo)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(main_repo)
            .output()
            .unwrap();

        // Create initial commit
        fs::write(main_repo.join("README.md"), "# Test").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(main_repo)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(main_repo)
            .output()
            .unwrap();

        // Create .orkestra directory
        fs::create_dir_all(main_repo.join(".orkestra")).unwrap();

        // Create a worktree
        let worktree_path = main_repo.join("worktrees/test-task");
        fs::create_dir_all(main_repo.join("worktrees")).unwrap();
        Command::new("git")
            .args([
                "worktree",
                "add",
                "-b",
                "task/test",
                worktree_path.to_str().unwrap(),
            ])
            .current_dir(main_repo)
            .output()
            .unwrap();

        // Verify worktree was created
        assert!(worktree_path.exists());
        assert!(worktree_path.join(".git").is_file()); // .git is a file in worktree

        // Test that find_main_repo_if_worktree finds the main repo
        let found = find_main_repo_if_worktree(&worktree_path);
        assert!(found.is_some());
        // Canonicalize both paths to handle macOS /var vs /private/var symlink
        let found_canonical = found.unwrap().canonicalize().unwrap();
        let main_canonical = main_repo.canonicalize().unwrap();
        assert_eq!(found_canonical, main_canonical);

        // Test that main repo returns None (it's not a worktree)
        let found = find_main_repo_if_worktree(main_repo);
        assert!(found.is_none());
    }

    #[test]
    fn test_find_git_root_from_subdirectory() {
        let temp_dir = TempDir::new().unwrap();
        let repo_root = temp_dir.path();

        Command::new("git")
            .args(["init"])
            .current_dir(repo_root)
            .output()
            .unwrap();

        let subdir = repo_root.join("packages/app");
        fs::create_dir_all(&subdir).unwrap();

        let found = find_git_root(&subdir);
        assert!(found.is_some());
        let found_canonical = found.unwrap().canonicalize().unwrap();
        let expected_canonical = repo_root.canonicalize().unwrap();
        assert_eq!(found_canonical, expected_canonical);
    }

    #[test]
    fn test_find_main_repo_from_monorepo_worktree() {
        // Git repo at root, .orkestra/ in a subdirectory (mono-repo layout)
        let temp_dir = TempDir::new().unwrap();
        let git_root = temp_dir.path();

        Command::new("git")
            .args(["init"])
            .current_dir(git_root)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(git_root)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(git_root)
            .output()
            .unwrap();

        // Create initial commit
        fs::write(git_root.join("README.md"), "# Mono").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(git_root)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(git_root)
            .output()
            .unwrap();

        // Project root is a subdirectory of the git root
        let project_root = git_root.join("frontend");
        fs::create_dir_all(project_root.join(".orkestra/.worktrees")).unwrap();

        // Create a git worktree under the project root's .orkestra
        let worktree_path = project_root.join(".orkestra/.worktrees/test-task");
        Command::new("git")
            .args([
                "worktree",
                "add",
                "-b",
                "task/test",
                worktree_path.to_str().unwrap(),
            ])
            .current_dir(git_root)
            .output()
            .unwrap();

        assert!(worktree_path.join(".git").is_file());

        // Must return project_root (where .orkestra/ lives), NOT git_root
        let found = find_main_repo_if_worktree(&worktree_path);
        assert!(found.is_some(), "Should detect Orkestra project root");
        let found_canonical = found.unwrap().canonicalize().unwrap();
        let expected_canonical = project_root.canonicalize().unwrap();
        assert_eq!(
            found_canonical, expected_canonical,
            "Should return project root (with .orkestra/), not git root"
        );
    }
}
