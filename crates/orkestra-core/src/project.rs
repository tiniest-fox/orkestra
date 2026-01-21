use std::path::PathBuf;
use std::fs;

/// Finds the project root by looking for workspace Cargo.toml or agents directory.
/// This ensures we use a consistent root regardless of which subdirectory we're running from.
pub fn find_project_root() -> std::io::Result<PathBuf> {
    let mut current = std::env::current_dir()?;

    loop {
        // Check for workspace Cargo.toml (contains [workspace])
        let cargo_toml = current.join("Cargo.toml");
        if cargo_toml.exists() {
            if let Ok(content) = fs::read_to_string(&cargo_toml) {
                if content.contains("[workspace]") {
                    return Ok(current);
                }
            }
        }

        // Check for agents directory (strong signal we're at project root)
        if current.join("agents").exists() && current.join("agents").is_dir() {
            return Ok(current);
        }

        // Move up to parent
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => break,
        }
    }

    // Fall back to current directory if nothing found
    std::env::current_dir()
}

/// Gets the .orkestra directory path at the project root
pub fn get_orkestra_dir() -> PathBuf {
    find_project_root()
        .unwrap_or_else(|_| std::env::current_dir().expect("Failed to get current directory"))
        .join(".orkestra")
}

/// Ensures the .orkestra directory exists
pub fn ensure_orkestra_dir() -> std::io::Result<()> {
    let dir = get_orkestra_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    Ok(())
}
