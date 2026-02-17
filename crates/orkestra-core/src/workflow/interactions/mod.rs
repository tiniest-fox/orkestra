//! Business logic interactions for workflow operations.
//!
//! Each interaction is a free function with `execute()` as the entry point,
//! taking explicit dependencies. Interactions compose other interactions
//! via `super::domain::action::execute()`.

pub mod agent;
pub mod human;
pub mod integration;
pub mod query;
pub mod stage;
pub mod task;
