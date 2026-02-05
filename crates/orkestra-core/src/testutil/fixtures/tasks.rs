//! Task fixture factories.

use crate::workflow::domain::Task;
use crate::workflow::ports::{WorkflowResult, WorkflowStore};
use crate::workflow::runtime::Artifact;

use super::FIXTURE_TIMESTAMP;

/// Save a task in the planning stage with a default title/description.
pub fn save_planning_task(store: &dyn WorkflowStore, id: &str) -> WorkflowResult<Task> {
    save_task(store, id, "planning", "Test task", "Test description")
}

/// Save a task in a specific stage with title and description.
pub fn save_task(
    store: &dyn WorkflowStore,
    id: &str,
    stage: &str,
    title: &str,
    description: &str,
) -> WorkflowResult<Task> {
    let task = Task::new(id, title, description, stage, FIXTURE_TIMESTAMP);
    store.save_task(&task)?;
    Ok(task)
}

/// Save a task with git worktree and branch set.
pub fn save_task_with_worktree(
    store: &dyn WorkflowStore,
    id: &str,
    stage: &str,
) -> WorkflowResult<Task> {
    let task = Task::new(
        id,
        "Test task",
        "Test description",
        stage,
        FIXTURE_TIMESTAMP,
    )
    .with_git_worktree(format!("ork/{id}"), format!("/tmp/.worktrees/{id}"));
    store.save_task(&task)?;
    Ok(task)
}

/// Save a subtask linked to a parent.
pub fn save_subtask(store: &dyn WorkflowStore, id: &str, parent_id: &str) -> WorkflowResult<Task> {
    let task = Task::new(
        id,
        "Subtask",
        "Subtask description",
        "planning",
        FIXTURE_TIMESTAMP,
    )
    .with_parent(parent_id);
    store.save_task(&task)?;
    Ok(task)
}

/// Save a task with artifacts already populated.
///
/// Each artifact is a tuple of `(name, content, stage)`.
pub fn save_task_with_artifacts(
    store: &dyn WorkflowStore,
    id: &str,
    stage: &str,
    artifacts: &[(&str, &str, &str)],
) -> WorkflowResult<Task> {
    let mut task = Task::new(
        id,
        "Test task",
        "Test description",
        stage,
        FIXTURE_TIMESTAMP,
    );
    for (name, content, artifact_stage) in artifacts {
        task.artifacts.set(Artifact::new(
            *name,
            *content,
            *artifact_stage,
            FIXTURE_TIMESTAMP,
        ));
    }
    store.save_task(&task)?;
    Ok(task)
}
