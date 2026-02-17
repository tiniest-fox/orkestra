//! SQL serialization helpers for domain enums.
//!
//! Converts between Rust domain types and their string representations
//! used in `SQLite` columns.

use orkestra_types::domain::SessionState;

/// Convert a `SessionState` to its database string representation.
pub fn session_state_to_str(state: SessionState) -> &'static str {
    match state {
        SessionState::Spawning => "spawning",
        SessionState::Active => "active",
        SessionState::Completed => "completed",
        SessionState::Abandoned => "abandoned",
        SessionState::Superseded => "superseded",
    }
}

/// Parse a `SessionState` from its database string representation.
pub fn parse_session_state(s: &str) -> SessionState {
    match s {
        "spawning" => SessionState::Spawning,
        "completed" => SessionState::Completed,
        "abandoned" => SessionState::Abandoned,
        "superseded" => SessionState::Superseded,
        _ => SessionState::Active,
    }
}
