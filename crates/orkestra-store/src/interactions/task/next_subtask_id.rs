//! Generate a unique subtask ID with sibling-unique last word.

use petname::Generator;
use rusqlite::{params, Connection};

use crate::interface::{WorkflowError, WorkflowResult};

pub fn execute(conn: &Connection, parent_id: &str) -> WorkflowResult<String> {
    let petname_gen = petname::Petnames::default();

    // Collect last words of existing sibling IDs
    let mut stmt = conn
        .prepare("SELECT id FROM workflow_tasks WHERE parent_id = ?")
        .map_err(|e| WorkflowError::Storage(e.to_string()))?;
    let sibling_last_words: Vec<String> = stmt
        .query_map(params![parent_id], |row| row.get::<_, String>(0))
        .map_err(|e| WorkflowError::Storage(e.to_string()))?
        .filter_map(std::result::Result::ok)
        .filter_map(|id| id.rsplit('-').next().map(String::from))
        .collect();
    drop(stmt);

    for _ in 0..100 {
        let Some(id) = petname_gen.generate_one(3, "-") else {
            continue;
        };

        // Check global uniqueness
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM workflow_tasks WHERE id = ?)",
                params![&id],
                |row| row.get(0),
            )
            .map_err(|e| WorkflowError::Storage(e.to_string()))?;

        if exists {
            continue;
        }

        // Check last-word uniqueness among siblings
        let last_word = id.rsplit('-').next().unwrap_or(&id);
        if sibling_last_words.iter().any(|w| w == last_word) {
            continue;
        }

        return Ok(id);
    }

    Err(WorkflowError::Storage(
        "Failed to generate unique subtask ID after 100 attempts".into(),
    ))
}
