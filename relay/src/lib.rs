//! orkestra-relay — stateless WebSocket relay server library.
//!
//! Exposes server startup and protocol types for use in integration tests
//! and the sibling `orkestra-networking` relay client.

pub(crate) mod connection;
pub(crate) mod handler;
pub mod server;
pub mod types;
