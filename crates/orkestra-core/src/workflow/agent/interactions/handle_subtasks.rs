//! Handle subtasks output: store artifact + structured data, auto-advance or review.

use crate::workflow::config::WorkflowConfig;
use crate::workflow::domain::{ArtifactSnapshot, Task};
use crate::workflow::execution::SubtaskOutput;
use crate::workflow::iteration::IterationService;
use crate::workflow::ports::WorkflowResult;
use crate::workflow::runtime::Artifact;
use crate::workflow::stage::interactions as stage;

pub fn execute(
    workflow: &WorkflowConfig,
    iteration_service: &IterationService,
    task: &mut Task,
    content: &str,
    subtasks: &[SubtaskOutput],
    stage_name: &str,
    now: &str,
) -> WorkflowResult<()> {
    let artifact_name = stage::finalize_advancement::artifact_name_for_stage(
        workflow,
        &task.flow,
        stage_name,
        "breakdown",
    );

    let snapshot_content = if subtasks.len() == 1 {
        // Single subtask: inline on parent. Combine design + instructions as artifact.
        let artifact_content = format_inline_artifact(content, &subtasks[0].detailed_instructions);

        task.artifacts.set(Artifact::new(
            &artifact_name,
            &artifact_content,
            stage_name,
            now,
        ));
        // Clear any stale _structured data from a previous iteration
        task.artifacts
            .remove(&format!("{artifact_name}_structured"));
        artifact_content
    } else {
        // Multiple subtasks: store human-readable artifact + structured data
        let mut artifact_content = content.to_string();
        artifact_content.push_str("\n\n");
        artifact_content.push_str(&format_subtasks_as_markdown(subtasks));

        task.artifacts.set(Artifact::new(
            &artifact_name,
            &artifact_content,
            stage_name,
            now,
        ));

        let json = serde_json::to_string(subtasks).expect("SubtaskOutput is always serializable");
        task.artifacts.set(Artifact::new(
            format!("{artifact_name}_structured"),
            &json,
            stage_name,
            now,
        ));
        artifact_content
    };

    // Snapshot primary human-readable artifact on iteration for history (NOT the _structured JSON)
    iteration_service.set_artifact_snapshot(
        &task.id,
        stage_name,
        ArtifactSnapshot {
            name: artifact_name,
            content: snapshot_content,
        },
    )?;

    stage::auto_advance_or_review::execute(iteration_service, workflow, task, stage_name, now)
}

// -- Helpers --

/// Build the artifact content for a single inlined subtask.
fn format_inline_artifact(content: &str, detailed_instructions: &str) -> String {
    let mut artifact = content.to_string();
    artifact.push_str("\n\n---\n\n## Implementation Instructions\n\n");
    artifact.push_str(detailed_instructions);
    artifact
}

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
    fn test_format_single_subtask_inline() {
        let result = format_inline_artifact(
            "# Technical Design\n\nOverview here.",
            "Implement the following steps...",
        );

        assert!(result.contains("# Technical Design"));
        assert!(result.contains("---"));
        assert!(result.contains("## Implementation Instructions"));
        assert!(result.contains("Implement the following steps..."));

        // Content before separator, instructions after
        let sep_pos = result.find("---").unwrap();
        let instructions_pos = result.find("Implement the following").unwrap();
        let design_pos = result.find("# Technical Design").unwrap();
        assert!(design_pos < sep_pos);
        assert!(sep_pos < instructions_pos);
    }

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
