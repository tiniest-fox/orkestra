//! Agent/orchestrator actions: agent started, process output, get pending tasks.

use crate::orkestra_debug;
use crate::workflow::domain::{IterationTrigger, QuestionAnswer, Task};
use crate::workflow::execution::StageOutput;
use crate::workflow::ports::{WorkflowError, WorkflowResult};
use crate::workflow::runtime::{Artifact, Outcome, Phase, Status};

/// Standard auto-answer text used when auto-mode tasks receive questions from agents.
pub(crate) const AUTO_ANSWER_TEXT: &str =
    "Make a decision based on your best understanding and highest recommendation.";

use super::WorkflowApi;

/// Strip ANSI escape codes from a string.
///
/// Used to clean terminal color codes from script output before storing as artifacts.
/// This ensures artifacts contain clean text for LLM consumption without wasted tokens.
fn strip_ansi_codes(input: &str) -> String {
    let bytes = strip_ansi_escapes::strip(input);
    String::from_utf8_lossy(&bytes).into_owned()
}

impl WorkflowApi {
    /// Handle artifact output: store artifact, auto-approve if automated stage or `auto_mode` task.
    fn handle_artifact_output(
        &self,
        task: &mut Task,
        content: &str,
        stage: &str,
        now: &str,
    ) -> WorkflowResult<()> {
        let artifact_name = self.artifact_name_for_stage(stage, "artifact");
        task.artifacts
            .set(Artifact::new(&artifact_name, content, stage, now));
        self.auto_advance_or_review(task, stage, now)
    }

    /// Auto-approve and advance if the stage/task allows it, otherwise pause for review.
    ///
    /// If the stage produced subtasks and is auto-advancing, creates Task records
    /// and sets the parent to `WaitingOnChildren` instead of normal progression.
    fn auto_advance_or_review(
        &self,
        task: &mut Task,
        stage: &str,
        now: &str,
    ) -> WorkflowResult<()> {
        if self.should_auto_advance(task, stage) {
            self.end_current_iteration(task, Outcome::Approved)?;

            // Check if this stage produced subtasks that need to be materialized
            if self.stage_has_subtask_data(stage, task) {
                self.auto_advance_with_subtask_creation(task, stage, now)?;
            } else {
                let next_status = self.compute_next_status_on_approve(stage, task.flow.as_deref());
                task.status = next_status.clone();
                task.phase = Phase::Idle;

                if let Some(new_stage) = next_status.stage() {
                    self.iteration_service
                        .create_iteration(&task.id, new_stage, None)?;
                }
                if task.is_done() {
                    task.completed_at = Some(now.to_string());
                }
            }
        } else {
            task.phase = Phase::AwaitingReview;
        }
        task.updated_at = now.to_string();
        Ok(())
    }

    /// Auto-advance a breakdown stage: create subtask Tasks and set parent to `WaitingOnChildren`.
    fn auto_advance_with_subtask_creation(
        &self,
        task: &mut Task,
        stage: &str,
        now: &str,
    ) -> WorkflowResult<()> {
        use super::SubtaskService;

        let artifact_name = self.artifact_name_for_stage(stage, "breakdown");
        let created = SubtaskService::create_subtasks_from_breakdown(
            task,
            &self.workflow,
            &self.store,
            &self.iteration_service,
            &artifact_name,
        )?;

        if created.is_empty() {
            // No subtasks - proceed with normal advancement
            let next_status = self.compute_next_status_on_approve(stage, task.flow.as_deref());
            task.status = next_status.clone();
            task.phase = Phase::Idle;
            if let Some(new_stage) = next_status.stage() {
                self.iteration_service
                    .create_iteration(&task.id, new_stage, None)?;
            }
            if task.is_done() {
                task.completed_at = Some(now.to_string());
            }
        } else {
            orkestra_debug!(
                "action",
                "auto_advance {}: created {} subtasks, WaitingOnChildren",
                task.id,
                created.len()
            );
            let next_stage = self
                .compute_next_status_on_approve(stage, task.flow.as_deref())
                .stage()
                .unwrap_or(stage)
                .to_string();
            task.status = Status::waiting_on_children(next_stage);
            task.phase = Phase::Idle;
        }
        Ok(())
    }

    /// Check if a stage has structured subtask data stored on the task.
    fn stage_has_subtask_data(&self, stage: &str, task: &Task) -> bool {
        let has_capability = self
            .workflow
            .effective_capabilities(stage, task.flow.as_deref())
            .is_some_and(|caps| caps.produces_subtasks());
        if !has_capability {
            return false;
        }
        let artifact_name = self.artifact_name_for_stage(stage, "breakdown");
        let structured_key = format!("{artifact_name}_structured");
        task.artifacts.content(&structured_key).is_some()
    }

    /// Check if a stage should auto-advance for a given task.
    ///
    /// Returns true if the stage is automated OR if the task has `auto_mode` enabled.
    fn should_auto_advance(&self, task: &Task, stage: &str) -> bool {
        task.auto_mode || self.is_stage_automated(stage)
    }

    /// Handle questions output: end iteration with questions, auto-answer if `auto_mode`.
    fn handle_questions_output(
        &self,
        task: &mut Task,
        questions: &[crate::workflow::domain::Question],
        stage: &str,
        now: &str,
    ) -> WorkflowResult<()> {
        self.end_current_iteration(task, Outcome::awaiting_answers(stage, questions.to_owned()))?;

        if task.auto_mode {
            orkestra_debug!(
                "action",
                "auto-answering {} questions for auto_mode task {}",
                questions.len(),
                task.id
            );
            let answers = auto_answer_questions(questions);
            self.iteration_service.create_iteration(
                &task.id,
                stage,
                Some(IterationTrigger::Answers { answers }),
            )?;
            task.phase = Phase::Idle;
        } else {
            task.phase = Phase::AwaitingReview;
        }
        task.updated_at = now.to_string();
        Ok(())
    }

    /// Handle subtasks output: store artifact content + structured data, auto-approve or await review.
    fn handle_subtasks_output(
        &self,
        task: &mut Task,
        content: &str,
        subtasks: &[crate::workflow::execution::SubtaskOutput],
        skip_reason: Option<&str>,
        stage: &str,
        now: &str,
    ) -> WorkflowResult<()> {
        let artifact_name = self.artifact_name_for_stage(stage, "breakdown");

        // Store the agent-provided content directly as the artifact
        task.artifacts
            .set(Artifact::new(&artifact_name, content, stage, now));

        // Store structured subtask data as JSON for later Task creation on approval
        if !subtasks.is_empty() {
            let json = serde_json::to_string(subtasks).unwrap_or_default();
            task.artifacts.set(Artifact::new(
                format!("{artifact_name}_structured"),
                &json,
                stage,
                now,
            ));
        }

        if subtasks.is_empty() {
            if let Some(reason) = skip_reason {
                orkestra_debug!("agent_actions", "Skipping subtask breakdown: {}", reason);
            }
        }

        self.auto_advance_or_review(task, stage, now)
    }

    /// Handle approval output: approve stores artifact and advances, reject sends to rejection target.
    fn handle_approval_output(
        &self,
        task: &mut Task,
        current_stage: &str,
        decision: &str,
        content: &str,
        now: &str,
    ) -> WorkflowResult<()> {
        // Verify stage has approval capability
        let effective_caps = self
            .workflow
            .effective_capabilities(current_stage, task.flow.as_deref())
            .ok_or_else(|| {
                WorkflowError::InvalidTransition(format!("Unknown stage: {current_stage}"))
            })?;

        if !effective_caps.has_approval() {
            return Err(WorkflowError::InvalidTransition(format!(
                "Stage {current_stage} does not have approval capability"
            )));
        }

        match decision {
            "approve" => {
                // Store content as artifact, then auto-advance or review (same as artifact flow)
                self.handle_artifact_output(task, content, current_stage, now)
            }
            "reject" => {
                // Store rejection content as artifact (same name as approvals, overwrite semantics)
                let artifact_name = self.artifact_name_for_stage(current_stage, "artifact");
                task.artifacts
                    .set(Artifact::new(&artifact_name, content, current_stage, now));

                // Resolve rejection target: explicit config → previous stage in flow
                let target = self.resolve_rejection_target(current_stage, task.flow.as_deref())?;

                self.end_current_iteration(
                    task,
                    Outcome::rejection(current_stage, &target, content),
                )?;

                task.status = Status::active(&target);
                task.phase = Phase::Idle;
                task.updated_at = now.to_string();

                self.iteration_service.create_iteration(
                    &task.id,
                    &target,
                    Some(IterationTrigger::Rejection {
                        from_stage: current_stage.to_string(),
                        feedback: content.to_string(),
                    }),
                )?;
                Ok(())
            }
            _ => Err(WorkflowError::InvalidTransition(format!(
                "Invalid approval decision: {decision}"
            ))),
        }
    }

    /// Resolve the rejection target for a stage with approval capability.
    ///
    /// Priority: explicit `rejection_stage` in config → previous stage in flow.
    fn resolve_rejection_target(
        &self,
        current_stage: &str,
        flow: Option<&str>,
    ) -> WorkflowResult<String> {
        // Check explicit rejection_stage from config
        let effective_caps = self
            .workflow
            .effective_capabilities(current_stage, flow)
            .ok_or_else(|| {
                WorkflowError::InvalidTransition(format!("Unknown stage: {current_stage}"))
            })?;

        if let Some(target) = effective_caps.rejection_stage() {
            return Ok(target.to_string());
        }

        // Fall back to previous stage in flow
        self.workflow
            .previous_stage_in_flow(current_stage, flow)
            .map(|s| s.name.clone())
            .ok_or_else(|| {
                WorkflowError::InvalidTransition(format!(
                    "Stage {current_stage} has no rejection_stage configured and no previous stage in flow"
                ))
            })
    }

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

    /// Process completed agent output. Handles artifacts, questions, approvals, failures.
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
            StageOutput::Approval { .. } => "approval",
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
                self.handle_questions_output(&mut task, &questions, &current_stage, &now)?;
            }
            StageOutput::Artifact { content } => {
                self.handle_artifact_output(&mut task, &content, &current_stage, &now)?;
            }
            StageOutput::Approval { decision, content } => {
                self.handle_approval_output(&mut task, &current_stage, &decision, &content, &now)?;
            }
            StageOutput::Subtasks {
                content,
                subtasks,
                skip_reason,
            } => {
                self.handle_subtasks_output(
                    &mut task,
                    &content,
                    &subtasks,
                    skip_reason.as_deref(),
                    &current_stage,
                    &now,
                )?;
            }
            StageOutput::Failed { error } => {
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
    ///
    /// Filters out subtasks whose dependencies haven't completed yet.
    pub fn get_tasks_needing_agents(&self) -> WorkflowResult<Vec<Task>> {
        let all_tasks = self.store.list_tasks()?;

        // Build a set of completed task IDs for dependency checking
        let done_ids: std::collections::HashSet<String> = all_tasks
            .iter()
            .filter(|t| t.is_done() || t.is_archived())
            .map(|t| t.id.clone())
            .collect();

        Ok(all_tasks
            .into_iter()
            .filter(|t| {
                t.phase == Phase::Idle
                    && t.status.is_active()
                    && t.depends_on.iter().all(|dep| done_ids.contains(dep))
            })
            .collect())
    }

    // ========================================================================
    // Parent Completion Detection
    // ========================================================================

    /// Advance parents whose subtasks have all completed.
    ///
    /// Finds tasks in `WaitingOnChildren` status, checks if all their subtasks
    /// are `Done`, and if so, advances the parent to the next stage after the
    /// breakdown stage. Returns the list of (`task_id`, `subtask_count`) that were advanced.
    pub fn advance_completed_parents(&self) -> WorkflowResult<Vec<(String, usize)>> {
        let all_tasks = self.store.list_tasks()?;
        let waiting_parents: Vec<&Task> = all_tasks
            .iter()
            .filter(|t| t.status.is_waiting_on_children() && t.phase == Phase::Idle)
            .collect();

        let mut advanced = Vec::new();

        for parent in waiting_parents {
            let subtasks = self.store.list_subtasks(&parent.id)?;
            if subtasks.is_empty() {
                continue;
            }

            // Subtasks must be Archived (merged back to parent branch), not just Done.
            // Done means stages complete but branch not yet merged.
            let all_done = subtasks.iter().all(Task::is_archived);
            let any_failed = subtasks.iter().any(Task::is_failed);

            if any_failed {
                // If any subtask failed, fail the parent
                let mut parent = parent.clone();
                parent.status = Status::failed("One or more subtasks failed");
                parent.phase = Phase::Idle;
                parent.updated_at = chrono::Utc::now().to_rfc3339();
                self.store.save_task(&parent)?;
                continue;
            }

            if all_done {
                let subtask_count = subtasks.len();
                let mut parent = parent.clone();

                // Find the breakdown stage (the one with subtask capabilities)
                let breakdown_stage = self.find_breakdown_stage(&parent);

                if let Some(stage) = breakdown_stage {
                    let effective_caps = self
                        .workflow
                        .effective_capabilities(&stage, parent.flow.as_deref())
                        .unwrap_or_default();

                    let next_status = if let Some(target) = effective_caps.completion_stage() {
                        Status::active(target)
                    } else {
                        self.compute_next_status_on_approve(&stage, parent.flow.as_deref())
                    };
                    let now = chrono::Utc::now().to_rfc3339();

                    parent.status = next_status.clone();
                    parent.phase = Phase::Idle;
                    parent.updated_at.clone_from(&now);

                    if let Some(new_stage) = next_status.stage() {
                        self.iteration_service
                            .create_iteration(&parent.id, new_stage, None)?;
                    }
                    if parent.is_done() {
                        parent.completed_at = Some(now);
                    }
                } else {
                    // Fallback: mark as Done
                    parent.status = Status::Done;
                    parent.phase = Phase::Idle;
                    let now = chrono::Utc::now().to_rfc3339();
                    parent.updated_at.clone_from(&now);
                    parent.completed_at = Some(now);
                }

                self.store.save_task(&parent)?;
                advanced.push((parent.id.clone(), subtask_count));
            }
        }

        Ok(advanced)
    }

    /// Find the name of the breakdown stage (the stage with subtask capabilities).
    fn find_breakdown_stage(&self, task: &Task) -> Option<String> {
        for stage in &self.workflow.stages {
            let effective_caps = self
                .workflow
                .effective_capabilities(&stage.name, task.flow.as_deref())
                .unwrap_or_default();
            if effective_caps.produces_subtasks() {
                return Some(stage.name.clone());
            }
        }
        None
    }

    // ========================================================================
    // Script Stage Methods
    // ========================================================================

    /// Handle successful script completion. Creates artifact and auto-advances.
    ///
    /// Script stages always auto-advance on success (no human approval needed).
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not in `AgentWorking` phase.
    pub fn process_script_success(&self, task_id: &str, output: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if task.phase != Phase::AgentWorking {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot process script output in phase {:?}",
                task.phase
            )));
        }

        let current_stage = task
            .current_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
            .to_string();

        orkestra_debug!(
            "action",
            "process_script_success {}: stage={}",
            task_id,
            current_stage
        );

        let now = chrono::Utc::now().to_rfc3339();

        // Create artifact from script output, stripping ANSI codes for clean LLM consumption
        let clean_output = strip_ansi_codes(output);
        let artifact_name = self.artifact_name_for_stage(&current_stage, "script_output");
        task.artifacts.set(Artifact::new(
            &artifact_name,
            &clean_output,
            &current_stage,
            &now,
        ));

        // Script stages always auto-approve
        self.end_current_iteration(&task, Outcome::Approved)?;
        let next_status = self.compute_next_status_on_approve(&current_stage, task.flow.as_deref());
        task.status = next_status.clone();
        task.phase = Phase::Idle;

        if let Some(new_stage) = next_status.stage() {
            self.iteration_service
                .create_iteration(&task.id, new_stage, None)?;
        }
        if task.is_done() {
            task.completed_at = Some(now.clone());
        }

        task.updated_at = now;

        orkestra_debug!(
            "action",
            "process_script_success {} complete: phase={:?}, status={:?}",
            task_id,
            task.phase,
            task.status
        );

        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Handle script failure. Transitions to recovery stage if configured.
    ///
    /// If `recovery_stage` is None, the task is marked as failed.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not in `AgentWorking` phase.
    pub fn process_script_failure(
        &self,
        task_id: &str,
        error: &str,
        recovery_stage: Option<&str>,
    ) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if task.phase != Phase::AgentWorking {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot process script failure in phase {:?}",
                task.phase
            )));
        }

        let current_stage = task
            .current_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
            .to_string();

        orkestra_debug!(
            "action",
            "process_script_failure {}: stage={}, recovery={:?}",
            task_id,
            current_stage,
            recovery_stage
        );

        let now = chrono::Utc::now().to_rfc3339();

        // Strip ANSI codes from error message for clean LLM consumption
        let clean_error = strip_ansi_codes(error);

        // End current iteration with script failure outcome
        self.end_current_iteration(
            &task,
            Outcome::script_failed(
                &current_stage,
                &clean_error,
                recovery_stage.map(String::from),
            ),
        )?;

        if let Some(target) = recovery_stage {
            // Transition to recovery stage
            task.status = Status::active(target);
            task.phase = Phase::Idle;

            // Create new iteration in recovery stage with script failure trigger
            self.iteration_service.create_iteration(
                &task.id,
                target,
                Some(IterationTrigger::ScriptFailure {
                    from_stage: current_stage,
                    error: clean_error,
                }),
            )?;
        } else {
            // No recovery stage - mark task as failed
            task.status = Status::failed(&clean_error);
            task.phase = Phase::Idle;
        }

        task.updated_at = now;

        orkestra_debug!(
            "action",
            "process_script_failure {} complete: phase={:?}, status={:?}",
            task_id,
            task.phase,
            task.status
        );

        self.store.save_task(&task)?;
        Ok(task)
    }
}

/// Generate auto-answers for all questions using a standard response.
fn auto_answer_questions(questions: &[crate::workflow::domain::Question]) -> Vec<QuestionAnswer> {
    let now = chrono::Utc::now().to_rfc3339();
    questions
        .iter()
        .map(|q| QuestionAnswer::new(&q.question, AUTO_ANSWER_TEXT, &now))
        .collect()
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
                .with_capabilities(StageCapabilities::with_approval(Some("work".into())))
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

        let mut task = create_task_ready(&api, "Test", "Description");
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
            questions: vec![Question::new("What framework?")],
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        assert_eq!(task.phase, Phase::AwaitingReview);

        // Questions are now stored in iteration outcome, not on task
        let questions = api.get_pending_questions(&task.id).unwrap();
        assert_eq!(questions.len(), 1);
    }

    #[test]
    fn test_process_approval_reject_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Move to review stage
        task.status = Status::active("review");
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();

        let output = StageOutput::Approval {
            decision: "reject".to_string(),
            content: "Tests failing".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        assert_eq!(task.current_stage(), Some("work"));
        assert_eq!(task.phase, Phase::Idle);

        // Rejection should create an artifact with the rejection content
        assert!(task.artifacts.get("verdict").is_some());
        assert_eq!(
            task.artifacts.get("verdict").unwrap().content,
            "Tests failing"
        );
    }

    #[test]
    fn test_process_approval_approve_output() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();

        // Move to review stage (automated)
        task.status = Status::active("review");
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();

        let output = StageOutput::Approval {
            decision: "approve".to_string(),
            content: "Looks good, well implemented".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        // Should auto-approve (automated stage) and be done
        assert!(task.is_done());
        assert_eq!(task.phase, Phase::Idle);
        // Content should be stored as artifact
        assert!(task.artifacts.get("verdict").is_some());
        assert!(task
            .artifacts
            .get("verdict")
            .unwrap()
            .content
            .contains("well implemented"));
    }

    #[test]
    fn test_process_approval_no_capability() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        let task = api.agent_started(&task.id).unwrap();

        // Planning stage doesn't have approval capability
        let output = StageOutput::Approval {
            decision: "approve".to_string(),
            content: "Should fail".to_string(),
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

    // ========================================================================
    // Script stage tests
    // ========================================================================

    fn test_workflow_with_script() -> WorkflowConfig {
        use crate::workflow::config::ScriptStageConfig;

        let mut checks_stage = StageConfig::new_script("checks", "check_results", "./run.sh");
        checks_stage.script = Some(ScriptStageConfig::new("./run.sh").with_on_failure("work"));

        WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            checks_stage.with_inputs(vec!["summary".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["check_results".into()])
                .automated(),
        ])
    }

    #[test]
    fn test_process_script_success() {
        let workflow = test_workflow_with_script();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        // Move to checks stage
        task.status = Status::active("checks");
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();

        let task = api
            .process_script_success(&task.id, "All tests passed!\nOK")
            .unwrap();

        // Should auto-advance to next stage
        assert_eq!(task.current_stage(), Some("review"));
        assert_eq!(task.phase, Phase::Idle);
        // Artifact should be created
        assert!(task.artifacts.get("check_results").is_some());
        assert!(task
            .artifacts
            .get("check_results")
            .unwrap()
            .content
            .contains("All tests passed"));
    }

    #[test]
    fn test_process_script_failure_with_recovery() {
        let workflow = test_workflow_with_script();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        // Move to checks stage
        task.status = Status::active("checks");
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();

        let task = api
            .process_script_failure(
                &task.id,
                "npm test failed\nError: test failed",
                Some("work"),
            )
            .unwrap();

        // Should transition to recovery stage
        assert_eq!(task.current_stage(), Some("work"));
        assert_eq!(task.phase, Phase::Idle);
        assert!(!task.is_failed());
    }

    #[test]
    fn test_process_script_failure_no_recovery() {
        let workflow = test_workflow_with_script();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        // Move to checks stage
        task.status = Status::active("checks");
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();

        let task = api
            .process_script_failure(&task.id, "Critical error", None)
            .unwrap();

        // Should mark task as failed
        assert!(task.is_failed());
        assert_eq!(task.phase, Phase::Idle);
    }

    #[test]
    fn test_process_script_invalid_phase() {
        let workflow = test_workflow_with_script();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.status = Status::active("checks");
        task.phase = Phase::Idle; // Not AgentWorking
        api.store.save_task(&task).unwrap();

        let result = api.process_script_success(&task.id, "output");
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    // ========================================================================
    // ANSI stripping tests
    // ========================================================================

    #[test]
    fn test_strip_ansi_codes_removes_colors() {
        use super::strip_ansi_codes;

        let input = "\x1b[31mred text\x1b[0m normal text \x1b[32mgreen\x1b[0m";
        let result = strip_ansi_codes(input);
        assert_eq!(result, "red text normal text green");
        assert!(!result.contains("\x1b["));
    }

    #[test]
    fn test_strip_ansi_codes_preserves_plain_text() {
        use super::strip_ansi_codes;

        let input = "plain text without any escapes\nwith newlines";
        let result = strip_ansi_codes(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_strip_ansi_codes_handles_empty_string() {
        use super::strip_ansi_codes;

        let result = strip_ansi_codes("");
        assert_eq!(result, "");
    }

    #[test]
    fn test_strip_ansi_codes_handles_complex_sequences() {
        use super::strip_ansi_codes;

        // Bold, underline, cursor movement, etc.
        let input =
            "\x1b[1mbold\x1b[0m \x1b[4munderline\x1b[0m \x1b[38;5;196mextended color\x1b[0m";
        let result = strip_ansi_codes(input);
        assert_eq!(result, "bold underline extended color");
    }

    #[test]
    fn test_process_script_success_strips_ansi_codes() {
        let workflow = test_workflow_with_script();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.status = Status::active("checks");
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();

        // Script output with ANSI color codes
        let colored_output =
            "\x1b[32m✓ All tests passed!\x1b[0m\n\x1b[31mWarning: 1 skipped\x1b[0m";
        let task = api
            .process_script_success(&task.id, colored_output)
            .unwrap();

        // Artifact should have ANSI codes stripped
        let artifact = task.artifacts.get("check_results").unwrap();
        assert!(!artifact.content.contains("\x1b["));
        assert!(artifact.content.contains("✓ All tests passed!"));
        assert!(artifact.content.contains("Warning: 1 skipped"));
    }

    #[test]
    fn test_process_script_failure_strips_ansi_codes() {
        let workflow = test_workflow_with_script();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.status = Status::active("checks");
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();

        // Error message with ANSI color codes
        let colored_error =
            "\x1b[31mError: test failed\x1b[0m\n\x1b[33mStack trace:\x1b[0m foo.rs:42";
        let task = api
            .process_script_failure(&task.id, colored_error, Some("work"))
            .unwrap();

        // Verify task transitioned to recovery stage
        assert_eq!(task.current_stage(), Some("work"));

        // Get the iteration to verify the error was stripped
        let iterations = api.store.get_iterations(&task.id).unwrap();
        let recovery_iter = iterations.iter().find(|i| i.stage == "work").unwrap();

        if let Some(IterationTrigger::ScriptFailure { error, .. }) = &recovery_iter.incoming_context
        {
            assert!(!error.contains("\x1b["));
            assert!(error.contains("Error: test failed"));
            assert!(error.contains("Stack trace:"));
        } else {
            panic!("Expected ScriptFailure trigger");
        }
    }
}
