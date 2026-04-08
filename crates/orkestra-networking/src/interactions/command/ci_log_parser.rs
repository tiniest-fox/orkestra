//! Pure functions for parsing GitHub Actions job logs into actionable error excerpts.
//!
//! No I/O — operates entirely on string input. Uses step markers (`##[group]`,
//! `##[endgroup]`, `##[error]`) to scope to the failed step, then ANSI red code
//! detection to extract the relevant error lines.

// The public API is consumed by the sibling subtask (mongoose) that wires log
// fetching into `fetch_pr_status`. Until then, allow unused-code lints.
#![allow(dead_code)]

// ============================================================================
// Types
// ============================================================================

/// Parsed excerpt from a CI job log.
pub(crate) struct CiLogExcerpt {
    /// The command that failed (extracted from `##[group]Run <command>`).
    /// `None` if no group markers were found.
    pub command: Option<String>,
    /// The extracted error output (stripped of ANSI codes and timestamps).
    pub output: String,
}

/// Intermediate: a failed step's boundaries in the log.
struct FailedStep {
    /// The command from the `##[group]Run` line.
    command: Option<String>,
    /// The actual command output (between `##[endgroup]` and `##[error]`).
    output: String,
}

// ============================================================================
// Parsing
// ============================================================================

/// Parse a raw GitHub Actions job log and return a concise, actionable excerpt.
///
/// Returns `None` if the log is empty or produces no output after processing.
pub(crate) fn parse_ci_log(raw_log: &str) -> Option<CiLogExcerpt> {
    if raw_log.is_empty() {
        return None;
    }

    let (command, step_output) = if let Some(step) = extract_failed_step(raw_log) {
        (step.command, step.output)
    } else {
        // No markers — use last 50 lines of the entire log.
        let tail = last_n_lines(raw_log, 50);
        (None, tail)
    };

    let error_block = match extract_error_lines(&step_output, 2) {
        Some(block) => block,
        None => last_n_lines(&step_output, 50),
    };

    let stripped = strip_ansi_codes(&strip_timestamps(&error_block));
    let capped = cap_lines(&stripped, 150);

    if capped.trim().is_empty() {
        return None;
    }

    Some(CiLogExcerpt {
        command,
        output: capped,
    })
}

// ============================================================================
// Helpers
// ============================================================================

// -- Step extraction --

/// Find the last failed step in a GitHub Actions log using `##[group]`/`##[error]` markers.
fn extract_failed_step(log: &str) -> Option<FailedStep> {
    let lines: Vec<&str> = log.lines().collect();

    // Find the last ##[error] line.
    let error_idx = lines.iter().rposition(|l| {
        let stripped = strip_timestamps_line(l);
        stripped.trim_start().starts_with("##[error]")
    })?;

    // Walk backward from error_idx to find the nearest ##[group]Run line.
    let group_idx = (0..error_idx).rev().find(|&i| {
        let stripped = strip_timestamps_line(lines[i]);
        stripped.trim_start().starts_with("##[group]Run ")
    })?;

    let command_line = strip_timestamps_line(lines[group_idx]);
    let command = command_line
        .trim_start()
        .strip_prefix("##[group]Run ")
        .map(std::string::ToString::to_string);

    // Walk forward from group_idx to find ##[endgroup].
    let endgroup_idx = lines[group_idx..error_idx].iter().position(|l| {
        let stripped = strip_timestamps_line(l);
        stripped.trim_start().starts_with("##[endgroup]")
    })? + group_idx;

    // Output is everything between endgroup and error (exclusive).
    let output_lines = &lines[(endgroup_idx + 1)..error_idx];
    let output = output_lines.join("\n");

    Some(FailedStep { command, output })
}

// -- Error line extraction --

/// Red ANSI color codes (codes 31 and 91 with optional bold/reset prefixes).
const RED_ANSI_PATTERNS: &[&str] = &[
    "\x1b[31m",
    "\x1b[91m",
    "\x1b[1;31m",
    "\x1b[0;31m",
    "\x1b[1;91m",
    "\x1b[0;91m",
];

/// Extract lines containing red ANSI escape codes plus `context` surrounding lines.
///
/// Returns `None` if no red lines are found.
fn extract_error_lines(text: &str, context: usize) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    let n = lines.len();

    // Find all line indices with red ANSI codes.
    let red_indices: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| RED_ANSI_PATTERNS.iter().any(|pat| line.contains(pat)))
        .map(|(i, _)| i)
        .collect();

    if red_indices.is_empty() {
        return None;
    }

    // Expand each red line index into a range [start, end] (inclusive).
    let ranges: Vec<(usize, usize)> = red_indices
        .iter()
        .map(|&i| {
            let start = i.saturating_sub(context);
            let end = (i + context).min(n.saturating_sub(1));
            (start, end)
        })
        .collect();

    // Merge overlapping/adjacent ranges.
    let merged = merge_ranges(ranges);

    // Build output with `...` separators between non-adjacent spans.
    let mut parts: Vec<String> = Vec::new();
    for (idx, (start, end)) in merged.iter().enumerate() {
        if idx > 0 {
            let prev_end = merged[idx - 1].1;
            if *start > prev_end + 1 {
                parts.push("...".to_string());
            }
        }
        parts.push(lines[*start..=*end].join("\n"));
    }

    Some(parts.join("\n"))
}

// -- ANSI / timestamp stripping --

/// Remove all ANSI escape sequences from `text`.
///
/// Matches `ESC [ <params> <letter>` using a manual byte-level scanner.
fn strip_ansi_codes(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut result = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'\x1b' && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            // Skip until we find a letter [a-zA-Z].
            i += 2;
            while i < bytes.len() && !bytes[i].is_ascii_alphabetic() {
                i += 1;
            }
            if i < bytes.len() {
                i += 1; // skip the terminating letter
            }
        } else {
            result.push(bytes[i]);
            i += 1;
        }
    }

    String::from_utf8_lossy(&result).into_owned()
}

/// Strip GitHub Actions timestamp prefixes from every line in `text`.
///
/// GitHub prefixes lines with `YYYY-MM-DDThh:mm:ss.<digits>Z ` — strips
/// only when the pattern is unambiguous.
fn strip_timestamps(text: &str) -> String {
    text.lines()
        .map(strip_timestamps_line)
        .collect::<Vec<_>>()
        .join("\n")
}

/// Strip a timestamp prefix from a single line (returns original if no match).
fn strip_timestamps_line(line: &str) -> &str {
    // Pattern: YYYY-MM-DDThh:mm:ss.<digits>Z <space>
    // Minimum: "2024-01-15T10:30:45.1Z " = 24 chars
    let bytes = line.as_bytes();
    if bytes.len() < 21 {
        return line;
    }
    // Check: 4 digits, '-', 2 digits, '-', 2 digits, 'T', 2 digits, ':', 2 digits, ':', 2 digits, '.'
    let date_ok = bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
        && bytes[16] == b':'
        && bytes[19] == b'.'
        && bytes[0..4].iter().all(u8::is_ascii_digit)
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[8..10].iter().all(u8::is_ascii_digit)
        && bytes[11..13].iter().all(u8::is_ascii_digit)
        && bytes[14..16].iter().all(u8::is_ascii_digit)
        && bytes[17..19].iter().all(u8::is_ascii_digit);

    if !date_ok {
        return line;
    }

    // Skip fractional digits after '.', then expect 'Z' followed by ' '.
    let mut i = 20;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i + 1 < bytes.len() && bytes[i] == b'Z' && bytes[i + 1] == b' ' {
        &line[i + 2..]
    } else {
        line
    }
}

// -- Utility --

/// Return the last `n` lines of `text` joined by newlines.
fn last_n_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

/// Truncate `text` to at most `max_lines` lines, keeping the tail.
fn cap_lines(text: &str, max_lines: usize) -> String {
    last_n_lines(text, max_lines)
}

/// Merge a list of `(start, end)` ranges (inclusive) into non-overlapping spans.
fn merge_ranges(mut ranges: Vec<(usize, usize)>) -> Vec<(usize, usize)> {
    if ranges.is_empty() {
        return ranges;
    }
    ranges.sort_unstable_by_key(|r| r.0);
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (start, end) in ranges {
        if let Some(last) = merged.last_mut() {
            if start <= last.1 + 1 {
                last.1 = last.1.max(end);
                continue;
            }
        }
        merged.push((start, end));
    }
    merged
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // 1. Step extraction with markers
    // -------------------------------------------------------------------------

    #[test]
    fn step_extraction_with_markers() {
        let log = "\
##[group]Run cargo clippy --workspace -- -D warnings
  cargo clippy --workspace -- -D warnings
  shell: /usr/bin/bash -e {0}
##[endgroup]
warning: unused variable
error[E0308]: mismatched types
##[error]Process completed with exit code 101.";

        let result = extract_failed_step(log).expect("should find a step");
        assert_eq!(
            result.command.as_deref(),
            Some("cargo clippy --workspace -- -D warnings")
        );
        assert!(result.output.contains("error[E0308]"));
        assert!(!result.output.contains("##[endgroup]"));
        assert!(!result.output.contains("##[error]"));
    }

    // -------------------------------------------------------------------------
    // 2. Step extraction — no markers
    // -------------------------------------------------------------------------

    #[test]
    fn step_extraction_no_markers() {
        let lines: Vec<String> = (0..60).map(|i| format!("line {i}")).collect();
        let log = lines.join("\n");

        let result = parse_ci_log(&log).expect("should return an excerpt");
        // No command when there are no markers.
        assert!(result.command.is_none());
        // Should use the last 50 lines.
        let output_lines: Vec<&str> = result.output.lines().collect();
        assert_eq!(output_lines.len(), 50);
        assert!(result.output.contains("line 59"));
        assert!(!result.output.contains("line 9\n")); // line 9 is before the 50-line window
    }

    // -------------------------------------------------------------------------
    // 3. ANSI red detection
    // -------------------------------------------------------------------------

    #[test]
    fn ansi_red_detection() {
        let text = "\
normal line 1
context before
\x1b[31merror: something bad\x1b[0m
context after
normal line 5";

        let result = extract_error_lines(text, 2).expect("should find red lines");
        assert!(result.contains("error: something bad"));
        assert!(result.contains("context before"));
        assert!(result.contains("context after"));
    }

    // -------------------------------------------------------------------------
    // 4. ANSI red detection — overlapping context
    // -------------------------------------------------------------------------

    #[test]
    fn ansi_red_overlapping_context() {
        let lines = [
            "line 0",
            "line 1",
            "\x1b[31merror A\x1b[0m", // index 2
            "line 3",
            "line 4",
            "\x1b[91merror B\x1b[0m", // index 5 (3 apart from A)
            "line 6",
            "line 7",
        ];
        let text = lines.join("\n");

        let result = extract_error_lines(&text, 2).expect("should find red lines");
        // No "..." separator because context windows overlap/touch
        assert!(
            !result.contains("..."),
            "ranges should be merged, no separator needed"
        );
        assert!(result.contains("error A"));
        assert!(result.contains("error B"));
    }

    // -------------------------------------------------------------------------
    // 5. No red lines fallback
    // -------------------------------------------------------------------------

    #[test]
    fn no_red_lines_fallback() {
        let lines: Vec<String> = (0..60).map(|i| format!("plain line {i}")).collect();
        let log = format!(
            "##[group]Run make test\n##[endgroup]\n{}\n##[error]exit 1",
            lines.join("\n")
        );

        let result = parse_ci_log(&log).expect("should produce output");
        // Falls back to last 50 lines of step output.
        let output_lines: Vec<&str> = result.output.lines().collect();
        assert_eq!(output_lines.len(), 50);
    }

    // -------------------------------------------------------------------------
    // 6. ANSI stripping
    // -------------------------------------------------------------------------

    #[test]
    fn ansi_stripping() {
        let input = "\x1b[1;31merror\x1b[0m: \x1b[32msuccess\x1b[0m normal";
        let result = strip_ansi_codes(input);
        assert_eq!(result, "error: success normal");
    }

    // -------------------------------------------------------------------------
    // 7. Timestamp stripping
    // -------------------------------------------------------------------------

    #[test]
    fn timestamp_stripping() {
        let input =
            "2024-01-15T10:30:45.1234567Z actual log content\nnormal line without timestamp";
        let result = strip_timestamps(input);
        assert!(result.contains("actual log content"));
        assert!(!result.contains("2024-01-15T"));
        assert!(result.contains("normal line without timestamp"));
    }

    // -------------------------------------------------------------------------
    // 8. Output capping
    // -------------------------------------------------------------------------

    #[test]
    fn output_capping() {
        let lines: Vec<String> = (0..200).map(|i| format!("line {i}")).collect();
        let text = lines.join("\n");
        let capped = cap_lines(&text, 150);
        let count = capped.lines().count();
        assert_eq!(count, 150);
        // Should be the tail.
        assert!(capped.contains("line 199"));
        assert!(!capped.contains("line 49\n"));
    }

    // -------------------------------------------------------------------------
    // 9. Empty input
    // -------------------------------------------------------------------------

    #[test]
    fn empty_input_returns_none() {
        assert!(parse_ci_log("").is_none());
    }

    // -------------------------------------------------------------------------
    // 10. Realistic Rust/cargo clippy failure
    // -------------------------------------------------------------------------

    #[test]
    fn realistic_cargo_clippy_failure() {
        let log =
            "2024-01-15T10:30:45.1234567Z ##[group]Run cargo clippy --workspace -- -D warnings\n\
2024-01-15T10:30:45.2345678Z   CARGO_INCREMENTAL=0\n\
2024-01-15T10:30:45.3456789Z   cargo clippy --workspace -- -D warnings\n\
2024-01-15T10:30:45.4567890Z   shell: /usr/bin/bash -e {0}\n\
2024-01-15T10:30:45.5678901Z ##[endgroup]\n\
2024-01-15T10:30:46.1234567Z    Compiling orkestra-core v0.1.0\n\
2024-01-15T10:30:47.1234567Z \x1b[0;31merror[E0308]\x1b[0m\x1b[1m: mismatched types\x1b[0m\n\
2024-01-15T10:30:47.2345678Z   \x1b[0;34m-->\x1b[0m src/lib.rs:42:5\n\
2024-01-15T10:30:47.3456789Z    |\n\
2024-01-15T10:30:47.4567890Z 42 |     bad_call()\n\
2024-01-15T10:30:47.5678901Z    |     \x1b[0;31m^^^^^^^^^^^\x1b[0m\n\
2024-01-15T10:30:47.6789012Z    |\n\
2024-01-15T10:30:47.7890123Z    = note: expected type `String`\n\
2024-01-15T10:30:47.8901234Z \x1b[0;31merror\x1b[0m: aborting due to 1 previous error\n\
2024-01-15T10:30:47.9012345Z ##[error]Process completed with exit code 101.";

        let result = parse_ci_log(log).expect("should parse realistic log");

        // Command extracted correctly.
        assert_eq!(
            result.command.as_deref(),
            Some("cargo clippy --workspace -- -D warnings")
        );

        // Error diagnostics present.
        assert!(result.output.contains("E0308"));
        assert!(result.output.contains("mismatched types"));

        // Timestamps stripped.
        assert!(!result.output.contains("2024-01-15T"));

        // ANSI codes stripped.
        assert!(!result.output.contains("\x1b["));
    }

    // -------------------------------------------------------------------------
    // Additional: multiple ANSI red variants
    // -------------------------------------------------------------------------

    #[test]
    fn all_red_ansi_variants_detected() {
        for pat in RED_ANSI_PATTERNS {
            let text = format!("before\n{pat}error line\x1b[0m\nafter");
            let result = extract_error_lines(&text, 0);
            assert!(
                result.is_some(),
                "pattern {pat:?} should be detected as red"
            );
        }
    }

    // -------------------------------------------------------------------------
    // Additional: non-adjacent context ranges get separator
    // -------------------------------------------------------------------------

    #[test]
    fn non_adjacent_ranges_get_separator() {
        let lines = vec![
            "line 0",
            "line 1",
            "\x1b[31merror A\x1b[0m", // index 2, context 1 → range [1..3]
            "line 3",
            "line 4",
            "line 5",
            "line 6",
            "\x1b[31merror B\x1b[0m", // index 7, context 1 → range [6..8]
            "line 8",
        ];
        let text = lines.join("\n");

        let result = extract_error_lines(&text, 1).expect("should find red lines");
        assert!(
            result.contains("..."),
            "non-adjacent spans should have '...' separator"
        );
    }
}
