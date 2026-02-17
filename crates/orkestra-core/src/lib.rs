// Suppress pedantic clippy warnings we're not addressing yet
#![allow(clippy::missing_errors_doc)]
#![allow(clippy::must_use_candidate)]

// Core modules - new workflow system
pub mod adapters;
pub mod commit_message;
pub mod debug_log;
pub mod init;
pub mod pr_description;
pub mod process;
pub mod project;
pub mod prompts;
pub mod title;
pub mod utility;
pub mod workflow;

// Test utilities (available for integration tests)
#[cfg(any(test, feature = "testutil"))]
pub mod testutil;

// Title generation
#[cfg(any(test, feature = "testutil"))]
pub use title::mock::MockTitleGenerator;
pub use title::{generate_title_sync, ClaudeTitleGenerator, TitleGenerator};

// Commit message generation
#[cfg(any(test, feature = "testutil"))]
pub use commit_message::mock::MockCommitMessageGenerator;
pub use commit_message::{ClaudeCommitMessageGenerator, CommitMessageGenerator};

// PR description generation
#[cfg(any(test, feature = "testutil"))]
pub use pr_description::mock::MockPrDescriptionGenerator;
pub use pr_description::{ClaudePrDescriptionGenerator, PrDescriptionGenerator};

// Process infrastructure re-exports
pub use process::{is_process_running, kill_process_tree, ParsedStreamEvent, ProcessGuard};

// Init re-exports
pub use init::ensure_orkestra_project;

// Project discovery re-exports
pub use project::{find_project_root, get_orkestra_dir};
