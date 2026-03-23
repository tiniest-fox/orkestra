//! Commands for one-time app setup operations (CLI tool installation, etc.).

use std::path::Path;

use tauri::State;

use crate::error::TauriError;
use crate::OrkBinPath;

// =============================================================================
// Tauri Commands
// =============================================================================

/// Install the `ork` CLI by symlinking the bundled binary into the target directory.
///
/// Requires the app to be running from its bundle (a real `ork` binary must have
/// been found in the app's resource directory at startup). After installation,
/// `ork` is available in any new terminal session.
///
/// `target_path` defaults to `/usr/local/bin/ork`. Pass an explicit path in tests
/// to avoid touching the real filesystem.
#[tauri::command]
pub fn install_cli_tools(
    ork_bin_state: State<OrkBinPath>,
    target_path: Option<String>,
) -> Result<String, TauriError> {
    let ork_bin = ork_bin_state.0.as_deref().ok_or_else(|| {
        TauriError::new(
            "ORK_NOT_BUNDLED",
            "ork binary not found in app bundle. Run Orkestra from the installed .app.",
        )
    })?;

    let target_str = target_path.unwrap_or_else(|| "/usr/local/bin/ork".to_string());
    let target = Path::new(&target_str);
    install_ork_to_path(ork_bin, target)
}

// -- Helpers --

/// Core install logic: validates the source path and creates a symlink (Unix) or
/// copy (non-Unix) at `target`.
///
/// Both the Tauri command and the native menu handler call this function, so all
/// guards — including the `AppTranslocation` check — live here.
pub(crate) fn install_ork_to_path(ork_bin: &Path, target: &Path) -> Result<String, TauriError> {
    // Gatekeeper path translocation: unsigned apps launched directly from a DMG
    // run from a temporary translocated path. Symlinks to that path become stale
    // once the app is moved to /Applications.
    if ork_bin.to_string_lossy().contains("AppTranslocation") {
        return Err(TauriError::new(
            "APP_TRANSLOCATED",
            "Orkestra is running from a quarantined location. Move the app to /Applications and relaunch before installing the CLI.",
        ));
    }

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            let msg = if e.kind() == std::io::ErrorKind::PermissionDenied {
                let parent_str = parent.display();
                format!(
                    "Cannot write to {parent_str}. Try: sudo mkdir -p {parent_str} && sudo chown $USER {parent_str}. \
                     On Apple Silicon, /opt/homebrew/bin may already be in your PATH."
                )
            } else {
                format!("Failed to create {}: {e}", parent.display())
            };
            TauriError::new("INSTALL_FAILED", msg)
        })?;
    }

    // Remove any existing file or symlink (including broken symlinks).
    if target.symlink_metadata().is_ok() {
        std::fs::remove_file(target).map_err(|e| {
            TauriError::new(
                "INSTALL_FAILED",
                format!("Failed to remove existing {}: {e}", target.display()),
            )
        })?;
    }

    #[cfg(unix)]
    std::os::unix::fs::symlink(ork_bin, target)
        .map_err(|e| TauriError::new("INSTALL_FAILED", format!("Failed to create symlink: {e}")))?;

    #[cfg(not(unix))]
    std::fs::copy(ork_bin, target).map_err(|e| {
        TauriError::new("INSTALL_FAILED", format!("Failed to copy ork binary: {e}"))
    })?;

    Ok(format!("Installed: ork → {}", target.display()))
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn apptranslocation_path_returns_error() {
        // The AppTranslocation guard must fire when ork_bin is a translocated path.
        let translocated =
            PathBuf::from("/private/var/folders/AppTranslocation/abc123/d/Orkestra.app/ork");
        let target_dir = tempfile::tempdir().unwrap();
        let target = target_dir.path().join("ork");

        let result = install_ork_to_path(&translocated, &target);
        assert!(result.is_err(), "expected Err for translocated path");
        assert_eq!(result.unwrap_err().code, "APP_TRANSLOCATED");
    }

    #[test]
    fn install_creates_symlink_at_target() {
        let src_dir = tempfile::tempdir().unwrap();
        let target_dir = tempfile::tempdir().unwrap();

        let ork_bin = src_dir.path().join("ork");
        std::fs::File::create(&ork_bin).unwrap();

        let target = target_dir.path().join("ork");
        let result = install_ork_to_path(&ork_bin, &target);
        assert!(result.is_ok(), "expected Ok, got {result:?}");
        assert!(
            target.symlink_metadata().is_ok(),
            "symlink should exist at target"
        );
        // Verify the symlink points to the correct source.
        #[cfg(unix)]
        assert_eq!(
            std::fs::read_link(&target).unwrap(),
            ork_bin,
            "symlink must point to ork_bin"
        );
    }

    #[test]
    fn install_replaces_existing_symlink() {
        let src_dir = tempfile::tempdir().unwrap();
        let target_dir = tempfile::tempdir().unwrap();

        let ork_bin = src_dir.path().join("ork");
        std::fs::File::create(&ork_bin).unwrap();

        let target = target_dir.path().join("ork");

        // Create an existing *symlink* at the target location (not a regular file).
        #[cfg(unix)]
        {
            let old_src = src_dir.path().join("old_ork");
            std::fs::File::create(&old_src).unwrap();
            std::os::unix::fs::symlink(&old_src, &target).unwrap();
        }
        #[cfg(not(unix))]
        std::fs::write(&target, b"old content").unwrap();

        let result = install_ork_to_path(&ork_bin, &target);
        assert!(result.is_ok(), "expected Ok, got {result:?}");
        assert!(target.symlink_metadata().is_ok());
        // Verify the symlink now points to the new binary.
        #[cfg(unix)]
        assert_eq!(std::fs::read_link(&target).unwrap(), ork_bin);
    }

    #[test]
    fn install_returns_formatted_success_message() {
        let src_dir = tempfile::tempdir().unwrap();
        let target_dir = tempfile::tempdir().unwrap();

        let ork_bin = src_dir.path().join("ork");
        std::fs::File::create(&ork_bin).unwrap();

        let target = target_dir.path().join("ork");
        let msg = install_ork_to_path(&ork_bin, &target).unwrap();
        assert!(
            msg.contains("Installed: ork →"),
            "unexpected message: {msg}"
        );
        assert!(msg.contains(target.to_str().unwrap()));
    }
}
