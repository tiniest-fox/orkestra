//! Spawn a background thread to collect stderr output.

use std::io::BufRead;
use std::process::ChildStderr;
use std::thread::JoinHandle;

/// Spawn a thread to read stderr and collect lines.
pub fn execute(stderr: Option<ChildStderr>) -> Option<JoinHandle<Vec<String>>> {
    stderr.map(|stderr| {
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stderr);
            let mut lines = Vec::new();
            for line in reader.lines().map_while(std::result::Result::ok) {
                lines.push(line);
            }
            lines
        })
    })
}
