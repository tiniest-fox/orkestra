//! Git test helpers for creating temporary repositories.

use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

/// Creates a temporary git repository for testing.
///
/// The repository is initialized with:
/// - A `main` branch
/// - An initial commit with a README.md
/// - Git user configuration (required for commits)
///
/// The `TempDir` is automatically cleaned up when dropped.
///
/// # Example
///
/// ```ignore
/// use orkestra_core::testutil::create_temp_git_repo;
///
/// let temp_dir = create_temp_git_repo().unwrap();
/// let repo_path = temp_dir.path();
///
/// // Use repo_path for testing...
/// // Directory is cleaned up when temp_dir goes out of scope
/// ```
pub fn create_temp_git_repo() -> std::io::Result<TempDir> {
    let temp_dir = TempDir::new()?;

    // Initialize git repo
    Command::new("git")
        .args(["init"])
        .current_dir(temp_dir.path())
        .output()?;

    // Configure git user (required for commits)
    Command::new("git")
        .args(["config", "user.email", "test@example.com"])
        .current_dir(temp_dir.path())
        .output()?;

    Command::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(temp_dir.path())
        .output()?;

    // Create initial commit on main branch
    std::fs::write(temp_dir.path().join("README.md"), "# Test Repo\n")?;
    Command::new("git")
        .args(["add", "."])
        .current_dir(temp_dir.path())
        .output()?;

    Command::new("git")
        .args(["commit", "-m", "Initial commit"])
        .current_dir(temp_dir.path())
        .output()?;

    // Ensure we're on 'main' branch
    Command::new("git")
        .args(["branch", "-M", "main"])
        .current_dir(temp_dir.path())
        .output()?;

    Ok(temp_dir)
}

/// Creates the `.orkestra/worktrees` directory in a repo.
///
/// This is required before creating worktrees for tasks.
pub fn create_orkestra_dirs(repo_path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(repo_path.join(".orkestra/worktrees"))
}

/// Get the current branch name of a git repository.
pub fn get_current_branch(repo_path: &Path) -> std::io::Result<String> {
    let output = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(repo_path)
        .output()?;

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Check if a path is inside a git repository.
pub fn is_git_repo(path: &Path) -> bool {
    Command::new("git")
        .args(["rev-parse", "--git-dir"])
        .current_dir(path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Make a commit in a repository with the given message.
pub fn make_commit(repo_path: &Path, message: &str) -> std::io::Result<()> {
    Command::new("git")
        .args(["add", "."])
        .current_dir(repo_path)
        .output()?;

    Command::new("git")
        .args(["commit", "-m", message, "--allow-empty"])
        .current_dir(repo_path)
        .output()?;

    Ok(())
}

/// Create a file and commit it in one step.
pub fn create_and_commit_file(
    repo_path: &Path,
    filename: &str,
    content: &str,
    commit_message: &str,
) -> std::io::Result<()> {
    std::fs::write(repo_path.join(filename), content)?;

    Command::new("git")
        .args(["add", filename])
        .current_dir(repo_path)
        .output()?;

    Command::new("git")
        .args(["commit", "-m", commit_message])
        .current_dir(repo_path)
        .output()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_temp_git_repo() {
        let temp_dir = create_temp_git_repo().expect("Failed to create repo");

        assert!(temp_dir.path().join(".git").exists());
        assert!(is_git_repo(temp_dir.path()));
        assert_eq!(get_current_branch(temp_dir.path()).unwrap(), "main");
    }

    #[test]
    fn test_create_orkestra_dirs() {
        let temp_dir = TempDir::new().unwrap();
        create_orkestra_dirs(temp_dir.path()).unwrap();

        assert!(temp_dir.path().join(".orkestra").exists());
        assert!(temp_dir.path().join(".orkestra/worktrees").exists());
    }

    #[test]
    fn test_create_and_commit_file() {
        let temp_dir = create_temp_git_repo().unwrap();

        create_and_commit_file(temp_dir.path(), "test.txt", "Hello", "Add test file").unwrap();

        assert!(temp_dir.path().join("test.txt").exists());
    }
}
