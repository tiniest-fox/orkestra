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
//! use orkestra_core::tasks;
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
//! // Use tasks module for all task operations
//! let task = tasks::create_task(&project, "Title", "Description")?;
//! tasks::set_task_plan(&project, &task.id, "1. Do X\n2. Do Y")?;
//! tasks::approve_task_plan(&project, &task.id)?;
//! ```

use std::path::{Path, PathBuf};

use crate::adapters::SqliteStore;
use crate::error::{OrkestraError, Result};
use crate::project as project_discovery;
use crate::services::GitService;

/// A project context representing a single codebase managed by Orkestra.
///
/// Each `Project` is isolated - it has its own database, worktrees, and state.
/// This enables:
/// - Multiple Orkestra windows for different projects
/// - Isolated testing with real code paths
/// - Clear ownership of resources
///
/// `Project` provides access to the underlying store and git service.
/// All task operations should be performed through the `tasks` module,
/// which takes a `&Project` parameter.
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

    /// Get a reference to the task store.
    pub fn store(&self) -> &SqliteStore {
        &self.store
    }
}
