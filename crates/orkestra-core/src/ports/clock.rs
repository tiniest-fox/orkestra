/// Abstraction over system time.
///
/// This trait allows services to work with time in a testable way.
/// In tests, a fixed clock can be used for deterministic behavior.
pub trait Clock: Send + Sync {
    /// Get the current time as an RFC 3339 formatted string.
    fn now_rfc3339(&self) -> String;
}
