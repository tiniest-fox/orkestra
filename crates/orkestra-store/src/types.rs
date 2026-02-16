//! SQL serialization helpers for domain enums.
//!
//! Converts between Rust domain types and their string representations
//! used in `SQLite` columns.

use orkestra_types::domain::SessionState;
use orkestra_types::runtime::Phase;

/// Convert a `Phase` to its database string representation.
pub fn phase_to_str(phase: Phase) -> &'static str {
    match phase {
        Phase::AwaitingSetup => "awaiting_setup",
        Phase::SettingUp => "setting_up",
        Phase::Idle => "idle",
        Phase::AgentWorking => "agent_working",
        Phase::AwaitingReview => "awaiting_review",
        Phase::Interrupted => "interrupted",
        Phase::Integrating => "integrating",
        Phase::Finishing => "finishing",
        Phase::Committing => "committing",
        Phase::Finished => "finished",
    }
}

/// Parse a `Phase` from its database string representation.
pub fn parse_phase(s: &str) -> rusqlite::Result<Phase> {
    match s {
        "idle" => Ok(Phase::Idle),
        "awaiting_setup" => Ok(Phase::AwaitingSetup),
        "setting_up" => Ok(Phase::SettingUp),
        "agent_working" => Ok(Phase::AgentWorking),
        "awaiting_review" => Ok(Phase::AwaitingReview),
        "interrupted" => Ok(Phase::Interrupted),
        "integrating" => Ok(Phase::Integrating),
        "finishing" => Ok(Phase::Finishing),
        "committing" => Ok(Phase::Committing),
        "finished" => Ok(Phase::Finished),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            format!("unknown phase in database: '{s}'").into(),
        )),
    }
}

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
