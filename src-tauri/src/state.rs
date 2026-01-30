//! Application state holding the `WorkflowApi`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use orkestra_core::adapters::sqlite::DatabaseConnection;
use orkestra_core::workflow::{
    Git2GitService, GitService, SqliteWorkflowStore, WorkflowApi, WorkflowConfig, WorkflowStore,
};

use crate::error::TauriError;

/// Application state holding the workflow API.
///
/// The `WorkflowApi` is wrapped in an `Arc<Mutex>` to allow shared access from both
/// Tauri commands and the orchestrator loop.
pub struct AppState {
    api: Arc<Mutex<WorkflowApi>>,
    config: WorkflowConfig,
    project_root: PathBuf,
    /// Database connection, kept alive for the lifetime of the app.
    /// We use this to create additional stores (e.g., for the orchestrator).
    #[allow(dead_code)]
    db_conn: DatabaseConnection,
    /// Whether git service is available for worktree isolation.
    has_git: bool,
}

impl AppState {
    /// Create a new `AppState` with the given workflow config and database path.
    pub fn new(
        workflow: WorkflowConfig,
        db_path: &Path,
        project_root: PathBuf,
    ) -> Result<Self, String> {
        // Open database with integrity validation.
        // If corrupted, moves the bad file aside and starts fresh.
        let (conn, recovered) =
            DatabaseConnection::open_validated(db_path).map_err(|e| e.to_string())?;
        if recovered {
            eprintln!("[startup] Database was corrupted — started with a fresh database");
            eprintln!("[startup] Previous database preserved as .corrupt file for inspection");
        }

        // Create workflow store with shared connection
        let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::new(conn.shared()));

        // Try to create git service for worktree support
        let (git_service, has_git): (Option<Arc<dyn GitService>>, bool) =
            match Git2GitService::new(&project_root) {
                Ok(git) => {
                    eprintln!(
                        "[git] Git service initialized for {}",
                        project_root.display()
                    );
                    (Some(Arc::new(git)), true)
                }
                Err(e) => {
                    eprintln!("[git] Git service unavailable: {e}");
                    eprintln!("[git] Tasks will run without git worktree isolation");
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
            api: Arc::new(Mutex::new(api)),
            project_root,
            db_conn: conn,
            has_git,
        })
    }

    /// Get a lock on the `WorkflowApi`.
    ///
    /// Returns an error if the mutex is poisoned (another thread panicked while holding the lock).
    /// This is preferable to panicking in a GUI application.
    pub fn api(&self) -> Result<std::sync::MutexGuard<WorkflowApi>, TauriError> {
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
    /// Call on graceful shutdown to leave the database in a clean state,
    /// reducing the risk of corruption if the next startup is interrupted.
    pub fn checkpoint_database(&self) {
        if let Err(e) = self.db_conn.checkpoint() {
            eprintln!("[shutdown] WAL checkpoint failed: {e}");
        }
    }
}
