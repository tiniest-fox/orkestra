//! List top-level directories of a project's repository.

use std::path::Path;

use crate::types::ServiceError;

/// Return a sorted list of non-hidden top-level directory names under `repo_path`.
///
/// Hidden directories (names starting with `.`) are excluded.
pub fn execute(repo_path: &Path) -> Result<Vec<String>, ServiceError> {
    let mut dirs = Vec::new();
    for entry in std::fs::read_dir(repo_path)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with('.') {
                dirs.push(name);
            }
        }
    }
    dirs.sort();
    Ok(dirs)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::execute;

    #[test]
    fn lists_non_hidden_directories() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        std::fs::create_dir(root.join("alpha")).unwrap();
        std::fs::create_dir(root.join("beta")).unwrap();
        std::fs::create_dir(root.join(".hidden")).unwrap();
        std::fs::write(root.join("file.txt"), "data").unwrap();

        let result = execute(root).unwrap();
        assert_eq!(result, vec!["alpha", "beta"]);
    }

    #[test]
    fn returns_sorted_list() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        std::fs::create_dir(root.join("zebra")).unwrap();
        std::fs::create_dir(root.join("ant")).unwrap();
        std::fs::create_dir(root.join("mango")).unwrap();

        let result = execute(root).unwrap();
        assert_eq!(result, vec!["ant", "mango", "zebra"]);
    }

    #[test]
    fn empty_directory_returns_empty_vec() {
        let dir = tempfile::tempdir().unwrap();
        let result = execute(dir.path()).unwrap();
        assert!(result.is_empty());
    }
}
