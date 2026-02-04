//! Multi-project state management for Orkestra.
//!
//! Each project window gets its own `ProjectState` (isolated database, orchestrator, etc.).
//! The `ProjectRegistry` manages mapping from window labels to project state.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard};

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::orkestra_debug;
use orkestra_core::workflow::{
    AutoTaskTemplate, Git2GitService, GitService, SqliteWorkflowStore, WorkflowApi, WorkflowConfig,
    WorkflowStore,
};
use serde::{Deserialize, Serialize};
use tauri::Window;

use crate::error::TauriError;

/// Project state for a single project window.
///
/// This is the evolved `AppState` with per-project orchestrator control.
pub struct ProjectState {
    api: Arc<Mutex<WorkflowApi>>,
    config: WorkflowConfig,
    auto_task_templates: Vec<AutoTaskTemplate>,
    project_root: PathBuf,
    /// Database connection, kept alive for the lifetime of the project.
    #[allow(dead_code)]
    db_conn: DatabaseConnection,
    /// Whether git service is available for worktree isolation.
    has_git: bool,
    /// Stop flag for this project's orchestrator.
    /// Will be used in subtask 2 for per-project orchestrator control.
    #[allow(dead_code)]
    stop_flag: Arc<AtomicBool>,
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

        Ok(Self {
            config: workflow,
            auto_task_templates,
            api: Arc::new(Mutex::new(api)),
            project_root,
            db_conn: conn,
            has_git,
            stop_flag: Arc::new(AtomicBool::new(false)),
        })
    }

    /// Get a lock on the `WorkflowApi`.
    ///
    /// Returns an error if the mutex is poisoned (another thread panicked while holding the lock).
    /// This is preferable to panicking in a GUI application.
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

    /// Get the stop flag for this project's orchestrator.
    /// Will be used in subtask 2 for per-project orchestrator control.
    #[allow(dead_code)]
    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        self.stop_flag.clone()
    }

    /// Flush the WAL to the main database file.
    ///
    /// Call on graceful shutdown to leave the database in a clean state,
    /// reducing the risk of corruption if the next startup is interrupted.
    pub fn checkpoint_database(&self) {
        if let Err(e) = self.db_conn.checkpoint() {
            orkestra_debug!("shutdown", "WAL checkpoint failed: {}", e);
        }
    }
}

/// Registry mapping window labels to project state.
pub struct ProjectRegistry {
    projects: Mutex<HashMap<String, Arc<ProjectState>>>,
}

impl ProjectRegistry {
    /// Create a new empty project registry.
    pub fn new() -> Self {
        Self {
            projects: Mutex::new(HashMap::new()),
        }
    }

    /// Register a new project with the given window label.
    ///
    /// Returns an error if a project is already registered with that label.
    pub fn register(&self, label: String, state: ProjectState) -> Result<(), TauriError> {
        let mut projects = self
            .projects
            .lock()
            .map_err(|_| TauriError::new("LOCK_ERROR", "Failed to acquire registry lock"))?;

        if projects.contains_key(&label) {
            return Err(TauriError::new(
                "DUPLICATE_PROJECT",
                format!("Project already registered with label: {label}"),
            ));
        }

        projects.insert(label, Arc::new(state));
        Ok(())
    }

    /// Remove a project from the registry, returning its state for cleanup.
    /// Will be used in subtask 2 for window close cleanup.
    #[allow(dead_code)]
    pub fn remove(&self, label: &str) -> Result<Option<Arc<ProjectState>>, TauriError> {
        let mut projects = self
            .projects
            .lock()
            .map_err(|_| TauriError::new("LOCK_ERROR", "Failed to acquire registry lock"))?;

        Ok(projects.remove(label))
    }

    /// Get a project's state by window label.
    ///
    /// Returns an error if no project is registered with that label.
    pub fn get(&self, label: &str) -> Result<Arc<ProjectState>, TauriError> {
        let projects = self
            .projects
            .lock()
            .map_err(|_| TauriError::new("LOCK_ERROR", "Failed to acquire registry lock"))?;

        projects.get(label).cloned().ok_or_else(|| {
            TauriError::new(
                "PROJECT_NOT_LOADED",
                format!("No project registered with label: {label}"),
            )
        })
    }

    /// Check if a project path is already open, returning its window label if found.
    /// Will be used in subtask 2 for duplicate project detection.
    #[allow(dead_code)]
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

    /// Convert a project path to a valid Tauri window label.
    ///
    /// Sanitizes the path by replacing invalid characters with hyphens.
    /// Will be used in subtask 2 for window label generation.
    #[allow(dead_code)]
    pub fn label_for_path(path: &Path) -> String {
        // Use the path string, replacing invalid characters
        let path_str = path.to_string_lossy();
        path_str
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '-'
                }
            })
            .collect()
    }

    /// Get all registered project root paths (for cleanup operations).
    /// Will be used in subtask 2 for signal handler cleanup.
    #[allow(dead_code)]
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

/// Recently opened project metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProject {
    /// Absolute path to the project directory.
    pub path: String,
    /// Display name derived from folder name.
    pub display_name: String,
    /// ISO 8601 timestamp of last open.
    pub last_opened: String,
}

/// Helper function to extract project state from a window.
///
/// Looks up the window's label in the registry and returns the project state.
pub fn project_for_window(
    registry: &ProjectRegistry,
    window: &Window,
) -> Result<Arc<ProjectState>, TauriError> {
    let label = window.label();
    registry.get(label)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;
    use tempfile::TempDir;

    fn create_test_state(project_root: PathBuf) -> ProjectState {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");

        ProjectState::new(WorkflowConfig::default(), vec![], &db_path, project_root).unwrap()
    }

    #[test]
    fn test_registry_register_and_get() {
        let registry = ProjectRegistry::new();
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().to_path_buf();
        let state = create_test_state(path.clone());

        registry.register("test".to_string(), state).unwrap();

        let retrieved = registry.get("test").unwrap();
        assert_eq!(retrieved.project_root(), path.as_path());
    }

    #[test]
    fn test_registry_duplicate_label_error() {
        let registry = ProjectRegistry::new();
        let temp_dir = TempDir::new().unwrap();
        let state1 = create_test_state(temp_dir.path().to_path_buf());
        let state2 = create_test_state(temp_dir.path().to_path_buf());

        registry.register("test".to_string(), state1).unwrap();
        let result = registry.register("test".to_string(), state2);

        assert!(result.is_err());
        assert!(result.unwrap_err().code == "DUPLICATE_PROJECT");
    }

    #[test]
    fn test_registry_remove() {
        let registry = ProjectRegistry::new();
        let temp_dir = TempDir::new().unwrap();
        let state = create_test_state(temp_dir.path().to_path_buf());

        registry.register("test".to_string(), state).unwrap();

        let removed = registry.remove("test").unwrap();
        assert!(removed.is_some());

        let result = registry.get("test");
        assert!(result.is_err());
    }

    #[test]
    fn test_registry_is_open() {
        let registry = ProjectRegistry::new();
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().to_path_buf();
        let state = create_test_state(path.clone());

        registry.register("test".to_string(), state).unwrap();

        let result = registry.is_open(&path).unwrap();
        assert_eq!(result, Some("test".to_string()));

        let other_path = PathBuf::from("/some/other/path");
        let result = registry.is_open(&other_path).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_label_for_path() {
        let path = PathBuf::from("/Users/test/my-project");
        let label = ProjectRegistry::label_for_path(&path);
        assert!(label
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_'));

        let path_with_spaces = PathBuf::from("/Users/test/my project");
        let label = ProjectRegistry::label_for_path(&path_with_spaces);
        assert!(!label.contains(' '));
    }

    #[test]
    fn test_project_state_stop_flag() {
        let temp_dir = TempDir::new().unwrap();
        let state = create_test_state(temp_dir.path().to_path_buf());

        let stop_flag = state.stop_flag();
        assert!(!stop_flag.load(Ordering::Relaxed));

        stop_flag.store(true, Ordering::Relaxed);
        assert!(stop_flag.load(Ordering::Relaxed));
    }

    #[test]
    fn test_all_project_roots() {
        let registry = ProjectRegistry::new();
        let temp_dir1 = TempDir::new().unwrap();
        let temp_dir2 = TempDir::new().unwrap();

        let state1 = create_test_state(temp_dir1.path().to_path_buf());
        let state2 = create_test_state(temp_dir2.path().to_path_buf());

        registry.register("test1".to_string(), state1).unwrap();
        registry.register("test2".to_string(), state2).unwrap();

        let roots = registry.all_project_roots().unwrap();
        assert_eq!(roots.len(), 2);
        assert!(roots.contains(&temp_dir1.path().to_path_buf()));
        assert!(roots.contains(&temp_dir2.path().to_path_buf()));
    }
}
