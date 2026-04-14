//! Read a file from the project root's live working tree.

use std::path::Path;

use crate::workflow::ports::{WorkflowError, WorkflowResult};

/// Read the content of a file from the project root's live working tree.
///
/// Returns the file content as a string, or None if the file doesn't exist.
/// Returns an error for empty paths, path traversal attempts, oversized files
/// (>1 MB), or binary content.
pub fn execute(project_root: &Path, file_path: &str) -> WorkflowResult<Option<String>> {
    if file_path.is_empty() {
        return Err(WorkflowError::InvalidState("Empty file path".into()));
    }

    // Path traversal validation
    if file_path.contains("..")
        || file_path.starts_with('/')
        || file_path.starts_with('\\')
        || file_path.contains('\0')
    {
        return Err(WorkflowError::InvalidState(format!(
            "Invalid file path: {file_path}"
        )));
    }

    let full_path = project_root.join(file_path);

    // Verify the resolved path is under project_root
    let canonical = match full_path.canonicalize() {
        Ok(canonical) => {
            let canonical_root = project_root
                .canonicalize()
                .map_err(|e| WorkflowError::InvalidState(e.to_string()))?;
            if !canonical.starts_with(&canonical_root) {
                return Err(WorkflowError::InvalidState(format!(
                    "Path escapes project root: {file_path}"
                )));
            }
            canonical
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(WorkflowError::InvalidState(e.to_string())),
    };

    // Size limit: 1MB
    let metadata =
        std::fs::metadata(&canonical).map_err(|e| WorkflowError::InvalidState(e.to_string()))?;
    if metadata.len() > 1_048_576 {
        return Err(WorkflowError::InvalidState(format!(
            "File too large: {} bytes (max 1MB)",
            metadata.len()
        )));
    }

    // Read as bytes to detect binary files
    let bytes =
        std::fs::read(&canonical).map_err(|e| WorkflowError::InvalidState(e.to_string()))?;
    match String::from_utf8(bytes) {
        Ok(content) => Ok(Some(content)),
        Err(_) => Err(WorkflowError::InvalidState(
            "Binary file cannot be displayed".into(),
        )),
    }
}
