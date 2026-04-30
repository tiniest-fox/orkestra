//! Command for saving pasted/dropped images to a temp directory.

use base64::Engine as _;
use std::fs;
use tauri::{State, Window};
use uuid::Uuid;

use crate::error::TauriError;
use crate::project_registry::ProjectRegistry;

/// Save base64-encoded image data to `.orkestra/.tmp/images/<uuid>.<ext>`.
///
/// Returns the absolute path to the written file. The `image_data` parameter
/// may be a raw base64 string or a data URL (`data:image/png;base64,...`) —
/// the data URL prefix is stripped automatically.
#[tauri::command]
pub fn save_temp_image(
    registry: State<'_, ProjectRegistry>,
    window: Window,
    image_data: String,
    mime_type: String,
) -> Result<String, TauriError> {
    let project_root = registry.with_project(window.label(), |state| {
        Ok(state.project_root().to_path_buf())
    })?;

    let ext = mime_to_ext(&mime_type).ok_or_else(|| {
        TauriError::new(
            "UNSUPPORTED_IMAGE_TYPE",
            format!("Unsupported image MIME type: {mime_type}"),
        )
    })?;

    let raw_b64 = strip_data_url_prefix(&image_data);

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw_b64)
        .map_err(|e| TauriError::new("INVALID_IMAGE_DATA", format!("Base64 decode failed: {e}")))?;

    let dir = project_root.join(".orkestra/.tmp/images");
    fs::create_dir_all(&dir).map_err(|e| {
        TauriError::new("IO_ERROR", format!("Failed to create image directory: {e}"))
    })?;

    let filename = format!("{}.{ext}", Uuid::new_v4());
    let path = dir.join(&filename);

    fs::write(&path, &bytes)
        .map_err(|e| TauriError::new("IO_ERROR", format!("Failed to write image file: {e}")))?;

    path.to_str()
        .map(String::from)
        .ok_or_else(|| TauriError::new("IO_ERROR", "Image path contains invalid UTF-8"))
}

// -- Helpers --

fn mime_to_ext(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/bmp" => Some("bmp"),
        "image/tiff" => Some("tiff"),
        _ => None,
    }
}

fn strip_data_url_prefix(data: &str) -> &str {
    if let Some(comma_pos) = data.find(',') {
        if data[..comma_pos].contains(';') {
            return &data[comma_pos + 1..];
        }
    }
    data
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_to_ext_known_types() {
        assert_eq!(mime_to_ext("image/png"), Some("png"));
        assert_eq!(mime_to_ext("image/jpeg"), Some("jpg"));
        assert_eq!(mime_to_ext("image/jpg"), Some("jpg"));
        assert_eq!(mime_to_ext("image/gif"), Some("gif"));
        assert_eq!(mime_to_ext("image/webp"), Some("webp"));
    }

    #[test]
    fn mime_to_ext_unknown_returns_none() {
        assert_eq!(mime_to_ext("image/svg+xml"), None);
        assert_eq!(mime_to_ext("application/pdf"), None);
        assert_eq!(mime_to_ext(""), None);
    }

    #[test]
    fn strip_data_url_prefix_strips_prefix() {
        let data_url = "data:image/png;base64,iVBORw0KGgo=";
        assert_eq!(strip_data_url_prefix(data_url), "iVBORw0KGgo=");
    }

    #[test]
    fn strip_data_url_prefix_passes_through_raw_base64() {
        let raw = "iVBORw0KGgo=";
        assert_eq!(strip_data_url_prefix(raw), raw);
    }
}
