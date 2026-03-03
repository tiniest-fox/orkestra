//! WebSocket networking layer for Orkestra daemon connections.
//!
//! Provides a WebSocket server (`server::start`) and the protocol types
//! (`types`) used for client-server communication. Business logic lives in
//! `interactions`, following the project's module structure conventions.

pub(crate) mod diff_cache;
pub(crate) mod diff_types;
pub(crate) mod highlight;
pub mod interactions;
pub mod server;
pub mod types;

pub use interactions::command::query::fetch_pr_status;
pub use server::start;
pub use types::{
    AuthError, ErrorPayload, ErrorResponse, Event, PairedDevice, PrCheck, PrComment, PrReview,
    PrStatus, Request, Response,
};
