//! Per-project resource limit interactions: host detection, resolution, DB read/write.

pub mod detect_host;
pub mod get;
pub mod resolve;
pub mod set;

/// Minimum allowed CPU limit (cores).
pub const MIN_CPU_LIMIT: f64 = 1.0;

/// Minimum allowed memory limit (MB).
pub const MIN_MEMORY_LIMIT_MB: i64 = 512;
