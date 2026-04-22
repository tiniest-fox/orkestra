//! Resume prompt construction.
//!
//! Builds short resume prompts for session continuation.

use handlebars::Handlebars;
use orkestra_types::runtime::resolve_artifact_path;

use crate::types::{AgentConfigError, ResumeType};

// ============================================================================
// Template Constants
// ============================================================================

const RESUME_CONTINUE: &str = include_str!("../../templates/resume/continue.md");
const RESUME_INTEGRATION: &str = include_str!("../../templates/resume/integration.md");
const RESUME_ANSWERS: &str = include_str!("../../templates/resume/answers.md");
const RESUME_PR_COMMENTS: &str = include_str!("../../templates/resume/pr_comments.md");
const RESUME_MALFORMED_OUTPUT: &str = include_str!("../../templates/resume/malformed_output.md");
const RESUME_GATE_FAILURE: &str = include_str!("../../templates/resume/gate_failure.md");

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
        ResumeType::PrComments {
            comments,
            checks,
            guidance,
        } => (
            RESUME_PR_COMMENTS,
            serde_json::json!({ "comments": comments, "checks": checks, "guidance": guidance }),
        ),
        ResumeType::MalformedOutput {
            error,
            attempt,
            max_attempts,
            compact_schema,
        } => (
            RESUME_MALFORMED_OUTPUT,
            serde_json::json!({
                "error": error,
                "attempt": attempt,
                "max_attempts": max_attempts,
                "compact_schema": compact_schema
            }),
        ),
        ResumeType::GateFailure { error } => {
            (RESUME_GATE_FAILURE, serde_json::json!({ "error": error }))
        }
        ResumeType::UserMessage { message } => return Ok(message.clone()),
    };

    // All resume templates need the stage name for the marker
    context["stage_name"] = serde_json::json!(stage);

    // Inject artifacts if present (using file paths, not content).
    // Use absolute paths when worktree_path is available to avoid ambiguity in nested worktrees.
    if !artifact_names.is_empty() {
        let artifact_values: Vec<serde_json::Value> = artifact_names
            .iter()
            .map(|name| {
                let file_path = resolve_artifact_path(worktree_path, name);
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
    use crate::types::{PrCheckContext, PrComment, ResumeQuestionAnswer};

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
        assert!(prompt.contains("merge is in progress"));
        assert!(!prompt.contains("Updated Input Artifacts"));
    }

    #[test]
    fn test_integration_pr_path_empty_conflict_files() {
        let artifact_names = vec!["breakdown".to_string()];
        let prompt = execute(
            "work",
            &ResumeType::Integration {
                message: "PR has merge conflicts".to_string(),
                conflict_files: vec![],
            },
            "main",
            &artifact_names,
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:integration>"));
        assert!(prompt.contains("PR has merge conflicts"));
        assert!(!prompt.contains("merge is in progress"));
        assert!(prompt.contains("git fetch origin && git merge origin/main"));
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
    fn test_no_artifacts() {
        let prompt = execute("work", &ResumeType::Continue, "main", &[], None).unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:continue>"));
        assert!(prompt.contains("interrupted"));
        assert!(!prompt.contains("Updated Input Artifacts"));
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
                checks: vec![],
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
                checks: vec![],
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
    fn test_pr_checks_only() {
        let checks = vec![
            PrCheckContext {
                name: "CI / build".to_string(),
                log_excerpt: Some("3 tests failed".to_string()),
            },
            PrCheckContext {
                name: "CI / lint".to_string(),
                log_excerpt: None,
            },
        ];
        let prompt = execute(
            "work",
            &ResumeType::PrComments {
                comments: vec![],
                checks,
                guidance: None,
            },
            "main",
            &[],
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:pr_comments>"));
        assert!(prompt.contains("CI / build"));
        assert!(prompt.contains("3 tests failed"));
        assert!(prompt.contains("CI / lint"));
        assert!(prompt.contains("No failure details available."));
        assert!(!prompt.contains("PR Comments"));
    }

    #[test]
    fn test_pr_comments_and_checks() {
        let comments = vec![PrComment {
            author: "reviewer".to_string(),
            path: "src/main.rs".to_string(),
            line: Some(10),
            body: "Fix this".to_string(),
        }];
        let checks = vec![PrCheckContext {
            name: "CI / build".to_string(),
            log_excerpt: Some("Build failed".to_string()),
        }];
        let prompt = execute(
            "work",
            &ResumeType::PrComments {
                comments,
                checks,
                guidance: Some("Address both".to_string()),
            },
            "main",
            &[],
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:pr_comments>"));
        assert!(prompt.contains("PR Comments"));
        assert!(prompt.contains("Failed CI Checks"));
        assert!(prompt.contains("Fix this"));
        assert!(prompt.contains("Build failed"));
        assert!(prompt.contains("Address both"));
    }

    #[test]
    fn test_malformed_output_resume_prompt() {
        let prompt = execute(
            "work",
            &ResumeType::MalformedOutput {
                error: "no structured output found".to_string(),
                attempt: 2,
                max_attempts: 4,
                compact_schema: Some("{\"type\":\"object\"}".to_string()),
            },
            "main",
            &[],
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:malformed_output>"));
        assert!(prompt.contains("attempt 2 of 4"));
        assert!(prompt.contains("no structured output found"));
        assert!(prompt.contains("```ork"));
        assert!(prompt.contains("JSON Schema Reference"));
        assert!(prompt.contains("{\"type\":\"object\"}"));
    }

    #[test]
    fn test_malformed_output_resume_prompt_no_schema() {
        let prompt = execute(
            "work",
            &ResumeType::MalformedOutput {
                error: "no structured output found".to_string(),
                attempt: 1,
                max_attempts: 4,
                compact_schema: None,
            },
            "main",
            &[],
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:malformed_output>"));
        assert!(prompt.contains("attempt 1 of 4"));
        assert!(!prompt.contains("JSON Schema Reference"));
    }

    #[test]
    fn test_gate_failure() {
        let prompt = execute(
            "work",
            &ResumeType::GateFailure {
                error: "lint failed".to_string(),
            },
            "main",
            &[],
            None,
        )
        .unwrap();
        assert!(prompt.starts_with("<!orkestra:resume:work:gate_failure>"));
        assert!(prompt.contains("lint failed"));
        assert!(prompt.contains("Fix the issues"));
    }

    #[test]
    fn test_user_message_resume() {
        let prompt = execute(
            "work",
            &ResumeType::UserMessage {
                message: "Please also add error handling for the edge case".to_string(),
            },
            "main",
            &[],
            None,
        )
        .unwrap();
        assert_eq!(prompt, "Please also add error handling for the edge case");
    }

    #[test]
    fn test_no_system_prompt_in_resume() {
        let prompt = execute("work", &ResumeType::Continue, "main", &[], None).unwrap();

        assert!(prompt.starts_with("<!orkestra:resume:work:continue>"));
        assert!(!prompt.contains("Output Format"));
        assert!(!prompt.contains("agent definition"));
    }
}
