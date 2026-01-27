//! Breakdown output conversion.
//!
//! Converts structured subtask output from the breakdown stage
//! into markdown format suitable for artifact storage and display.

use super::output::SubtaskOutput;

/// Convert breakdown subtasks to markdown artifact content.
///
/// Formats the subtasks as a structured markdown document with:
/// - Numbered subtask headings
/// - Descriptions
/// - Dependency information
///
/// If subtasks is empty, returns a "skipped" message with the reason.
pub fn subtasks_to_markdown(subtasks: &[SubtaskOutput], skip_reason: Option<&str>) -> String {
    if subtasks.is_empty() {
        return match skip_reason {
            Some(reason) => format!("# Breakdown Skipped\n\n{}", reason),
            None => "# Breakdown Skipped\n\nNo subtasks generated.".to_string(),
        };
    }

    let mut md = String::from("# Task Breakdown\n\n");

    for (i, subtask) in subtasks.iter().enumerate() {
        md.push_str(&format!("## {}. {}\n\n", i + 1, subtask.title));
        md.push_str(&format!("{}\n\n", subtask.description));

        if subtask.depends_on.is_empty() {
            md.push_str("**Dependencies:** None\n\n");
        } else {
            let deps: Vec<String> = subtask
                .depends_on
                .iter()
                .map(|idx| format!("Subtask {}", idx + 1))
                .collect();
            md.push_str(&format!("**Dependencies:** {}\n\n", deps.join(", ")));
        }
    }

    md
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_subtasks_with_skip_reason() {
        let md = subtasks_to_markdown(&[], Some("Task is simple enough"));
        assert!(md.contains("# Breakdown Skipped"));
        assert!(md.contains("Task is simple enough"));
    }

    #[test]
    fn test_empty_subtasks_no_reason() {
        let md = subtasks_to_markdown(&[], None);
        assert!(md.contains("# Breakdown Skipped"));
        assert!(md.contains("No subtasks generated"));
    }

    #[test]
    fn test_single_subtask() {
        let subtasks = vec![SubtaskOutput {
            title: "Setup database".to_string(),
            description: "Create the schema and migrations".to_string(),
            depends_on: vec![],
        }];

        let md = subtasks_to_markdown(&subtasks, None);
        assert!(md.contains("# Task Breakdown"));
        assert!(md.contains("## 1. Setup database"));
        assert!(md.contains("Create the schema"));
        assert!(md.contains("**Dependencies:** None"));
    }

    #[test]
    fn test_subtasks_with_dependencies() {
        let subtasks = vec![
            SubtaskOutput {
                title: "First task".to_string(),
                description: "Do this first".to_string(),
                depends_on: vec![],
            },
            SubtaskOutput {
                title: "Second task".to_string(),
                description: "Depends on first".to_string(),
                depends_on: vec![0],
            },
            SubtaskOutput {
                title: "Third task".to_string(),
                description: "Depends on both".to_string(),
                depends_on: vec![0, 1],
            },
        ];

        let md = subtasks_to_markdown(&subtasks, None);
        assert!(md.contains("## 1. First task"));
        assert!(md.contains("## 2. Second task"));
        assert!(md.contains("## 3. Third task"));
        assert!(md.contains("**Dependencies:** Subtask 1, Subtask 2"));
    }
}
