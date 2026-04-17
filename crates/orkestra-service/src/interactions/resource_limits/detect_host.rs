//! Detect host CPU count and total memory for default resource limit calculation.

/// Return `(cpu_count, memory_mb)` for the host machine.
///
/// CPU count uses `num_cpus::get()` (cross-platform). Memory detection is
/// platform-native: `sysctl hw.memsize` on macOS, `/proc/meminfo` on Linux.
/// Returns `(1, 4096)` as a conservative fallback if detection fails.
pub fn execute() -> (usize, u64) {
    let cpu_count = num_cpus::get().max(1);
    let memory_mb = detect_memory_mb();
    (cpu_count, memory_mb)
}

// -- Helpers --

fn detect_memory_mb() -> u64 {
    #[cfg(target_os = "macos")]
    {
        if let Some(mb) = sysctl_hw_memsize() {
            return mb;
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(mb) = proc_meminfo_total() {
            return mb;
        }
    }

    // Fallback: assume 4 GB.
    4096
}

#[cfg(target_os = "macos")]
fn sysctl_hw_memsize() -> Option<u64> {
    let out = std::process::Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    let bytes: u64 = std::str::from_utf8(&out.stdout).ok()?.trim().parse().ok()?;
    Some(bytes / (1024 * 1024))
}

#[cfg(target_os = "linux")]
fn proc_meminfo_total() -> Option<u64> {
    let content = std::fs::read_to_string("/proc/meminfo").ok()?;
    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            let kb: u64 = rest.trim().trim_end_matches(" kB").trim().parse().ok()?;
            return Some(kb / 1024);
        }
    }
    None
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::execute;

    #[test]
    fn returns_sensible_values() {
        let (cpu_count, memory_mb) = execute();
        assert!(cpu_count > 0, "cpu_count should be > 0, got {cpu_count}");
        assert!(memory_mb > 0, "memory_mb should be > 0, got {memory_mb}");
    }
}
