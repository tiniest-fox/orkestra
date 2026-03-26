//! Post-loop integration (merge or PR) and final task output.

use std::sync::{Arc, Mutex};

use orkestra_core::workflow::{create_pr_sync, merge_task_sync, WorkflowApi};

pub fn execute(
    api: &Arc<Mutex<WorkflowApi>>,
    task_id: &str,
    no_integrate: bool,
    no_pr: bool,
    pretty: bool,
) -> Result<(), String> {
    let task = api
        .lock()
        .map_err(|_| "Workflow API lock poisoned".to_string())?
        .get_task(task_id)
        .map_err(|e| format!("Failed to get task: {e}"))?;

    // Only attempt post-loop integration when task is Done.
    // If already Archived, the orchestrator handled integration (auto_merge) — skip.
    if task.is_done() && !no_integrate {
        if no_pr {
            // Direct merge — no PR.
            eprintln!("Merging...");
            merge_task_sync(Arc::clone(api), task_id).map_err(|e| format!("Merge failed: {e}"))?;
            eprintln!("Merged successfully");
        } else {
            // PR is the integration mechanism — push branch, open PR on GitHub.
            eprintln!("Creating pull request...");
            let task = create_pr_sync(Arc::clone(api), task_id)
                .map_err(|e| format!("PR creation failed: {e}"))?;
            if let Some(url) = &task.pr_url {
                eprintln!("PR created: {url}");
            }
        }
    }

    let final_task = api
        .lock()
        .map_err(|_| "Workflow API lock poisoned".to_string())?
        .get_task(task_id)
        .map_err(|e| format!("Failed to get final task: {e}"))?;

    if pretty {
        println!("Task {task_id} complete");
        println!("State: {}", crate::format_state(&final_task.state));
        if let Some(branch) = &final_task.branch_name {
            println!("Branch: {branch}");
        }
        if let Some(url) = &final_task.pr_url {
            println!("PR: {url}");
        }
    } else {
        crate::output_json(&final_task);
    }

    Ok(())
}
