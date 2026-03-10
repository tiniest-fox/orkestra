//! Read the last N lines from a project's debug log.

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use crate::types::ServiceError;

pub fn execute(project_path: &str, lines: usize) -> Result<Vec<String>, ServiceError> {
    // Cap at 500 lines
    let lines = lines.min(500);
    let log_path = Path::new(project_path)
        .join(".orkestra")
        .join(".logs")
        .join("debug.log");

    let mut file = match std::fs::File::open(&log_path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };

    // Read last 64KB (enough for ~500 lines at ~128 chars each)
    let file_len = file.metadata()?.len();
    let read_size: u64 = 65_536;
    let start = file_len.saturating_sub(read_size);
    file.seek(SeekFrom::Start(start))?;

    let mut raw = Vec::new();
    file.read_to_end(&mut raw)?;
    let buf = String::from_utf8_lossy(&raw);

    // If we didn't read from the start, drop the first partial line
    let text = if start > 0 {
        buf.split_once('\n').map_or("", |(_, rest)| rest)
    } else {
        &buf
    };

    let all_lines: Vec<&str> = text.lines().collect();
    let tail = if all_lines.len() > lines {
        &all_lines[all_lines.len() - lines..]
    } else {
        &all_lines
    };

    Ok(tail.iter().map(std::string::ToString::to_string).collect())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use std::io::Write;

    use tempfile::TempDir;

    use super::execute;

    fn write_log(dir: &TempDir, lines: &[&str]) -> String {
        let log_dir = dir.path().join(".orkestra").join(".logs");
        std::fs::create_dir_all(&log_dir).unwrap();
        let log_path = log_dir.join("debug.log");
        let mut f = std::fs::File::create(&log_path).unwrap();
        for line in lines {
            writeln!(f, "{line}").unwrap();
        }
        dir.path().to_string_lossy().to_string()
    }

    #[test]
    fn returns_last_n_lines() {
        let dir = TempDir::new().unwrap();
        let all: Vec<String> = (1..=10).map(|i| format!("line {i}")).collect();
        let refs: Vec<&str> = all.iter().map(std::string::String::as_str).collect();
        let project_path = write_log(&dir, &refs);

        let result = execute(&project_path, 3).unwrap();
        assert_eq!(result, vec!["line 8", "line 9", "line 10"]);
    }

    #[test]
    fn returns_empty_vec_when_file_not_found() {
        let dir = TempDir::new().unwrap();
        let project_path = dir.path().to_string_lossy().to_string();
        let result = execute(&project_path, 50).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn returns_all_lines_when_file_smaller_than_requested() {
        let dir = TempDir::new().unwrap();
        let project_path = write_log(&dir, &["a", "b", "c"]);
        let result = execute(&project_path, 50).unwrap();
        assert_eq!(result, vec!["a", "b", "c"]);
    }

    #[test]
    fn caps_at_500_lines() {
        let dir = TempDir::new().unwrap();
        let all: Vec<String> = (1..=600).map(|i| format!("line {i}")).collect();
        let refs: Vec<&str> = all.iter().map(std::string::String::as_str).collect();
        let project_path = write_log(&dir, &refs);

        let result = execute(&project_path, 1000).unwrap();
        assert_eq!(result.len(), 500);
        assert_eq!(result[0], "line 101");
        assert_eq!(result[499], "line 600");
    }
}
