//! Session lifecycle interactions: spawn context, agent tracking, stage transitions.

pub mod mark_trigger_delivered;
pub mod on_agent_spawned;
pub mod on_spawn_failed;
pub mod on_spawn_starting;
pub mod should_supersede;
pub mod supersede_session;
