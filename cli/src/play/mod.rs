//! Run a task through all workflow stages non-interactively.

mod finish;
mod run_loop;
mod setup;

use std::sync::{Arc, Mutex};

use orkestra_core::workflow::{OrchestratorLoop, WorkflowApi};

/// Maximum consecutive gate failures allowed per stage before the run loop
/// aborts — prevents infinite retries when a gate check keeps failing.
const MAX_GATE_FAILURES_PER_STAGE: u32 = 3;

struct PlayContext {
    api: Arc<Mutex<WorkflowApi>>,
    orchestrator: OrchestratorLoop,
    task_id: String,
}

pub fn execute(
    description: String,
    title: Option<String>,
    base_branch: Option<String>,
    flow: Option<String>,
    no_integrate: bool,
    no_pr: bool,
    pretty: bool,
) -> Result<(), String> {
    let mut ctx = setup::execute(&description, title, base_branch, flow, no_integrate)?;
    run_loop::execute(&mut ctx)?;
    finish::execute(&ctx.api, &ctx.task_id, no_integrate, no_pr, pretty)
}
