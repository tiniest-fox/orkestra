//! PR description generation — re-exported from `orkestra-utility`.

pub use orkestra_utility::pr_description::*;

#[cfg(any(test, feature = "testutil"))]
pub use orkestra_utility::pr_description::mock;
