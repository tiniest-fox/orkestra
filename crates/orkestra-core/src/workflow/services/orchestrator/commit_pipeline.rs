//! Finishing → Committing → Finished pipeline.
//!
//! Handles background git commits after stage completion and advances
//! tasks through the commit pipeline phases.

use std::sync::{Arc, Mutex};

use crate::orkestra_debug;
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult};
use crate::workflow::runtime::Phase;
use crate::workflow::services::WorkflowApi;

use super::{OrchestratorEvent, OrchestratorLoop};

/// Parameters for a background commit job.
struct CommitJob {
    task: Task,
    /// The stage being committed (for simple commit message format).
    stage: String,
    /// Activity log from the iteration (for commit message body).
    activity_log: Option<String>,
    git: Arc<dyn GitService>,
}

impl OrchestratorLoop {
    /// Transition Finishing tasks to Committing and spawn background commit threads.
    ///
    /// Always goes through Committing — even if there are no changes, the
    /// background thread completes instantly (`commit_pending_changes` is a no-op
    /// when clean). This keeps the git status check off the tick thread.
    pub(super) fn spawn_pending_commits(&self) -> WorkflowResult<()> {
        let jobs = self.collect_pending_commit_jobs()?;

        for job in jobs {
            let api_clone = Arc::clone(&self.api);
            let run_commit = move || {
                Self::run_background_commit(
                    job.git,
                    api_clone,
                    job.task,
                    job.stage,
                    job.activity_log,
                );
            };

            if self.sync_background {
                run_commit();
            } else {
                std::thread::spawn(run_commit);
            }
        }

        Ok(())
    }

    /// Advance tasks in Finished phase to the next stage.
    ///
    /// The output was already processed inline (during `handle_execution_complete`
    /// or human approval). The commit pipeline just committed the worktree changes.
    /// Now we complete the stage advancement.
    pub(super) fn advance_committed_stages(&self) -> WorkflowResult<Vec<OrchestratorEvent>> {
        // Query DB directly (not snapshot) because:
        // 1. process_completed_executions may have created Finishing tasks after snapshot
        // 2. spawn_pending_commits bg threads transition Committing → Finished after snapshot
        // Acquiring the lock also blocks until any in-flight commit threads complete.
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let finished: Vec<_> = api
            .store
            .list_task_headers()?
            .into_iter()
            .filter(|h| h.phase == Phase::Finished)
            .collect();

        if finished.is_empty() {
            return Ok(Vec::new());
        }

        let mut events = Vec::new();

        for header in &finished {
            let task_id = header.id.clone();
            let stage = header.current_stage().unwrap_or("unknown").to_string();

            orkestra_debug!(
                "orchestrator",
                "advance_committed_stages {}/{}: advancing stage",
                task_id,
                stage,
            );

            match api.finalize_stage_advancement(&task_id) {
                Ok(updated) => {
                    let output_type = if updated.is_done() {
                        "done"
                    } else if updated.status.is_waiting_on_children() {
                        "subtasks"
                    } else {
                        "advanced"
                    };
                    events.push(OrchestratorEvent::OutputProcessed {
                        task_id,
                        stage,
                        output_type: output_type.to_string(),
                    });
                }
                Err(e) => {
                    events.push(OrchestratorEvent::Error {
                        task_id: Some(task_id),
                        error: e.to_string(),
                    });
                }
            }
        }

        Ok(events)
    }

    // -- Helpers --

    /// Find Finishing tasks, transition them to Committing (or Finished if no git),
    /// and return the commit jobs to spawn.
    fn collect_pending_commit_jobs(&self) -> WorkflowResult<Vec<CommitJob>> {
        let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
        let finishing: Vec<_> = api
            .store
            .list_task_headers()?
            .into_iter()
            .filter(|h| h.phase == Phase::Finishing)
            .collect();

        if finishing.is_empty() {
            return Ok(Vec::new());
        }

        let mut jobs = Vec::new();

        for header in &finishing {
            let Some(mut task) = api.store.get_task(&header.id)? else {
                continue;
            };
            if task.phase != Phase::Finishing {
                continue;
            }

            // Get stage and activity_log for simple commit message
            let stage = task.current_stage().unwrap_or("unknown").to_string();
            let activity_log = api
                .store
                .get_latest_iteration(&task.id, &stage)?
                .and_then(|iter| iter.activity_log);

            orkestra_debug!(
                "orchestrator",
                "spawn_pending_commits {}: → {}",
                task.id,
                if self.git_service.is_some() {
                    "Committing"
                } else {
                    "Finished"
                }
            );

            if let Some(g) = &self.git_service {
                // Git path: transition to Committing and queue background job
                task.phase = Phase::Committing;
                task.updated_at = chrono::Utc::now().to_rfc3339();
                api.store.save_task(&task)?;

                jobs.push(CommitJob {
                    task,
                    stage,
                    activity_log,
                    git: Arc::clone(g),
                });
            } else {
                // No git service — skip commit, go straight to Finished
                task.phase = Phase::Finished;
                task.updated_at = chrono::Utc::now().to_rfc3339();
                api.store.save_task(&task)?;
            }
        }

        Ok(jobs)
    }

    /// Background commit logic. Commits worktree changes and records result via `WorkflowApi`.
    #[allow(clippy::needless_pass_by_value)]
    fn run_background_commit(
        git: Arc<dyn GitService>,
        api: Arc<Mutex<WorkflowApi>>,
        task: Task,
        stage: String,
        activity_log: Option<String>,
    ) {
        let task_id = task.id.clone();

        let commit_result = crate::workflow::services::commit_worktree::commit_worktree_changes(
            git.as_ref(),
            &task,
            &stage,
            activity_log.as_deref(),
        );

        let Ok(api) = api.lock() else {
            orkestra_debug!(
                "commit",
                "failed to acquire API lock after commit for {} — will be recovered on restart",
                task_id
            );
            return;
        };

        let result = match commit_result {
            Ok(()) => api.commit_succeeded(&task_id),
            Err(e) => api.commit_failed(&task_id, &format!("Failed to commit agent changes: {e}")),
        };

        if let Err(e) = result {
            orkestra_debug!(
                "commit",
                "commit result recording failed for {}: {}",
                task_id,
                e
            );
        }
    }
}
