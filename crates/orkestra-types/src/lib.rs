//! Shared domain and runtime types for the Orkestra workflow system.
//!
//! This crate contains the core type definitions used across orkestra crates:
//! domain types (Task, Iteration, etc.), runtime types (`TaskState`, etc.),
//! and shared utilities like [`domain::compute_transcript_path`].
//! It has no I/O or storage dependencies — just data structures and their logic.

pub mod config;
pub mod domain;
pub mod runtime;
