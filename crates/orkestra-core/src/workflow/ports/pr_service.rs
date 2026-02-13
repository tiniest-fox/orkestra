//! Pull request creation service.

use std::fmt;

/// Error type for PR creation operations.
#[derive(Debug, Clone)]
pub enum PrError {
    /// Push to remote failed.
    PushFailed(String),
    /// PR creation failed (gh CLI error, auth, permissions).
    CreationFailed(String),
    /// gh CLI not found.
    CliNotFound,
}

impl fmt::Display for PrError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PushFailed(msg) => write!(f, "Failed to push branch: {msg}"),
            Self::CreationFailed(msg) => write!(f, "Failed to create pull request: {msg}"),
            Self::CliNotFound => write!(
                f,
                "gh CLI not found (install GitHub CLI: https://cli.github.com/)"
            ),
        }
    }
}

impl std::error::Error for PrError {}

/// Service for creating pull requests on a remote hosting platform.
pub trait PrService: Send + Sync {
    /// Create a pull request for the given branch.
    ///
    /// Returns the PR URL on success. If a PR already exists for this branch,
    /// returns the existing PR's URL (idempotent for crash recovery).
    fn create_pull_request(
        &self,
        repo_root: &std::path::Path,
        branch: &str,
        base: &str,
        title: &str,
        body: &str,
    ) -> Result<String, PrError>;
}

// =============================================================================
// Mock Implementation for Testing
// =============================================================================

#[cfg(any(test, feature = "testutil"))]
pub mod mock {
    use super::PrError;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// Mock PR service for testing.
    pub struct MockPrService {
        results: Mutex<VecDeque<Result<String, PrError>>>,
    }

    impl MockPrService {
        /// Create a new mock PR service.
        pub fn new() -> Self {
            Self {
                results: Mutex::new(VecDeque::new()),
            }
        }

        /// Set the result for the next PR creation.
        pub fn set_next_result(&self, result: Result<String, PrError>) {
            self.results.lock().unwrap().push_back(result);
        }
    }

    impl Default for MockPrService {
        fn default() -> Self {
            Self::new()
        }
    }

    impl super::PrService for MockPrService {
        fn create_pull_request(
            &self,
            _repo_root: &std::path::Path,
            _branch: &str,
            _base: &str,
            _title: &str,
            _body: &str,
        ) -> Result<String, PrError> {
            self.results
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok("https://github.com/test/repo/pull/1".to_string()))
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::workflow::ports::PrService;

        #[test]
        fn test_mock_default_success() {
            let mock = MockPrService::new();
            let url = mock
                .create_pull_request(
                    std::path::Path::new("/test"),
                    "feature-branch",
                    "main",
                    "Test PR",
                    "Test body",
                )
                .unwrap();
            assert!(url.contains("github.com"));
        }

        #[test]
        fn test_mock_configured_result() {
            let mock = MockPrService::new();
            mock.set_next_result(Ok("https://github.com/custom/repo/pull/42".to_string()));

            let url = mock
                .create_pull_request(
                    std::path::Path::new("/test"),
                    "feature-branch",
                    "main",
                    "Test PR",
                    "Test body",
                )
                .unwrap();
            assert_eq!(url, "https://github.com/custom/repo/pull/42");
        }

        #[test]
        fn test_mock_configured_error() {
            let mock = MockPrService::new();
            mock.set_next_result(Err(PrError::CliNotFound));

            let result = mock.create_pull_request(
                std::path::Path::new("/test"),
                "feature-branch",
                "main",
                "Test PR",
                "Test body",
            );
            assert!(result.is_err());
            assert!(matches!(result.unwrap_err(), PrError::CliNotFound));
        }
    }
}
