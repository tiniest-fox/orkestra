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
                "integration" => ResumeMarkerType::Integration,
                "answers" => ResumeMarkerType::Answers,
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
        // Removed variants fall through to _ => None
        assert!(execute("<!orkestra:resume:review:feedback>\n\nPlease fix this bug").is_none());
        // user_message marker is no longer emitted — raw text is used instead
        assert!(execute("<!orkestra:resume:work:user_message>\n\nFix the bug").is_none());
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
        assert_eq!(ResumeMarkerType::Integration.as_str(), "integration");
        assert_eq!(ResumeMarkerType::Answers.as_str(), "answers");
        assert_eq!(ResumeMarkerType::Initial.as_str(), "initial");
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
    fn test_parse_resume_marker_manual_resume_returns_none() {
        let marker = execute(
            "<!orkestra:resume:work:manual_resume>\n\nMessage from the user:\n\nPlease fix the bug",
        );
        assert!(marker.is_none());
    }
}
