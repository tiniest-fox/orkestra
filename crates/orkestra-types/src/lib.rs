//! Shared domain and runtime types for the Orkestra workflow system.
//!
//! This crate contains the core type definitions used across orkestra crates:
//! domain types (Task, Iteration, etc.) and runtime types (Phase, Status, etc.).
//! It has no I/O or storage dependencies — just data structures and their logic.

pub mod config;
pub mod domain;
pub mod runtime;
