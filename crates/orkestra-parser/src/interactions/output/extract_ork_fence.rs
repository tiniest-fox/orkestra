//! Extract structured JSON output from an ork fence (` ```ork ` ... ` ``` `).

use super::extract_fenced_json::fence_close_positions;

/// Count the number of valid ork fence openings in `text`.
///
/// Uses the same validation as `execute()`: the character after "ork"
/// must be whitespace or end-of-string. Rejects false matches like
/// `orkestra` or `ork-json`.
pub fn count_ork_fences(text: &str) -> usize {
    let mut count = 0;
    let mut search_from = 0;
    while search_from < text.len() {
        let Some(pos) = text[search_from..].find("```ork") else {
            break;
        };
        let abs_pos = search_from + pos;
        let after_tag = abs_pos + "```ork".len();
        let valid = match text[after_tag..].chars().next() {
            None => true,
            Some(c) => c.is_whitespace(),
        };
        if valid {
            count += 1;
        }
        search_from = abs_pos + 1;
    }
    count
}

/// Extract structured JSON from an ork fence in the given text.
///
/// Searches for `` ```ork\n `` ... `` \n``` `` blocks. When multiple ork fences
/// exist, the **last** one wins — agents may discuss the format in prose before
/// producing actual output.
///
/// Returns `Some(json_string)` when a valid JSON payload is found inside a fence.
/// Returns `None` when:
/// - No ork fence is present
/// - The fence content is not valid JSON
/// - The fence has no content
///
/// Handles JSON content containing embedded markdown code fences by trying each
/// candidate closing position from furthest to nearest and validating JSON at
/// each candidate. A premature closing position truncates the JSON, making it
/// invalid, so the first valid candidate (furthest first) is the real fence end.
pub fn execute(text: &str) -> Option<String> {
    let mut last_json: Option<String> = None;
    let mut search_from = 0;

    while search_from < text.len() {
        // Find the next opening ork fence
        let Some(fence_start) = text[search_from..].find("```ork") else {
            break;
        };
        let abs_fence_start = search_from + fence_start;

        // Find the end of the opening fence line (skip optional trailing text like ```ork json)
        let after_tag = abs_fence_start + "```ork".len();

        // Reject matches like ```orkestra or ```ork-json: the character after "ork"
        // must be whitespace, newline, or end-of-string.
        if let Some(next_char) = text[after_tag..].chars().next() {
            if !next_char.is_whitespace() {
                // Not a valid ork fence — skip past this match and keep searching
                search_from = abs_fence_start + 1;
                continue;
            }
        }
        let Some(newline_pos) = text[after_tag..].find('\n') else {
            break; // No newline after opening fence — malformed
        };
        let content_start = after_tag + newline_pos + 1;

        // Collect all candidate closing positions in the remaining text.
        // Try from furthest to nearest — a premature candidate truncates the JSON
        // making it invalid; the real closing fence produces valid JSON.
        let candidates = fence_close_positions(&text[content_start..]);

        if candidates.is_empty() {
            break; // No closing fence at all
        }

        let mut matched_offset: Option<usize> = None;

        for &offset in candidates.iter().rev() {
            let content = text[content_start..content_start + offset].trim();
            if !content.is_empty() && serde_json::from_str::<serde_json::Value>(content).is_ok() {
                last_json = Some(content.to_string());
                matched_offset = Some(offset);
                break;
            }
        }

        // Advance past the matched closing fence, or past all candidates if no match
        let advance_offset = matched_offset.unwrap_or(*candidates.last().unwrap());
        search_from = content_start + advance_offset + "\n```".len();
    }

    last_json
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -- count_ork_fences tests --

    #[test]
    fn count_ork_fences_no_fences() {
        assert_eq!(count_ork_fences("no fences here"), 0);
    }

    #[test]
    fn count_ork_fences_single() {
        assert_eq!(count_ork_fences("```ork\n{}\n```"), 1);
    }

    #[test]
    fn count_ork_fences_two() {
        assert_eq!(count_ork_fences("```ork\n{}\n```\n```ork\n{}\n```"), 2);
    }

    #[test]
    fn count_ork_fences_rejects_false_match() {
        assert_eq!(count_ork_fences("```orkestra\n{}\n```"), 0);
    }

    #[test]
    fn count_ork_fences_rejects_ork_hyphen() {
        assert_eq!(count_ork_fences("```ork-json\n{}\n```"), 0);
    }

    // -- execute tests --

    #[test]
    fn valid_fence_extracts_json() {
        let text = "```ork\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "summary");
    }

    #[test]
    fn invalid_json_in_fence_returns_none() {
        let text = "```ork\nnot valid json at all\n```";
        assert!(execute(text).is_none());
    }

    #[test]
    fn multiple_fences_last_wins() {
        let text = "```ork\n{\"type\":\"first\",\"content\":\"a\"}\n```\n\nSome prose\n\n```ork\n{\"type\":\"last\",\"content\":\"b\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "last");
    }

    #[test]
    fn no_fence_returns_none() {
        let text = "Just some plain text without any fences";
        assert!(execute(text).is_none());
    }

    #[test]
    fn ork_with_trailing_text_on_opening_line() {
        let text = "```ork json\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "summary");
    }

    #[test]
    fn empty_content_returns_none() {
        let text = "```ork\n\n```";
        assert!(execute(text).is_none());
    }

    #[test]
    fn orkestra_fence_is_not_matched() {
        let text = "```orkestra\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        assert!(execute(text).is_none());
    }

    #[test]
    fn ork_hyphen_fence_is_not_matched() {
        let text = "```ork-json\n{\"type\":\"summary\",\"content\":\"done\"}\n```";
        assert!(execute(text).is_none());
    }

    #[test]
    fn ork_fence_after_false_match() {
        // An ```orkestra fence followed by a real ```ork fence — only the real one should match.
        let text = "```orkestra\n{\"type\":\"wrong\"}\n```\n\n```ork\n{\"type\":\"right\",\"content\":\"ok\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "right");
    }

    #[test]
    fn prose_before_fence_is_ignored() {
        let text =
            "Here is my output:\n\n```ork\n{\"type\":\"artifact\",\"content\":\"result\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "artifact");
    }

    #[test]
    fn nested_fence_in_json_content() {
        // JSON with embedded code fences in a string value
        let text = "```ork\n{\"type\":\"artifact\",\"content\":\"```python\\ndef hello():\\n    pass\\n```\"}\n```";
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "artifact");
    }

    #[test]
    fn multiple_nested_fences_in_content() {
        // Content field with multiple code fence blocks
        let json_content = serde_json::json!({
            "type": "artifact",
            "content": "Example:\n```rust\nfn main() {}\n```\nAnd:\n```python\nprint()\n```"
        })
        .to_string();
        let text = format!("```ork\n{json_content}\n```");
        let result = execute(&text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "artifact");
    }

    #[test]
    fn nested_ork_fence_in_content() {
        // Content that itself contains an ork fence example
        let json_content = serde_json::json!({
            "type": "artifact",
            "content": "Use this format:\n```ork\n{\"type\": \"plan\"}\n```"
        })
        .to_string();
        let text = format!("```ork\n{json_content}\n```");
        let result = execute(&text);
        assert!(result.is_some());
    }

    #[test]
    fn multiple_candidate_closes_selects_valid_json() {
        // Text with multiple \n``` sequences — exercises the multi-candidate path.
        // The outer text wrapping the ork fence contains an additional code block,
        // producing two \n``` candidates inside the search window.
        //
        // The algorithm tries candidates from furthest to nearest. The furthest
        // candidate includes trailing garbage (invalid JSON). The nearer candidate
        // gives the complete valid JSON object. Confirms both that the algorithm
        // iterates candidates and that the correct JSON is returned.
        let text = "```ork\n{\"type\":\"ok\",\"a\":1}\n```broken\nnot-json-continuation\n```";
        // candidates in text[content_start..]:
        //   offset A (nearer):  \n```broken  → content = {"type":"ok","a":1}   → valid
        //   offset B (furthest):\n```         → content includes trailing garbage → invalid
        // Furthest-first: B fails, A succeeds.
        let result = execute(text);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["type"], "ok");
        assert_eq!(json["a"], 1);
    }
}
