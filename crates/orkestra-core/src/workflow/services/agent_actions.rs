//! Agent/orchestrator actions: agent started, process output, get pending tasks.

use crate::orkestra_debug;
use crate::workflow::domain::{IterationTrigger, Task};
use crate::workflow::execution::StageOutput;
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::{Artifact, Outcome, Phase, Status};

use super::WorkflowApi;

impl WorkflowApi {
    /// Mark agent as started on a task. Transitions phase to `AgentWorking`.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not in `Idle` phase.
    pub fn agent_started(&self, task_id: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if task.phase != Phase::Idle {
            return Err(WorkflowError::InvalidTransition(format!(
                "Agent cannot start in phase {:?}",
                task.phase
            )));
        }

        task.phase = Phase::AgentWorking;
        task.updated_at = chrono::Utc::now().to_rfc3339();

        orkestra_debug!(
            "action",
            "agent_started {}: phase={:?}, stage={:?}",
            task_id,
            task.phase,
            task.current_stage()
        );

        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Process completed agent output. Handles artifacts, questions, restages, failures.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not in `AgentWorking` phase.
    pub fn process_agent_output(&self, task_id: &str, output: StageOutput) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if task.phase != Phase::AgentWorking {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot process agent output in phase {:?}",
                task.phase
            )));
        }

        let current_stage = task
            .current_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
            .to_string();

        let output_type = match &output {
            StageOutput::Artifact { .. } => "artifact",
            StageOutput::Questions { .. } => "questions",
            StageOutput::Subtasks { .. } => "subtasks",
            StageOutput::Restage { .. } => "restage",
            StageOutput::Failed { .. } => "failed",
            StageOutput::Blocked { .. } => "blocked",
        };

        orkestra_debug!(
            "action",
            "process_agent_output {}: type={}, stage={}",
            task_id,
            output_type,
            current_stage
        );

        let now = chrono::Utc::now().to_rfc3339();

        match output {
            StageOutput::Questions { questions } => {
                // Agent asked questions - end iteration with questions in outcome
                self.end_current_iteration(
                    &task,
                    Outcome::awaiting_answers(&current_stage, questions),
                )?;

                task.phase = Phase::AwaitingReview; // UI needs to show questions
                task.updated_at = now;
            }

            StageOutput::Artifact { content } => {
                // Get artifact name from stage config
                let artifact_name = self
                    .workflow
                    .stage(&current_stage).map_or_else(|| "artifact".to_string(), |s| s.artifact.clone());

                // Agent produced artifact
                task.artifacts.set(Artifact::new(
                    &artifact_name,
                    &content,
                    &current_stage,
                    &now,
                ));

                // Check if this is an automated stage
                let is_automated = self.is_stage_automated(&current_stage);

                if is_automated {
                    // Automated stages auto-approve and move to next stage
                    self.end_current_iteration(&task, Outcome::Approved)?;

                    let next_status = self.compute_next_status_on_approve(&current_stage);
                    task.status = next_status.clone();
                    task.phase = Phase::Idle;

                    // Create new iteration if moving to new stage via IterationService
                    if let Some(new_stage) = next_status.stage() {
                        self.iteration_service
                            .create_iteration(&task.id, new_stage, None)?;
                    }

                    if task.is_done() {
                        task.completed_at = Some(now.clone());
                    }
                } else {
                    task.phase = Phase::AwaitingReview;
                }
                task.updated_at = now;
            }

            StageOutput::Restage { target, feedback } => {
                // Validate restage capability
                let stage_config = self.workflow.stage(&current_stage).ok_or_else(|| {
                    WorkflowError::InvalidTransition(format!("Unknown stage: {current_stage}"))
                })?;

                if !stage_config.capabilities.can_restage_to(&target) {
                    return Err(WorkflowError::InvalidTransition(format!(
                        "Stage {current_stage} cannot restage to {target}"
                    )));
                }

                // End current iteration with restage
                self.end_current_iteration(
                    &task,
                    Outcome::restage(&current_stage, &target, &feedback),
                )?;

                // Move to target stage
                task.status = Status::active(&target);
                task.phase = Phase::Idle;
                task.updated_at = now.clone();

                // Create new iteration in target stage with restage context via IterationService
                self.iteration_service.create_iteration(
                    &task.id,
                    &target,
                    Some(IterationTrigger::Restage {
                        from_stage: current_stage.clone(),
                        feedback: feedback.clone(),
                    }),
                )?;
            }

            StageOutput::Subtasks {
                subtasks,
                skip_reason,
            } => {
                use crate::workflow::execution::subtasks_to_markdown;

                // Convert subtasks to markdown artifact
                let content = subtasks_to_markdown(&subtasks, skip_reason.as_deref());

                // Get artifact name from stage config (should be "breakdown")
                let artifact_name = self
                    .workflow
                    .stage(&current_stage).map_or_else(|| "breakdown".to_string(), |s| s.artifact.clone());

                // Store the artifact
                task.artifacts.set(Artifact::new(
                    &artifact_name,
                    &content,
                    &current_stage,
                    &now,
                ));

                if subtasks.is_empty() {
                    if let Some(reason) = &skip_reason {
                        orkestra_debug!("agent_actions", "Skipping subtask breakdown: {}", reason);
                    }
                }

                task.phase = Phase::AwaitingReview;
                task.updated_at = now;
            }

            StageOutput::Failed { error } => {
                // End iteration before changing status (task must still be in active stage)
                self.end_current_iteration(
                    &task,
                    Outcome::AgentError {
                        error: error.clone(),
                    },
                )?;
                task.status = Status::failed(&error);
                task.phase = Phase::Idle;
                task.updated_at = now;
            }

            StageOutput::Blocked { reason } => {
                // End iteration before changing status (task must still be in active stage)
                self.end_current_iteration(
                    &task,
                    Outcome::Blocked {
                        reason: reason.clone(),
                    },
                )?;
                task.status = Status::blocked(&reason);
                task.phase = Phase::Idle;
                task.updated_at = now;
            }
        }

        orkestra_debug!(
            "action",
            "process_agent_output {} complete: phase={:?}, status={:?}",
            task_id,
            task.phase,
            task.status
        );

        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Get tasks that need agents spawned (in Idle phase with Active status).
    pub fn get_tasks_needing_agents(&self) -> WorkflowResult<Vec<Task>> {
        let all_tasks = self.store.list_tasks()?;
        Ok(all_tasks
            .into_iter()
            .filter(|t| t.phase == Phase::Idle && t.status.is_active())
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::domain::Question;
    use crate::workflow::InMemoryWorkflowStore;

    use super::*;

    /// Create a task and wait for async setup to complete (transition to Idle).
    /// In tests without git configured, this is nearly instant but we need a small delay.
    fn create_task_ready(api: &WorkflowApi, title: &str, desc: &str) -> Task {
        let task = api.create_task(title, desc, None).unwrap();
        // Wait for async setup to complete (no-op without git, but still async)
        std::thread::sleep(Duration::from_millis(10));
        // Re-fetch to get updated phase
        api.get_task(&task.id).unwrap()
    }

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan")
                .with_capabilities(StageCapabilities::with_questions()),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["summary".into()])
                .with_capabilities(StageCapabilities::with_restage(vec!["work".into()]))
                .automated(),
        ])
    }

    #[test]
    fn test_agent_started() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        let task = api.agent_started(&task.id).unwrap();

        assert_eq!(task.phase, Phase::AgentWorking);
    }

    #[test]
    fn test_agent_started_invalid_phase() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();

        let result = api.agent_started(&task.id);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_process_artifact_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        let task = api.agent_started(&task.id).unwrap();

        let output = StageOutput::Artifact {
            content: "The plan content".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        assert_eq!(task.phase, Phase::AwaitingReview);
        assert!(task.artifacts.get("plan").is_some());
    }

    #[test]
    fn test_process_questions_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        let task = api.agent_started(&task.id).unwrap();

        let output = StageOutput::Questions {
            questions: vec![Question::new("q1", "What framework?")],
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        assert_eq!(task.phase, Phase::AwaitingReview);

        // Questions are now stored in iteration outcome, not on task
        let questions = api.get_pending_questions(&task.id).unwrap();
        assert_eq!(questions.len(), 1);
    }

    #[test]
    fn test_process_restage_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Move to review stage
        task.status = Status::active("review");
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();

        let output = StageOutput::Restage {
            target: "work".to_string(),
            feedback: "Tests failing".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        assert_eq!(task.current_stage(), Some("work"));
        assert_eq!(task.phase, Phase::Idle);
    }

    #[test]
    fn test_process_restage_invalid_target() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        let task = api.agent_started(&task.id).unwrap();

        // Planning stage can't restage
        let output = StageOutput::Restage {
            target: "work".to_string(),
            feedback: "Should fail".to_string(),
        };
        let result = api.process_agent_output(&task.id, output);

        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_process_failed_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        let task = api.agent_started(&task.id).unwrap();

        let output = StageOutput::Failed {
            error: "Build failed".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        assert!(task.is_failed());
        assert_eq!(task.phase, Phase::Idle);
    }

    #[test]
    fn test_process_blocked_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        let task = api.agent_started(&task.id).unwrap();

        let output = StageOutput::Blocked {
            reason: "Waiting for API access".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        assert!(task.is_blocked());
        assert_eq!(task.phase, Phase::Idle);
    }

    #[test]
    fn test_automated_stage_auto_approves() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Move to review stage (automated)
        task.status = Status::active("review");
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();

        let output = StageOutput::Artifact {
            content: "Approved".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        // Should auto-approve and be done
        assert!(task.is_done());
        assert_eq!(task.phase, Phase::Idle);
    }

    #[test]
    fn test_get_tasks_needing_agents() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        // Create some tasks in different states
        let task1 = create_task_ready(&api, "Task 1", "Ready for agent");
        let task2 = create_task_ready(&api, "Task 2", "Also ready");
        let _ = api.agent_started(&task2.id).unwrap(); // Now working

        let mut task3 = create_task_ready(&api, "Task 3", "Done");
        task3.status = Status::Done;
        api.store.save_task(&task3).unwrap();

        let needing_agents = api.get_tasks_needing_agents().unwrap();

        assert_eq!(needing_agents.len(), 1);
        assert_eq!(needing_agents[0].id, task1.id);
    }
}
