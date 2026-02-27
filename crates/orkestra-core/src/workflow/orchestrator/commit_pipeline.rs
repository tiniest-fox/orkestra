//! Finishing → Committing → Committed pipeline.
//!
//! Spawns background git commit threads. Business logic (which tasks need
//! committing, phase transitions) lives in `stage_interactions::collect_commit_jobs`.

use std::sync::{Arc, Mutex};

use crate::commit_message::CommitMessageGenerator;
use crate::orkestra_debug;
use crate::workflow::api::WorkflowApi;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult};
use crate::workflow::stage::interactions as stage_interactions;

use super::OrchestratorLoop;

impl OrchestratorLoop {
    /// Transition Finishing tasks to Committing and spawn background commit threads.
    ///
    /// Always goes through Committing — even if there are no changes, the
    /// background thread completes instantly (`commit_pending_changes` is a no-op
    /// when clean). This keeps the git status check off the tick thread.
    pub(super) fn spawn_pending_commits(&self) -> WorkflowResult<()> {
        let jobs = {
            let api = self.api.lock().map_err(|_| WorkflowError::Lock)?;
            let commit_message_generator = Arc::clone(&api.commit_message_generator);
            let workflow = api.workflow.clone();
            stage_interactions::collect_commit_jobs::execute(
                api.store.as_ref(),
                self.git_service.as_ref(),
                &commit_message_generator,
                &workflow,
            )?
        };

        for job in jobs {
            let api_clone = Arc::clone(&self.api);
            let run_commit = move || {
                Self::run_background_commit(
                    job.git,
                    api_clone,
                    job.task,
                    job.stage,
                    job.activity_log,
                    job.commit_message_generator,
                    job.workflow,
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

    // -- Helpers --

    /// Background commit logic. Commits worktree changes and records result via `WorkflowApi`.
    #[allow(clippy::needless_pass_by_value)]
    fn run_background_commit(
        git: Arc<dyn GitService>,
        api: Arc<Mutex<WorkflowApi>>,
        task: Task,
        stage: String,
        activity_log: Option<String>,
        commit_message_generator: Arc<dyn CommitMessageGenerator>,
        workflow: WorkflowConfig,
    ) {
        let task_id = task.id.clone();

        let commit_result = crate::workflow::integration::interactions::commit_worktree::execute(
            git.as_ref(),
            &task,
            &stage,
            activity_log.as_deref(),
            Some((commit_message_generator.as_ref(), &workflow)),
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
