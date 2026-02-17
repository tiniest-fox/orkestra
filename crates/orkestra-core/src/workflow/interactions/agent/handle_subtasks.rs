//! Handle subtasks output: store artifact + structured data, auto-advance or review.

use crate::orkestra_debug;
use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::Task;
use crate::workflow::execution::SubtaskOutput;
use crate::workflow::interactions::stage;
use crate::workflow::ports::WorkflowResult;
use crate::workflow::runtime::Artifact;
use crate::workflow::services::IterationService;

#[allow(clippy::too_many_arguments)]
pub fn execute(
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task: &mut Task,
    content: &str,
    subtasks: &[SubtaskOutput],
    skip_reason: Option<&str>,
    stage_name: &str,
    now: &str,
) -> WorkflowResult<()> {
    let artifact_name =
        stage::finalize_advancement::artifact_name_for_stage(workflow, stage_name, "breakdown");

    // Build artifact content with subtask summary appended if present
    let mut artifact_content = content.to_string();
    if !subtasks.is_empty() {
        artifact_content.push_str("\n\n");
        artifact_content.push_str(&format_subtasks_as_markdown(subtasks));
    }

    // Store the artifact with appended subtask details
    task.artifacts.set(Artifact::new(
        &artifact_name,
        &artifact_content,
        stage_name,
        now,
    ));

    // Store or clear structured subtask data for later Task creation on approval
    if subtasks.is_empty() {
        // Clear any stale structured data from a previous run
        task.artifacts
            .remove(&format!("{artifact_name}_structured"));
    } else {
        let json = serde_json::to_string(subtasks).expect("SubtaskOutput is always serializable");
        task.artifacts.set(Artifact::new(
            format!("{artifact_name}_structured"),
            &json,
            stage_name,
            now,
        ));
    }

    if subtasks.is_empty() {
        if let Some(reason) = skip_reason {
            orkestra_debug!("agent_actions", "Skipping subtask breakdown: {}", reason);
        }
    }

    stage::auto_advance_or_review::execute(iteration_service, workflow, task, stage_name, now)
}

// -- Helpers --

/// Format subtasks as a human-readable markdown artifact.
fn format_subtasks_as_markdown(subtasks: &[SubtaskOutput]) -> String {
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

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_subtasks_as_markdown() {
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

        let result = format_subtasks_as_markdown(&subtasks);

        assert!(result.contains("## Proposed Subtasks"));
        assert!(result.contains("### 1. First subtask"));
        assert!(result.contains("### 2. Second subtask"));
        assert!(result.contains("### 3. Third subtask"));

        assert!(result.contains("Do the first thing"));
        assert!(result.contains("Do the second thing"));
        assert!(result.contains("Do the third thing"));

        assert!(result.contains("**Depends on:** none"));
        assert!(result.contains("**Depends on:** subtask 1"));
        assert!(result.contains("**Depends on:** subtask 1, subtask 2"));

        // Detailed instructions should NOT be in the summary
        assert!(!result.contains("Detailed instructions here"));
    }
}
