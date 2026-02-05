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

/// If the given path is inside a git worktree, returns the main repo path.
/// Returns None if not a worktree (i.e., it's the main repo or not a git repo).
fn find_main_repo_if_worktree(path: &std::path::Path) -> Option<PathBuf> {
    let git_path = path.join(".git");

    // If .git is a directory, this is the main repo (not a worktree)
    if git_path.is_dir() {
        return None;
    }

    // If .git is a file, it might be a worktree
    if git_path.is_file() {
        if let Ok(content) = fs::read_to_string(&git_path) {
            // Worktree .git file contains: "gitdir: /path/to/main/.git/worktrees/NAME"
            if let Some(gitdir) = content.strip_prefix("gitdir: ") {
                let gitdir = gitdir.trim();
                // Extract main repo: remove "/.git/worktrees/NAME" suffix
                if let Some(pos) = gitdir.find("/.git/worktrees/") {
                    let main_repo = PathBuf::from(&gitdir[..pos]);
                    if main_repo.exists() {
                        return Some(main_repo);
                    }
                }
            }
        }
    }

    None
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
}
