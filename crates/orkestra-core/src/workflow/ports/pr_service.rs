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
    /// Failed to update pull request.
    UpdateFailed(String),
    /// Failed to read pull request data.
    ReadFailed(String),
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
            Self::UpdateFailed(msg) => write!(f, "Failed to update pull request: {msg}"),
            Self::ReadFailed(msg) => write!(f, "Failed to read pull request data: {msg}"),
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

    /// Get the body/description of an existing pull request.
    ///
    /// Returns the PR body as a string. Uses the branch name to find the PR.
    fn get_pull_request_body(
        &self,
        repo_root: &std::path::Path,
        branch: &str,
    ) -> Result<String, PrError>;

    /// Update the body/description of an existing pull request.
    ///
    /// Overwrites the entire body with the new content.
    fn update_pull_request_body(
        &self,
        repo_root: &std::path::Path,
        branch: &str,
        body: &str,
    ) -> Result<(), PrError>;
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
        get_body_results: Mutex<VecDeque<Result<String, PrError>>>,
        update_body_results: Mutex<VecDeque<Result<(), PrError>>>,
        update_body_calls: Mutex<Vec<(String, String)>>,
    }

    impl MockPrService {
        /// Create a new mock PR service.
        pub fn new() -> Self {
            Self {
                results: Mutex::new(VecDeque::new()),
                get_body_results: Mutex::new(VecDeque::new()),
                update_body_results: Mutex::new(VecDeque::new()),
                update_body_calls: Mutex::new(Vec::new()),
            }
        }

        /// Set the result for the next PR creation.
        pub fn set_next_result(&self, result: Result<String, PrError>) {
            self.results.lock().unwrap().push_back(result);
        }

        /// Set the result for the next `get_pull_request_body` call.
        pub fn set_next_get_body_result(&self, result: Result<String, PrError>) {
            self.get_body_results.lock().unwrap().push_back(result);
        }

        /// Set the result for the next `update_pull_request_body` call.
        pub fn set_next_update_body_result(&self, result: Result<(), PrError>) {
            self.update_body_results.lock().unwrap().push_back(result);
        }

        /// Returns all (branch, body) pairs passed to `update_pull_request_body`.
        pub fn update_body_calls(&self) -> Vec<(String, String)> {
            self.update_body_calls.lock().unwrap().clone()
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

        fn get_pull_request_body(
            &self,
            _repo_root: &std::path::Path,
            _branch: &str,
        ) -> Result<String, PrError> {
            self.get_body_results
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok("## Summary\n\n- Default PR body".to_string()))
        }

        fn update_pull_request_body(
            &self,
            _repo_root: &std::path::Path,
            branch: &str,
            body: &str,
        ) -> Result<(), PrError> {
            self.update_body_calls
                .lock()
                .unwrap()
                .push((branch.to_string(), body.to_string()));
            self.update_body_results
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Ok(()))
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
