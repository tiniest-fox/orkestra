//! Extract token usage from Claude Code JSONL session files.

use std::io::BufRead;
use std::path::{Path, PathBuf};

use indexmap::IndexMap;

use orkestra_types::domain::{
    compute_transcript_path, SessionTokenUsage, StageTokenUsage, TaskTokenUsage, TokenUsage,
};

use crate::workflow::ports::{WorkflowError, WorkflowResult, WorkflowStore};

/// Extract token usage for a task by reading its Claude Code JSONL session files.
///
/// Sessions without a `claude_session_id` are skipped (non-Claude or unstarted).
/// Missing JSONL files produce `usage: None` rather than an error — this is the
/// normal case for completed tasks whose worktrees have been deleted.
pub fn execute(
    store: &dyn WorkflowStore,
    task_id: &str,
    home_dir: &Path,
) -> WorkflowResult<TaskTokenUsage> {
    let task = store
        .get_task(task_id)?
        .ok_or_else(|| WorkflowError::TaskNotFound(task_id.into()))?;

    let Some(worktree_path) = &task.worktree_path else {
        return Ok(TaskTokenUsage {
            task_id: task_id.into(),
            stages: vec![],
            total: TokenUsage::default(),
        });
    };

    let working_dir = PathBuf::from(worktree_path);
    let sessions = store.get_stage_sessions(task_id)?;

    let mut session_usages: Vec<SessionTokenUsage> = Vec::with_capacity(sessions.len());
    for session in &sessions {
        // DB-first: if session has stored token data, use it directly
        if let Some(ref db_usage) = session.token_usage {
            session_usages.push(SessionTokenUsage {
                session_id: session.id.clone(),
                stage: session.stage.clone(),
                usage: Some(db_usage.clone()),
            });
            continue;
        }

        // JSONL fallback: for sessions with a claude_session_id but no DB tokens
        let Some(claude_session_id) = &session.claude_session_id else {
            continue;
        };

        let transcript_path = compute_transcript_path(home_dir, &working_dir, claude_session_id);
        let usage = read_usage_from_jsonl(&transcript_path);
        session_usages.push(SessionTokenUsage {
            session_id: session.id.clone(),
            stage: session.stage.clone(),
            usage,
        });
    }

    // Group by stage
    let mut stage_map: IndexMap<String, Vec<SessionTokenUsage>> = IndexMap::new();
    for su in session_usages {
        stage_map.entry(su.stage.clone()).or_default().push(su);
    }

    let mut trak_total = TokenUsage::default();
    let stages: Vec<StageTokenUsage> = stage_map
        .into_iter()
        .map(|(stage, sessions)| {
            let mut stage_total = TokenUsage::default();
            for su in &sessions {
                if let Some(u) = &su.usage {
                    stage_total.add(u);
                }
            }
            trak_total.add(&stage_total);
            StageTokenUsage {
                stage,
                sessions,
                total: stage_total,
            }
        })
        .collect();

    Ok(TaskTokenUsage {
        task_id: task_id.into(),
        stages,
        total: trak_total,
    })
}

// -- Helpers --

/// Read and sum token usage from all `assistant` messages in a JSONL file.
///
/// Returns `None` if the file doesn't exist. Malformed lines are skipped silently.
fn read_usage_from_jsonl(path: &Path) -> Option<TokenUsage> {
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);

    let mut total = TokenUsage::default();
    for line in reader.lines() {
        let Ok(line) = line else { continue };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if value.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        let Some(usage) = value.get("message").and_then(|m| m.get("usage")) else {
            continue;
        };
        total.input_tokens += usage
            .get("input_tokens")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        total.output_tokens += usage
            .get("output_tokens")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        total.cache_creation_input_tokens += usage
            .get("cache_creation_input_tokens")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        total.cache_read_input_tokens += usage
            .get("cache_read_input_tokens")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
    }
    Some(total)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::ports::InMemoryWorkflowStore;
    use orkestra_types::domain::{StageSession, Task};
    use tempfile::TempDir;

    fn make_jsonl_line(input: u64, output: u64, cache_create: u64, cache_read: u64) -> String {
        serde_json::json!({
            "type": "assistant",
            "message": {
                "usage": {
                    "input_tokens": input,
                    "output_tokens": output,
                    "cache_creation_input_tokens": cache_create,
                    "cache_read_input_tokens": cache_read
                }
            }
        })
        .to_string()
    }

    #[test]
    fn missing_file_returns_none() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nonexistent.jsonl");
        assert!(read_usage_from_jsonl(&path).is_none());
    }

    #[test]
    fn empty_file_returns_zero_usage() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("empty.jsonl");
        std::fs::write(&path, "").unwrap();
        let usage = read_usage_from_jsonl(&path).unwrap();
        assert_eq!(usage, TokenUsage::default());
    }

    #[test]
    fn single_assistant_message_parsed() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("session.jsonl");
        std::fs::write(&path, make_jsonl_line(100, 50, 10, 5)).unwrap();
        let usage = read_usage_from_jsonl(&path).unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_creation_input_tokens, 10);
        assert_eq!(usage.cache_read_input_tokens, 5);
    }

    #[test]
    fn multiple_assistant_messages_summed() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("session.jsonl");
        let content = format!(
            "{}\n{}\n",
            make_jsonl_line(100, 50, 10, 5),
            make_jsonl_line(200, 75, 20, 15),
        );
        std::fs::write(&path, content).unwrap();
        let usage = read_usage_from_jsonl(&path).unwrap();
        assert_eq!(usage.input_tokens, 300);
        assert_eq!(usage.output_tokens, 125);
        assert_eq!(usage.cache_creation_input_tokens, 30);
        assert_eq!(usage.cache_read_input_tokens, 20);
    }

    #[test]
    fn non_assistant_lines_skipped() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("session.jsonl");
        let user_line = serde_json::json!({
            "type": "user",
            "message": { "usage": { "input_tokens": 999 } }
        })
        .to_string();
        let content = format!("{}\n{}\n", user_line, make_jsonl_line(100, 50, 0, 0));
        std::fs::write(&path, content).unwrap();
        let usage = read_usage_from_jsonl(&path).unwrap();
        assert_eq!(usage.input_tokens, 100);
    }

    #[test]
    fn malformed_json_lines_skipped() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("session.jsonl");
        let content = format!("not json\n{}\n{{broken\n", make_jsonl_line(100, 50, 0, 0));
        std::fs::write(&path, content).unwrap();
        let usage = read_usage_from_jsonl(&path).unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
    }

    #[test]
    fn missing_usage_fields_default_to_zero() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("session.jsonl");
        let partial_line = serde_json::json!({
            "type": "assistant",
            "message": {
                "usage": {
                    "input_tokens": 42
                    // output_tokens and cache fields absent
                }
            }
        })
        .to_string();
        std::fs::write(&path, partial_line).unwrap();
        let usage = read_usage_from_jsonl(&path).unwrap();
        assert_eq!(usage.input_tokens, 42);
        assert_eq!(usage.output_tokens, 0);
        assert_eq!(usage.cache_creation_input_tokens, 0);
        assert_eq!(usage.cache_read_input_tokens, 0);
    }

    #[test]
    fn token_usage_add_accumulates_fields() {
        let mut a = TokenUsage {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 5,
            cache_read_input_tokens: 3,
        };
        let b = TokenUsage {
            input_tokens: 100,
            output_tokens: 200,
            cache_creation_input_tokens: 50,
            cache_read_input_tokens: 30,
        };
        a.add(&b);
        assert_eq!(a.input_tokens, 110);
        assert_eq!(a.output_tokens, 220);
        assert_eq!(a.cache_creation_input_tokens, 55);
        assert_eq!(a.cache_read_input_tokens, 33);
    }

    #[test]
    fn token_usage_total_sums_all_fields() {
        let u = TokenUsage {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 5,
            cache_read_input_tokens: 3,
        };
        assert_eq!(u.total(), 38);
    }

    #[test]
    fn compute_transcript_path_encodes_slashes_and_dots() {
        let home = PathBuf::from("/home/user");
        let dir = PathBuf::from("/repo/my.project");
        let path = compute_transcript_path(&home, &dir, "ses-123");
        assert_eq!(
            path,
            PathBuf::from("/home/user/.claude/projects/-repo-my-project/ses-123.jsonl")
        );
    }

    fn make_store_with_task(task_id: &str, worktree: &str) -> InMemoryWorkflowStore {
        let store = InMemoryWorkflowStore::new();
        let mut task = Task::new(task_id, "Test", "", "work", "2026-01-01T00:00:00Z");
        task.worktree_path = Some(worktree.to_string());
        store.save_task(&task).unwrap();
        store
    }

    #[test]
    fn session_with_db_tokens_uses_db_path() {
        let store = make_store_with_task("task-1", "/tmp/wt");
        let mut session = StageSession::new("ss-1", "task-1", "work", "2026-01-01T00:00:00Z");
        session.token_usage = Some(TokenUsage {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
        });
        store.save_stage_session(&session).unwrap();

        let home = PathBuf::from("/nonexistent");
        let result = execute(&store, "task-1", &home).unwrap();

        assert_eq!(result.stages.len(), 1);
        let stage = &result.stages[0];
        assert_eq!(stage.sessions.len(), 1);
        let su = &stage.sessions[0];
        assert!(su.usage.is_some());
        let usage = su.usage.as_ref().unwrap();
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
        // JSONL path was never consulted — home dir doesn't exist and no error
    }

    #[test]
    fn session_without_db_tokens_falls_back_to_jsonl() {
        let tmp = TempDir::new().unwrap();
        let worktree = tmp.path().to_string_lossy().into_owned();
        let store = make_store_with_task("task-2", &worktree);

        let session_id = "ses-fallback";
        let mut session = StageSession::new("ss-2", "task-2", "work", "2026-01-01T00:00:00Z");
        session.claude_session_id = Some(session_id.to_string());
        session.token_usage = None;
        store.save_stage_session(&session).unwrap();

        // Write a JSONL file for this session
        let home = tmp.path().to_path_buf();
        let encoded_cwd: String = worktree
            .chars()
            .map(|c| if c == '/' || c == '.' { '-' } else { c })
            .collect();
        let projects_dir = home.join(".claude").join("projects").join(&encoded_cwd);
        std::fs::create_dir_all(&projects_dir).unwrap();
        let jsonl_path = projects_dir.join(format!("{session_id}.jsonl"));
        std::fs::write(&jsonl_path, make_jsonl_line(200, 75, 0, 0)).unwrap();

        let result = execute(&store, "task-2", &home).unwrap();

        assert_eq!(result.stages.len(), 1);
        let su = &result.stages[0].sessions[0];
        assert!(su.usage.is_some());
        assert_eq!(su.usage.as_ref().unwrap().input_tokens, 200);
    }

    #[test]
    fn session_without_either_is_skipped() {
        let store = make_store_with_task("task-3", "/tmp/wt");
        // Session has neither db token_usage nor claude_session_id
        let session = StageSession::new("ss-3", "task-3", "work", "2026-01-01T00:00:00Z");
        store.save_stage_session(&session).unwrap();

        let home = PathBuf::from("/nonexistent");
        let result = execute(&store, "task-3", &home).unwrap();

        assert!(result.stages.is_empty());
    }
}
