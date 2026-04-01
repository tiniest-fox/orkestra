//! Drive the orchestrator tick loop until the Trak reaches a terminal state.

use std::collections::HashMap;

use orkestra_core::workflow::{OrchestratorEvent, TaskState};

pub fn execute(ctx: &mut super::PlayContext) -> Result<(), String> {
    let mut gate_failures: HashMap<String, u32> = HashMap::new();

    loop {
        let events = ctx
            .orchestrator
            .tick()
            .map_err(|e| format!("Orchestrator error: {e}"))?;

        for event in &events {
            print_event(event);
            if let OrchestratorEvent::GateFailed { stage, .. } = event {
                let count = gate_failures.entry(stage.clone()).or_default();
                *count += 1;
                if *count >= super::MAX_GATE_FAILURES_PER_STAGE {
                    return Err(format!(
                        "Gate failed {} times for stage '{stage}', aborting",
                        super::MAX_GATE_FAILURES_PER_STAGE
                    ));
                }
            }
        }

        let task = ctx
            .api
            .lock()
            .map_err(|_| "Workflow API lock poisoned".to_string())?
            .get_task(&ctx.task_id)
            .map_err(|e| format!("Failed to get trak: {e}"))?;
        match &task.state {
            TaskState::Done | TaskState::Archived => break,
            TaskState::Failed { stage, error } => {
                let stage = stage.as_deref().unwrap_or("unknown");
                let error = error.as_deref().unwrap_or("unknown error");
                return Err(format!("trak failed at stage '{stage}': {error}"));
            }
            TaskState::Blocked { stage, reason } => {
                let stage = stage.as_deref().unwrap_or("unknown");
                let reason = reason.as_deref().unwrap_or("unknown reason");
                return Err(format!("trak blocked at stage '{stage}': {reason}"));
            }
            // Interrupted is not treated as terminal — the loop continues ticking until
            // the interruption is resolved or the task transitions to a terminal state.
            // This is an unlikely scenario for unattended `ork play` execution.
            _ => {}
        }
    }

    Ok(())
}

// -- Helpers --

fn print_event(event: &OrchestratorEvent) {
    match event {
        OrchestratorEvent::AgentSpawned { stage, .. } => eprintln!("  running {stage}..."),
        OrchestratorEvent::OutputProcessed { stage, .. } => eprintln!("  {stage} complete"),
        OrchestratorEvent::GateSpawned { command, .. } => eprintln!("  running gate: {command}"),
        OrchestratorEvent::GatePassed { stage, .. } => eprintln!("  gate passed ({stage})"),
        OrchestratorEvent::GateFailed { stage, error, .. } => {
            eprintln!("  gate failed ({stage}): {error}");
        }
        OrchestratorEvent::ParentAdvanced { subtask_count, .. } => {
            eprintln!("  all {subtask_count} subtraks complete");
        }
        OrchestratorEvent::IntegrationCompleted { .. } => eprintln!("  subtrak integrated"),
        OrchestratorEvent::Error { error, .. } => eprintln!("  warning: {error}"),
        _ => {}
    }
}
