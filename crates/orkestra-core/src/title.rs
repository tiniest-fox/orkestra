//! Title generation — re-exported from `orkestra-utility`.

pub use orkestra_utility::title::*;

#[cfg(any(test, feature = "testutil"))]
pub use orkestra_utility::title::mock;
