//! Create a new top-level task.

use std::sync::Arc;

use crate::orkestra_debug;
use crate::title::TitleGenerator;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{Task, TaskCreationMode};
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::{GitService, WorkflowError, WorkflowResult, WorkflowStore};
use crate::workflow::runtime::TaskState;

#[allow(clippy::too_many_arguments)]
pub fn execute(
    store: Arc<dyn WorkflowStore>,
    workflow: &WorkflowConfig,
    git_service: Option<&dyn GitService>,
    iteration_service: &IterationService,
    task_id: Option<&str>,
    title: &str,
    description: &str,
    base_branch: Option<&str>,
    mode: TaskCreationMode,
    flow: Option<&str>,
    auto_pr: bool,
    title_gen: Option<Arc<dyn TitleGenerator>>,
) -> WorkflowResult<Task> {
    // Validate flow exists if specified
    if let Some(flow_name) = flow {
        if !workflow.flows.contains_key(flow_name) {
            return Err(WorkflowError::InvalidTransition(format!(
                "Unknown flow \"{flow_name}\". Available flows: {:?}",
                workflow.flows.keys().collect::<Vec<_>>()
            )));
        }
    }

    let flow_name = flow
        .or_else(|| workflow.first_flow_name())
        .unwrap_or("default");

    let id = match task_id {
        Some(id) => id.to_string(),
        None => store.next_task_id()?,
    };
    let first_stage = workflow
        .first_stage(flow_name)
        .ok_or_else(|| WorkflowError::InvalidTransition("No stages in workflow".into()))?;

    // Resolve base_branch eagerly: use provided value, or current branch from git.
    let resolved_base_branch = match base_branch {
        Some(b) => b.to_string(),
        None => match git_service {
            Some(git) => git.current_branch().map_err(|e| {
                WorkflowError::InvalidTransition(format!("Cannot determine base branch: {e}"))
            })?,
            None => String::new(),
        },
    };

    let now = chrono::Utc::now().to_rfc3339();
    let mut task = Task::new(&id, title, description, &first_stage.name, &now);
    task.base_branch = resolved_base_branch;
    task.auto_mode = matches!(mode, TaskCreationMode::AutoMode);
    task.auto_pr = auto_pr;
    task.flow = flow_name.to_string();

    // Check for a prewarmed worktree; adopt it if ready.
    let prewarm_adopted = if let Some(record) = super::adopt_worktree::execute(store.as_ref(), &id)?
    {
        super::adopt_worktree::apply_to_task(&mut task, record);
        // Start directly in Queued — worktree is already ready.
        task.state = TaskState::queued(&first_stage.name);
        true
    } else {
        // Start in AwaitingSetup - orchestrator will pick this up and trigger setup.
        task.state = TaskState::awaiting_setup(&first_stage.name);
        false
    };

    // Save task immediately (non-blocking UI)
    store.save_task(&task)?;

    // Create initial iteration via IterationService
    iteration_service.create_initial_iteration(&id, &first_stage.name)?;

    // For prewarm-adopted tasks the normal setup path (which triggers title gen) is
    // skipped. Spawn title generation here so the UI gets a real title.
    if prewarm_adopted && task.title.trim().is_empty() && !task.description.trim().is_empty() {
        if let Some(tg) = title_gen {
            let store_clone = Arc::clone(&store);
            let desc = task.description.clone();
            let tid = task.id.clone();
            std::thread::spawn(move || {
                super::generate_title::execute(store_clone.as_ref(), tg.as_ref(), &tid, &desc);
            });
        }
    }

    orkestra_debug!(
        "task",
        "Created {}: state={}, stage={}",
        task.id,
        task.state,
        first_stage.name
    );

    Ok(task)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use orkestra_store::{WorktreeRecord, WorktreeStatus};

    use crate::title::mock::MockTitleGenerator;
    use crate::workflow::adapters::InMemoryWorkflowStore;
    use crate::workflow::config::{StageConfig, WorkflowConfig};
    use crate::workflow::domain::TaskCreationMode;
    use crate::workflow::iteration::IterationService;
    use crate::workflow::ports::WorkflowStore;

    fn test_workflow() -> WorkflowConfig {
        WorkflowConfig::new(vec![StageConfig::new("work", "summary")])
    }

    fn ready_prewarm(task_id: &str) -> WorktreeRecord {
        WorktreeRecord {
            task_id: task_id.to_string(),
            status: WorktreeStatus::Ready,
            base_branch: Some("main".to_string()),
            worktree_path: Some("/tmp/wt".to_string()),
            branch_name: Some(format!("task/{task_id}")),
            base_commit: Some("abc123".to_string()),
            created_at: "2025-01-01T00:00:00Z".to_string(),
        }
    }

    /// Bug 3: title generation must be triggered for prewarm-adopted tasks that
    /// have an empty title but non-empty description.
    #[test]
    fn prewarm_adoption_triggers_title_generation() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let title_gen_clone: Arc<dyn crate::title::TitleGenerator> =
            Arc::new(MockTitleGenerator::succeeding());

        store
            .save_worktree_record(&ready_prewarm("my-task"))
            .unwrap();

        let iteration_service = IterationService::new(Arc::clone(&store));
        let workflow = test_workflow();

        super::execute(
            Arc::clone(&store),
            &workflow,
            None,
            &iteration_service,
            Some("my-task"),
            "", // empty title — triggers generation
            "Build something interesting",
            None,
            TaskCreationMode::Normal,
            None,
            false,
            Some(title_gen_clone),
        )
        .unwrap();

        // Give the background thread time to complete.
        std::thread::sleep(std::time::Duration::from_millis(100));

        let task = store.get_task("my-task").unwrap().unwrap();
        assert!(
            !task.title.trim().is_empty(),
            "expected title to be set after prewarm adoption, got empty"
        );
    }

    /// No title generation when a prewarm is adopted but title is already set.
    #[test]
    fn prewarm_adoption_skips_title_gen_when_title_present() {
        let store: Arc<dyn WorkflowStore> = Arc::new(InMemoryWorkflowStore::new());
        let title_gen: Arc<dyn crate::title::TitleGenerator> =
            Arc::new(MockTitleGenerator::succeeding());

        store
            .save_worktree_record(&ready_prewarm("my-task2"))
            .unwrap();

        let iteration_service = IterationService::new(Arc::clone(&store));
        let workflow = test_workflow();

        let task = super::execute(
            Arc::clone(&store),
            &workflow,
            None,
            &iteration_service,
            Some("my-task2"),
            "Already has a title",
            "Some description",
            None,
            TaskCreationMode::Normal,
            None,
            false,
            Some(title_gen),
        )
        .unwrap();

        // Title should remain as supplied — not overwritten by generator.
        assert_eq!(task.title, "Already has a title");
    }
}
