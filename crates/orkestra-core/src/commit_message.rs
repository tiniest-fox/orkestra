//! Commit message generation — re-exported from `orkestra-utility`.

pub use orkestra_utility::commit_message::*;

#[cfg(any(test, feature = "testutil"))]
pub use orkestra_utility::commit_message::mock;
