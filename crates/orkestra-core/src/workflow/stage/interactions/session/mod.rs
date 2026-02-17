//! Session lifecycle interactions: spawn context, agent tracking, stage transitions.

pub mod get_running_agents;
pub mod mark_trigger_delivered;
pub mod on_agent_exited;
pub mod on_agent_spawned;
pub mod on_spawn_failed;
pub mod on_spawn_starting;
pub mod on_stage_abandoned;
pub mod on_stage_completed;
pub mod supersede_session;
