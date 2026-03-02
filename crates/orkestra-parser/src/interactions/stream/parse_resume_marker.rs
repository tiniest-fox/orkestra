//! Parse orkestra resume markers from user messages.

use crate::types::{ResumeMarker, ResumeMarkerType};

/// Parse a marker from a user message.
///
/// Returns `Some(ResumeMarker)` if this is an orkestra prompt, `None` otherwise.
/// Recognises `<!orkestra:spawn:STAGE>` (initial) and `<!orkestra:resume:STAGE:TYPE>` (resume).
pub fn execute(text: &str) -> Option<ResumeMarker> {
    let trimmed = text.trim();

    // All orkestra markers start with <!orkestra:
    let rest = trimmed.strip_prefix("<!orkestra:")?;
    let end_idx = rest.find('>')?;
    let tag = &rest[..end_idx];
    let content = rest[end_idx + 1..].trim().to_string();

    // Split tag by ':' → ["spawn", stage] or ["resume", stage, type]
    let parts: Vec<&str> = tag.splitn(3, ':').collect();

    match parts.as_slice() {
        ["spawn", _stage] => Some(ResumeMarker {
            marker_type: ResumeMarkerType::Initial,
            content,
        }),
        ["resume", _stage, resume_type] => {
            let marker_type = match *resume_type {
                "continue" => ResumeMarkerType::Continue,
                "feedback" => ResumeMarkerType::Feedback,
                "integration" => ResumeMarkerType::Integration,
                "answers" => ResumeMarkerType::Answers,
                "retry_failed" => ResumeMarkerType::RetryFailed,
                "retry_blocked" => ResumeMarkerType::RetryBlocked,
                "manual_resume" => ResumeMarkerType::ManualResume,
                "return_to_work" => ResumeMarkerType::ReturnToWork,
                _ => return None,
            };
            Some(ResumeMarker {
                marker_type,
                content,
            })
        }
        _ => None,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_resume_marker_typed() {
        let marker = execute("<!orkestra:resume:work:continue>\n\nContinue working");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Continue);
        assert_eq!(marker.content, "Continue working");

        let marker = execute("<!orkestra:resume:review:feedback>\n\nPlease fix this bug");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Feedback);
        assert_eq!(marker.content, "Please fix this bug");

        let marker = execute("<!orkestra:resume:work:integration>\n\nMerge conflict in file.rs");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Integration);
        assert_eq!(marker.content, "Merge conflict in file.rs");
    }

    #[test]
    fn test_parse_resume_marker_unrecognized_returns_none() {
        assert!(execute("Fix the bug please").is_none());
        assert!(execute("# Worker Agent\nDo stuff").is_none());
        assert!(execute("").is_none());
    }

    #[test]
    fn test_parse_resume_marker_answers() {
        let marker = execute(
            "<!orkestra:resume:planning:answers>\n\nHere are the answers:\n\nQ: What? A: Something",
        );
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Answers);
        assert!(marker.content.contains("answers"));
    }

    #[test]
    fn test_resume_marker_type_as_str() {
        assert_eq!(ResumeMarkerType::Continue.as_str(), "continue");
        assert_eq!(ResumeMarkerType::Feedback.as_str(), "feedback");
        assert_eq!(ResumeMarkerType::Integration.as_str(), "integration");
        assert_eq!(ResumeMarkerType::Answers.as_str(), "answers");
        assert_eq!(ResumeMarkerType::RetryFailed.as_str(), "retry_failed");
        assert_eq!(ResumeMarkerType::RetryBlocked.as_str(), "retry_blocked");
        assert_eq!(ResumeMarkerType::Initial.as_str(), "initial");
        assert_eq!(ResumeMarkerType::ManualResume.as_str(), "manual_resume");
        assert_eq!(ResumeMarkerType::ReturnToWork.as_str(), "return_to_work");
    }

    #[test]
    fn test_parse_resume_marker_spawn() {
        let marker = execute("<!orkestra:spawn:review>\n\n# Reviewer Agent\n\nYou review code...");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::Initial);
        assert!(marker.content.starts_with("# Reviewer Agent"));
    }

    #[test]
    fn test_parse_resume_marker_retry_failed() {
        let marker =
            execute("<!orkestra:resume:work:retry_failed>\n\nRetrying after task failure.");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::RetryFailed);
        assert!(marker.content.contains("failure"));
    }

    #[test]
    fn test_parse_resume_marker_retry_blocked() {
        let marker =
            execute("<!orkestra:resume:work:retry_blocked>\n\nRetrying after task was blocked.");
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::RetryBlocked);
        assert!(marker.content.contains("blocked"));
    }

    #[test]
    fn test_parse_resume_marker_manual_resume() {
        let marker = execute(
            "<!orkestra:resume:work:manual_resume>\n\nMessage from the user:\n\nPlease fix the bug",
        );
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::ManualResume);
        assert!(marker.content.contains("Message from the user"));
    }

    #[test]
    fn test_parse_resume_marker_return_to_work() {
        let marker = execute(
            "<!orkestra:resume:work:return_to_work>\n\n# Worker Agent\n\nReturn to work prompt",
        );
        assert!(marker.is_some());
        let marker = marker.unwrap();
        assert_eq!(marker.marker_type, ResumeMarkerType::ReturnToWork);
        assert!(marker.content.contains("Return to work prompt"));
    }
}
