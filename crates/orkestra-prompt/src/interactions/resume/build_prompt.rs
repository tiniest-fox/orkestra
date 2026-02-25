//! Resume prompt construction.
//!
//! Builds short resume prompts for session continuation.

use handlebars::Handlebars;
use orkestra_types::runtime::{absolute_artifact_file_path, artifact_file_path};

use crate::types::{AgentConfigError, ResumeType};

// ============================================================================
// Template Constants
// ============================================================================

const RESUME_CONTINUE: &str = include_str!("../../templates/resume/continue.md");
const RESUME_FEEDBACK: &str = include_str!("../../templates/resume/feedback.md");
const RESUME_INTEGRATION: &str = include_str!("../../templates/resume/integration.md");
const RESUME_ANSWERS: &str = include_str!("../../templates/resume/answers.md");
const RESUME_RECHECK: &str = include_str!("../../templates/resume/recheck.md");
const RESUME_RETRY_FAILED: &str = include_str!("../../templates/resume/retry_failed.md");
const RESUME_RETRY_BLOCKED: &str = include_str!("../../templates/resume/retry_blocked.md");
const RESUME_MANUAL_RESUME: &str = include_str!("../../templates/resume/manual_resume.md");
const RESUME_PR_COMMENTS: &str = include_str!("../../templates/resume/pr_comments.md");

// ============================================================================
// Interaction
// ============================================================================

/// Build a resume prompt from the resume type and context.
///
/// Resume prompts are short user messages sent when resuming an agent session.
/// The agent already has the full task context from the original session.
pub fn execute(
    stage: &str,
    resume_type: &ResumeType,
    base_branch: &str,
    artifact_names: &[String],
    worktree_path: Option<&str>,
) -> Result<String, AgentConfigError> {
    let (template, mut context) = match &resume_type {
        ResumeType::Continue => (RESUME_CONTINUE, serde_json::json!({})),
        ResumeType::Feedback { feedback } => {
            (RESUME_FEEDBACK, serde_json::json!({ "feedback": feedback }))
        }
        ResumeType::Integration {
            message,
            conflict_files,
        } => (
            RESUME_INTEGRATION,
            serde_json::json!({
                "error_message": message,
                "conflict_files": conflict_files,
                "base_branch": base_branch,
            }),
        ),
        ResumeType::Answers { answers } => {
            (RESUME_ANSWERS, serde_json::json!({ "answers": answers }))
        }
        ResumeType::Recheck => (RESUME_RECHECK, serde_json::json!({})),
        ResumeType::RetryFailed { instructions } => (
            RESUME_RETRY_FAILED,
            serde_json::json!({ "instructions": instructions }),
        ),
        ResumeType::RetryBlocked { instructions } => (
            RESUME_RETRY_BLOCKED,
            serde_json::json!({ "instructions": instructions }),
        ),
        ResumeType::ManualResume { message } => (
            RESUME_MANUAL_RESUME,
            serde_json::json!({ "message": message }),
        ),
        ResumeType::PrComments { comments, guidance } => (
            RESUME_PR_COMMENTS,
            serde_json::json!({ "comments": comments, "guidance": guidance }),
        ),
    };

    // All resume templates need the stage name for the marker
    context["stage_name"] = serde_json::json!(stage);

    // Inject artifacts if present (using file paths, not content).
    // Use absolute paths when worktree_path is available to avoid ambiguity in nested worktrees.
    if !artifact_names.is_empty() {
        let artifact_values: Vec<serde_json::Value> = artifact_names
            .iter()
            .map(|name| {
                let file_path = match worktree_path {
                    Some(wt) => absolute_artifact_file_path(wt, name),
                    None => artifact_file_path(name),
                };
                serde_json::json!({
                    "name": name,
                    "file_path": file_path
                })
            })
            .collect();
        context["artifacts"] = serde_json::json!(artifact_values);
    }

    render_template(template, &context)
}

// -- Helpers --

/// Render a Handlebars template with the given context.
fn render_template(
    template: &str,
    context: &serde_json::Value,
) -> Result<String, AgentConfigError> {
    let reg = Handlebars::new();
    reg.render_template(template, context)
        .map_err(|e| AgentConfigError::PromptBuildError(e.to_string()))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{PrComment, ResumeQuestionAnswer};

    #[test]
    fn test_continue() {
        let artifact_names = vec!["plan".to_string()];
        let prompt = execute("work", &ResumeType::Continue, "main", &artifact_names, None).unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:continue>"));
        assert!(prompt.contains("interrupted"));
        assert!(prompt.contains("JSON"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_feedback() {
        let artifact_names = vec!["summary".to_string()];
        let prompt = execute(
            "review",
            &ResumeType::Feedback {
                feedback: "Add more error handling".to_string(),
            },
            "main",
            &artifact_names,
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:review:feedback>"));
        assert!(prompt.contains("Add more error handling"));
        assert!(prompt.contains("revision"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_integration() {
        let artifact_names = vec!["breakdown".to_string()];
        let prompt = execute(
            "work",
            &ResumeType::Integration {
                message: "Merge conflict detected".to_string(),
                conflict_files: vec!["src/main.rs".to_string(), "src/lib.rs".to_string()],
            },
            "feature/parent-branch",
            &artifact_names,
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:integration>"));
        assert!(prompt.contains("Merge conflict detected"));
        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("src/lib.rs"));
        assert!(prompt.contains("git rebase feature/parent-branch"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_answers() {
        let artifact_names = vec!["requirements".to_string()];
        let prompt = execute(
            "planning",
            &ResumeType::Answers {
                answers: vec![
                    ResumeQuestionAnswer {
                        question: "Which database?".to_string(),
                        answer: "PostgreSQL".to_string(),
                    },
                    ResumeQuestionAnswer {
                        question: "Add caching?".to_string(),
                        answer: "Yes, use Redis".to_string(),
                    },
                ],
            },
            "main",
            &artifact_names,
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:planning:answers>"));
        assert!(prompt.contains("Which database?"));
        assert!(prompt.contains("PostgreSQL"));
        assert!(prompt.contains("Add caching?"));
        assert!(prompt.contains("Yes, use Redis"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_recheck() {
        let artifact_names = vec!["summary".to_string(), "check_results".to_string()];
        let prompt = execute(
            "review",
            &ResumeType::Recheck,
            "main",
            &artifact_names,
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:review:recheck>"));
        assert!(prompt.contains("re-run"));
        assert!(prompt.contains("re-examine"));
        assert!(prompt.contains("JSON"));
        assert!(prompt.contains("Updated Input Artifacts"));
        // New format: file paths instead of inline content
        assert!(prompt.contains(".orkestra/.artifacts/summary.md"));
        assert!(prompt.contains(".orkestra/.artifacts/check_results.md"));
        // Should NOT contain inline content
        assert!(!prompt.contains("### summary"));
    }

    #[test]
    fn test_recheck_with_worktree_path() {
        let artifact_names = vec!["summary".to_string(), "check_results".to_string()];
        let worktree = "/path/to/worktree";
        let prompt = execute(
            "review",
            &ResumeType::Recheck,
            "main",
            &artifact_names,
            Some(worktree),
        )
        .unwrap();
        assert!(prompt.contains("Updated Input Artifacts"));
        // Should use absolute paths
        assert!(prompt.contains("/path/to/worktree/.orkestra/.artifacts/summary.md"));
        assert!(prompt.contains("/path/to/worktree/.orkestra/.artifacts/check_results.md"));
        // Should NOT contain relative paths
        assert!(!prompt.contains("\".orkestra/.artifacts/summary.md\""));
    }

    #[test]
    fn test_recheck_with_activity_log_artifact() {
        // Activity logs are now referenced by file path (via artifact list), not inline.
        let artifact_names = vec!["summary".to_string(), "activity_log".to_string()];
        let prompt = execute(
            "review",
            &ResumeType::Recheck,
            "main",
            &artifact_names,
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:review:recheck>"));
        assert!(prompt.contains("Updated Input Artifacts"));
        // File paths are referenced, not inline content
        assert!(prompt.contains(".orkestra/.artifacts/summary.md"));
        assert!(prompt.contains(".orkestra/.artifacts/activity_log.md"));
        // Should NOT contain old inline Activity Log section
        assert!(!prompt.contains("Prior stages have recorded the following activity"));
    }

    #[test]
    fn test_no_artifacts() {
        let prompt = execute("work", &ResumeType::Continue, "main", &[], None).unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:continue>"));
        assert!(prompt.contains("interrupted"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_manual_resume_with_message() {
        let artifact_names = vec!["plan".to_string()];
        let prompt = execute(
            "work",
            &ResumeType::ManualResume {
                message: Some("Fix the validation logic".to_string()),
            },
            "main",
            &artifact_names,
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:manual_resume>"));
        assert!(prompt.contains("interrupted by the user"));
        assert!(prompt.contains("Message from the user"));
        assert!(prompt.contains("Fix the validation logic"));
        assert!(prompt.contains("JSON"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_manual_resume_no_message() {
        let prompt = execute(
            "review",
            &ResumeType::ManualResume { message: None },
            "main",
            &[],
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:review:manual_resume>"));
        assert!(prompt.contains("interrupted by the user"));
        assert!(prompt.contains("JSON"));
        assert!(!prompt.contains("Message from the user"));
    }

    #[test]
    fn test_pr_comments() {
        let comments = vec![
            PrComment {
                author: "reviewer1".to_string(),
                path: "src/main.rs".to_string(),
                line: Some(42),
                body: "This function needs error handling".to_string(),
            },
            PrComment {
                author: "reviewer2".to_string(),
                path: "src/lib.rs".to_string(),
                line: None,
                body: "Consider adding tests for this module".to_string(),
            },
        ];
        let prompt = execute(
            "work",
            &ResumeType::PrComments {
                comments,
                guidance: Some("Focus on the error handling first".to_string()),
            },
            "main",
            &[],
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:pr_comments>"));
        assert!(prompt.contains("reviewer1"));
        assert!(prompt.contains("src/main.rs"));
        assert!(prompt.contains("line 42"));
        assert!(prompt.contains("This function needs error handling"));
        assert!(prompt.contains("reviewer2"));
        assert!(prompt.contains("src/lib.rs"));
        assert!(prompt.contains("Consider adding tests"));
        assert!(prompt.contains("Focus on the error handling first"));
    }

    #[test]
    fn test_pr_comments_no_guidance() {
        let comments = vec![PrComment {
            author: "reviewer".to_string(),
            path: "README.md".to_string(),
            line: None,
            body: "Typo in documentation".to_string(),
        }];
        let prompt = execute(
            "work",
            &ResumeType::PrComments {
                comments,
                guidance: None,
            },
            "main",
            &[],
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:pr_comments>"));
        assert!(prompt.contains("reviewer"));
        assert!(prompt.contains("README.md"));
        assert!(prompt.contains("Typo in documentation"));
        assert!(!prompt.contains("User guidance"));
    }

    #[test]
    fn test_no_system_prompt_in_resume() {
        let prompt = execute("work", &ResumeType::Continue, "main", &[], None).unwrap();

        assert!(prompt.starts_with("<!orkestra:resume:work:continue>"));
        assert!(!prompt.contains("Output Format"));
        assert!(!prompt.contains("agent definition"));
    }
}
