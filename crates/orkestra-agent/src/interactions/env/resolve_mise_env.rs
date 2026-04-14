//! Fast environment resolution via mise (mise-en-place).
//!
//! Calls the `mise` binary directly at a known absolute path to resolve
//! project-specific tool versions (Ruby, Node, Python, etc.) without
//! spawning a full login shell. This is ~9x faster than `zsh -l -i -c 'env -0'`
//! and works reliably from bare launchd environments where Tauri desktop apps run.

use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::orkestra_debug;

const TIMEOUT: Duration = Duration::from_secs(5);

/// Well-known locations where mise may be installed.
const MISE_CANDIDATES: &[&str] = &[
    // mise's default install location (via installer script or mise self-update)
    ".local/bin/mise",
    // Homebrew on Apple Silicon
    "/opt/homebrew/bin/mise",
    // Homebrew on Intel Mac / Linux Homebrew
    "/usr/local/bin/mise",
];

/// Resolves project-specific environment variables via `mise env`.
///
/// Finds the mise binary at a known absolute path (no PATH lookup needed),
/// runs `mise env -C <project_root> -s zsh`, and parses the `export KEY="value"`
/// output into a `HashMap`. Returns `None` if mise is not installed or fails.
///
/// The returned map contains only the variables mise manages (typically PATH
/// plus a handful of tool-specific vars) — callers merge these as an overlay
/// on top of the inherited or base environment.
pub fn execute(project_root: &Path) -> Option<HashMap<String, String>> {
    let mise_bin = find_mise_binary()?;

    orkestra_debug!("env", "Found mise binary: {}", mise_bin);

    let output = run_mise_env(&mise_bin, project_root)?;

    let env = parse_mise_output(&output);

    if env.is_empty() {
        orkestra_debug!("env", "mise env produced no variables");
        return None;
    }

    let path_preview = env.get("PATH").map(|p| {
        let truncated: String = p.chars().take(80).collect();
        if p.len() > 80 {
            format!("{truncated}...")
        } else {
            truncated
        }
    });
    orkestra_debug!(
        "env",
        "mise resolved {} vars, PATH={}",
        env.len(),
        path_preview.as_deref().unwrap_or("<not set>")
    );

    Some(env)
}

// ============================================================================
// Helpers
// ============================================================================

/// Finds the mise binary at a known absolute path.
///
/// Checks well-known installation locations rather than searching PATH,
/// since the caller may be running in a bare launchd environment where
/// PATH is `/usr/bin:/bin:/usr/sbin:/sbin`.
fn find_mise_binary() -> Option<String> {
    // First check $HOME-relative paths
    if let Ok(home) = std::env::var("HOME") {
        for candidate in MISE_CANDIDATES {
            if candidate.starts_with('.') || candidate.starts_with('~') {
                let path = format!("{home}/{candidate}");
                if Path::new(&path).is_file() {
                    return Some(path);
                }
            }
        }
    }

    // Then check absolute paths
    for candidate in MISE_CANDIDATES {
        if candidate.starts_with('/') && Path::new(candidate).is_file() {
            return Some((*candidate).to_string());
        }
    }

    orkestra_debug!("env", "mise binary not found at any known location");
    None
}

/// Runs `mise env -C <project_root> -s zsh` and returns stdout.
fn run_mise_env(mise_bin: &str, project_root: &Path) -> Option<String> {
    let mut cmd = Command::new(mise_bin);
    cmd.args(["env", "-C"])
        .arg(project_root)
        .args(["-s", "zsh"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            orkestra_debug!("env", "Failed to spawn mise: {}", e);
            return None;
        }
    };

    // Collect output with timeout (same pattern as resolve_project_env)
    let (tx, rx) = std::sync::mpsc::channel::<std::io::Result<Vec<u8>>>();
    let mut stdout = child.stdout.take().expect("stdout is always piped");

    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let result = std::io::copy(&mut stdout, &mut buf).map(|_| buf);
        let _ = tx.send(result);
    });

    let output_bytes = match rx.recv_timeout(TIMEOUT) {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(e)) => {
            orkestra_debug!("env", "Failed to read mise output: {}", e);
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        Err(_) => {
            orkestra_debug!("env", "mise env timed out after {:?}", TIMEOUT);
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    };

    let status = child.wait();
    match status {
        Ok(s) if !s.success() => {
            let code = s.code().unwrap_or(-1);
            orkestra_debug!("env", "mise exited with non-zero status: {}", code);
            return None;
        }
        Err(e) => {
            orkestra_debug!("env", "Failed to wait on mise: {}", e);
            return None;
        }
        _ => {}
    }

    String::from_utf8(output_bytes).ok()
}

/// Parses `mise env -s zsh` output into a `HashMap`.
///
/// mise outputs lines like:
///   `export PATH="/Users/x/.local/share/mise/installs/ruby/3.4.7/bin:/usr/bin:/bin"`
///   `export RUBY_ROOT="/Users/x/.local/share/mise/installs/ruby/3.4.7"`
fn parse_mise_output(output: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();

    for line in output.lines() {
        let line = line.trim();

        let Some(assignment) = line.strip_prefix("export ") else {
            continue;
        };

        let Some(eq_pos) = assignment.find('=') else {
            continue;
        };

        let key = &assignment[..eq_pos];
        let mut value = &assignment[eq_pos + 1..];

        // Strip surrounding quotes (mise wraps values in double quotes)
        if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
            value = &value[1..value.len() - 1];
        }

        map.insert(key.to_string(), value.to_string());
    }

    map
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_mise_output_standard() {
        let output = r#"export PATH="/a/bin:/b/bin:/usr/bin"
export RUBY_ROOT="/a/ruby/3.4.7"
"#;
        let map = parse_mise_output(output);
        assert_eq!(map.len(), 2);
        assert_eq!(map["PATH"], "/a/bin:/b/bin:/usr/bin");
        assert_eq!(map["RUBY_ROOT"], "/a/ruby/3.4.7");
    }

    #[test]
    fn parse_mise_output_no_quotes() {
        let output = "export PATH=/a/bin:/usr/bin\n";
        let map = parse_mise_output(output);
        assert_eq!(map["PATH"], "/a/bin:/usr/bin");
    }

    #[test]
    fn parse_mise_output_empty() {
        let map = parse_mise_output("");
        assert!(map.is_empty());
    }

    #[test]
    fn parse_mise_output_skips_non_export_lines() {
        let output = "# some comment\nexport KEY=\"val\"\nnot an export\n";
        let map = parse_mise_output(output);
        assert_eq!(map.len(), 1);
        assert_eq!(map["KEY"], "val");
    }

    #[test]
    fn parse_mise_output_value_with_equals() {
        let output = "export FOO=\"bar=baz\"\n";
        let map = parse_mise_output(output);
        assert_eq!(map["FOO"], "bar=baz");
    }

    #[test]
    fn find_mise_binary_returns_some_when_installed() {
        // This test only validates behavior when mise is actually installed.
        // It's inherently environment-dependent.
        let result = find_mise_binary();
        if let Some(path) = &result {
            assert!(
                Path::new(path).is_file(),
                "Returned path should be an existing file"
            );
        }
        // None is acceptable when mise is not installed
    }
}
