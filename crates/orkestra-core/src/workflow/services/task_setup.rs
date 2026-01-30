//! Background task setup (worktree creation, title generation).

use std::sync::Arc;
use std::thread;

use crate::title::{generate_fallback_title, TitleGenerator};
use crate::workflow::ports::{GitService, WorkflowStore};
use crate::workflow::runtime::{Phase, Status};

/// Handles background setup for newly created tasks.
///
/// Runs worktree creation and title generation in parallel on a background thread,
/// then transitions the task from `SettingUp` to `Idle` (or `Failed` on error).
pub struct TaskSetupService {
    store: Arc<dyn WorkflowStore>,
    git: Option<Arc<dyn GitService>>,
    title_gen: Arc<dyn TitleGenerator>,
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
        }
    }

    /// Spawn background setup for a new task.
    ///
    /// Runs worktree creation and title generation in parallel, then transitions
    /// to `Phase::Idle`. On failure, transitions to `Status::Failed`.
    ///
    /// If `description` is Some, title will be generated from it (for tasks created
    /// without a title). The title is saved as soon as it's ready, before worktree
    /// setup finishes.
    pub fn spawn_setup(
        &self,
        task_id: String,
        base_branch: Option<String>,
        description: Option<String>,
    ) {
        let store = Arc::clone(&self.store);
        let git = self.git.clone();
        let title_gen = Arc::clone(&self.title_gen);

        crate::orkestra_debug!("task", "spawn_setup {}: starting", task_id);
        thread::spawn(move || {
            let worktree_result = run_parallel_setup(
                &store,
                git.as_ref(),
                &title_gen,
                &task_id,
                base_branch.as_ref(),
                description.as_deref(),
            );

            apply_setup_result(&store, git.as_ref(), &task_id, base_branch.as_ref(), worktree_result);
        });
    }

    /// Spawn background setup for a subtask.
    ///
    /// Subtasks inherit their parent's worktree, so this only transitions
    /// the task from `SettingUp` to `Idle`. No worktree creation or title
    /// generation is needed.
    pub fn spawn_subtask_setup(&self, task_id: String) {
        let store = Arc::clone(&self.store);

        crate::orkestra_debug!("task", "spawn_subtask_setup {}: starting", task_id);
        thread::spawn(move || {
            match store.get_task(&task_id) {
                Ok(Some(mut task)) => {
                    task.phase = Phase::Idle;
                    if let Err(e) = store.save_task(&task) {
                        crate::orkestra_debug!(
                            "setup",
                            "CRITICAL: Failed to save subtask {task_id}: {e}"
                        );
                    }
                }
                Ok(None) => {
                    crate::orkestra_debug!(
                        "setup",
                        "CRITICAL: Subtask {task_id} disappeared during setup"
                    );
                }
                Err(e) => {
                    crate::orkestra_debug!(
                        "setup",
                        "CRITICAL: Failed to load subtask {task_id}: {e}"
                    );
                }
            }
        });
    }
}

/// Run worktree creation and title generation in parallel using scoped threads.
///
/// Returns the worktree result. Title is saved directly to the store by its thread.
fn run_parallel_setup(
    store: &Arc<dyn WorkflowStore>,
    git: Option<&Arc<dyn GitService>>,
    title_gen: &Arc<dyn TitleGenerator>,
    task_id: &str,
    base_branch: Option<&String>,
    description: Option<&str>,
) -> Result<Option<crate::workflow::ports::WorktreeCreated>, String> {
    thread::scope(|s| {
        // Spawn worktree creation
        let worktree_handle = s.spawn(|| {
            if let Some(git) = git {
                match git.create_worktree(task_id, base_branch.map(String::as_str)) {
                    Ok(result) => Ok(Some(result)),
                    Err(e) => Err(format!("Worktree setup failed: {e}")),
                }
            } else {
                Ok(None)
            }
        });

        // Spawn title generation if needed — saves directly to DB when ready
        let title_store = Arc::clone(store);
        let title_handle = description.map(|desc| {
            let tg = Arc::clone(title_gen);
            let tid = task_id.to_owned();
            s.spawn(move || {
                generate_and_save_title(&*title_store, &*tg, &tid, desc);
            })
        });

        // Wait for both to complete
        let worktree_result = worktree_handle
            .join()
            .unwrap_or_else(|_| Err("Worktree thread panicked".to_string()));
        if let Some(h) = title_handle {
            let _ = h.join();
        }

        worktree_result
    })
}

/// Apply the setup result to the task (worktree info + phase transition).
fn apply_setup_result(
    store: &Arc<dyn WorkflowStore>,
    git: Option<&Arc<dyn GitService>>,
    task_id: &str,
    base_branch: Option<&String>,
    worktree_result: Result<Option<crate::workflow::ports::WorktreeCreated>, String>,
) {
    match store.get_task(task_id) {
        Ok(Some(mut task)) => {
            match worktree_result {
                Ok(worktree_info) => {
                    if let Some(ref wt) = worktree_info {
                        task.branch_name = Some(wt.branch_name.clone());
                        task.worktree_path =
                            Some(wt.worktree_path.to_string_lossy().to_string());
                    }

                    // Persist the base branch on the task.
                    // If explicitly provided, use that; otherwise resolve from current branch.
                    if let Some(git) = git {
                        task.base_branch = Some(base_branch.cloned().unwrap_or_else(|| {
                            git.current_branch().unwrap_or_else(|_| "main".to_string())
                        }));
                    }

                    task.phase = Phase::Idle;
                    crate::orkestra_debug!(
                        "task",
                        "{} setup complete: phase=Idle, worktree={:?}, branch={:?}",
                        task_id,
                        task.worktree_path,
                        task.branch_name
                    );
                    if let Err(e) = store.save_task(&task) {
                        crate::orkestra_debug!(
                            "setup",
                            "CRITICAL: Failed to save task {task_id}: {e}"
                        );
                    }
                }
                Err(error) => {
                    crate::orkestra_debug!("setup", "Setup failed for {task_id}: {error}");
                    task.status = Status::Failed { error: Some(error) };
                    task.phase = Phase::Idle;
                    if let Err(e) = store.save_task(&task) {
                        crate::orkestra_debug!(
                            "setup",
                            "CRITICAL: Failed to save failed task {task_id}: {e}"
                        );
                    }
                }
            }
        }
        Ok(None) => {
            // Task was deleted during setup - clean up any orphaned worktree
            crate::orkestra_debug!(
                "setup",
                "CRITICAL: Task {task_id} disappeared during setup"
            );
            if let Some(git) = git {
                if let Err(e) = git.remove_worktree(task_id, true) {
                    crate::orkestra_debug!(
                        "setup",
                        "WARNING: Failed to clean up orphaned worktree for {task_id}: {e}"
                    );
                }
            }
        }
        Err(e) => {
            crate::orkestra_debug!(
                "setup",
                "CRITICAL: Failed to load task {task_id}: {e}"
            );
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
                crate::orkestra_debug!(
                    "task",
                    "WARNING: Failed to save title for {task_id}: {e}"
                );
            }
        }
    }
}
