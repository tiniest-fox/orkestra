//! Project initialization and validation.
//!
//! This module handles:
//! - Creating `.orkestra/` directory for new projects
//! - Validating project paths before initialization
//! - Providing structured errors with remediation suggestions

use std::fs;
use std::path::Path;

use serde::Serialize;

// =============================================================================
// Project Initialization Errors
// =============================================================================

/// Errors that can occur during project initialization.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProjectInitError {
    /// The provided path does not exist.
    PathNotFound { path: String, remediation: String },
    /// The provided path exists but is not a directory.
    NotADirectory { path: String, remediation: String },
    /// Permission denied when accessing the path.
    PermissionDenied { path: String, remediation: String },
    /// Failed to create `.orkestra/` directory.
    CreateFailed {
        path: String,
        error: String,
        remediation: String,
    },
}

impl std::fmt::Display for ProjectInitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PathNotFound { path, .. } => write!(f, "Path not found: {path}"),
            Self::NotADirectory { path, .. } => write!(f, "Not a directory: {path}"),
            Self::PermissionDenied { path, .. } => write!(f, "Permission denied: {path}"),
            Self::CreateFailed { path, error, .. } => {
                write!(f, "Failed to create .orkestra in {path}: {error}")
            }
        }
    }
}

impl std::error::Error for ProjectInitError {}

// =============================================================================
// Project Path Validation
// =============================================================================

/// Validate that a path is suitable for use as a project directory.
///
/// Checks:
/// - Path exists
/// - Path is a directory
/// - Path is readable and writable
///
/// Returns structured errors with remediation suggestions.
pub fn validate_project_path(path: &Path) -> Result<(), ProjectInitError> {
    // Check that path exists
    if !path.exists() {
        return Err(ProjectInitError::PathNotFound {
            path: path.display().to_string(),
            remediation: "Choose a folder that exists, or create the folder first.".to_string(),
        });
    }

    // Check that path is a directory
    let metadata = fs::metadata(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            ProjectInitError::PermissionDenied {
                path: path.display().to_string(),
                remediation: "Check file permissions and ensure you have access to this folder."
                    .to_string(),
            }
        } else {
            ProjectInitError::CreateFailed {
                path: path.display().to_string(),
                error: e.to_string(),
                remediation: "Try selecting a different folder.".to_string(),
            }
        }
    })?;

    if !metadata.is_dir() {
        return Err(ProjectInitError::NotADirectory {
            path: path.display().to_string(),
            remediation: "Choose a folder, not a file.".to_string(),
        });
    }

    // Check read/write permissions by attempting to read the directory
    fs::read_dir(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            ProjectInitError::PermissionDenied {
                path: path.display().to_string(),
                remediation: "Check file permissions and ensure you have read and write access."
                    .to_string(),
            }
        } else {
            ProjectInitError::CreateFailed {
                path: path.display().to_string(),
                error: e.to_string(),
                remediation: "Try selecting a different folder.".to_string(),
            }
        }
    })?;

    Ok(())
}

// =============================================================================
// Orkestra Directory Initialization
// =============================================================================

/// Initialize `.orkestra/` directory in the given project path.
///
/// If `.orkestra/` already exists, this is a no-op (returns success).
/// The database will be created automatically by `DatabaseConnection::open_validated()`
/// during `ProjectState` construction. Workflow config falls back to default when absent.
///
/// # Arguments
///
/// * `project_path` - The project root directory
///
/// # Returns
///
/// * `Ok(())` - Directory exists or was created successfully
/// * `Err(ProjectInitError)` - Failed to create directory
pub fn initialize_orkestra_dir(project_path: &Path) -> Result<(), ProjectInitError> {
    let orkestra_dir = project_path.join(".orkestra");

    // If .orkestra already exists, this is a no-op
    if orkestra_dir.exists() {
        return Ok(());
    }

    // Create .orkestra directory
    fs::create_dir(&orkestra_dir).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            ProjectInitError::PermissionDenied {
                path: orkestra_dir.display().to_string(),
                remediation: "Check file permissions and ensure you have write access.".to_string(),
            }
        } else {
            ProjectInitError::CreateFailed {
                path: orkestra_dir.display().to_string(),
                error: e.to_string(),
                remediation: "Ensure the parent directory exists and you have write permissions."
                    .to_string(),
            }
        }
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_validate_project_path_valid_dir() {
        let temp_dir = TempDir::new().unwrap();
        let result = validate_project_path(temp_dir.path());
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_project_path_nonexistent() {
        let path = Path::new("/nonexistent/path/that/does/not/exist");
        let result = validate_project_path(path);
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectInitError::PathNotFound { .. } => {}
            e => panic!("Expected PathNotFound, got {e:?}"),
        }
    }

    #[test]
    fn test_validate_project_path_file_not_dir() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("file.txt");
        fs::write(&file_path, "test").unwrap();

        let result = validate_project_path(&file_path);
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectInitError::NotADirectory { .. } => {}
            e => panic!("Expected NotADirectory, got {e:?}"),
        }
    }

    #[test]
    fn test_initialize_orkestra_dir_new() {
        let temp_dir = TempDir::new().unwrap();
        let project_path = temp_dir.path();
        let orkestra_dir = project_path.join(".orkestra");

        // Should not exist initially
        assert!(!orkestra_dir.exists());

        // Initialize
        let result = initialize_orkestra_dir(project_path);
        assert!(result.is_ok());

        // Should exist now
        assert!(orkestra_dir.exists());
        assert!(orkestra_dir.is_dir());
    }

    #[test]
    fn test_initialize_orkestra_dir_already_exists() {
        let temp_dir = TempDir::new().unwrap();
        let project_path = temp_dir.path();
        let orkestra_dir = project_path.join(".orkestra");

        // Create .orkestra directory manually
        fs::create_dir(&orkestra_dir).unwrap();

        // Initialize should be a no-op
        let result = initialize_orkestra_dir(project_path);
        assert!(result.is_ok());

        // Should still exist
        assert!(orkestra_dir.exists());
    }

    #[test]
    fn test_initialize_orkestra_dir_invalid_path() {
        let path = Path::new("/nonexistent/path");
        let result = initialize_orkestra_dir(path);
        assert!(result.is_err());
        match result.unwrap_err() {
            ProjectInitError::CreateFailed { .. } => {}
            e => panic!("Expected CreateFailed, got {e:?}"),
        }
    }
}
