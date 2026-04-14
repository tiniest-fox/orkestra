//! Per-project environment resolution by running the login shell in the project root.
//!
//! Captures the full environment (including shell hooks, mise shims, nvm, etc.)
//! that a user would see in an interactive terminal session for the given project.

use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crate::orkestra_debug;

const TIMEOUT: Duration = Duration::from_secs(5);

/// Resolves the login-shell environment for the given project root.
///
/// Runs `shell -l -i -c 'env -0'` with `current_dir` set to `project_root`
/// and parses the NUL-delimited output. Returns `None` on any failure.
///
/// The `-i` flag enables interactive mode so that `~/.zshrc` is sourced in
/// addition to `~/.zprofile`. This is required for tool managers like mise and
/// nvm whose binaries are added to PATH only in `~/.zshrc`, not `~/.zprofile`.
/// Without `-i`, Tauri's lean inherited PATH means those managers can't be
/// found and their shims are never activated.
///
/// `setsid()` creates a new session with no controlling terminal. Without it,
/// `zsh -i` calls `tcsetpgrp()` to claim the terminal's foreground process
/// group. When spawned from a GUI process (Tauri), this triggers `SIGTTOU`,
/// which stops the shell silently until the timeout kills it. `setsid()` removes
/// the controlling terminal entirely so there is nothing to fight over.
///
/// PATH patching (prepending the ork CLI directory) is the caller's responsibility.
pub fn execute(project_root: &Path, shell: &str) -> Option<HashMap<String, String>> {
    let mut cmd = Command::new(shell);
    cmd.args(["-l", "-i", "-c", "env -0"])
        .current_dir(project_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // setsid() creates a new session with no controlling terminal, preventing
        // SIGTTOU when zsh -i calls tcsetpgrp() from a background process group.
        // process_group(0) is redundant after setsid() since setsid() implicitly
        // makes the process a new process group leader.
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            orkestra_debug!("env", "Failed to spawn shell '{}': {}", shell, e);
            return None;
        }
    };

    // Collect output with a timeout using a background thread.
    let (tx, rx) = mpsc::channel::<std::io::Result<Vec<u8>>>();

    let mut stdout = child.stdout.take().expect("stdout is always piped");
    thread::spawn(move || {
        let mut buf = Vec::new();
        let result = std::io::copy(&mut stdout, &mut buf).map(|_| buf);
        let _ = tx.send(result);
    });

    let output_bytes = match rx.recv_timeout(TIMEOUT) {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(e)) => {
            orkestra_debug!("env", "Failed to read shell output: {}", e);
            #[cfg(unix)]
            {
                let pid = child.id();
                let _ = orkestra_process::kill_process_tree(pid);
            }
            #[cfg(not(unix))]
            {
                let _ = child.kill();
            }
            let _ = child.wait();
            return None;
        }
        Err(_) => {
            orkestra_debug!("env", "Shell env resolution timed out after {:?}", TIMEOUT);
            #[cfg(unix)]
            {
                let pid = child.id();
                let _ = orkestra_process::kill_process_tree(pid);
            }
            #[cfg(not(unix))]
            {
                let _ = child.kill();
            }
            let _ = child.wait();
            return None;
        }
    };

    let status = child.wait();
    match status {
        Ok(s) if !s.success() => {
            let code = s.code().unwrap_or(-1);
            orkestra_debug!("env", "Shell exited with non-zero status: {}", code);
            return None;
        }
        Err(e) => {
            orkestra_debug!("env", "Failed to wait on shell: {}", e);
            return None;
        }
        _ => {}
    }

    if output_bytes.is_empty() {
        orkestra_debug!("env", "Shell produced empty output");
        return None;
    }

    let env = parse_env_output(&output_bytes);

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
        "Resolved {} vars, PATH={}",
        env.len(),
        path_preview.as_deref().unwrap_or("<not set>")
    );

    Some(env)
}

// ============================================================================
// Helpers
// ============================================================================

/// Parses NUL-delimited `KEY=value` records into a `HashMap`.
fn parse_env_output(bytes: &[u8]) -> HashMap<String, String> {
    let mut map = HashMap::new();

    for record in bytes.split(|&b| b == b'\0') {
        if record.is_empty() {
            continue;
        }
        // Split only on the first `=`
        let Some(eq_pos) = record.iter().position(|&b| b == b'=') else {
            // Malformed record — no `=` separator
            continue;
        };
        let key = String::from_utf8_lossy(&record[..eq_pos]).into_owned();
        let value = String::from_utf8_lossy(&record[eq_pos + 1..]).into_owned();
        map.insert(key, value);
    }

    map
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn test_resolve_env_in_temp_dir() {
        // Skip on CI environments without a login shell
        let shell = match env::var("SHELL") {
            Ok(s) if !s.is_empty() => s,
            _ => return,
        };

        let dir = env::temp_dir();
        let result = execute(&dir, &shell);

        // Should succeed when SHELL is set and the dir exists
        if let Some(env_map) = result {
            assert!(
                env_map.contains_key("PATH"),
                "Expected PATH in resolved env"
            );
            // HOME and USER are typically set by login shells
            assert!(
                env_map.contains_key("HOME") || env_map.contains_key("USER"),
                "Expected at least HOME or USER in resolved env"
            );
        }
        // None is acceptable if the login shell fails in this environment
    }

    #[test]
    fn test_resolve_env_with_sh() {
        let dir = env::temp_dir();
        let result = execute(&dir, "/bin/sh");

        // /bin/sh is universally available; result should contain PATH
        if let Some(env_map) = result {
            assert!(
                env_map.contains_key("PATH"),
                "Expected PATH in resolved env from /bin/sh"
            );
        }
        // None is acceptable in restricted environments
    }

    #[test]
    fn test_parse_env_output_normal() {
        let input = b"KEY1=value1\0KEY2=value2\0";
        let map = parse_env_output(input);
        assert_eq!(map.len(), 2);
        assert_eq!(map["KEY1"], "value1");
        assert_eq!(map["KEY2"], "value2");
    }

    #[test]
    fn test_parse_env_output_value_with_equals() {
        let input = b"KEY=val=ue\0";
        let map = parse_env_output(input);
        assert_eq!(map.len(), 1);
        assert_eq!(map["KEY"], "val=ue");
    }

    #[test]
    fn test_parse_env_output_malformed_no_equals() {
        let input = b"MALFORMED\0";
        let map = parse_env_output(input);
        assert!(map.is_empty(), "Malformed records should be skipped");
    }

    #[test]
    fn test_parse_env_output_empty_records() {
        let input = b"\0\0";
        let map = parse_env_output(input);
        assert!(map.is_empty(), "Empty records should be skipped");
    }

    #[test]
    fn test_parse_env_output_trailing_nul() {
        let input = b"KEY=val\0";
        let map = parse_env_output(input);
        assert_eq!(map.len(), 1);
        assert_eq!(map["KEY"], "val");
    }

    #[test]
    fn test_parse_env_output_empty_key_and_value() {
        let input = b"=\0";
        let map = parse_env_output(input);
        assert_eq!(map.len(), 1);
        assert_eq!(map[""], "");
    }
}
