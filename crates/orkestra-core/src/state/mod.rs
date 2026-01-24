//! State management module - SINGLE SOURCE OF TRUTH for task state.
//!
//! This module consolidates all state-related logic:
//! - `phase`: The `TaskPhase` enum for explicit phase tracking
//! - `predicates`: Pure functions for checking task state
//!
//! # Usage
//!
//! ```rust,ignore
//! use orkestra_core::state::{TaskPhase, predicates};
//!
//! // Check if task needs human review
//! if predicates::needs_human_review(&task, current_iter.as_ref()) {
//!     // Show in review queue
//! }
//!
//! // Check if we should spawn an agent
//! if predicates::should_spawn_worker(&task) {
//!     // Spawn worker agent
//! }
//! ```
//!
//! # Design Principles
//!
//! 1. **Explicit over implicit**: Use `TaskPhase` instead of inferring from fields.
//! 2. **Pure functions**: Predicates have no side effects and are easily testable.
//! 3. **Single source of truth**: All state checks go through this module.

mod phase;
pub mod predicates;

pub use phase::TaskPhase;
pub use predicates::NeedsReview;
