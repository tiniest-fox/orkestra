//! Background task setup (worktree creation, title generation).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use crate::title::{generate_fallback_title, TitleGenerator};
use crate::workflow::ports::{GitService, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

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
    /// to `Phase::Idle`. On failure, transitions to `Status::Failed`.
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

/// Run worktree creation and title generation in parallel using scoped threads.
///
/// The worktree is created in two phases:
/// 1. `ensure_worktree` - creates branch + worktree (fast, rarely fails)
/// 2. Save worktree info to DB immediately (so retry can skip step 1)
/// 3. `run_setup_script` - runs project-specific setup (may fail)
///
/// This split ensures that if the setup script fails, the worktree info is
/// already saved, allowing retry to skip branch/worktree creation.
fn run_parallel_setup(
    store: &Arc<dyn WorkflowStore>,
    git: Option<&Arc<dyn GitService>>,
    title_gen: &Arc<dyn TitleGenerator>,
    task_id: &str,
    base_branch: &str,
    description: Option<&str>,
) -> Result<(), String> {
    thread::scope(|s| {
        // Phase 1: Create/ensure worktree exists (no setup script yet)
        let worktree_result = if let Some(git) = git {
            let branch = if base_branch.is_empty() {
                None
            } else {
                Some(base_branch)
            };
            git.ensure_worktree(task_id, branch)
                .map(Some)
                .map_err(|e| format!("Worktree creation failed: {e}"))
        } else {
            Ok(None)
        };

        // Phase 2: IMMEDIATELY save worktree info (before setup script)
        // This ensures retry can skip worktree creation if setup script fails
        if let Ok(Some(ref wt)) = worktree_result {
            if let Ok(Some(mut task)) = store.get_task(task_id) {
                task.branch_name = Some(wt.branch_name.clone());
                task.worktree_path = Some(wt.worktree_path.to_string_lossy().to_string());
                if let Err(e) = store.save_task(&task) {
                    crate::orkestra_debug!(
                        "setup",
                        "WARNING: Failed to save worktree info for {task_id}: {e}"
                    );
                }
            }
        }

        // Spawn title generation (parallel with setup script)
        let title_store = Arc::clone(store);
        let title_handle = description.map(|desc| {
            let tg = Arc::clone(title_gen);
            let tid = task_id.to_owned();
            s.spawn(move || {
                generate_and_save_title(&*title_store, &*tg, &tid, desc);
            })
        });

        // Phase 3: Run setup script (after worktree info is saved)
        let setup_result = match worktree_result {
            Ok(Some(ref wt)) => {
                if let Some(git) = git {
                    git.run_setup_script(&wt.worktree_path)
                        .map_err(|e| format!("Setup script failed: {e}"))
                } else {
                    Ok(())
                }
            }
            Ok(None) => Ok(()), // No git service, nothing to do
            Err(e) => Err(e),   // Propagate worktree creation error
        };

        // Wait for title generation to complete
        if let Some(h) = title_handle {
            let _ = h.join();
        }

        // Apply phase transition (worktree info already saved)
        apply_setup_result(store, task_id, setup_result);

        Ok(())
    })
}

/// Apply the setup result to the task (phase transition only).
///
/// Worktree info is already saved by `run_parallel_setup` before the setup script
/// runs. This function only transitions the phase based on whether setup succeeded.
fn apply_setup_result(store: &Arc<dyn WorkflowStore>, task_id: &str, result: Result<(), String>) {
    match store.get_task(task_id) {
        Ok(Some(mut task)) => match result {
            Ok(()) => {
                task.phase = Phase::Idle;
                crate::orkestra_debug!(
                    "task",
                    "{} setup complete: phase=Idle, worktree={:?}, branch={:?}",
                    task_id,
                    task.worktree_path,
                    task.branch_name
                );
                if let Err(e) = store.save_task(&task) {
                    crate::orkestra_debug!("setup", "CRITICAL: Failed to save task {task_id}: {e}");
                }
            }
            Err(error) => {
                crate::orkestra_debug!("setup", "Setup failed for {task_id}: {error}");
                task.status = Status::Failed { error: Some(error) };
                task.phase = Phase::Idle;
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

/// Generate a title and save it directly to the store.
///
/// Called from the title thread inside `run_parallel_setup`. Saves immediately so
/// the UI can display the title before worktree setup finishes.
fn generate_and_save_title(
    store: &dyn WorkflowStore,
    title_gen: &dyn TitleGenerator,
    task_id: &str,
    description: &str,
) {
    let title = match title_gen.generate_title(task_id, description) {
        Ok(title) => title,
        Err(e) => {
            crate::orkestra_debug!(
                "task",
                "WARNING: Title generation failed for {task_id}: {e}"
            );
            generate_fallback_title(description)
        }
    };

    if let Ok(Some(mut task)) = store.get_task(task_id) {
        if task.title.trim().is_empty() {
            task.title = title;
            if let Err(e) = store.save_task(&task) {
                crate::orkestra_debug!("task", "WARNING: Failed to save title for {task_id}: {e}");
            }
        }
    }
}
