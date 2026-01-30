//! Commands for opening task worktrees in external tools (terminals, editors).

use std::path::Path;
use std::process::Command;

use crate::error::TauriError;

/// Detected external application with its launch mechanism.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DetectedApp {
    /// Display name (e.g., "Warp", "VS Code").
    pub name: String,
    /// Identifier for the app (e.g., "warp", "vscode").
    pub id: String,
}

/// Terminal emulators in preference order.
const TERMINAL_CANDIDATES: &[TerminalCandidate] = &[
    TerminalCandidate {
        id: "warp",
        name: "Warp",
        app_bundle: "Warp.app",
        cli_name: None,
    },
    TerminalCandidate {
        id: "ghostty",
        name: "Ghostty",
        app_bundle: "Ghostty.app",
        cli_name: None,
    },
    TerminalCandidate {
        id: "iterm2",
        name: "iTerm",
        app_bundle: "iTerm.app",
        cli_name: None,
    },
    TerminalCandidate {
        id: "terminal",
        name: "Terminal",
        app_bundle: "Utilities/Terminal.app",
        cli_name: None,
    },
];

/// Code editors in preference order.
const EDITOR_CANDIDATES: &[EditorCandidate] = &[
    EditorCandidate {
        id: "zed",
        name: "Zed",
        app_bundle: "Zed.app",
        cli_name: Some("zed"),
    },
    EditorCandidate {
        id: "vscode",
        name: "VS Code",
        app_bundle: "Visual Studio Code.app",
        cli_name: Some("code"),
    },
    EditorCandidate {
        id: "vscode-insiders",
        name: "VS Code Insiders",
        app_bundle: "Visual Studio Code - Insiders.app",
        cli_name: Some("code-insiders"),
    },
    EditorCandidate {
        id: "cursor",
        name: "Cursor",
        app_bundle: "Cursor.app",
        cli_name: Some("cursor"),
    },
    EditorCandidate {
        id: "sublime",
        name: "Sublime Text",
        app_bundle: "Sublime Text.app",
        cli_name: Some("subl"),
    },
];

struct TerminalCandidate {
    id: &'static str,
    name: &'static str,
    /// Path relative to /Applications (e.g., "Warp.app" or "Utilities/Terminal.app").
    app_bundle: &'static str,
    /// CLI tool name in PATH (if different from app bundle).
    #[allow(dead_code)]
    cli_name: Option<&'static str>,
}

struct EditorCandidate {
    id: &'static str,
    name: &'static str,
    /// Path relative to /Applications.
    app_bundle: &'static str,
    /// CLI tool name in PATH.
    cli_name: Option<&'static str>,
}

fn is_app_installed(app_bundle: &str) -> bool {
    Path::new(&format!("/Applications/{app_bundle}")).exists()
        || Path::new(&format!("/System/Applications/{app_bundle}")).exists()
}

fn is_cli_in_path(cli_name: &str) -> bool {
    Command::new("which")
        .arg(cli_name)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn detect_terminal() -> Option<&'static TerminalCandidate> {
    TERMINAL_CANDIDATES
        .iter()
        .find(|c| is_app_installed(c.app_bundle))
}

fn detect_editor() -> Option<&'static EditorCandidate> {
    EDITOR_CANDIDATES
        .iter()
        .find(|c| is_app_installed(c.app_bundle) || c.cli_name.is_some_and(is_cli_in_path))
}

fn open_terminal_at(terminal: &TerminalCandidate, dir: &str) -> Result<(), TauriError> {
    // macOS: use `open -a <App> <dir>` for terminal emulators.
    // Most terminals interpret a directory argument as "open a new window here."
    Command::new("open")
        .args(["-a", terminal.name, dir])
        .spawn()
        .map_err(|e| {
            TauriError::new(
                "LAUNCH_FAILED",
                format!("Failed to open {}: {e}", terminal.name),
            )
        })?;
    Ok(())
}

fn open_editor_at(editor: &EditorCandidate, dir: &str) -> Result<(), TauriError> {
    // Prefer CLI tool if available (more reliable for opening directories).
    if let Some(cli) = editor.cli_name {
        if is_cli_in_path(cli) {
            Command::new(cli).arg(dir).spawn().map_err(|e| {
                TauriError::new(
                    "LAUNCH_FAILED",
                    format!("Failed to open {}: {e}", editor.name),
                )
            })?;
            return Ok(());
        }
    }

    // Fall back to `open -a`.
    Command::new("open")
        .args(["-a", editor.name, dir])
        .spawn()
        .map_err(|e| {
            TauriError::new(
                "LAUNCH_FAILED",
                format!("Failed to open {}: {e}", editor.name),
            )
        })?;
    Ok(())
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Open the task worktree directory in the user's terminal emulator.
#[tauri::command]
pub fn open_in_terminal(path: String) -> Result<(), TauriError> {
    if !Path::new(&path).is_dir() {
        return Err(TauriError::new(
            "DIR_NOT_FOUND",
            format!("Worktree directory does not exist: {path}"),
        ));
    }

    let terminal = detect_terminal().ok_or_else(|| {
        TauriError::new(
            "NO_TERMINAL",
            "No supported terminal emulator found. Install Warp, Ghostty, iTerm, or use Terminal.app.",
        )
    })?;

    open_terminal_at(terminal, &path)
}

/// Open the task worktree directory in the user's code editor.
#[tauri::command]
pub fn open_in_editor(path: String) -> Result<(), TauriError> {
    if !Path::new(&path).is_dir() {
        return Err(TauriError::new(
            "DIR_NOT_FOUND",
            format!("Worktree directory does not exist: {path}"),
        ));
    }

    let editor = detect_editor().ok_or_else(|| {
        TauriError::new(
            "NO_EDITOR",
            "No supported code editor found. Install Zed, VS Code, Cursor, or Sublime Text.",
        )
    })?;

    open_editor_at(editor, &path)
}

/// Detect which terminal emulator and code editor are available.
///
/// Returns the best available option for each category.
#[tauri::command]
pub fn detect_external_tools() -> ExternalToolsInfo {
    let terminal = detect_terminal().map(|t| DetectedApp {
        name: t.name.to_string(),
        id: t.id.to_string(),
    });
    let editor = detect_editor().map(|e| DetectedApp {
        name: e.name.to_string(),
        id: e.id.to_string(),
    });
    ExternalToolsInfo { terminal, editor }
}

/// Information about detected external tools.
#[derive(Debug, serde::Serialize)]
pub struct ExternalToolsInfo {
    /// Best available terminal emulator, if any.
    pub terminal: Option<DetectedApp>,
    /// Best available code editor, if any.
    pub editor: Option<DetectedApp>,
}
