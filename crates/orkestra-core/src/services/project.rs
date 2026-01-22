//! Project context for Orkestra.
//!
//! A `Project` represents a single codebase being managed by Orkestra.
//! Each project has its own:
//! - Task database (`.orkestra/tasks.db`)
//! - Git worktrees (`.orkestra/worktrees/`)
//! - Agent definitions (`.orkestra/agents/`)
//!
//! # Usage
//!
//! ```ignore
//! use orkestra_core::services::Project;
//!
//! // Open existing project (for Tauri "Open Directory")
//! let project = Project::open("/path/to/repo")?;
//!
//! // Initialize new project
//! let project = Project::init("/path/to/new/repo")?;
//!
//! // Discover from current directory (for CLI)
//! let project = Project::discover()?;
//!
//! // Use the project
//! let task = project.create_task("Title", "Description")?;
//! ```

use std::path::{Path, PathBuf};

use crate::adapters::SqliteStore;
use crate::domain::{IntegrationResult, Task, TaskKind, TaskStatus};
use crate::error::{OrkestraError, Result};
use crate::ports::TaskStore;
use crate::project as project_discovery;
use crate::services::GitService;

/// A project context representing a single codebase managed by Orkestra.
///
/// Each `Project` is isolated - it has its own database, worktrees, and state.
/// This enables:
/// - Multiple Orkestra windows for different projects
/// - Isolated testing with real code paths
/// - Clear ownership of resources
pub struct Project {
    /// The root directory of the project.
    root: PathBuf,
    /// The task store (`SQLite` database).
    store: SqliteStore,
    /// The git service for worktree operations (None if not a git repo).
    git: Option<GitService>,
}

impl Project {
    /// Open an existing Orkestra project.
    ///
    /// The directory must already be initialized (have a `.orkestra` directory).
    /// Use [`Project::init`] to initialize a new project.
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        let orkestra_dir = root.join(".orkestra");

        if !orkestra_dir.exists() {
            return Err(OrkestraError::InvalidInput(format!(
                "Not an Orkestra project: {} (missing .orkestra directory)",
                root.display()
            )));
        }

        let store = SqliteStore::for_project(&root)?;
        let git = GitService::new(&root).ok();

        Ok(Self { root, store, git })
    }

    /// Initialize a new Orkestra project in the given directory.
    ///
    /// Creates the `.orkestra` directory structure and initializes the database.
    /// The directory must already exist.
    pub fn init(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();

        if !root.exists() {
            return Err(OrkestraError::InvalidInput(format!(
                "Directory does not exist: {}",
                root.display()
            )));
        }

        // Create .orkestra directory structure
        let orkestra_dir = root.join(".orkestra");
        std::fs::create_dir_all(orkestra_dir.join("worktrees"))?;
        std::fs::create_dir_all(orkestra_dir.join("agents"))?;

        // Initialize store (creates database)
        let store = SqliteStore::for_project(&root)?;
        let git = GitService::new(&root).ok();

        Ok(Self { root, store, git })
    }

    /// Initialize a new Orkestra project, or open it if already initialized.
    ///
    /// This is useful for CLI commands that should work whether or not
    /// the project is already initialized.
    pub fn open_or_init(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref();
        if root.join(".orkestra").exists() {
            Self::open(root)
        } else {
            Self::init(root)
        }
    }

    /// Discover the project from the current working directory.
    ///
    /// Searches upward from the current directory to find a project root
    /// (directory containing `.orkestra` or a workspace `Cargo.toml`).
    ///
    /// This is the default behavior for CLI usage.
    pub fn discover() -> Result<Self> {
        let root = project_discovery::find_project_root()?;
        Self::open_or_init(root)
    }

    /// Get the project root directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Get the `.orkestra` directory path.
    pub fn orkestra_dir(&self) -> PathBuf {
        self.root.join(".orkestra")
    }

    /// Check if this project has git support.
    pub fn has_git(&self) -> bool {
        self.git.is_some()
    }

    /// Get a reference to the git service, if available.
    pub fn git(&self) -> Option<&GitService> {
        self.git.as_ref()
    }

    // =========================================================================
    // Task Operations
    // =========================================================================

    /// Load all tasks from the project.
    pub fn list_tasks(&self) -> Result<Vec<Task>> {
        self.store.load_all()
    }

    /// Find a task by ID.
    pub fn get_task(&self, id: &str) -> Result<Option<Task>> {
        self.store.find_by_id(id)
    }

    /// Create a new task in this project.
    ///
    /// For root tasks (no parent), this also creates a git worktree if git is available.
    pub fn create_task(&self, title: &str, description: &str) -> Result<Task> {
        self.create_task_with_options(title, description, false)
    }

    /// Create a new task with options.
    pub fn create_task_with_options(
        &self,
        title: &str,
        description: &str,
        auto_approve: bool,
    ) -> Result<Task> {
        let now = chrono::Utc::now().to_rfc3339();
        let id = self.store.next_id()?;

        // Create worktree for root task if git is available
        let (branch_name, worktree_path) = if let Some(git) = &self.git {
            match git.create_worktree(&id) {
                Ok((branch, path)) => (Some(branch), Some(path.to_string_lossy().to_string())),
                Err(e) => {
                    eprintln!("Warning: Failed to create worktree for task {id}: {e}");
                    (None, None)
                }
            }
        } else {
            (None, None)
        };

        let task = Task {
            id,
            title: title.to_string(),
            description: description.to_string(),
            status: TaskStatus::Planning,
            kind: TaskKind::Task,
            created_at: now.clone(),
            updated_at: now,
            completed_at: None,
            summary: None,
            error: None,
            plan: None,
            plan_feedback: None,
            review_feedback: None,
            reviewer_feedback: None,
            sessions: None,
            auto_approve,
            parent_id: None,
            breakdown: None,
            breakdown_feedback: None,
            skip_breakdown: false,
            agent_pid: None,
            branch_name,
            worktree_path,
            integration_result: None,
        };

        self.store.save(&task)?;
        Ok(task)
    }

    /// Set the plan for a task.
    pub fn set_plan(&self, task_id: &str, plan: &str) -> Result<Task> {
        let mut task = self.require_task(task_id)?;

        if task.status != TaskStatus::Planning {
            return Err(OrkestraError::InvalidState {
                expected: "Planning".into(),
                actual: format!("{:?}", task.status),
            });
        }

        task.plan = Some(plan.to_string());
        task.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.save(&task)?;
        Ok(task)
    }

    /// Approve a task's plan and move to the next phase.
    pub fn approve_plan(&self, task_id: &str) -> Result<Task> {
        let mut task = self.require_task(task_id)?;

        if task.status != TaskStatus::Planning || task.plan.is_none() {
            return Err(OrkestraError::InvalidState {
                expected: "Planning with plan set".into(),
                actual: format!("{:?}", task.status),
            });
        }

        task.status = if task.skip_breakdown {
            TaskStatus::Working
        } else {
            TaskStatus::BreakingDown
        };
        task.plan_feedback = None;
        task.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.save(&task)?;
        Ok(task)
    }

    /// Mark a task's work as complete (ready for review).
    pub fn complete_task(&self, task_id: &str, summary: &str) -> Result<Task> {
        let mut task = self.require_task(task_id)?;

        if task.status != TaskStatus::Working {
            return Err(OrkestraError::InvalidState {
                expected: "Working".into(),
                actual: format!("{:?}", task.status),
            });
        }

        task.summary = Some(summary.to_string());
        task.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.save(&task)?;
        Ok(task)
    }

    /// Approve work review and complete the task.
    ///
    /// For root tasks with worktrees, this attempts to merge the branch
    /// back to the primary branch. On successful merge, the task is deleted
    /// from the database (git history preserves the work).
    ///
    /// Returns the final task state (even if deleted) so the caller knows
    /// what happened.
    pub fn approve_review(&self, task_id: &str) -> Result<Task> {
        let mut task = self.require_task(task_id)?;

        if task.status != TaskStatus::Working || task.summary.is_none() {
            return Err(OrkestraError::InvalidState {
                expected: "Working with summary set".into(),
                actual: format!("{:?}", task.status),
            });
        }

        // Try to integrate the branch back to primary
        let (new_status, integration_result, conflict_msg) = self.try_integrate(&task);

        // Check if this was a successful merge before moving integration_result
        let was_merged = matches!(integration_result, Some(IntegrationResult::Merged { .. }));

        task.status = new_status;
        task.integration_result = integration_result;
        task.updated_at = chrono::Utc::now().to_rfc3339();

        if new_status == TaskStatus::Done {
            task.completed_at = Some(chrono::Utc::now().to_rfc3339());
            task.review_feedback = None;

            // On successful merge, delete the task - git history has everything
            if was_merged {
                self.store.delete(&task.id)?;
                return Ok(task);
            }
        } else {
            // Conflict - reopen task
            task.summary = None;
            task.reviewer_feedback = conflict_msg;
        }

        self.store.save(&task)?;
        Ok(task)
    }

    /// Fail a task with a reason.
    pub fn fail_task(&self, task_id: &str, reason: &str) -> Result<Task> {
        let mut task = self.require_task(task_id)?;
        task.status = TaskStatus::Failed;
        task.error = Some(reason.to_string());
        task.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.save(&task)?;
        Ok(task)
    }

    /// Block a task with a reason.
    pub fn block_task(&self, task_id: &str, reason: &str) -> Result<Task> {
        let mut task = self.require_task(task_id)?;
        task.status = TaskStatus::Blocked;
        task.error = Some(reason.to_string());
        task.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.save(&task)?;
        Ok(task)
    }

    /// Update a task with a custom mutation function.
    pub fn update_task<F>(&self, task_id: &str, f: F) -> Result<Task>
    where
        F: FnOnce(&mut Task) -> Result<()>,
    {
        let mut task = self.require_task(task_id)?;
        f(&mut task)?;
        task.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.save(&task)?;
        Ok(task)
    }

    // =========================================================================
    // Internal Helpers
    // =========================================================================

    /// Get a task or return an error if not found.
    fn require_task(&self, id: &str) -> Result<Task> {
        self.store
            .find_by_id(id)?
            .ok_or_else(|| OrkestraError::TaskNotFound(id.to_string()))
    }

    /// Attempt to integrate a task's branch back to the primary branch.
    ///
    /// Returns a tuple of (new status, integration result, conflict message).
    fn try_integrate(&self, task: &Task) -> (TaskStatus, Option<IntegrationResult>, Option<String>) {
        // Skip if not a root task (has parent)
        if task.parent_id.is_some() {
            return (
                TaskStatus::Done,
                Some(IntegrationResult::Skipped {
                    reason: "Child task - parent handles integration".into(),
                }),
                None,
            );
        }

        // Skip if no worktree/branch
        let branch_name = match &task.branch_name {
            Some(b) => b.clone(),
            None => {
                return (
                    TaskStatus::Done,
                    Some(IntegrationResult::Skipped {
                        reason: "No branch associated with task".into(),
                    }),
                    None,
                );
            }
        };

        // Skip if no git service
        let Some(git) = &self.git else {
            return (
                TaskStatus::Done,
                Some(IntegrationResult::Skipped {
                    reason: "Git not available".into(),
                }),
                None,
            );
        };

        // Attempt merge
        match git.merge_to_primary(&branch_name) {
            Ok(commit_sha) => {
                // Success: cleanup worktree and branch
                let _ = git.remove_worktree(&task.id);
                let _ = git.delete_branch(&branch_name);

                let target_branch = git.detect_primary_branch().unwrap_or_else(|_| "main".into());
                (
                    TaskStatus::Done,
                    Some(IntegrationResult::Merged {
                        merged_at: chrono::Utc::now().to_rfc3339(),
                        commit_sha,
                        target_branch,
                    }),
                    None,
                )
            }
            Err(OrkestraError::MergeConflict { files, .. }) => {
                // Conflict: abort merge, reopen task
                let _ = git.abort_merge();

                let conflict_msg = format!(
                    "Merge conflict occurred when integrating to primary branch. \
                     Please resolve the following conflicts:\n\n{}\n\n\
                     After resolving, mark the task complete again.",
                    files
                        .iter()
                        .map(|f| format!("- {f}"))
                        .collect::<Vec<_>>()
                        .join("\n")
                );

                (
                    TaskStatus::Working,
                    Some(IntegrationResult::Conflict {
                        conflict_files: files,
                    }),
                    Some(conflict_msg),
                )
            }
            Err(e) => {
                // Other error: log and skip integration
                eprintln!("Warning: Failed to integrate task {}: {e}", task.id);
                (
                    TaskStatus::Done,
                    Some(IntegrationResult::Skipped {
                        reason: format!("Merge failed: {e}"),
                    }),
                    None,
                )
            }
        }
    }
}
