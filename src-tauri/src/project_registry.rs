//! Project registry for multi-window project management.
//!
//! Each window maps to a single project folder. The registry maintains a global
//! map from window labels to per-project state.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard};

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::{
    AutoTaskTemplate, Git2GitService, GitService, SqliteWorkflowStore, WorkflowApi, WorkflowConfig,
    WorkflowStore,
};
use serde::{Deserialize, Serialize};

use orkestra_core::orkestra_debug;

use crate::error::TauriError;

/// Per-project state, holding the workflow API and project metadata.
///
/// This is the per-window equivalent of the old global `AppState`.
pub struct ProjectState {
    api: Arc<Mutex<WorkflowApi>>,
    config: WorkflowConfig,
    auto_task_templates: Vec<AutoTaskTemplate>,
    project_root: PathBuf,
    /// Database connection, kept alive for the lifetime of the project window.
    #[allow(dead_code)]
    db_conn: DatabaseConnection,
    /// Whether git service is available for worktree isolation.
    has_git: bool,
    /// Stop flag for the orchestrator loop.
    pub(crate) stop_flag: Arc<AtomicBool>,
}

impl ProjectState {
    /// Create a new `ProjectState` with the given workflow config and database path.
    pub fn new(
        workflow: WorkflowConfig,
        auto_task_templates: Vec<AutoTaskTemplate>,
        db_path: &Path,
        project_root: PathBuf,
    ) -> Result<Self, String> {
        // Open database with integrity validation.
        // If corrupted, moves the bad file aside and starts fresh.
        let (conn, recovered) =
            DatabaseConnection::open_validated(db_path).map_err(|e| e.to_string())?;
        if recovered {
            orkestra_debug!(
                "startup",
                "Database was corrupted — started with a fresh database"
            );
            orkestra_debug!(
                "startup",
                "Previous database preserved as .corrupt file for inspection"
            );
        }

        // Create workflow store with shared connection
        let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(conn.shared()));

        // Try to create git service for worktree support
        let (git_service, has_git): (Option<Arc<dyn GitService>>, bool) =
            match Git2GitService::new(&project_root) {
                Ok(git) => {
                    orkestra_debug!(
                        "git",
                        "Git service initialized for {}",
                        project_root.display()
                    );
                    (Some(Arc::new(git)), true)
                }
                Err(e) => {
                    orkestra_debug!("git", "Git service unavailable: {}", e);
                    orkestra_debug!("git", "Tasks will run without git worktree isolation");
                    (None, false)
                }
            };

        // Create workflow API with or without git service
        let api = if let Some(git) = git_service {
            WorkflowApi::with_git(workflow.clone(), store, git)
        } else {
            WorkflowApi::new(workflow.clone(), store)
        };

        let stop_flag = Arc::new(AtomicBool::new(false));

        Ok(Self {
            config: workflow,
            auto_task_templates,
            api: Arc::new(Mutex::new(api)),
            project_root,
            db_conn: conn,
            has_git,
            stop_flag,
        })
    }

    /// Get a lock on the `WorkflowApi`.
    ///
    /// Returns an error if the mutex is poisoned (another thread panicked while holding the lock).
    pub fn api(&self) -> Result<MutexGuard<WorkflowApi>, TauriError> {
        self.api
            .lock()
            .map_err(|_| TauriError::new("LOCK_ERROR", "Failed to acquire API lock"))
    }

    /// Get a clone of the Arc<Mutex<WorkflowApi>> for the orchestrator.
    pub fn api_arc(&self) -> Arc<Mutex<WorkflowApi>> {
        self.api.clone()
    }

    /// Get the workflow configuration.
    pub fn config(&self) -> &WorkflowConfig {
        &self.config
    }

    /// Get the auto-task templates.
    pub fn auto_task_templates(&self) -> &[AutoTaskTemplate] {
        &self.auto_task_templates
    }

    /// Get the project root path.
    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    /// Create a new `WorkflowStore` for the orchestrator.
    pub fn create_store(&self) -> Arc<dyn WorkflowStore> {
        Arc::new(SqliteWorkflowStore::new(self.db_conn.shared()))
    }

    /// Check if git service is available.
    pub fn has_git_service(&self) -> bool {
        self.has_git
    }

    /// Flush the WAL to the main database file.
    ///
    /// Call on graceful shutdown to leave the database in a clean state.
    pub fn checkpoint_database(&self) {
        if let Err(e) = self.db_conn.checkpoint() {
            orkestra_debug!("shutdown", "WAL checkpoint failed: {}", e);
        }
    }
}

/// Global registry mapping window labels to project state.
pub struct ProjectRegistry {
    projects: Mutex<HashMap<String, ProjectState>>,
}

impl ProjectRegistry {
    /// Create a new empty registry.
    pub fn new() -> Self {
        Self {
            projects: Mutex::new(HashMap::new()),
        }
    }

    /// Register a project with the given window label.
    ///
    /// Returns an error if a project with that label already exists.
    pub fn register(&self, label: String, state: ProjectState) -> Result<(), TauriError> {
        let mut projects = self
            .projects
            .lock()
            .map_err(|_| TauriError::new("LOCK_ERROR", "Failed to acquire registry lock"))?;

        if projects.contains_key(&label) {
            return Err(TauriError::new(
                "PROJECT_ALREADY_REGISTERED",
                format!("Project with label '{label}' is already registered"),
            ));
        }

        projects.insert(label, state);
        Ok(())
    }

    /// Remove a project from the registry.
    ///
    /// Returns the removed state if it existed.
    pub fn remove(&self, label: &str) -> Result<Option<ProjectState>, TauriError> {
        let mut projects = self
            .projects
            .lock()
            .map_err(|_| TauriError::new("LOCK_ERROR", "Failed to acquire registry lock"))?;

        Ok(projects.remove(label))
    }

    /// Execute a function with access to a project's state.
    ///
    /// Returns an error if the label doesn't exist or the lock is poisoned.
    pub fn with_project<F, R>(&self, label: &str, f: F) -> Result<R, TauriError>
    where
        F: FnOnce(&ProjectState) -> Result<R, TauriError>,
    {
        let projects = self
            .projects
            .lock()
            .map_err(|_| TauriError::new("LOCK_ERROR", "Failed to acquire registry lock"))?;

        let state = projects.get(label).ok_or_else(|| {
            TauriError::new(
                "PROJECT_NOT_FOUND",
                format!("No project registered for window '{label}'"),
            )
        })?;

        f(state)
    }

    /// Check if a project path is already open.
    ///
    /// Returns the window label if found.
    pub fn is_open(&self, path: &Path) -> Result<Option<String>, TauriError> {
        let projects = self
            .projects
            .lock()
            .map_err(|_| TauriError::new("LOCK_ERROR", "Failed to acquire registry lock"))?;

        for (label, state) in projects.iter() {
            if state.project_root() == path {
                return Ok(Some(label.clone()));
            }
        }

        Ok(None)
    }

    /// Generate a unique window label from a project path.
    ///
    /// Sanitizes the path to create a valid window label.
    pub fn label_for_path(path: &Path) -> String {
        let path_str = path.display().to_string();
        // Replace path separators and special characters with hyphens
        let sanitized = path_str
            .chars()
            .map(|c| match c {
                '/' | '\\' | ':' | ' ' | '.' => '-',
                c if c.is_alphanumeric() => c,
                _ => '-',
            })
            .collect::<String>();

        // Remove duplicate hyphens and trim
        let cleaned = sanitized
            .split('-')
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("-");

        format!("project-{cleaned}")
    }

    /// Get all project root paths currently registered.
    ///
    /// Used for signal handler cleanup.
    pub fn all_project_roots(&self) -> Result<Vec<PathBuf>, TauriError> {
        let projects = self
            .projects
            .lock()
            .map_err(|_| TauriError::new("LOCK_ERROR", "Failed to acquire registry lock"))?;

        Ok(projects
            .values()
            .map(|state| state.project_root().to_path_buf())
            .collect())
    }
}

impl Default for ProjectRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Recent project metadata for persistence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProject {
    /// Absolute path to the project folder
    pub path: String,
    /// Display name derived from folder name
    pub display_name: String,
    /// ISO 8601 timestamp of last open
    pub last_opened: String,
}
