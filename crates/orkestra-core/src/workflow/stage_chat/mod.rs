//! Stage chat: free-form conversation with stage agents during review or interruption.
pub mod api;
pub(crate) mod interactions;
pub use interactions::send_message::CHAT_RESUME_TYPE;
