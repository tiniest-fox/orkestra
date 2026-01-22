use crate::domain::{Task, TaskStatus};
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

    /// Approve a plan and transition to Working. Requires: Planning + plan set.
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
            task.transition_to(TaskStatus::Working, &now)
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

    /// Set the agent PID for a task.
    pub fn set_agent_pid(&self, id: &str, pid: u32) -> Result<Task> {
        self.update(id, |task| {
            task.agent_pid = Some(pid);
            Ok(())
        })
    }

    /// Clear the agent PID for a task.
    pub fn clear_agent_pid(&self, id: &str) -> Result<Task> {
        self.update(id, |task| {
            task.agent_pid = None;
            Ok(())
        })
    }

    /// Add a session to a task.
    pub fn add_session(&self, id: &str, session_type: &str, session_id: &str) -> Result<Task> {
        let now = self.clock.now_rfc3339();
        self.update(id, |task| {
            task.add_session(session_type, session_id, &now);
            Ok(())
        })
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
    fn test_task_workflow() {
        let store = MockStore::new();
        let clock = FixedClock("2025-01-21T00:00:00Z".to_string());
        let service = TaskService::new(store, clock);

        // Create task - starts in Planning
        let task = service.create("Test", "Desc", false).unwrap();
        assert_eq!(task.status, TaskStatus::Planning);

        // Set plan - stays in Planning (plan indicates ready for review)
        let task = service.set_plan(&task.id, "My Plan").unwrap();
        assert_eq!(task.status, TaskStatus::Planning);
        assert_eq!(task.plan, Some("My Plan".to_string()));

        // Approve plan - transitions to Working
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
