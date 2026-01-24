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

    // =========================================================================
    // Pending Output Recovery (for crash resilience with JSON schema output)
    // =========================================================================

    /// Get the directory for storing pending JSON outputs.
    ///
    /// Pending outputs are raw JSON blobs from agents that haven't been
    /// parsed and committed to the database yet. This provides crash recovery.
    pub fn pending_outputs_dir(&self) -> PathBuf {
        self.orkestra_dir().join("pending-outputs")
    }

    /// Get the path for a specific task's pending output file.
    ///
    /// File format: `{task_id}.{agent_type}.json`
    pub fn pending_output_path(&self, task_id: &str, agent_type: &str) -> PathBuf {
        self.pending_outputs_dir()
            .join(format!("{task_id}.{agent_type}.json"))
    }

    /// Read a pending output for a task and agent type, if one exists.
    ///
    /// Returns `Some(json_string)` if there's a pending output awaiting parse,
    /// or `None` if no pending output exists.
    pub fn read_pending_output(&self, task_id: &str, agent_type: &str) -> Option<String> {
        let path = self.pending_output_path(task_id, agent_type);
        std::fs::read_to_string(path).ok()
    }

    /// Write a pending output for a task.
    ///
    /// This should be called immediately after reading JSON from stdout,
    /// BEFORE parsing. Ensures output survives app crashes.
    pub fn write_pending_output(
        &self,
        task_id: &str,
        agent_type: &str,
        json: &str,
    ) -> std::io::Result<()> {
        let dir = self.pending_outputs_dir();
        std::fs::create_dir_all(&dir)?;
        let path = self.pending_output_path(task_id, agent_type);
        std::fs::write(path, json)
    }

    /// Clear a pending output after successful processing.
    ///
    /// Call this AFTER the parsed output has been committed to the database.
    pub fn clear_pending_output(&self, task_id: &str, agent_type: &str) {
        let path = self.pending_output_path(task_id, agent_type);
        let _ = std::fs::remove_file(path);
    }

    /// List all pending outputs as (task_id, agent_type) tuples.
    ///
    /// Used on startup to recover from crashes.
    pub fn list_pending_outputs(&self) -> Vec<(String, String)> {
        let dir = self.pending_outputs_dir();
        if !dir.exists() {
            return Vec::new();
        }

        std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".json") {
                    // Parse "{task_id}.{agent_type}.json"
                    let without_ext = name.trim_end_matches(".json");
                    let parts: Vec<&str> = without_ext.rsplitn(2, '.').collect();
                    if parts.len() == 2 {
                        // rsplitn gives [agent_type, task_id] (reversed)
                        Some((parts[1].to_string(), parts[0].to_string()))
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
            .collect()
    }
}
