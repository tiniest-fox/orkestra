//! Transition Finishing tasks to Committing and collect background commit jobs.

use std::sync::Arc;

use crate::orkestra_debug;
use crate::workflow::ports::{GitService, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

/// Parameters for a background commit job.
pub struct CommitJob {
    pub task: crate::workflow::domain::Task,
    pub stage: String,
    pub activity_log: Option<String>,
    pub git: Arc<dyn GitService>,
}

/// Find Finishing tasks, transition them to Committing (or Finished if no git),
/// and return the commit jobs to spawn.
pub fn execute(
    store: &dyn WorkflowStore,
    git_service: Option<&Arc<dyn GitService>>,
) -> WorkflowResult<Vec<CommitJob>> {
    let finishing: Vec<_> = store
        .list_task_headers()?
        .into_iter()
        .filter(|h| matches!(h.state, TaskState::Finishing { .. }))
        .collect();

    if finishing.is_empty() {
        return Ok(Vec::new());
    }

    let mut jobs = Vec::new();

    for header in &finishing {
        let Some(mut task) = store.get_task(&header.id)? else {
            continue;
        };
        if !matches!(task.state, TaskState::Finishing { .. }) {
            continue;
        }

        // Get stage and activity_log for simple commit message
        let stage = task.current_stage().unwrap_or("unknown").to_string();
        let activity_log = store
            .get_latest_iteration(&task.id, &stage)?
            .and_then(|iter| iter.activity_log);

        orkestra_debug!(
            "orchestrator",
            "spawn_pending_commits {}: → {}",
            task.id,
            if git_service.is_some() {
                "Committing"
            } else {
                "Finished"
            }
        );

        if let Some(g) = git_service {
            // Git path: transition to Committing and queue background job
            task.state = TaskState::committing(&stage);
            task.updated_at = chrono::Utc::now().to_rfc3339();
            store.save_task(&task)?;

            jobs.push(CommitJob {
                task,
                stage,
                activity_log,
                git: Arc::clone(g),
            });
        } else {
            // No git service — skip commit, stay in Finishing (advance_all_committed picks up)
            task.updated_at = chrono::Utc::now().to_rfc3339();
            store.save_task(&task)?;
        }
    }

    Ok(jobs)
}
