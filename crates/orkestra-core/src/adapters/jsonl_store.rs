use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

use crate::domain::Task;
use crate::error::Result;
use crate::ports::TaskStore;

/// JSONL file-based task store.
///
/// Tasks are stored as append-only JSONL, with later entries overriding earlier ones.
/// This provides a simple audit trail while maintaining fast reads.
pub struct JsonlTaskStore {
    path: PathBuf,
}

impl JsonlTaskStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Ensure the parent directory exists.
    fn ensure_dir(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        Ok(())
    }

    /// Check if a process with the given PID is still running.
    fn is_process_running(pid: u32) -> bool {
        #[cfg(unix)]
        {
            unsafe { libc::kill(pid as i32, 0) == 0 }
        }
        #[cfg(not(unix))]
        {
            let _ = pid;
            false
        }
    }
}

impl TaskStore for JsonlTaskStore {
    fn load_all(&self) -> Result<Vec<Task>> {
        if !self.path.exists() {
            return Ok(vec![]);
        }

        let file = fs::File::open(&self.path)?;
        let reader = BufReader::new(file);
        let mut task_map: HashMap<String, Task> = HashMap::new();

        // JSONL is append-only, so later entries override earlier ones
        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(task) = serde_json::from_str::<Task>(&line) {
                task_map.insert(task.id.clone(), task);
            }
        }

        let mut tasks: Vec<Task> = task_map.into_values().collect();
        tasks.sort_by(|a, b| a.created_at.cmp(&b.created_at));

        // Check for stale PIDs and clear them
        let mut needs_save = false;
        for task in &mut tasks {
            if let Some(pid) = task.agent_pid {
                if !Self::is_process_running(pid) {
                    task.agent_pid = None;
                    needs_save = true;
                }
            }
        }

        // Save if we cleared any stale PIDs
        if needs_save {
            let _ = self.save_all(&tasks);
        }

        Ok(tasks)
    }

    fn find_by_id(&self, id: &str) -> Result<Option<Task>> {
        let tasks = self.load_all()?;
        Ok(tasks.into_iter().find(|t| t.id == id))
    }

    fn save(&self, task: &Task) -> Result<()> {
        self.ensure_dir()?;

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;

        let json = serde_json::to_string(task)?;
        writeln!(file, "{}", json)?;
        Ok(())
    }

    fn save_all(&self, tasks: &[Task]) -> Result<()> {
        self.ensure_dir()?;

        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&self.path)?;

        for task in tasks {
            let json = serde_json::to_string(task)?;
            writeln!(file, "{}", json)?;
        }
        Ok(())
    }

    fn next_id(&self) -> Result<String> {
        let tasks = self.load_all()?;
        let max_num = tasks
            .iter()
            .filter_map(|t| t.id.strip_prefix("TASK-").and_then(|n| n.parse::<u32>().ok()))
            .max()
            .unwrap_or(0);
        Ok(format!("TASK-{:03}", max_num + 1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_save_and_load() {
        let dir = tempdir().unwrap();
        let store = JsonlTaskStore::new(dir.path().join("tasks.jsonl"));

        let task = Task::new(
            "TASK-001".to_string(),
            "Test Task".to_string(),
            "Description".to_string(),
            "2025-01-21T00:00:00Z",
        );

        store.save(&task).unwrap();

        let tasks = store.load_all().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "TASK-001");
        assert_eq!(tasks[0].title, "Test Task");
    }

    #[test]
    fn test_next_id() {
        let dir = tempdir().unwrap();
        let store = JsonlTaskStore::new(dir.path().join("tasks.jsonl"));

        assert_eq!(store.next_id().unwrap(), "TASK-001");

        let task = Task::new(
            "TASK-001".to_string(),
            "Test".to_string(),
            "Desc".to_string(),
            "now",
        );
        store.save(&task).unwrap();

        assert_eq!(store.next_id().unwrap(), "TASK-002");
    }

    #[test]
    fn test_append_only_override() {
        let dir = tempdir().unwrap();
        let store = JsonlTaskStore::new(dir.path().join("tasks.jsonl"));

        let mut task = Task::new(
            "TASK-001".to_string(),
            "Original".to_string(),
            "Desc".to_string(),
            "now",
        );
        store.save(&task).unwrap();

        task.title = "Updated".to_string();
        store.save(&task).unwrap();

        let tasks = store.load_all().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "Updated");
    }
}
