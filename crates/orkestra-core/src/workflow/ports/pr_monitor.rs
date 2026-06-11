//! PR monitoring service for auto-resolve.

use std::path::Path;

use super::pr_service::PrError;

/// A failed or concluded CI check run on a PR.
pub struct AutoResolveCheckRun {
    pub id: i64,
    pub name: String,
    pub log_excerpt: Option<String>,
}

/// A review comment on a PR.
pub struct AutoResolveComment {
    pub id: i64,
    pub author: String,
    pub body: String,
    pub path: Option<String>,
    pub line: Option<u32>,
}

/// A review submitted on a PR.
pub struct AutoResolveReview {
    pub id: i64,
    pub author: String,
    pub state: String, // APPROVED, CHANGES_REQUESTED, COMMENTED, etc.
}

/// Current PR feedback status fetched for auto-resolve monitoring.
pub struct AutoResolveStatus {
    pub pr_state: String, // OPEN, CLOSED, MERGED
    pub failed_checks: Vec<AutoResolveCheckRun>,
    pub comments: Vec<AutoResolveComment>,
    pub reviews: Vec<AutoResolveReview>,
    pub all_checks_concluded: bool,
}

/// Service for monitoring pull request feedback for auto-resolve.
pub trait PrMonitor: Send + Sync {
    /// Return the GitHub login of the authenticated user (for self-comment filtering).
    fn authenticated_user(&self) -> Result<String, PrError>;

    /// Fetch PR feedback status for auto-resolve monitoring.
    fn fetch_auto_resolve_status(
        &self,
        repo_root: &Path,
        pr_url: &str,
    ) -> Result<AutoResolveStatus, PrError>;
}

// =============================================================================
// Mock Implementation for Testing
// =============================================================================

#[cfg(any(test, feature = "testutil"))]
pub mod mock {
    use super::{AutoResolveStatus, PrError, PrMonitor};
    use std::collections::VecDeque;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    };

    /// Mock PR monitor for testing.
    pub struct MockPrMonitor {
        authenticated_user: Mutex<String>,
        statuses: Mutex<VecDeque<Result<AutoResolveStatus, PrError>>>,
        call_count: AtomicUsize,
    }

    impl MockPrMonitor {
        /// Create a new mock PR monitor.
        pub fn new() -> Self {
            Self {
                authenticated_user: Mutex::new("test-bot".to_string()),
                statuses: Mutex::new(VecDeque::new()),
                call_count: AtomicUsize::new(0),
            }
        }

        /// Set the authenticated user login.
        pub fn set_authenticated_user(&self, login: &str) {
            *self.authenticated_user.lock().unwrap() = login.to_string();
        }

        /// Queue the next status to be returned by `fetch_auto_resolve_status`.
        pub fn set_next_status(&self, status: AutoResolveStatus) {
            self.statuses.lock().unwrap().push_back(Ok(status));
        }

        /// Number of times `fetch_auto_resolve_status` has been called.
        pub fn call_count(&self) -> usize {
            self.call_count.load(Ordering::SeqCst)
        }
    }

    impl Default for MockPrMonitor {
        fn default() -> Self {
            Self::new()
        }
    }

    impl PrMonitor for MockPrMonitor {
        fn authenticated_user(&self) -> Result<String, PrError> {
            Ok(self.authenticated_user.lock().unwrap().clone())
        }

        fn fetch_auto_resolve_status(
            &self,
            _repo_root: &std::path::Path,
            _pr_url: &str,
        ) -> Result<AutoResolveStatus, PrError> {
            self.call_count.fetch_add(1, Ordering::SeqCst);
            self.statuses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| {
                    Ok(AutoResolveStatus {
                        pr_state: "OPEN".to_string(),
                        failed_checks: Vec::new(),
                        comments: Vec::new(),
                        reviews: Vec::new(),
                        all_checks_concluded: true,
                    })
                })
        }
    }
}
