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
    /// Auto-advance sets `Phase::Finishing` to trigger the commit pipeline.
    /// Actual stage advancement happens in `finalize_stage_advancement` after
    /// the Finishing → Committing → Finished pipeline completes.
    fn auto_advance_or_review(
        &self,
        task: &mut Task,
        stage: &str,
        now: &str,
    ) -> WorkflowResult<()> {
        if self.should_auto_advance(task, stage) {
            self.enter_commit_pipeline(task, now)?;
        } else {
            task.phase = Phase::AwaitingReview;
            task.updated_at = now.to_string();
        }
        Ok(())
    }

    /// Complete stage advancement after the commit pipeline finishes.
    ///
    /// Called by `advance_committed_stages` after Finishing → Committing → Finished.
    /// Computes the next status, creates subtasks if needed, and transitions
    /// the task to its next stage (or Done).
    pub fn finalize_stage_advancement(&self, task_id: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if !matches!(task.phase, Phase::Finishing | Phase::Finished) {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot finalize stage advancement in phase {:?} (expected Finishing or Finished)",
                task.phase
            )));
        }

        let stage = task
            .current_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
            .to_string();

        let now = chrono::Utc::now().to_rfc3339();

        if self.stage_has_subtask_data(&stage, &task) {
            use super::SubtaskService;

            let artifact_name = self.artifact_name_for_stage(&stage, "breakdown");
            let created = SubtaskService::create_subtasks_from_breakdown(
                &task,
                &self.workflow,
                &self.store,
                &self.iteration_service,
                &artifact_name,
            )?;

            if created.is_empty() {
                // No subtasks — proceed with normal advancement
                self.advance_task(&mut task, &stage, &now)?;
            } else {
                orkestra_debug!(
                    "action",
                    "finalize_stage_advancement {}: created {} subtasks, WaitingOnChildren",
                    task.id,
                    created.len()
                );
                let next_stage = self
                    .compute_next_status_on_approve(&stage, task.flow.as_deref())
                    .stage()
                    .unwrap_or(&stage)
                    .to_string();
                task.status = Status::waiting_on_children(next_stage);
                task.phase = Phase::Idle;
            }
        } else {
            self.advance_task(&mut task, &stage, &now)?;
        }

        task.updated_at = now;
        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Advance a task to its next stage after approval (shared by auto-advance and human approve).
    fn advance_task(&self, task: &mut Task, stage: &str, now: &str) -> WorkflowResult<()> {
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

    /// Handle questions output: store artifact, end iteration with questions, auto-answer if `auto_mode`.
    fn handle_questions_output(
        &self,
        task: &mut Task,
        questions: &[crate::workflow::domain::Question],
        stage: &str,
        now: &str,
    ) -> WorkflowResult<()> {
        // Store questions as a markdown artifact for reference
        let artifact_name = self.artifact_name_for_stage(stage, "artifact");
        let content = format_questions_as_markdown(questions);
        task.artifacts
            .set(Artifact::new(&artifact_name, &content, stage, now));

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

        // Build artifact content with subtask summary appended if present
        let mut artifact_content = content.to_string();
        if !subtasks.is_empty() {
            artifact_content.push_str("\n\n");
            artifact_content.push_str(&format_subtasks_as_markdown(subtasks));
        }

        // Store the artifact with appended subtask details
        task.artifacts
            .set(Artifact::new(&artifact_name, &artifact_content, stage, now));

        // Store or clear structured subtask data for later Task creation on approval
        if subtasks.is_empty() {
            // Clear any stale structured data from a previous run
            task.artifacts
                .remove(&format!("{artifact_name}_structured"));
        } else {
            let json =
                serde_json::to_string(subtasks).expect("SubtaskOutput is always serializable");
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

                if self.should_auto_advance(task, current_stage) {
                    // Auto-advance: execute rejection immediately (existing behavior)
                    self.end_current_iteration(
                        task,
                        Outcome::rejection(current_stage, &target, content),
                    )?;
                    self.execute_rejection(task, current_stage, &target, content, now)?;
                } else {
                    // Pause for human review before executing rejection
                    self.end_current_iteration(
                        task,
                        Outcome::awaiting_rejection_review(current_stage, &target, content),
                    )?;
                    task.phase = Phase::AwaitingReview;
                    task.updated_at = now.to_string();
                }
                Ok(())
            }
            _ => Err(WorkflowError::InvalidTransition(format!(
                "Invalid approval decision: {decision}"
            ))),
        }
    }

    /// Execute a rejection: transition task to the target stage with rejection context.
    ///
    /// Called from both `agent_actions` (auto-advance) and `human_actions` (confirm rejection).
    pub(crate) fn execute_rejection(
        &self,
        task: &mut Task,
        from_stage: &str,
        target: &str,
        feedback: &str,
        now: &str,
    ) -> WorkflowResult<()> {
        let effective_caps = self
            .workflow
            .effective_capabilities(from_stage, task.flow.as_deref())
            .unwrap_or_default();

        // Supersede target stage session if configured (forces fresh spawn)
        if effective_caps.rejection_resets_session() {
            if let Ok(Some(mut session)) = self.store.get_stage_session(&task.id, target) {
                session.supersede(now);
                if let Err(e) = self.store.save_stage_session(&session) {
                    orkestra_debug!(
                        "action",
                        "Failed to supersede session for {}/{}: {}",
                        task.id,
                        target,
                        e
                    );
                }
            }
        }

        task.status = Status::active(target);
        task.phase = Phase::Idle;
        task.updated_at = now.to_string();

        self.iteration_service.create_iteration(
            &task.id,
            target,
            Some(IterationTrigger::Rejection {
                from_stage: from_stage.to_string(),
                feedback: feedback.to_string(),
            }),
        )?;
        Ok(())
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
    /// Called directly when an agent completes. For outputs that advance the stage
    /// (artifacts, subtasks, approvals), the task enters the Finishing → Committing → Finished
    /// commit pipeline before advancing. For non-advancing outputs (questions, failures,
    /// blocked), the task transitions directly without committing.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not in `AgentWorking` phase.
    pub fn process_agent_output(&self, task_id: &str, output: StageOutput) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if task.phase != Phase::AgentWorking {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot process agent output in phase {:?} (expected AgentWorking)",
                task.phase
            )));
        }

        let current_stage = task
            .current_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
            .to_string();

        let output_type = output.type_label();

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

    /// Handle agent execution failure (crash, poll error, spawn failure).
    ///
    /// Separate from `process_agent_output` because failures bypass the
    /// Finishing → Committing → Finished pipeline (no commit needed).
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not in `AgentWorking` phase.
    pub fn fail_agent_execution(&self, task_id: &str, error: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if task.phase != Phase::AgentWorking {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot fail agent execution in phase {:?} (expected AgentWorking)",
                task.phase
            )));
        }

        let current_stage = task
            .current_stage()
            .ok_or_else(|| WorkflowError::InvalidTransition("Task not in active stage".into()))?
            .to_string();

        orkestra_debug!(
            "action",
            "fail_agent_execution {}: stage={}, error={}",
            task_id,
            current_stage,
            error
        );

        self.end_current_iteration(
            &task,
            Outcome::AgentError {
                error: error.to_string(),
            },
        )?;
        task.status = Status::failed(error);
        task.phase = Phase::Idle;
        task.updated_at = chrono::Utc::now().to_rfc3339();

        self.store.save_task(&task)?;
        Ok(task)
    }

    // ========================================================================
    // Commit Pipeline Results
    // ========================================================================

    /// Record a successful commit. Transitions phase from Committing to Finished.
    ///
    /// Called by the background commit thread after worktree changes are committed.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not in `Committing` phase.
    pub(crate) fn commit_succeeded(&self, task_id: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if task.phase != Phase::Committing {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot mark commit succeeded in phase {:?} (expected Committing)",
                task.phase
            )));
        }

        task.phase = Phase::Finished;
        task.updated_at = chrono::Utc::now().to_rfc3339();
        self.store.save_task(&task)?;
        Ok(task)
    }

    /// Record a failed commit. Marks task as failed and records a `CommitFailed` iteration.
    ///
    /// Reads `current_stage()` before changing status (stage is lost after `Status::failed`).
    /// Creates a new iteration with `Outcome::CommitFailed` to preserve the failure in history,
    /// following the same pattern as `integration_failed`.
    ///
    /// # Errors
    ///
    /// Returns `InvalidTransition` if the task is not in `Committing` phase.
    pub(crate) fn commit_failed(&self, task_id: &str, error: &str) -> WorkflowResult<Task> {
        let mut task = self.get_task(task_id)?;

        if task.phase != Phase::Committing {
            return Err(WorkflowError::InvalidTransition(format!(
                "Cannot mark commit failed in phase {:?} (expected Committing)",
                task.phase
            )));
        }

        // Read current stage BEFORE changing status (stage is lost after Status::failed)
        let stage = task.current_stage().map(String::from);

        // Record failure via iteration (create + end, matching integration_failed pattern)
        if let Some(ref stage) = stage {
            self.iteration_service
                .create_iteration(task_id, stage, None)?;
            self.iteration_service.end_iteration(
                task_id,
                stage,
                Outcome::CommitFailed {
                    error: error.to_string(),
                },
            )?;
        }

        task.status = Status::failed(error);
        task.phase = Phase::Idle;
        task.updated_at = chrono::Utc::now().to_rfc3339();
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
            // Failed subtasks can be retried independently, so parent stays in WaitingOnChildren.
            let all_done = subtasks.iter().all(Task::is_archived);

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

        // Script stages always auto-approve — enter commit pipeline before advancing.
        self.enter_commit_pipeline(&mut task, &now)?;

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

        // Store error as artifact (mirrors process_script_success pattern)
        let artifact_name = self.artifact_name_for_stage(&current_stage, "script_output");
        task.artifacts.set(Artifact::new(
            &artifact_name,
            &clean_error,
            &current_stage,
            &now,
        ));

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

/// Format questions as a human-readable markdown artifact.
fn format_questions_as_markdown(questions: &[crate::workflow::domain::Question]) -> String {
    use std::fmt::Write;

    let mut md = String::from("# Questions\n");
    for (i, q) in questions.iter().enumerate() {
        write!(md, "\n## Question {}\n\n{}\n", i + 1, q.question).unwrap();
        if let Some(ctx) = &q.context {
            write!(md, "\n**Context:** {ctx}\n").unwrap();
        }
        if !q.options.is_empty() {
            md.push_str("\n**Options:**\n");
            for opt in &q.options {
                write!(md, "- {}", opt.label).unwrap();
                if let Some(desc) = &opt.description {
                    write!(md, " — {desc}").unwrap();
                }
                md.push('\n');
            }
        }
    }
    md
}

/// Format subtasks as a human-readable markdown artifact.
fn format_subtasks_as_markdown(subtasks: &[crate::workflow::execution::SubtaskOutput]) -> String {
    use std::fmt::Write;

    let mut md = String::from("---\n\n## Proposed Subtasks\n");
    for (i, subtask) in subtasks.iter().enumerate() {
        write!(
            md,
            "\n### {}. {}\n\n{}\n",
            i + 1,
            subtask.title,
            subtask.description
        )
        .unwrap();

        if subtask.depends_on.is_empty() {
            md.push_str("\n**Depends on:** none\n");
        } else {
            md.push_str("\n**Depends on:** ");
            let deps: Vec<String> = subtask
                .depends_on
                .iter()
                .map(|idx| format!("subtask {}", idx + 1))
                .collect();
            writeln!(md, "{}", deps.join(", ")).unwrap();
        }
    }
    md
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

    use crate::workflow::config::{StageCapabilities, StageConfig, WorkflowConfig};
    use crate::workflow::domain::Question;
    use crate::workflow::InMemoryWorkflowStore;

    use super::*;

    /// Create a task ready for agent work (in Idle phase).
    ///
    /// Unit tests don't have an orchestrator to run setup, so we manually
    /// transition the task to Idle. This is fine because these tests are
    /// testing agent actions, not setup behavior.
    fn create_task_ready(api: &WorkflowApi, title: &str, desc: &str) -> Task {
        let mut task = api.create_task(title, desc, None).unwrap();
        // Manually complete "setup" for unit tests (no orchestrator)
        task.phase = Phase::Idle;
        api.store.save_task(&task).unwrap();
        task
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
        api.agent_started(&task.id).unwrap();

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
        api.agent_started(&task.id).unwrap();

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
    fn test_format_subtasks_as_markdown() {
        use crate::workflow::execution::SubtaskOutput;

        let subtasks = vec![
            SubtaskOutput {
                title: "First subtask".to_string(),
                description: "Do the first thing".to_string(),
                detailed_instructions: "Detailed instructions here".to_string(),
                depends_on: vec![],
            },
            SubtaskOutput {
                title: "Second subtask".to_string(),
                description: "Do the second thing".to_string(),
                detailed_instructions: "More details".to_string(),
                depends_on: vec![0],
            },
            SubtaskOutput {
                title: "Third subtask".to_string(),
                description: "Do the third thing".to_string(),
                detailed_instructions: "Even more details".to_string(),
                depends_on: vec![0, 1],
            },
        ];

        let result = super::format_subtasks_as_markdown(&subtasks);

        // Check structure
        assert!(result.contains("## Proposed Subtasks"));
        assert!(result.contains("### 1. First subtask"));
        assert!(result.contains("### 2. Second subtask"));
        assert!(result.contains("### 3. Third subtask"));

        // Check descriptions
        assert!(result.contains("Do the first thing"));
        assert!(result.contains("Do the second thing"));
        assert!(result.contains("Do the third thing"));

        // Check dependencies (1-indexed, human-readable)
        assert!(result.contains("**Depends on:** none"));
        assert!(result.contains("**Depends on:** subtask 1"));
        assert!(result.contains("**Depends on:** subtask 1, subtask 2"));

        // Detailed instructions should NOT be in the summary
        assert!(!result.contains("Detailed instructions here"));
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
    fn test_rejection_pauses_for_review_on_non_automated_stage() {
        // Non-automated review stage: rejection should pause for human review
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["summary".into()])
                .with_capabilities(StageCapabilities::with_approval(Some("work".into()))),
        ]);
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.status = Status::active("review");
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();
        api.iteration_service
            .create_iteration(&task.id, "review", None)
            .unwrap();

        let output = StageOutput::Approval {
            decision: "reject".to_string(),
            content: "Tests failing, please fix".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        // Should pause at AwaitingReview, NOT move to work stage
        assert_eq!(task.current_stage(), Some("review"));
        assert_eq!(task.phase, Phase::AwaitingReview);

        // Rejection content stored as artifact
        assert_eq!(
            task.artifacts.get("verdict").unwrap().content,
            "Tests failing, please fix"
        );

        // Iteration should have AwaitingRejectionReview outcome
        let iterations = api.store.get_iterations(&task.id).unwrap();
        let review_iter = iterations.iter().find(|i| i.stage == "review").unwrap();
        match &review_iter.outcome {
            Some(Outcome::AwaitingRejectionReview {
                from_stage,
                target,
                feedback,
            }) => {
                assert_eq!(from_stage, "review");
                assert_eq!(target, "work");
                assert_eq!(feedback, "Tests failing, please fix");
            }
            other => panic!("Expected AwaitingRejectionReview outcome, got {other:?}"),
        }
    }

    #[test]
    fn test_rejection_auto_executes_for_auto_mode_task() {
        // Non-automated review stage but task has auto_mode — should auto-execute
        let workflow = WorkflowConfig::new(vec![
            StageConfig::new("planning", "plan"),
            StageConfig::new("work", "summary").with_inputs(vec!["plan".into()]),
            StageConfig::new("review", "verdict")
                .with_inputs(vec!["summary".into()])
                .with_capabilities(StageCapabilities::with_approval(Some("work".into()))),
        ]);
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = api.create_task("Test", "Description", None).unwrap();
        task.auto_mode = true;
        task.status = Status::active("review");
        task.phase = Phase::AgentWorking;
        api.store.save_task(&task).unwrap();
        api.iteration_service
            .create_iteration(&task.id, "review", None)
            .unwrap();

        let output = StageOutput::Approval {
            decision: "reject".to_string(),
            content: "Tests failing".to_string(),
        };
        let task = api.process_agent_output(&task.id, output).unwrap();

        // Should auto-execute rejection — move to work stage
        assert_eq!(task.current_stage(), Some("work"));
        assert_eq!(task.phase, Phase::Idle);
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

        // Should enter commit pipeline (automated stage auto-advances via Finishing)
        assert_eq!(task.phase, Phase::Finishing);
        assert_eq!(task.current_stage(), Some("review"));
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
        api.agent_started(&task.id).unwrap();

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
        api.agent_started(&task.id).unwrap();

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
        api.agent_started(&task.id).unwrap();

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

        // Should enter commit pipeline (automated stage auto-advances via Finishing)
        assert_eq!(task.phase, Phase::Finishing);
        assert_eq!(task.current_stage(), Some("review"));
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

        // Should enter commit pipeline (script stages always auto-advance via Finishing)
        assert_eq!(task.current_stage(), Some("checks"));
        assert_eq!(task.phase, Phase::Finishing);
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

    // ========================================================================
    // Commit pipeline result tests
    // ========================================================================

    #[test]
    fn test_commit_succeeded() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = create_task_ready(&api, "Test", "Description");
        task.phase = Phase::Committing;
        api.store.save_task(&task).unwrap();

        let task = api.commit_succeeded(&task.id).unwrap();
        assert_eq!(task.phase, Phase::Finished);
    }

    #[test]
    fn test_commit_succeeded_wrong_phase() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        // task is in Idle, not Committing

        let result = api.commit_succeeded(&task.id);
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }

    #[test]
    fn test_commit_failed_records_iteration() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let mut task = create_task_ready(&api, "Test", "Description");
        task.phase = Phase::Committing;
        api.store.save_task(&task).unwrap();

        let task = api.commit_failed(&task.id, "git commit error").unwrap();
        assert!(task.is_failed());
        assert_eq!(task.phase, Phase::Idle);

        // Should have a CommitFailed iteration
        let iterations = api.store.get_iterations(&task.id).unwrap();
        let commit_iter = iterations
            .iter()
            .find(|i| matches!(&i.outcome, Some(Outcome::CommitFailed { .. })));
        assert!(commit_iter.is_some(), "Should have CommitFailed iteration");

        if let Some(Outcome::CommitFailed { error }) = &commit_iter.unwrap().outcome {
            assert_eq!(error, "git commit error");
        }
    }

    #[test]
    fn test_commit_failed_wrong_phase() {
        let workflow = test_workflow();
        let store = Arc::new(InMemoryWorkflowStore::new());
        let api = WorkflowApi::new(workflow, store);

        let task = create_task_ready(&api, "Test", "Description");
        // task is in Idle, not Committing

        let result = api.commit_failed(&task.id, "error");
        assert!(matches!(result, Err(WorkflowError::InvalidTransition(_))));
    }
}
