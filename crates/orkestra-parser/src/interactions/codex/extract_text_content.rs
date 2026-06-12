//! Extract text from Codex `agent_message` item events.

/// Extract the text string from an `agent_message` item event.
///
/// Returns `None` if the item is not an `agent_message`, the text field is absent,
/// or the trimmed text is empty.
pub fn execute(v: &serde_json::Value) -> Option<String> {
    let item_type = v["item"]["type"].as_str()?;
    if item_type != "agent_message" {
        return None;
    }
    let text = v["item"]["text"].as_str()?.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_text_from_agent_message() {
        let v = serde_json::json!({
            "type": "item.completed",
            "item": {
                "id": "item_1",
                "type": "agent_message",
                "text": "done"
            }
        });
        assert_eq!(execute(&v), Some("done".to_string()));
    }

    #[test]
    fn trims_whitespace() {
        let v = serde_json::json!({
            "type": "item.completed",
            "item": {
                "type": "agent_message",
                "text": "  hello world  "
            }
        });
        assert_eq!(execute(&v), Some("hello world".to_string()));
    }

    #[test]
    fn returns_none_for_empty_text() {
        let v = serde_json::json!({
            "type": "item.completed",
            "item": {
                "type": "agent_message",
                "text": "   "
            }
        });
        assert!(execute(&v).is_none());
    }

    #[test]
    fn returns_none_for_wrong_item_type() {
        let v = serde_json::json!({
            "type": "item.started",
            "item": {
                "type": "command_execution",
                "text": "should not extract"
            }
        });
        assert!(execute(&v).is_none());
    }

    #[test]
    fn returns_none_when_no_item_type() {
        let v = serde_json::json!({
            "type": "item.completed",
            "item": {
                "text": "some text"
            }
        });
        assert!(execute(&v).is_none());
    }
}
