//! GitHub check status classification.

/// Normalized check status categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckStatus {
    Success,
    Failure,
    Pending,
    Skipped,
}

impl CheckStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Failure => "failure",
            Self::Pending => "pending",
            Self::Skipped => "skipped",
        }
    }

    pub fn is_failing(&self) -> bool {
        matches!(self, Self::Failure)
    }
}

/// Classify a GitHub check's status and conclusion into a normalized category.
pub fn classify_check(status: Option<&str>, conclusion: Option<&str>) -> CheckStatus {
    match status {
        Some(s) if s.eq_ignore_ascii_case("COMPLETED") => match conclusion {
            Some(c) if c.eq_ignore_ascii_case("SUCCESS") => CheckStatus::Success,
            Some(c)
                if c.eq_ignore_ascii_case("FAILURE")
                    || c.eq_ignore_ascii_case("TIMED_OUT")
                    || c.eq_ignore_ascii_case("CANCELLED")
                    || c.eq_ignore_ascii_case("ACTION_REQUIRED") =>
            {
                CheckStatus::Failure
            }
            Some(c) if c.eq_ignore_ascii_case("SKIPPED") || c.eq_ignore_ascii_case("NEUTRAL") => {
                CheckStatus::Skipped
            }
            _ => CheckStatus::Pending,
        },
        Some(s) if s.eq_ignore_ascii_case("SKIPPED") => CheckStatus::Skipped,
        _ => CheckStatus::Pending,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_check_completed_success() {
        assert_eq!(
            classify_check(Some("COMPLETED"), Some("SUCCESS")),
            CheckStatus::Success
        );
        assert_eq!(
            classify_check(Some("completed"), Some("success")),
            CheckStatus::Success
        );
    }

    #[test]
    fn classify_check_completed_failure_variants() {
        assert_eq!(
            classify_check(Some("COMPLETED"), Some("FAILURE")),
            CheckStatus::Failure
        );
        assert_eq!(
            classify_check(Some("COMPLETED"), Some("TIMED_OUT")),
            CheckStatus::Failure
        );
        assert_eq!(
            classify_check(Some("COMPLETED"), Some("CANCELLED")),
            CheckStatus::Failure
        );
        assert_eq!(
            classify_check(Some("COMPLETED"), Some("ACTION_REQUIRED")),
            CheckStatus::Failure
        );
    }

    #[test]
    fn classify_check_skipped_via_conclusion() {
        assert_eq!(
            classify_check(Some("COMPLETED"), Some("SKIPPED")),
            CheckStatus::Skipped
        );
        assert_eq!(
            classify_check(Some("COMPLETED"), Some("NEUTRAL")),
            CheckStatus::Skipped
        );
    }

    #[test]
    fn classify_check_skipped_via_status() {
        assert_eq!(classify_check(Some("SKIPPED"), None), CheckStatus::Skipped);
    }

    #[test]
    fn classify_check_pending_states() {
        assert_eq!(classify_check(Some("QUEUED"), None), CheckStatus::Pending);
        assert_eq!(
            classify_check(Some("IN_PROGRESS"), None),
            CheckStatus::Pending
        );
        assert_eq!(classify_check(Some("WAITING"), None), CheckStatus::Pending);
        assert_eq!(classify_check(Some("PENDING"), None), CheckStatus::Pending);
        assert_eq!(
            classify_check(Some("REQUESTED"), None),
            CheckStatus::Pending
        );
        assert_eq!(classify_check(None, None), CheckStatus::Pending);
    }

    #[test]
    fn classify_check_completed_with_unknown_conclusion() {
        assert_eq!(
            classify_check(Some("COMPLETED"), Some("UNKNOWN")),
            CheckStatus::Pending
        );
        assert_eq!(
            classify_check(Some("COMPLETED"), None),
            CheckStatus::Pending
        );
    }

    #[test]
    fn check_status_as_str() {
        assert_eq!(CheckStatus::Success.as_str(), "success");
        assert_eq!(CheckStatus::Failure.as_str(), "failure");
        assert_eq!(CheckStatus::Pending.as_str(), "pending");
        assert_eq!(CheckStatus::Skipped.as_str(), "skipped");
    }

    #[test]
    fn check_status_is_failing() {
        assert!(CheckStatus::Failure.is_failing());
        assert!(!CheckStatus::Success.is_failing());
        assert!(!CheckStatus::Pending.is_failing());
        assert!(!CheckStatus::Skipped.is_failing());
    }
}
