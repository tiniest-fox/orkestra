use crate::domain::{Task, TaskKind, TaskStatus};
use crate::error::{OrkestraError, Result};
use crate::ports::{Clock, TaskStore};

/// Service for task operations.
///
/// This service encapsulates all task-related business logic,
/// using injected traits for storage and time operations.
pub struct TaskService<S: TaskStore, C: Clock> {
    store: S,
    clock: C,
}

impl<S: TaskStore, C: Clock> TaskService<S, C> {
    pub fn new(store: S, clock: C) -> Self {
        Self { store, clock }
    }

    /// List all tasks.
    pub fn list(&self) -> Result<Vec<Task>> {
        self.store.load_all()
    }

    /// Get a task by ID.
    pub fn get(&self, id: &str) -> Result<Task> {
        self.store
            .find_by_id(id)?
            .ok_or_else(|| OrkestraError::TaskNotFound(id.to_string()))
    }

    /// Create a new task.
    pub fn create(&self, title: &str, description: &str, auto_approve: bool) -> Result<Task> {
        let id = self.store.next_id()?;
        let now = self.clock.now_rfc3339();
        let mut task = Task::new(id, title.to_string(), description.to_string(), &now);
        task.auto_approve = auto_approve;
        self.store.save(&task)?;
        Ok(task)
    }

    /// Generic update helper - eliminates repetitive load/find/save pattern.
    pub fn update<F>(&self, id: &str, f: F) -> Result<Task>
    where
        F: FnOnce(&mut Task) -> Result<()>,
    {
        let mut task = self.get(id)?;
        f(&mut task)?;
        task.updated_at = self.clock.now_rfc3339();
        self.store.save(&task)?;
        Ok(task)
    }

    /// Transition a task to a new status.
    pub fn transition(&self, id: &str, new_status: TaskStatus) -> Result<Task> {
        let now = self.clock.now_rfc3339();
        self.update(id, |task| task.transition_to(new_status, &now))
    }

    /// Set the plan for a task. Stays in Planning - plan field indicates ready for review.
    pub fn set_plan(&self, id: &str, plan: &str) -> Result<Task> {
        self.update(id, |task| {
            task.plan = Some(plan.to_string());
            Ok(())
        })
    }

    /// Approve a plan. Transitions to BreakingDown or Working based on skip_breakdown.
    /// Requires: Planning + plan set.
    pub fn approve_plan(&self, id: &str) -> Result<Task> {
        let now = self.clock.now_rfc3339();
        self.update(id, |task| {
            if !task.needs_plan_review() {
                return Err(OrkestraError::InvalidState {
                    expected: "planning with plan set".to_string(),
                    actual: format!("{:?}", task.status),
                });
            }
            task.plan_feedback = None;
            let next_status = if task.skip_breakdown {
                TaskStatus::Working
            } else {
                TaskStatus::BreakingDown
            };
            task.transition_to(next_status, &now)
        })
    }

    /// Request changes to a plan. Requires: Planning + plan set.
    /// Clears the plan and stores feedback.
    pub fn request_plan_changes(&self, id: &str, feedback: &str) -> Result<Task> {
        self.update(id, |task| {
            if !task.needs_plan_review() {
                return Err(OrkestraError::InvalidState {
                    expected: "planning with plan set".to_string(),
                    actual: format!("{:?}", task.status),
                });
            }
            task.plan = None;
            task.plan_feedback = Some(feedback.to_string());
            Ok(())
        })
    }

    /// Complete a task by setting summary. Stays in Working - summary indicates ready for review.
    pub fn complete(&self, id: &str, summary: &str) -> Result<Task> {
        self.update(id, |task| {
            task.summary = Some(summary.to_string());
            Ok(())
        })
    }

    /// Approve work review and transition to Done. Requires: Working + summary set.
    pub fn approve_review(&self, id: &str) -> Result<Task> {
        let now = self.clock.now_rfc3339();
        self.update(id, |task| {
            if !task.needs_work_review() {
                return Err(OrkestraError::InvalidState {
                    expected: "working with summary set".to_string(),
                    actual: format!("{:?}", task.status),
                });
            }
            task.completed_at = Some(now.clone());
            task.review_feedback = None;
            task.transition_to(TaskStatus::Done, &now)
        })
    }

    /// Request changes during work review. Requires: Working + summary set.
    /// Clears the summary and stores feedback.
    pub fn request_review_changes(&self, id: &str, feedback: &str) -> Result<Task> {
        self.update(id, |task| {
            if !task.needs_work_review() {
                return Err(OrkestraError::InvalidState {
                    expected: "working with summary set".to_string(),
                    actual: format!("{:?}", task.status),
                });
            }
            task.summary = None;
            task.review_feedback = Some(feedback.to_string());
            Ok(())
        })
    }

    /// Mark a task as failed.
    pub fn fail(&self, id: &str, reason: &str) -> Result<Task> {
        let now = self.clock.now_rfc3339();
        self.update(id, |task| {
            task.error = Some(reason.to_string());
            task.transition_to(TaskStatus::Failed, &now)
        })
    }

    /// Mark a task as blocked.
    pub fn block(&self, id: &str, reason: &str) -> Result<Task> {
        let now = self.clock.now_rfc3339();
        self.update(id, |task| {
            task.error = Some(reason.to_string());
            task.transition_to(TaskStatus::Blocked, &now)
        })
    }

    /// Add a session to a task with optional agent PID.
    pub fn add_session(&self, id: &str, session_type: &str, session_id: &str, agent_pid: Option<u32>) -> Result<Task> {
        let now = self.clock.now_rfc3339();
        self.update(id, |task| {
            task.add_session(session_type, session_id, &now, agent_pid);
            Ok(())
        })
    }

    // ========== Breakdown methods ==========

    /// Create a child task under a parent task (parallel work, appears in Kanban).
    /// Child tasks have kind=Task and start in Working status.
    pub fn create_child_task(
        &self,
        parent_id: &str,
        title: &str,
        description: &str,
    ) -> Result<Task> {
        // Verify parent exists and is in BreakingDown status
        let parent = self.get(parent_id)?;
        if parent.status != TaskStatus::BreakingDown {
            return Err(OrkestraError::InvalidState {
                expected: "breaking_down".to_string(),
                actual: format!("{:?}", parent.status),
            });
        }

        let id = self.store.next_id()?;
        let now = self.clock.now_rfc3339();
        let mut task = Task::new(id, title.to_string(), description.to_string(), &now);
        task.parent_id = Some(parent_id.to_string());
        task.kind = TaskKind::Task; // appears in Kanban
        task.skip_breakdown = true;
        // Inherit parent's plan as context
        task.plan = parent.plan.clone();
        // Start child tasks directly in Working status
        task.status = TaskStatus::Working;
        self.store.save(&task)?;
        Ok(task)
    }

    /// Create a subtask under a parent task (checklist item, hidden from Kanban).
    /// Subtasks have kind=Subtask and start in Working status.
    /// The parent's worker agent iterates through these; logs stay on parent.
    pub fn create_subtask(
        &self,
        parent_id: &str,
        title: &str,
        description: &str,
    ) -> Result<Task> {
        // Verify parent exists and is in BreakingDown status
        let parent = self.get(parent_id)?;
        if parent.status != TaskStatus::BreakingDown {
            return Err(OrkestraError::InvalidState {
                expected: "breaking_down".to_string(),
                actual: format!("{:?}", parent.status),
            });
        }

        let id = self.store.next_id()?;
        let now = self.clock.now_rfc3339();
        let mut task = Task::new(id, title.to_string(), description.to_string(), &now);
        task.parent_id = Some(parent_id.to_string());
        task.kind = TaskKind::Subtask; // hidden from Kanban, shown as checklist
        task.skip_breakdown = true;
        // Inherit parent's plan as context
        task.plan = parent.plan.clone();
        // Start subtasks directly in Working status
        task.status = TaskStatus::Working;
        self.store.save(&task)?;
        Ok(task)
    }

    /// Complete a subtask (checklist item). Marks it as Done.
    pub fn complete_subtask(&self, id: &str) -> Result<Task> {
        let now = self.clock.now_rfc3339();
        self.update(id, |task| {
            if task.kind != TaskKind::Subtask {
                return Err(OrkestraError::InvalidState {
                    expected: "subtask".to_string(),
                    actual: format!("{:?}", task.kind),
                });
            }
            task.completed_at = Some(now.clone());
            task.transition_to(TaskStatus::Done, &now)
        })
    }

    /// Get subtasks (checklist items) for a task.
    pub fn get_subtasks(&self, parent_id: &str) -> Result<Vec<Task>> {
        let children = self.get_children(parent_id)?;
        Ok(children.into_iter().filter(|t| t.kind == TaskKind::Subtask).collect())
    }

    /// Get child tasks (parallel tasks that appear in Kanban) for a task.
    pub fn get_child_tasks(&self, parent_id: &str) -> Result<Vec<Task>> {
        let children = self.get_children(parent_id)?;
        Ok(children.into_iter().filter(|t| t.kind == TaskKind::Task).collect())
    }

    /// Set the breakdown for a task. Stays in BreakingDown - breakdown field indicates ready for review.
    pub fn set_breakdown(&self, id: &str, breakdown: &str) -> Result<Task> {
        self.update(id, |task| {
            if task.status != TaskStatus::BreakingDown {
                return Err(OrkestraError::InvalidState {
                    expected: "breaking_down".to_string(),
                    actual: format!("{:?}", task.status),
                });
            }
            task.breakdown = Some(breakdown.to_string());
            Ok(())
        })
    }

    /// Approve a breakdown and transition to WaitingOnSubtasks.
    /// Requires: BreakingDown + breakdown set.
    pub fn approve_breakdown(&self, id: &str) -> Result<Task> {
        let now = self.clock.now_rfc3339();
        self.update(id, |task| {
            if !task.needs_breakdown_review() {
                return Err(OrkestraError::InvalidState {
                    expected: "breaking_down with breakdown set".to_string(),
                    actual: format!("{:?}", task.status),
                });
            }
            task.breakdown_feedback = None;
            task.transition_to(TaskStatus::WaitingOnSubtasks, &now)
        })
    }

    /// Request changes to a breakdown. Requires: BreakingDown + breakdown set.
    /// Clears the breakdown and stores feedback.
    pub fn request_breakdown_changes(&self, id: &str, feedback: &str) -> Result<Task> {
        self.update(id, |task| {
            if !task.needs_breakdown_review() {
                return Err(OrkestraError::InvalidState {
                    expected: "breaking_down with breakdown set".to_string(),
                    actual: format!("{:?}", task.status),
                });
            }
            task.breakdown = None;
            task.breakdown_feedback = Some(feedback.to_string());
            Ok(())
        })
    }

    /// Skip breakdown and go directly to Working.
    /// Requires: BreakingDown status. Used when breakdown agent decides no subtasks needed.
    pub fn skip_breakdown(&self, id: &str) -> Result<Task> {
        let now = self.clock.now_rfc3339();
        self.update(id, |task| {
            if task.status != TaskStatus::BreakingDown {
                return Err(OrkestraError::InvalidState {
                    expected: "breaking_down".to_string(),
                    actual: format!("{:?}", task.status),
                });
            }
            task.transition_to(TaskStatus::Working, &now)
        })
    }

    /// Get all children of a task.
    pub fn get_children(&self, parent_id: &str) -> Result<Vec<Task>> {
        let all = self.list()?;
        Ok(all
            .into_iter()
            .filter(|t| t.parent_id.as_deref() == Some(parent_id))
            .collect())
    }

    /// Check if parent should transition based on children states.
    /// Called after any child state change. Returns updated parent if state changed.
    pub fn check_parent_completion(&self, parent_id: &str) -> Result<Option<Task>> {
        let parent = self.get(parent_id)?;
        if parent.status != TaskStatus::WaitingOnSubtasks {
            return Ok(None);
        }

        let children = self.get_children(parent_id)?;
        if children.is_empty() {
            return Ok(None);
        }

        // Check for any failed/blocked children
        let has_failed = children.iter().any(|c| c.status == TaskStatus::Failed);
        let has_blocked = children.iter().any(|c| c.status == TaskStatus::Blocked);

        if has_failed || has_blocked {
            let reason = if has_failed {
                "Child task failed"
            } else {
                "Child task blocked"
            };
            return Ok(Some(self.block(parent_id, reason)?));
        }

        // Check if all children are done
        let all_done = children.iter().all(|c| c.status == TaskStatus::Done);
        if all_done {
            let now = self.clock.now_rfc3339();
            return Ok(Some(self.update(parent_id, |task| {
                task.completed_at = Some(now.clone());
                task.summary = Some(format!(
                    "All {} subtasks completed successfully",
                    children.len()
                ));
                task.transition_to(TaskStatus::Done, &now)
            })?));
        }

        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::FixedClock;
    use std::sync::RwLock;
    use std::collections::HashMap;

    struct MockStore {
        tasks: RwLock<HashMap<String, Task>>,
        next_id: RwLock<u32>,
    }

    impl MockStore {
        fn new() -> Self {
            Self {
                tasks: RwLock::new(HashMap::new()),
                next_id: RwLock::new(1),
            }
        }
    }

    impl TaskStore for MockStore {
        fn load_all(&self) -> Result<Vec<Task>> {
            let mut tasks: Vec<Task> = self.tasks.read().unwrap().values().cloned().collect();
            tasks.sort_by(|a, b| a.created_at.cmp(&b.created_at));
            Ok(tasks)
        }

        fn find_by_id(&self, id: &str) -> Result<Option<Task>> {
            Ok(self.tasks.read().unwrap().get(id).cloned())
        }

        fn save(&self, task: &Task) -> Result<()> {
            self.tasks.write().unwrap().insert(task.id.clone(), task.clone());
            Ok(())
        }

        fn save_all(&self, tasks: &[Task]) -> Result<()> {
            let mut store = self.tasks.write().unwrap();
            store.clear();
            for task in tasks {
                store.insert(task.id.clone(), task.clone());
            }
            Ok(())
        }

        fn next_id(&self) -> Result<String> {
            let mut id = self.next_id.write().unwrap();
            let current = *id;
            *id = current + 1;
            Ok(format!("TASK-{:03}", current))
        }
    }

    #[test]
    fn test_create_task() {
        let store = MockStore::new();
        let clock = FixedClock("2025-01-21T00:00:00Z".to_string());
        let service = TaskService::new(store, clock);

        let task = service.create("Test Task", "Description", false).unwrap();

        assert_eq!(task.id, "TASK-001");
        assert_eq!(task.title, "Test Task");
        assert_eq!(task.status, TaskStatus::Planning);
        assert_eq!(task.created_at, "2025-01-21T00:00:00Z");
    }

    #[test]
    fn test_task_workflow_skip_breakdown() {
        let store = MockStore::new();
        let clock = FixedClock("2025-01-21T00:00:00Z".to_string());
        let service = TaskService::new(store, clock);

        // Create task - starts in Planning
        let task = service.create("Test", "Desc", false).unwrap();
        assert_eq!(task.status, TaskStatus::Planning);

        // Set skip_breakdown to use the simple flow
        let task = service.update(&task.id, |t| {
            t.skip_breakdown = true;
            Ok(())
        }).unwrap();

        // Set plan - stays in Planning (plan indicates ready for review)
        let task = service.set_plan(&task.id, "My Plan").unwrap();
        assert_eq!(task.status, TaskStatus::Planning);
        assert_eq!(task.plan, Some("My Plan".to_string()));

        // Approve plan - transitions to Working (skip_breakdown=true)
        let task = service.approve_plan(&task.id).unwrap();
        assert_eq!(task.status, TaskStatus::Working);

        // Complete work - stays in Working (summary indicates ready for review)
        let task = service.complete(&task.id, "Done").unwrap();
        assert_eq!(task.status, TaskStatus::Working);
        assert_eq!(task.summary, Some("Done".to_string()));

        // Approve review - transitions to Done
        let task = service.approve_review(&task.id).unwrap();
        assert_eq!(task.status, TaskStatus::Done);
    }

    #[test]
    fn test_task_workflow_with_breakdown() {
        let store = MockStore::new();
        let clock = FixedClock("2025-01-21T00:00:00Z".to_string());
        let service = TaskService::new(store, clock);

        // Create parent task - starts in Planning
        let parent = service.create("Parent Task", "Desc", false).unwrap();
        assert_eq!(parent.status, TaskStatus::Planning);
        assert!(!parent.skip_breakdown); // breakdown enabled by default

        // Set plan
        let parent = service.set_plan(&parent.id, "My Plan").unwrap();
        assert_eq!(parent.plan, Some("My Plan".to_string()));

        // Approve plan - transitions to BreakingDown (not Working)
        let parent = service.approve_plan(&parent.id).unwrap();
        assert_eq!(parent.status, TaskStatus::BreakingDown);

        // Create child tasks (parallel, appear in Kanban)
        let subtask1 = service.create_child_task(&parent.id, "Subtask 1", "First part").unwrap();
        assert_eq!(subtask1.parent_id, Some(parent.id.clone()));
        assert_eq!(subtask1.status, TaskStatus::Working); // child tasks start in Working
        assert!(subtask1.skip_breakdown);
        assert_eq!(subtask1.plan, parent.plan); // inherits parent's plan
        assert_eq!(subtask1.kind, TaskKind::Task); // parallel task

        let subtask2 = service.create_child_task(&parent.id, "Subtask 2", "Second part").unwrap();
        assert_eq!(subtask2.parent_id, Some(parent.id.clone()));

        // Set breakdown summary
        let parent = service.set_breakdown(&parent.id, "Split into 2 parts").unwrap();
        assert!(parent.needs_breakdown_review());

        // Approve breakdown - transitions to WaitingOnSubtasks
        let parent = service.approve_breakdown(&parent.id).unwrap();
        assert_eq!(parent.status, TaskStatus::WaitingOnSubtasks);

        // Get children
        let children = service.get_children(&parent.id).unwrap();
        assert_eq!(children.len(), 2);

        // Complete first subtask
        let subtask1 = service.complete(&subtask1.id, "Part 1 done").unwrap();
        let subtask1 = service.approve_review(&subtask1.id).unwrap();
        assert_eq!(subtask1.status, TaskStatus::Done);

        // Parent should not be done yet
        let result = service.check_parent_completion(&parent.id).unwrap();
        assert!(result.is_none());

        // Complete second subtask
        let subtask2 = service.complete(&subtask2.id, "Part 2 done").unwrap();
        let subtask2 = service.approve_review(&subtask2.id).unwrap();
        assert_eq!(subtask2.status, TaskStatus::Done);

        // Parent should now be done
        let result = service.check_parent_completion(&parent.id).unwrap();
        assert!(result.is_some());
        let parent = result.unwrap();
        assert_eq!(parent.status, TaskStatus::Done);
        assert!(parent.summary.unwrap().contains("2 subtasks"));
    }

    #[test]
    fn test_parent_blocked_on_child_failure() {
        let store = MockStore::new();
        let clock = FixedClock("2025-01-21T00:00:00Z".to_string());
        let service = TaskService::new(store, clock);

        // Create parent and child task
        let parent = service.create("Parent", "Desc", false).unwrap();
        let parent = service.set_plan(&parent.id, "Plan").unwrap();
        let parent = service.approve_plan(&parent.id).unwrap();
        let subtask = service.create_child_task(&parent.id, "Child Task", "Desc").unwrap();
        let parent = service.set_breakdown(&parent.id, "One subtask").unwrap();
        let parent = service.approve_breakdown(&parent.id).unwrap();
        assert_eq!(parent.status, TaskStatus::WaitingOnSubtasks);

        // Fail the subtask
        let _subtask = service.fail(&subtask.id, "Something went wrong").unwrap();

        // Parent should be blocked
        let result = service.check_parent_completion(&parent.id).unwrap();
        assert!(result.is_some());
        let parent = result.unwrap();
        assert_eq!(parent.status, TaskStatus::Blocked);
        assert_eq!(parent.error, Some("Child task failed".to_string()));
    }

    #[test]
    fn test_skip_breakdown_from_breaking_down() {
        let store = MockStore::new();
        let clock = FixedClock("2025-01-21T00:00:00Z".to_string());
        let service = TaskService::new(store, clock);

        let task = service.create("Simple Task", "Desc", false).unwrap();
        let task = service.set_plan(&task.id, "Plan").unwrap();
        let task = service.approve_plan(&task.id).unwrap();
        assert_eq!(task.status, TaskStatus::BreakingDown);

        // Breakdown agent decides no subtasks needed
        let task = service.skip_breakdown(&task.id).unwrap();
        assert_eq!(task.status, TaskStatus::Working);
    }

    #[test]
    fn test_request_breakdown_changes() {
        let store = MockStore::new();
        let clock = FixedClock("2025-01-21T00:00:00Z".to_string());
        let service = TaskService::new(store, clock);

        let task = service.create("Task", "Desc", false).unwrap();
        let task = service.set_plan(&task.id, "Plan").unwrap();
        let task = service.approve_plan(&task.id).unwrap();
        let task = service.set_breakdown(&task.id, "Initial breakdown").unwrap();
        assert!(task.needs_breakdown_review());

        // Request changes
        let task = service.request_breakdown_changes(&task.id, "Split into more parts").unwrap();
        assert!(task.breakdown.is_none());
        assert_eq!(task.breakdown_feedback, Some("Split into more parts".to_string()));
        assert_eq!(task.status, TaskStatus::BreakingDown);
    }

    #[test]
    fn test_invalid_approve_plan() {
        let store = MockStore::new();
        let clock = FixedClock("2025-01-21T00:00:00Z".to_string());
        let service = TaskService::new(store, clock);

        let task = service.create("Test", "Desc", false).unwrap();

        // Can't approve plan when no plan is set
        let result = service.approve_plan(&task.id);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_approve_review() {
        let store = MockStore::new();
        let clock = FixedClock("2025-01-21T00:00:00Z".to_string());
        let service = TaskService::new(store, clock);

        let task = service.create("Test", "Desc", false).unwrap();
        let task = service.set_plan(&task.id, "Plan").unwrap();
        let task = service.approve_plan(&task.id).unwrap();

        // Can't approve review when no summary is set
        let result = service.approve_review(&task.id);
        assert!(result.is_err());
    }
}
