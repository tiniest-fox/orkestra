//! E2E tests for git sync status and push/pull operations.
//!
//! These tests verify `sync_status()` and `pull_branch()` work correctly
//! with real git repositories and bare "origin" remotes.

use std::path::{Path, PathBuf};
use std::process::Command;

use orkestra_core::workflow::adapters::Git2GitService;
use orkestra_core::workflow::ports::GitService;
use tempfile::TempDir;

// =============================================================================
// Test Infrastructure
// =============================================================================

/// Create a test git repository with an initial commit.
fn create_test_repo() -> (TempDir, PathBuf) {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let repo_path = temp_dir.path().to_path_buf();

    run_git(&repo_path, &["init"]);
    run_git(&repo_path, &["config", "user.email", "test@example.com"]);
    run_git(&repo_path, &["config", "user.name", "Test User"]);

    std::fs::write(repo_path.join("README.md"), "# Test Repo\n").expect("write file");
    run_git(&repo_path, &["add", "."]);
    run_git(&repo_path, &["commit", "-m", "Initial commit"]);
    run_git(&repo_path, &["branch", "-M", "main"]);

    (temp_dir, repo_path)
}

/// Create a bare "origin" repo and connect the local repo to it.
///
/// Returns the path to the bare origin repo.
fn setup_origin(repo_path: &Path) -> TempDir {
    let origin_dir = TempDir::new().expect("Failed to create origin dir");
    let origin_path = origin_dir.path();

    // Initialize bare repo
    run_git(origin_path, &["init", "--bare"]);

    // Add as remote to local repo
    let origin_url = format!("file://{}", origin_path.display());
    run_git(repo_path, &["remote", "add", "origin", &origin_url]);

    // Push main branch to establish tracking
    run_git(repo_path, &["push", "-u", "origin", "main"]);

    origin_dir
}

/// Add commits directly to the origin by cloning, committing, and pushing.
fn add_commits_to_origin(origin_path: &Path, count: usize) {
    let clone_dir = TempDir::new().expect("clone dir");
    let clone_path = clone_dir.path();

    // Clone the bare repo
    let origin_url = format!("file://{}", origin_path.display());
    run_git(
        clone_path.parent().unwrap(),
        &[
            "clone",
            &origin_url,
            &clone_path.file_name().unwrap().to_string_lossy(),
        ],
    );

    // Configure git user
    run_git(clone_path, &["config", "user.email", "other@example.com"]);
    run_git(clone_path, &["config", "user.name", "Other User"]);

    // Add commits
    for i in 0..count {
        let filename = format!("origin_file_{i}.txt");
        std::fs::write(clone_path.join(&filename), format!("Content {i}")).expect("write file");
        run_git(clone_path, &["add", &filename]);
        run_git(clone_path, &["commit", "-m", &format!("Origin commit {i}")]);
    }

    // Push back to origin
    run_git(clone_path, &["push", "origin", "main"]);
}

/// Add local commits (without pushing).
fn add_local_commits(repo_path: &Path, count: usize) {
    for i in 0..count {
        let filename = format!("local_file_{i}.txt");
        std::fs::write(repo_path.join(&filename), format!("Local content {i}"))
            .expect("write file");
        run_git(repo_path, &["add", &filename]);
        run_git(repo_path, &["commit", "-m", &format!("Local commit {i}")]);
    }
}

/// Run a git command in the specified directory.
fn run_git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap_or_else(|e| panic!("Failed to run git {args:?}: {e}"));

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        panic!("git {args:?} failed: {stderr}");
    }
}

/// Fetch from origin to update remote refs.
fn fetch_origin(repo_path: &Path) {
    run_git(repo_path, &["fetch", "origin"]);
}

// =============================================================================
// sync_status Tests
// =============================================================================

#[test]
fn sync_status_returns_none_for_no_remote() {
    let (_temp_dir, repo_path) = create_test_repo();
    // No origin added
    let git = Git2GitService::new(&repo_path).expect("git service");

    let status = git.sync_status().expect("sync_status should succeed");

    assert!(
        status.is_none(),
        "Expected None when no origin remote exists"
    );
}

#[test]
fn sync_status_returns_none_for_branch_not_on_origin() {
    let (_temp_dir, repo_path) = create_test_repo();
    let _origin_dir = setup_origin(&repo_path);

    // Create a new local branch that doesn't exist on origin
    run_git(&repo_path, &["checkout", "-b", "feature-branch"]);

    let git = Git2GitService::new(&repo_path).expect("git service");
    let status = git.sync_status().expect("sync_status should succeed");

    assert!(
        status.is_none(),
        "Expected None when current branch doesn't exist on origin"
    );
}

#[test]
fn sync_status_returns_zero_when_in_sync() {
    let (_temp_dir, repo_path) = create_test_repo();
    let _origin_dir = setup_origin(&repo_path);

    let git = Git2GitService::new(&repo_path).expect("git service");
    let status = git.sync_status().expect("sync_status should succeed");

    let status = status.expect("Should return Some when in sync");
    assert_eq!(status.ahead, 0, "Expected 0 ahead when in sync");
    assert_eq!(status.behind, 0, "Expected 0 behind when in sync");
}

#[test]
fn sync_status_returns_ahead_count() {
    let (_temp_dir, repo_path) = create_test_repo();
    let _origin_dir = setup_origin(&repo_path);

    // Add local commits without pushing
    add_local_commits(&repo_path, 3);

    let git = Git2GitService::new(&repo_path).expect("git service");
    let status = git.sync_status().expect("sync_status should succeed");

    let status = status.expect("Should return Some with status");
    assert_eq!(status.ahead, 3, "Expected 3 commits ahead");
    assert_eq!(status.behind, 0, "Expected 0 behind when only ahead");
}

#[test]
fn sync_status_returns_behind_count() {
    let (_temp_dir, repo_path) = create_test_repo();
    let origin_dir = setup_origin(&repo_path);

    // Add commits to origin (simulating another developer)
    add_commits_to_origin(origin_dir.path(), 2);

    // Fetch to update remote refs
    fetch_origin(&repo_path);

    let git = Git2GitService::new(&repo_path).expect("git service");
    let status = git.sync_status().expect("sync_status should succeed");

    let status = status.expect("Should return Some with status");
    assert_eq!(status.ahead, 0, "Expected 0 ahead when only behind");
    assert_eq!(status.behind, 2, "Expected 2 commits behind");
}

#[test]
fn sync_status_returns_both_when_diverged() {
    let (_temp_dir, repo_path) = create_test_repo();
    let origin_dir = setup_origin(&repo_path);

    // Add local commits (ahead)
    add_local_commits(&repo_path, 2);

    // Add commits to origin (behind) - this creates divergence
    add_commits_to_origin(origin_dir.path(), 3);

    // Fetch to update remote refs
    fetch_origin(&repo_path);

    let git = Git2GitService::new(&repo_path).expect("git service");
    let status = git.sync_status().expect("sync_status should succeed");

    let status = status.expect("Should return Some with diverged status");
    assert_eq!(status.ahead, 2, "Expected 2 commits ahead");
    assert_eq!(status.behind, 3, "Expected 3 commits behind");
}

#[test]
fn sync_status_returns_none_for_detached_head() {
    let (_temp_dir, repo_path) = create_test_repo();
    let _origin_dir = setup_origin(&repo_path);

    // Get the current commit hash
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo_path)
        .output()
        .expect("get HEAD");
    let commit_sha = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Checkout to detached HEAD state
    run_git(&repo_path, &["checkout", &commit_sha]);

    let git = Git2GitService::new(&repo_path).expect("git service");
    let status = git.sync_status().expect("sync_status should succeed");

    assert!(status.is_none(), "Expected None in detached HEAD state");
}

// =============================================================================
// pull_branch Tests
// =============================================================================

#[test]
fn pull_branch_fast_forwards_when_behind() {
    let (_temp_dir, repo_path) = create_test_repo();
    let origin_dir = setup_origin(&repo_path);

    // Add commits to origin
    add_commits_to_origin(origin_dir.path(), 2);

    // Verify we're behind before pull
    fetch_origin(&repo_path);
    let git = Git2GitService::new(&repo_path).expect("git service");
    let status_before = git.sync_status().expect("sync_status").unwrap();
    assert_eq!(status_before.behind, 2);

    // Pull
    git.pull_branch().expect("pull_branch should succeed");

    // Verify we're now in sync
    let status_after = git.sync_status().expect("sync_status").unwrap();
    assert_eq!(status_after.ahead, 0, "Should be in sync after pull");
    assert_eq!(status_after.behind, 0, "Should be in sync after pull");

    // Verify origin files exist locally
    assert!(
        repo_path.join("origin_file_0.txt").exists(),
        "Pulled files should exist"
    );
    assert!(
        repo_path.join("origin_file_1.txt").exists(),
        "Pulled files should exist"
    );
}

#[test]
fn pull_branch_fails_when_diverged() {
    let (_temp_dir, repo_path) = create_test_repo();
    let origin_dir = setup_origin(&repo_path);

    // Add local commits (creates divergence)
    add_local_commits(&repo_path, 1);

    // Add commits to origin
    add_commits_to_origin(origin_dir.path(), 1);

    // Fetch to update refs
    fetch_origin(&repo_path);

    let git = Git2GitService::new(&repo_path).expect("git service");
    let result = git.pull_branch();

    assert!(result.is_err(), "pull_branch should fail when diverged");
    let err = result.unwrap_err();
    let err_msg = format!("{err}");
    assert!(
        err_msg.contains("diverged") || err_msg.contains("fast-forward"),
        "Error should mention divergence: {err_msg}"
    );
}

#[test]
fn pull_branch_succeeds_when_in_sync() {
    let (_temp_dir, repo_path) = create_test_repo();
    let _origin_dir = setup_origin(&repo_path);

    let git = Git2GitService::new(&repo_path).expect("git service");

    // Pull when already in sync should succeed (no-op)
    git.pull_branch()
        .expect("pull_branch should succeed when in sync");

    // Verify still in sync
    let status = git.sync_status().expect("sync_status").unwrap();
    assert_eq!(status.ahead, 0);
    assert_eq!(status.behind, 0);
}

#[test]
fn pull_branch_fails_in_detached_head() {
    let (_temp_dir, repo_path) = create_test_repo();
    let _origin_dir = setup_origin(&repo_path);

    // Get current commit and checkout to detached HEAD
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo_path)
        .output()
        .expect("get HEAD");
    let commit_sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
    run_git(&repo_path, &["checkout", &commit_sha]);

    let git = Git2GitService::new(&repo_path).expect("git service");
    let result = git.pull_branch();

    assert!(result.is_err(), "pull_branch should fail in detached HEAD");
    let err_msg = format!("{}", result.unwrap_err());
    assert!(
        err_msg.contains("detached") || err_msg.contains("HEAD"),
        "Error should mention detached HEAD: {err_msg}"
    );
}
