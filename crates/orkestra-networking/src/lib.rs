//! WebSocket networking layer for Orkestra daemon connections.
//!
//! Provides a WebSocket server (`server::start`) and the protocol types
//! (`types`) used for client-server communication. Business logic lives in
//! `interactions`, following the project's module structure conventions.

pub(crate) mod diff_cache;
pub(crate) mod diff_types;
pub(crate) mod highlight;
pub(crate) mod interactions;
pub mod relay_client;
pub mod server;
pub mod types;

pub use axum::http::HeaderValue;
pub use interactions::auth::{
    generate_pairing_code, list_devices, pair_device, revoke_device, verify_token,
};
pub use interactions::command::dispatch::CommandContext;
pub use interactions::command::registry;
pub use interactions::command::{action, assistant, git, interactive, query, stage_chat, task};
pub use interactions::event::broadcast::execute as convert_orchestrator_event;
// NOTE: Re-exported for src-tauri, which reuses the same GitHub CLI integration
// rather than duplicating the ~160-line fetch + parse logic.
pub use interactions::command::query::fetch_pr_status;
pub use relay_client::{RelayClientConfig, RelayClientError};
pub use server::start;
pub use types::{
    AuthError, ErrorPayload, ErrorResponse, Event, PairedDevice, PrCheck, PrComment, PrReview,
    PrStatus, Request, Response,
};
