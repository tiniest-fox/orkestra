//! Query enriched task views with pre-joined data and derived state.

use std::collections::HashMap;
use std::sync::Arc;

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::task_view::{DerivedTaskState, DifferentialTaskResponse, TaskView};
use crate::workflow::domain::{Iteration, StageSession, Task};
use crate::workflow::ports::{WorkflowResult, WorkflowStore};

/// List all active top-level tasks with pre-joined data and derived state.
#[allow(clippy::too_many_lines)]
pub fn list_active(
    store: &Arc<dyn WorkflowStore>,
    workflow: &WorkflowConfig,
) -> WorkflowResult<Vec<TaskView>> {
    let all_active = store.list_active_tasks()?;

    let mut top_level = Vec::new();
    let mut parent_ids = Vec::new();
    let mut subtasks_by_parent: HashMap<String, Vec<Task>> = HashMap::new();

    for task in all_active {
        if let Some(ref parent_id) = task.parent_id {
            subtasks_by_parent
                .entry(parent_id.clone())
                .or_default()
                .push(task);
        } else {
            parent_ids.push(task.id.clone());
            top_level.push(task);
        }
    }

    // For non-archived parent tasks, load their archived subtasks too
    {
        let parent_id_refs: Vec<&str> = parent_ids.iter().map(String::as_str).collect();
        let archived_subtasks = store.list_archived_subtasks_by_parents(&parent_id_refs)?;
        for subtask in archived_subtasks {
            if let Some(ref parent_id) = subtask.parent_id {
                subtasks_by_parent
                    .entry(parent_id.clone())
                    .or_default()
                    .push(subtask);
            }
        }
    }

    let all_task_ids: Vec<String> = {
        let mut ids = parent_ids.clone();
        for subtasks in subtasks_by_parent.values() {
            for subtask in subtasks {
                ids.push(subtask.id.clone());
            }
        }
        ids
    };
    let all_task_id_refs: Vec<&str> = all_task_ids.iter().map(String::as_str).collect();

    let iterations_by_task = group_by_task_id(store.list_iterations_for_tasks(&all_task_id_refs)?);
    let sessions_by_task =
        group_by_task_id(store.list_stage_sessions_for_tasks(&all_task_id_refs)?);

    let mut subtask_derived_by_parent: HashMap<String, Vec<DerivedTaskState>> = HashMap::new();
    let mut subtask_views: Vec<TaskView> = Vec::new();

    for (parent_id, subtasks) in &subtasks_by_parent {
        let sorted = topological_sort(subtasks.clone());
        let mut derived_states = Vec::with_capacity(sorted.len());

        for task in sorted {
            let iterations = iterations_by_task
                .get(&task.id)
                .cloned()
                .unwrap_or_default();
            let stage_sessions = sessions_by_task.get(&task.id).cloned().unwrap_or_default();
            let derived =
                DerivedTaskState::build(&task, &iterations, &stage_sessions, &[], workflow);
            derived_states.push(derived.clone());
            subtask_views.push(TaskView {
                task,
                iterations,
                stage_sessions,
                derived,
            });
        }
        subtask_derived_by_parent.insert(parent_id.clone(), derived_states);
    }

    let mut views = Vec::with_capacity(top_level.len() + subtask_views.len());
    for task in top_level {
        let iterations = iterations_by_task
            .get(&task.id)
            .cloned()
            .unwrap_or_default();
        let stage_sessions = sessions_by_task.get(&task.id).cloned().unwrap_or_default();
        let subtask_states = subtask_derived_by_parent
            .get(&task.id)
            .map_or(&[][..], Vec::as_slice);
        let derived = DerivedTaskState::build(
            &task,
            &iterations,
            &stage_sessions,
            subtask_states,
            workflow,
        );
        views.push(TaskView {
            task,
            iterations,
            stage_sessions,
            derived,
        });
    }

    views.extend(subtask_views);
    Ok(views)
}

/// List only changed or new active tasks relative to a client-provided timestamp map.
///
/// Accepts a map of `task_id → updated_at` from the client. Returns only tasks
/// whose `updated_at` has changed or that are new (not in the map), plus IDs of
/// tasks that were in the map but are no longer active. When the map is empty,
/// returns all active tasks (backwards-compatible full response).
#[allow(clippy::too_many_lines)]
pub fn list_active_differential<S: std::hash::BuildHasher>(
    store: &Arc<dyn WorkflowStore>,
    workflow: &WorkflowConfig,
    since: &HashMap<String, String, S>,
) -> WorkflowResult<DifferentialTaskResponse> {
    // Empty map → full response (backwards compatible).
    if since.is_empty() {
        let tasks = list_active(store, workflow)?;
        return Ok(DifferentialTaskResponse {
            tasks,
            deleted_ids: vec![],
        });
    }

    let all_active = store.list_active_tasks()?;

    // Compute the set of active task IDs for deletion detection.
    let active_ids: std::collections::HashSet<&str> =
        all_active.iter().map(|t| t.id.as_str()).collect();

    // IDs in the client map that no longer exist in the active set.
    let deleted_ids: Vec<String> = since
        .keys()
        .filter(|id| !active_ids.contains(id.as_str()))
        .cloned()
        .collect();

    // Partition into top-level and subtasks, tracking which are changed.
    let mut top_level = Vec::new();
    let mut parent_ids = Vec::new();
    let mut subtasks_by_parent: HashMap<String, Vec<Task>> = HashMap::new();

    for task in all_active {
        let is_changed = since.get(&task.id) != Some(&task.updated_at);

        if let Some(ref parent_id) = task.parent_id {
            subtasks_by_parent
                .entry(parent_id.clone())
                .or_default()
                .push(task);
        } else {
            if is_changed {
                parent_ids.push(task.id.clone());
            }
            top_level.push((task, is_changed));
        }
    }

    // For non-archived parent tasks, load their archived subtasks too.
    {
        let all_parent_ids: Vec<&str> = top_level.iter().map(|(t, _)| t.id.as_str()).collect();
        let archived_subtasks = store.list_archived_subtasks_by_parents(&all_parent_ids)?;
        for subtask in archived_subtasks {
            if let Some(ref parent_id) = subtask.parent_id {
                subtasks_by_parent
                    .entry(parent_id.clone())
                    .or_default()
                    .push(subtask);
            }
        }
    }

    // Collect all task IDs we need iterations/sessions for (changed tasks only).
    let changed_top_level_ids: Vec<String> = top_level
        .iter()
        .filter(|(_, changed)| *changed)
        .map(|(t, _)| t.id.clone())
        .collect();

    let changed_subtask_ids: Vec<String> = subtasks_by_parent
        .values()
        .flat_map(|subtasks| subtasks.iter())
        .filter(|t| since.get(&t.id) != Some(&t.updated_at))
        .map(|t| t.id.clone())
        .collect();

    let mut changed_ids = changed_top_level_ids;
    changed_ids.extend(changed_subtask_ids);
    let changed_id_refs: Vec<&str> = changed_ids.iter().map(String::as_str).collect();

    let iterations_by_task = group_by_task_id(store.list_iterations_for_tasks(&changed_id_refs)?);
    let sessions_by_task = group_by_task_id(store.list_stage_sessions_for_tasks(&changed_id_refs)?);

    let mut subtask_derived_by_parent: HashMap<String, Vec<DerivedTaskState>> = HashMap::new();
    let mut subtask_views: Vec<TaskView> = Vec::new();

    for (parent_id, subtasks) in &subtasks_by_parent {
        let sorted = topological_sort(subtasks.clone());
        let mut derived_states = Vec::with_capacity(sorted.len());

        for task in sorted {
            let is_changed = since.get(&task.id) != Some(&task.updated_at);

            let iterations = iterations_by_task
                .get(&task.id)
                .cloned()
                .unwrap_or_default();
            let stage_sessions = sessions_by_task.get(&task.id).cloned().unwrap_or_default();
            let derived =
                DerivedTaskState::build(&task, &iterations, &stage_sessions, &[], workflow);
            derived_states.push(derived.clone());

            if is_changed {
                subtask_views.push(TaskView {
                    task,
                    iterations,
                    stage_sessions,
                    derived,
                });
            }
        }
        subtask_derived_by_parent.insert(parent_id.clone(), derived_states);
    }

    let mut views = Vec::new();
    for (task, is_changed) in top_level {
        if !is_changed {
            continue;
        }
        let iterations = iterations_by_task
            .get(&task.id)
            .cloned()
            .unwrap_or_default();
        let stage_sessions = sessions_by_task.get(&task.id).cloned().unwrap_or_default();
        let subtask_states = subtask_derived_by_parent
            .get(&task.id)
            .map_or(&[][..], Vec::as_slice);
        let derived = DerivedTaskState::build(
            &task,
            &iterations,
            &stage_sessions,
            subtask_states,
            workflow,
        );
        views.push(TaskView {
            task,
            iterations,
            stage_sessions,
            derived,
        });
    }

    views.extend(subtask_views);

    Ok(DifferentialTaskResponse {
        tasks: views,
        deleted_ids,
    })
}

/// List subtasks for a parent task with pre-joined data and derived state.
pub fn list_subtasks(
    store: &dyn WorkflowStore,
    parent_id: &str,
    workflow: &WorkflowConfig,
) -> WorkflowResult<Vec<TaskView>> {
    let subtasks = store.list_subtasks(parent_id)?;
    if subtasks.is_empty() {
        return Ok(vec![]);
    }

    let sorted = topological_sort(subtasks);

    let mut views = Vec::with_capacity(sorted.len());
    for task in sorted {
        let iterations = store.get_iterations(&task.id)?;
        let stage_sessions = store.get_stage_sessions(&task.id)?;
        let derived = DerivedTaskState::build(&task, &iterations, &stage_sessions, &[], workflow);
        views.push(TaskView {
            task,
            iterations,
            stage_sessions,
            derived,
        });
    }

    Ok(views)
}

/// List all archived top-level tasks with pre-joined data and derived state.
#[allow(clippy::too_many_lines)]
pub fn list_archived(
    store: &Arc<dyn WorkflowStore>,
    workflow: &WorkflowConfig,
) -> WorkflowResult<Vec<TaskView>> {
    let all_archived = store.list_archived_tasks()?;

    let mut top_level = Vec::new();
    let mut parent_ids = Vec::new();
    let mut subtasks_by_parent: HashMap<String, Vec<Task>> = HashMap::new();

    for task in all_archived {
        if let Some(ref parent_id) = task.parent_id {
            subtasks_by_parent
                .entry(parent_id.clone())
                .or_default()
                .push(task);
        } else {
            parent_ids.push(task.id.clone());
            top_level.push(task);
        }
    }

    let all_task_ids: Vec<String> = {
        let mut ids = parent_ids.clone();
        for subtasks in subtasks_by_parent.values() {
            for subtask in subtasks {
                ids.push(subtask.id.clone());
            }
        }
        ids
    };
    let all_task_id_refs: Vec<&str> = all_task_ids.iter().map(String::as_str).collect();

    let iterations_by_task = group_by_task_id(store.list_iterations_for_tasks(&all_task_id_refs)?);
    let sessions_by_task =
        group_by_task_id(store.list_stage_sessions_for_tasks(&all_task_id_refs)?);

    let mut subtask_derived_by_parent: HashMap<String, Vec<DerivedTaskState>> = HashMap::new();
    let mut subtask_views: Vec<TaskView> = Vec::new();

    for (parent_id, subtasks) in &subtasks_by_parent {
        let sorted = topological_sort(subtasks.clone());
        let mut derived_states = Vec::with_capacity(sorted.len());

        for task in sorted {
            let iterations = iterations_by_task
                .get(&task.id)
                .cloned()
                .unwrap_or_default();
            let stage_sessions = sessions_by_task.get(&task.id).cloned().unwrap_or_default();
            let derived =
                DerivedTaskState::build(&task, &iterations, &stage_sessions, &[], workflow);
            derived_states.push(derived.clone());
            subtask_views.push(TaskView {
                task,
                iterations,
                stage_sessions,
                derived,
            });
        }
        subtask_derived_by_parent.insert(parent_id.clone(), derived_states);
    }

    let mut views = Vec::with_capacity(top_level.len() + subtask_views.len());
    for task in top_level {
        let iterations = iterations_by_task
            .get(&task.id)
            .cloned()
            .unwrap_or_default();
        let stage_sessions = sessions_by_task.get(&task.id).cloned().unwrap_or_default();
        let subtask_states = subtask_derived_by_parent
            .get(&task.id)
            .map_or(&[][..], Vec::as_slice);
        let derived = DerivedTaskState::build(
            &task,
            &iterations,
            &stage_sessions,
            subtask_states,
            workflow,
        );
        views.push(TaskView {
            task,
            iterations,
            stage_sessions,
            derived,
        });
    }

    views.extend(subtask_views);
    Ok(views)
}

// -- Helpers --

/// Trait for types that belong to a task (have a `task_id` field).
trait HasTaskId {
    fn task_id(&self) -> &str;
}

impl HasTaskId for Iteration {
    fn task_id(&self) -> &str {
        &self.task_id
    }
}

impl HasTaskId for StageSession {
    fn task_id(&self) -> &str {
        &self.task_id
    }
}

/// Group a flat list of items by their task ID.
fn group_by_task_id<T: HasTaskId>(items: Vec<T>) -> HashMap<String, Vec<T>> {
    let mut map: HashMap<String, Vec<T>> = HashMap::new();
    for item in items {
        map.entry(item.task_id().to_string())
            .or_default()
            .push(item);
    }
    map
}

/// Sort tasks in topological order (dependencies before dependents).
///
/// Uses Kahn's algorithm. Within the same dependency level, preserves
/// the original input order (typically creation order).
pub(crate) fn topological_sort(tasks: Vec<Task>) -> Vec<Task> {
    use std::collections::{HashSet, VecDeque};

    let ids: HashSet<&str> = tasks.iter().map(|t| t.id.as_str()).collect();

    let id_to_idx: HashMap<&str, usize> = tasks
        .iter()
        .enumerate()
        .map(|(i, t)| (t.id.as_str(), i))
        .collect();

    let mut in_degree = vec![0usize; tasks.len()];
    let mut dependents: Vec<Vec<usize>> = vec![vec![]; tasks.len()];
    for (i, task) in tasks.iter().enumerate() {
        for dep_id in &task.depends_on {
            if let Some(&dep_idx) = id_to_idx.get(dep_id.as_str()) {
                if ids.contains(dep_id.as_str()) {
                    in_degree[i] += 1;
                    dependents[dep_idx].push(i);
                }
            }
        }
    }

    let mut queue: VecDeque<usize> = VecDeque::new();
    for (i, &deg) in in_degree.iter().enumerate() {
        if deg == 0 {
            queue.push_back(i);
        }
    }

    let mut order: Vec<usize> = Vec::with_capacity(tasks.len());
    while let Some(idx) = queue.pop_front() {
        order.push(idx);
        let mut deps = dependents[idx].clone();
        deps.sort_unstable();
        for dep_idx in deps {
            in_degree[dep_idx] -= 1;
            if in_degree[dep_idx] == 0 {
                queue.push_back(dep_idx);
            }
        }
    }

    if order.len() < tasks.len() {
        for i in 0..tasks.len() {
            if !order.contains(&i) {
                order.push(i);
            }
        }
    }

    let mut indexed: Vec<(usize, Task)> = tasks.into_iter().enumerate().collect();
    let mut result = Vec::with_capacity(indexed.len());
    for idx in order {
        if let Some(pos) = indexed.iter().position(|(i, _)| *i == idx) {
            result.push(indexed.swap_remove(pos).1);
        }
    }
    result
}
