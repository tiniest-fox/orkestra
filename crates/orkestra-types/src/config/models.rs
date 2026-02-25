//! Shared model metadata for all supported providers.
//!
//! Single source of truth for alias → (`model_id`, `display_name`) mappings.
//! Used by the provider registry for alias resolution and by commit message
//! generation for friendly display names.

// ============================================================================
// Model Entry
// ============================================================================

/// A model entry mapping an alias to its resolved model ID and display name.
#[derive(Debug, Clone, Copy)]
pub struct ModelEntry {
    /// Short alias used in workflow config (e.g., "sonnet").
    pub alias: &'static str,
    /// Fully-qualified model ID passed to the provider CLI (e.g., "claude-sonnet-4-6").
    pub model_id: &'static str,
    /// Human-readable display name for Co-authored-by trailers (e.g., "Claude Sonnet 4").
    pub display_name: &'static str,
    /// Provider name this entry belongs to (e.g., "claudecode").
    pub provider: &'static str,
}

// ============================================================================
// Provider Model Tables
// ============================================================================

/// Claude Code model entries.
pub fn claudecode_model_entries() -> &'static [ModelEntry] {
    &[
        ModelEntry {
            alias: "sonnet",
            model_id: "claude-sonnet-4-6",
            display_name: "Claude Sonnet 4",
            provider: "claudecode",
        },
        ModelEntry {
            alias: "opus",
            model_id: "claude-opus-4-6",
            display_name: "Claude Opus 4",
            provider: "claudecode",
        },
        ModelEntry {
            alias: "haiku",
            model_id: "claude-haiku-4-5-20251001",
            display_name: "Claude Haiku 4.5",
            provider: "claudecode",
        },
    ]
}

/// `OpenCode` model entries.
pub fn opencode_model_entries() -> &'static [ModelEntry] {
    &[
        ModelEntry {
            alias: "kimi-k2",
            model_id: "moonshot/kimi-k2-0711-preview",
            display_name: "Kimi K2",
            provider: "opencode",
        },
        ModelEntry {
            alias: "kimi-k2.5",
            model_id: "opencode/kimi-k2.5-free",
            display_name: "Kimi K2.5",
            provider: "opencode",
        },
    ]
}

// ============================================================================
// Lookup
// ============================================================================

/// Map a model spec to a friendly display name for Co-authored-by.
///
/// Matches against each entry's alias, `provider/alias`, and raw model ID.
/// Falls back to returning the raw spec unchanged for unknowns.
///
/// - `None` → default model (Claude Sonnet 4)
/// - `"sonnet"` → "Claude Sonnet 4"
/// - `"claudecode/sonnet"` → "Claude Sonnet 4"
/// - `"claude-sonnet-4-6"` → "Claude Sonnet 4"
/// - `"unknown-model"` → "unknown-model"
pub fn friendly_model_name(model_spec: Option<&str>) -> &str {
    match model_spec {
        None => "Claude Sonnet 4",
        Some(spec) => {
            for entry in all_model_entries() {
                if spec == entry.alias
                    || spec == entry.model_id
                    || matches_provider_prefixed(spec, entry)
                {
                    return entry.display_name;
                }
            }
            spec
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// All model entries across all providers, in registration order.
fn all_model_entries() -> impl Iterator<Item = &'static ModelEntry> {
    claudecode_model_entries()
        .iter()
        .chain(opencode_model_entries().iter())
}

/// Check whether `spec` matches the `provider/alias` form for an entry.
fn matches_provider_prefixed(spec: &str, entry: &ModelEntry) -> bool {
    spec.len() == entry.provider.len() + 1 + entry.alias.len()
        && spec.starts_with(entry.provider)
        && spec[entry.provider.len()..].starts_with('/')
        && spec[entry.provider.len() + 1..] == *entry.alias
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -- friendly_model_name --

    #[test]
    fn friendly_name_none_returns_default() {
        assert_eq!(friendly_model_name(None), "Claude Sonnet 4");
    }

    #[test]
    fn friendly_name_alias_forms() {
        assert_eq!(friendly_model_name(Some("sonnet")), "Claude Sonnet 4");
        assert_eq!(friendly_model_name(Some("opus")), "Claude Opus 4");
        assert_eq!(friendly_model_name(Some("haiku")), "Claude Haiku 4.5");
        assert_eq!(friendly_model_name(Some("kimi-k2")), "Kimi K2");
        assert_eq!(friendly_model_name(Some("kimi-k2.5")), "Kimi K2.5");
    }

    #[test]
    fn friendly_name_provider_prefixed_forms() {
        assert_eq!(
            friendly_model_name(Some("claudecode/sonnet")),
            "Claude Sonnet 4"
        );
        assert_eq!(
            friendly_model_name(Some("claudecode/opus")),
            "Claude Opus 4"
        );
        assert_eq!(
            friendly_model_name(Some("claudecode/haiku")),
            "Claude Haiku 4.5"
        );
        assert_eq!(friendly_model_name(Some("opencode/kimi-k2")), "Kimi K2");
        assert_eq!(friendly_model_name(Some("opencode/kimi-k2.5")), "Kimi K2.5");
    }

    #[test]
    fn friendly_name_raw_model_ids() {
        assert_eq!(
            friendly_model_name(Some("claude-sonnet-4-6")),
            "Claude Sonnet 4"
        );
        assert_eq!(
            friendly_model_name(Some("claude-opus-4-6")),
            "Claude Opus 4"
        );
        assert_eq!(
            friendly_model_name(Some("claude-haiku-4-5-20251001")),
            "Claude Haiku 4.5"
        );
        assert_eq!(
            friendly_model_name(Some("moonshot/kimi-k2-0711-preview")),
            "Kimi K2"
        );
        assert_eq!(
            friendly_model_name(Some("opencode/kimi-k2.5-free")),
            "Kimi K2.5"
        );
    }

    #[test]
    fn friendly_name_unknown_passes_through() {
        assert_eq!(
            friendly_model_name(Some("some-unknown-model")),
            "some-unknown-model"
        );
        assert_eq!(
            friendly_model_name(Some("my-custom-opus-variant")),
            "my-custom-opus-variant"
        );
        // Old stale model IDs now pass through unchanged
        assert_eq!(
            friendly_model_name(Some("claude-sonnet-4-5-20250929")),
            "claude-sonnet-4-5-20250929"
        );
        assert_eq!(
            friendly_model_name(Some("claude-opus-4-5-20251101")),
            "claude-opus-4-5-20251101"
        );
    }

    // -- claudecode_model_entries --

    #[test]
    fn claudecode_entries_are_correct() {
        let entries = claudecode_model_entries();
        assert_eq!(entries.len(), 3);

        let sonnet = entries.iter().find(|e| e.alias == "sonnet").unwrap();
        assert_eq!(sonnet.model_id, "claude-sonnet-4-6");
        assert_eq!(sonnet.display_name, "Claude Sonnet 4");
        assert_eq!(sonnet.provider, "claudecode");

        let opus = entries.iter().find(|e| e.alias == "opus").unwrap();
        assert_eq!(opus.model_id, "claude-opus-4-6");
        assert_eq!(opus.display_name, "Claude Opus 4");

        let haiku = entries.iter().find(|e| e.alias == "haiku").unwrap();
        assert_eq!(haiku.model_id, "claude-haiku-4-5-20251001");
        assert_eq!(haiku.display_name, "Claude Haiku 4.5");
    }

    // -- opencode_model_entries --

    #[test]
    fn opencode_entries_are_correct() {
        let entries = opencode_model_entries();
        assert_eq!(entries.len(), 2);

        let k2 = entries.iter().find(|e| e.alias == "kimi-k2").unwrap();
        assert_eq!(k2.model_id, "moonshot/kimi-k2-0711-preview");
        assert_eq!(k2.display_name, "Kimi K2");
        assert_eq!(k2.provider, "opencode");

        let k25 = entries.iter().find(|e| e.alias == "kimi-k2.5").unwrap();
        assert_eq!(k25.model_id, "opencode/kimi-k2.5-free");
        assert_eq!(k25.display_name, "Kimi K2.5");
    }
}
