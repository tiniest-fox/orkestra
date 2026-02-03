//! Periodic task scheduler for the orchestrator loop.
//!
//! Tracks named tasks with configurable intervals. Registration order
//! defines execution order within a single `poll_due` call.

use std::time::{Duration, Instant};

struct ScheduledTask {
    name: &'static str,
    interval: Duration,
    last_run: Instant,
}

/// A simple scheduler that tracks named tasks with intervals.
///
/// Tasks are returned in registration order when polled.
pub struct PeriodicScheduler {
    tasks: Vec<ScheduledTask>,
}

impl PeriodicScheduler {
    pub fn new() -> Self {
        Self { tasks: Vec::new() }
    }

    /// Register a task that should run at the given interval.
    ///
    /// The task runs immediately on the first `poll_due` call (`last_run` starts
    /// far enough in the past to be immediately due).
    pub fn register(&mut self, name: &'static str, interval: Duration) {
        self.tasks.push(ScheduledTask {
            name,
            interval,
            // Ensure first poll triggers immediately
            last_run: Instant::now().checked_sub(interval).unwrap_or_else(Instant::now),
        });
    }

    /// Returns names of tasks that are due, in registration order.
    ///
    /// Resets the timer for each returned task.
    pub fn poll_due(&mut self) -> Vec<&'static str> {
        let now = Instant::now();
        let mut due = Vec::new();

        for task in &mut self.tasks {
            if now.duration_since(task.last_run) >= task.interval {
                due.push(task.name);
                task.last_run = now;
            }
        }

        due
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_tasks_due_on_first_poll() {
        let mut scheduler = PeriodicScheduler::new();
        scheduler.register("fast", Duration::from_millis(100));
        scheduler.register("slow", Duration::from_secs(60));

        let due = scheduler.poll_due();
        assert_eq!(due, vec!["fast", "slow"]);
    }

    #[test]
    fn test_tasks_not_due_immediately_after_poll() {
        let mut scheduler = PeriodicScheduler::new();
        scheduler.register("task_a", Duration::from_secs(60));

        // First poll: due
        assert_eq!(scheduler.poll_due(), vec!["task_a"]);

        // Immediate second poll: not due
        assert!(scheduler.poll_due().is_empty());
    }

    #[test]
    fn test_registration_order_preserved() {
        let mut scheduler = PeriodicScheduler::new();
        scheduler.register("third", Duration::from_millis(10));
        scheduler.register("first", Duration::from_millis(10));
        scheduler.register("second", Duration::from_millis(10));

        let due = scheduler.poll_due();
        assert_eq!(due, vec!["third", "first", "second"]);
    }

    #[test]
    fn test_mixed_intervals() {
        let mut scheduler = PeriodicScheduler::new();
        scheduler.register("fast", Duration::from_millis(1));
        scheduler.register("slow", Duration::from_secs(60));

        // First poll: both due
        let due = scheduler.poll_due();
        assert_eq!(due, vec!["fast", "slow"]);

        // Sleep long enough for "fast" but not "slow"
        std::thread::sleep(Duration::from_millis(5));

        let due = scheduler.poll_due();
        assert_eq!(due, vec!["fast"]);
    }

    #[test]
    fn test_empty_scheduler() {
        let mut scheduler = PeriodicScheduler::new();
        assert!(scheduler.poll_due().is_empty());
    }
}
