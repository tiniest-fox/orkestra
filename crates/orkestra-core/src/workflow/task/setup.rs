//! Background task setup (worktree creation, title generation).
//!
//! `TaskSetupService` manages background-thread plumbing that spawns threads
//! calling setup interactions. Business logic lives in:
//! - `interactions/setup_worktree.rs` — worktree + branch creation
//! - `interactions/generate_title.rs` — AI title generation

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use crate::title::TitleGenerator;
use crate::workflow::ports::{GitService, WorkflowStore};
use crate::workflow::runtime::TaskState;

/// Handles background setup for newly created tasks.
///
/// Runs worktree creation and title generation in parallel on a background thread,
/// then transitions the task from `SettingUp` to `Idle` (or `Failed` on error).
///
/// When `sync` is true, setup runs inline on the calling thread instead of
/// spawning a background thread. Used by tests for deterministic execution.
pub struct TaskSetupService {
    store: Arc<dyn WorkflowStore>,
    git: Option<Arc<dyn GitService>>,
    title_gen: Arc<dyn TitleGenerator>,
    sync: AtomicBool,
}

impl TaskSetupService {
    pub fn new(
        store: Arc<dyn WorkflowStore>,
        git: Option<Arc<dyn GitService>>,
        title_gen: Arc<dyn TitleGenerator>,
    ) -> Self {
        Self {
            store,
            git,
            title_gen,
            sync: AtomicBool::new(false),
        }
    }

    /// Run setup synchronously on the calling thread instead of spawning.
    ///
    /// When enabled, `spawn_setup` blocks until setup is complete.
    /// Used by tests for deterministic execution.
    pub fn set_sync(&self, sync: bool) {
        self.sync.store(sync, Ordering::Relaxed);
    }

    /// Spawn background setup for a new task.
    ///
    /// Runs worktree creation and title generation in parallel, then transitions
    /// to `TaskState::Queued`. On failure, transitions to `TaskState::Failed`.
    ///
    /// `base_branch` is already set on the task at creation time. It's passed here
    /// so the background thread can use it for `create_worktree()` without loading
    /// the task first.
    ///
    /// If `description` is Some, title will be generated from it (for tasks created
    /// without a title). The title is saved as soon as it's ready, before worktree
    /// setup finishes.
    pub fn spawn_setup(&self, task_id: String, base_branch: String, description: Option<String>) {
        let store = Arc::clone(&self.store);
        let git = self.git.clone();
        let title_gen = Arc::clone(&self.title_gen);

        crate::orkestra_debug!("task", "spawn_setup {}: starting", task_id);

        let run = move || {
            let worktree_result = run_parallel_setup(
                &store,
                git.as_ref(),
                &title_gen,
                &task_id,
                &base_branch,
                description.as_deref(),
            );
            apply_setup_result(&store, &task_id, worktree_result);
        };

        if self.sync.load(Ordering::Relaxed) {
            run();
        } else {
            thread::spawn(run);
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Run worktree creation and title generation in parallel using scoped threads.
///
/// Delegates worktree creation to `setup_worktree::execute` and title generation
/// to `generate_title::execute`. Returns the worktree setup result for the caller
/// to apply.
fn run_parallel_setup(
    store: &Arc<dyn WorkflowStore>,
    git: Option<&Arc<dyn GitService>>,
    title_gen: &Arc<dyn TitleGenerator>,
    task_id: &str,
    base_branch: &str,
    description: Option<&str>,
) -> Result<(), String> {
    thread::scope(|s| {
        // Spawn title generation (parallel with worktree setup)
        let title_store = Arc::clone(store);
        let title_handle = description.map(|desc| {
            let tg = Arc::clone(title_gen);
            let tid = task_id.to_owned();
            s.spawn(move || {
                super::interactions::generate_title::execute(&*title_store, &*tg, &tid, desc);
            })
        });

        // Run worktree creation (sync, includes base branch sync + setup script)
        let worktree_result =
            super::interactions::setup_worktree::execute(store, git, task_id, base_branch);

        // Wait for title generation to complete
        if let Some(h) = title_handle {
            let _ = h.join();
        }

        worktree_result
    })
}

/// Apply the setup result to the task (phase transition only).
///
/// Worktree info is already saved by `setup_worktree::execute` before the setup
/// script runs. This function only transitions the phase based on whether setup succeeded.
fn apply_setup_result(store: &Arc<dyn WorkflowStore>, task_id: &str, result: Result<(), String>) {
    match store.get_task(task_id) {
        Ok(Some(mut task)) => match result {
            Ok(()) => {
                let stage = task.current_stage().unwrap_or("unknown").to_string();
                // Interactive tasks skip the pipeline queue and enter interactive mode directly.
                task.state = if task.created_interactive {
                    TaskState::interactive(&stage)
                } else {
                    TaskState::queued(stage)
                };
                crate::orkestra_debug!(
                    "task",
                    "{} setup complete: state={}, worktree={:?}, branch={:?}",
                    task_id,
                    task.state,
                    task.worktree_path,
                    task.branch_name
                );
                if let Err(e) = store.save_task(&task) {
                    crate::orkestra_debug!("setup", "CRITICAL: Failed to save task {task_id}: {e}");
                }
            }
            Err(error) => {
                crate::orkestra_debug!("setup", "Setup failed for {task_id}: {error}");
                let stage = task.current_stage().unwrap_or("unknown").to_string();
                task.state = TaskState::failed_at(stage, &error);
                // Worktree info is already saved - retry will skip creation
                if let Err(e) = store.save_task(&task) {
                    crate::orkestra_debug!(
                        "setup",
                        "CRITICAL: Failed to save failed task {task_id}: {e}"
                    );
                }
            }
        },
        Ok(None) => {
            crate::orkestra_debug!("setup", "CRITICAL: Task {task_id} disappeared during setup");
        }
        Err(e) => {
            crate::orkestra_debug!("setup", "CRITICAL: Failed to load task {task_id}: {e}");
        }
    }
}
