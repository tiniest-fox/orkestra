//! Provider registry for resolving model specs to process spawner implementations.
//!
//! The registry uses prefix-based routing to dispatch model specs to providers:
//! - `"claude/X"` or `"claudecode/X"` → Claude Code provider with model X (prefix stripped)
//! - `"codex/X"` → error (not yet implemented)
//! - `"prefix/model"` (any other prefix) → `OpenCode` with full spec as model ID
//! - `"alias"` (bare name, no `/`) → search alias tables; error on miss
//! - `None` → default provider's default model

use std::collections::HashMap;
use std::sync::Arc;

use orkestra_parser::{
    AgentParser, ClaudeParserService as ClaudeAgentParser,
    OpenCodeParserService as OpenCodeAgentParser,
};

use orkestra_process::ProcessSpawner;

// ============================================================================
// Provider Capabilities
// ============================================================================

/// Capabilities of a provider, describing what features it supports.
#[derive(Debug, Clone)]
#[allow(clippy::struct_excessive_bools)]
pub struct ProviderCapabilities {
    /// Whether the provider supports native `--json-schema` enforcement.
    pub supports_json_schema: bool,
    /// Whether the provider supports session resume (`--session-id` / `--resume`).
    pub supports_sessions: bool,
    /// Whether the provider generates its own session IDs (e.g., `OpenCode`'s `ses_...`).
    /// When true, the caller should NOT pre-generate a UUID — the session ID will be
    /// extracted from the provider's output stream. When false (Claude Code), the caller
    /// supplies a UUID via `--session-id` on first spawn.
    pub generates_own_session_id: bool,
    /// Whether the provider's `StructuredOutput` tool requires JSON properties
    /// to be passed directly as input fields (not as a JSON string in `content` field).
    /// True for Claude Code, false for `OpenCode`.
    pub requires_direct_structured_output: bool,
    /// Whether the provider supports system prompts (e.g., `--system` flag).
    pub supports_system_prompt: bool,
}

// ============================================================================
// Registered Provider
// ============================================================================

/// A registered provider with its spawner, capabilities, and alias table.
struct RegisteredProvider {
    /// The process spawner implementation.
    spawner: Arc<dyn ProcessSpawner>,
    /// Provider capabilities.
    capabilities: ProviderCapabilities,
    /// Alias map: friendly name → resolved model ID.
    /// e.g., "sonnet" → "claude-sonnet-4-6"
    aliases: HashMap<String, String>,
}

// ============================================================================
// Resolved Provider
// ============================================================================

/// Result of resolving a model spec through the registry.
#[derive(Clone)]
pub struct ResolvedProvider {
    /// The process spawner for this provider.
    pub spawner: Arc<dyn ProcessSpawner>,
    /// The resolved model ID to pass via `--model` flag, or None for provider default.
    pub model_id: Option<String>,
    /// The provider's capabilities.
    pub capabilities: ProviderCapabilities,
    /// The name of the resolved provider (e.g., "claudecode", "opencode").
    pub provider_name: String,
}

impl std::fmt::Debug for ResolvedProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResolvedProvider")
            .field("provider_name", &self.provider_name)
            .field("model_id", &self.model_id)
            .field("capabilities", &self.capabilities)
            .finish_non_exhaustive()
    }
}

// ============================================================================
// Resolution Error
// ============================================================================

/// Errors that can occur during provider resolution.
#[derive(Debug, Clone)]
pub enum RegistryError {
    /// The provider name in the model spec is not registered.
    UnknownProvider(String),
    /// The `codex/` prefix is reserved but the provider isn't implemented yet.
    ProviderNotImplemented(String),
    /// A bare alias (no `/` prefix) had no match in any provider's alias table.
    UnknownAlias {
        alias: String,
        available: Vec<String>,
    },
}

impl std::fmt::Display for RegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownProvider(name) => write!(f, "Unknown provider: \"{name}\""),
            Self::ProviderNotImplemented(name) => {
                write!(f, "Provider \"{name}\" is not yet implemented")
            }
            Self::UnknownAlias { alias, available } => {
                write!(
                    f,
                    "Unknown model alias \"{alias}\". Available aliases: {}",
                    available.join(", ")
                )
            }
        }
    }
}

impl std::error::Error for RegistryError {}

// ============================================================================
// Provider Registry
// ============================================================================

/// Registry that maps provider names to `ProcessSpawner` implementations.
///
/// Resolves model specs using prefix-based routing:
/// - `"claude/X"` or `"claudecode/X"` → Claude Code with model X (prefix stripped)
/// - `"codex/X"` → error (not yet implemented)
/// - `"prefix/model"` → `OpenCode` with full spec as model ID
/// - `"alias"` → search alias tables; error on miss
/// - `None` → default provider's default model
pub struct ProviderRegistry {
    providers: HashMap<String, RegisteredProvider>,
    default_provider: String,
}

impl ProviderRegistry {
    /// Create an empty registry with the given default provider name.
    ///
    /// The default provider is used when `resolve()` is called with `None`.
    pub fn new(default_provider: impl Into<String>) -> Self {
        Self {
            providers: HashMap::new(),
            default_provider: default_provider.into(),
        }
    }

    /// Register a provider with its spawner, capabilities, and alias table.
    pub fn register(
        &mut self,
        name: impl Into<String>,
        spawner: Arc<dyn ProcessSpawner>,
        capabilities: ProviderCapabilities,
        aliases: HashMap<String, String>,
    ) {
        self.providers.insert(
            name.into(),
            RegisteredProvider {
                spawner,
                capabilities,
                aliases,
            },
        );
    }

    /// Resolve a model spec into a provider and model ID.
    ///
    /// Routing rules (in priority order):
    /// - `"claude/X"` or `"claudecode/X"` → Claude Code provider with model X
    /// - `"codex/X"` → error (`ProviderNotImplemented`)
    /// - `"prefix/model"` (any other prefix) → `OpenCode` with full spec as model ID
    /// - `"alias"` (bare name) → search alias tables; `UnknownAlias` error on miss
    /// - `None` → default provider with no model ID
    pub fn resolve(&self, model_spec: Option<&str>) -> Result<ResolvedProvider, RegistryError> {
        match model_spec {
            None => self.resolve_default(),
            Some(spec) => self.resolve_spec(spec),
        }
    }

    /// Check whether a provider name is registered.
    pub fn has_provider(&self, name: &str) -> bool {
        self.providers.contains_key(name)
    }

    /// Get the capabilities for a named provider.
    pub fn provider_capabilities(&self, name: &str) -> Option<ProviderCapabilities> {
        self.providers.get(name).map(|p| p.capabilities.clone())
    }

    /// List all registered provider names.
    pub fn provider_names(&self) -> Vec<&str> {
        self.providers.keys().map(String::as_str).collect()
    }

    /// Create a provider-specific `AgentParser` for the given provider name.
    ///
    /// This is the single dispatch point for parser creation. Adding a new provider
    /// requires one match arm here and a new parser implementation.
    ///
    /// Returns `Err` if the provider has no registered parser — forces new providers
    /// to implement one rather than silently falling back to Claude's format.
    pub fn create_parser(
        &self,
        provider_name: &str,
    ) -> Result<Box<dyn AgentParser>, RegistryError> {
        match provider_name {
            "claudecode" => Ok(Box::new(ClaudeAgentParser::new())),
            "opencode" => Ok(Box::new(OpenCodeAgentParser::new())),
            _ => Err(RegistryError::UnknownProvider(provider_name.to_string())),
        }
    }

    // -- Internal resolution --

    /// Resolve with no model spec — return the default provider with no model ID.
    fn resolve_default(&self) -> Result<ResolvedProvider, RegistryError> {
        let provider = self
            .providers
            .get(&self.default_provider)
            .ok_or_else(|| RegistryError::UnknownProvider(self.default_provider.clone()))?;

        Ok(ResolvedProvider {
            spawner: Arc::clone(&provider.spawner),
            model_id: None,
            capabilities: provider.capabilities.clone(),
            provider_name: self.default_provider.clone(),
        })
    }

    /// Resolve a non-empty model spec string using prefix-based routing.
    fn resolve_spec(&self, spec: &str) -> Result<ResolvedProvider, RegistryError> {
        if let Some(model) = spec.strip_prefix("claude/") {
            self.resolve_with_provider("claudecode", Some(model.to_string()))
        } else if let Some(model) = spec.strip_prefix("claudecode/") {
            self.resolve_with_provider("claudecode", Some(model.to_string()))
        } else if spec.starts_with("codex/") {
            Err(RegistryError::ProviderNotImplemented("codex".to_string()))
        } else if spec.contains('/') {
            self.resolve_with_provider("opencode", Some(spec.to_string()))
        } else {
            self.resolve_alias(spec)
        }
    }

    /// Resolve to a specific provider with the given model ID (no alias resolution).
    fn resolve_with_provider(
        &self,
        provider_name: &str,
        model_id: Option<String>,
    ) -> Result<ResolvedProvider, RegistryError> {
        let provider = self
            .providers
            .get(provider_name)
            .ok_or_else(|| RegistryError::UnknownProvider(provider_name.to_string()))?;

        Ok(ResolvedProvider {
            spawner: Arc::clone(&provider.spawner),
            model_id,
            capabilities: provider.capabilities.clone(),
            provider_name: provider_name.to_string(),
        })
    }

    /// Resolve a bare alias by searching all providers' alias tables.
    ///
    /// Returns `UnknownAlias` with the sorted list of available aliases on miss.
    fn resolve_alias(&self, alias: &str) -> Result<ResolvedProvider, RegistryError> {
        for (provider_name, provider) in &self.providers {
            if let Some(resolved) = provider.aliases.get(alias) {
                return Ok(ResolvedProvider {
                    spawner: Arc::clone(&provider.spawner),
                    model_id: Some(resolved.clone()),
                    capabilities: provider.capabilities.clone(),
                    provider_name: provider_name.clone(),
                });
            }
        }

        let mut available: Vec<String> = self
            .providers
            .values()
            .flat_map(|p| p.aliases.keys().cloned())
            .collect();
        available.sort();
        Err(RegistryError::UnknownAlias {
            alias: alias.to_string(),
            available,
        })
    }
}

// ============================================================================
// Built-in Alias Tables
// ============================================================================

/// Claude Code provider alias table.
pub fn claudecode_aliases() -> HashMap<String, String> {
    orkestra_types::config::models::claudecode_model_entries()
        .iter()
        .map(|e| (e.alias.to_string(), e.model_id.to_string()))
        .collect()
}

/// `OpenCode` provider alias table.
pub fn opencode_aliases() -> HashMap<String, String> {
    orkestra_types::config::models::opencode_model_entries()
        .iter()
        .map(|e| (e.alias.to_string(), e.model_id.to_string()))
        .collect()
}

/// Claude Code provider capabilities.
pub fn claudecode_capabilities() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_json_schema: true,
        supports_sessions: true,
        generates_own_session_id: false,
        requires_direct_structured_output: true,
        supports_system_prompt: true,
    }
}

/// `OpenCode` provider capabilities.
pub fn opencode_capabilities() -> ProviderCapabilities {
    ProviderCapabilities {
        supports_json_schema: false,
        supports_sessions: true,
        generates_own_session_id: true,
        requires_direct_structured_output: false,
        supports_system_prompt: false,
    }
}

// ============================================================================
// Test Utilities
// ============================================================================

/// Create a default registry for testing.
///
/// Registers a stub claudecode provider with correct capabilities and aliases.
/// The spawner never actually spawns processes (tests use mock runners that
/// bypass process spawning entirely). This registry is needed so that
/// `AgentExecutionService` can check provider capabilities (e.g.,
/// `supports_json_schema`) when building prompts.
#[cfg(any(test, feature = "testutil"))]
pub fn default_test_registry() -> ProviderRegistry {
    use orkestra_process::{ProcessConfig, ProcessError, ProcessHandle, ProcessSpawner};
    use std::path::Path;

    /// Stub spawner that never spawns real processes. Used in tests where
    /// mock runners handle execution and the spawner is never called.
    struct StubSpawner;

    impl ProcessSpawner for StubSpawner {
        fn spawn(
            &self,
            _working_dir: &Path,
            _config: ProcessConfig,
        ) -> Result<ProcessHandle, ProcessError> {
            Err(ProcessError::SpawnFailed(
                "StubSpawner does not spawn real processes (test-only)".to_string(),
            ))
        }
    }

    let mut registry = ProviderRegistry::new("claudecode");
    registry.register(
        "claudecode",
        Arc::new(StubSpawner),
        claudecode_capabilities(),
        claudecode_aliases(),
    );
    registry.register(
        "opencode",
        Arc::new(StubSpawner),
        opencode_capabilities(),
        opencode_aliases(),
    );
    registry
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use orkestra_process::{ProcessConfig, ProcessError, ProcessHandle};
    use std::path::Path;

    /// Minimal spawner for tests — never actually spawns.
    struct StubSpawner {
        name: String,
    }

    impl StubSpawner {
        fn new(name: &str) -> Self {
            Self {
                name: name.to_string(),
            }
        }
    }

    impl ProcessSpawner for StubSpawner {
        fn spawn(
            &self,
            _working_dir: &Path,
            _config: ProcessConfig,
        ) -> Result<ProcessHandle, ProcessError> {
            Err(ProcessError::SpawnFailed(format!(
                "StubSpawner({}) does not spawn real processes",
                self.name
            )))
        }
    }

    fn test_registry() -> ProviderRegistry {
        let mut registry = ProviderRegistry::new("claudecode");
        registry.register(
            "claudecode",
            Arc::new(StubSpawner::new("claudecode")),
            claudecode_capabilities(),
            claudecode_aliases(),
        );
        registry.register(
            "opencode",
            Arc::new(StubSpawner::new("opencode")),
            opencode_capabilities(),
            opencode_aliases(),
        );
        registry
    }

    // -- Prefix-based routing: claude/ and claudecode/ --

    #[test]
    fn resolve_claude_prefix_strips_and_routes_to_claudecode() {
        let registry = test_registry();
        let resolved = registry.resolve(Some("claude/sonnet")).unwrap();
        assert_eq!(resolved.provider_name, "claudecode");
        assert_eq!(resolved.model_id, Some("sonnet".to_string()));
        assert!(resolved.capabilities.supports_json_schema);
    }

    #[test]
    fn resolve_claudecode_prefix_strips_and_routes_to_claudecode() {
        let registry = test_registry();
        let resolved = registry.resolve(Some("claudecode/opus")).unwrap();
        assert_eq!(resolved.provider_name, "claudecode");
        assert_eq!(resolved.model_id, Some("opus".to_string()));
    }

    #[test]
    fn resolve_claude_prefix_with_raw_model_id() {
        let registry = test_registry();
        let resolved = registry.resolve(Some("claude/claude-opus-4-6")).unwrap();
        assert_eq!(resolved.model_id, Some("claude-opus-4-6".to_string()));
        assert_eq!(resolved.provider_name, "claudecode");
    }

    // -- Prefix-based routing: opencode (unknown prefix passes full spec) --

    #[test]
    fn resolve_prefixed_opencode_passes_full_spec() {
        let registry = test_registry();
        let resolved = registry.resolve(Some("opencode/kimi-k2.6")).unwrap();
        assert_eq!(resolved.provider_name, "opencode");
        assert_eq!(resolved.model_id, Some("opencode/kimi-k2.6".to_string()));
        assert!(!resolved.capabilities.supports_json_schema);
    }

    #[test]
    fn resolve_unknown_prefix_routes_to_opencode() {
        let registry = test_registry();
        let resolved = registry
            .resolve(Some("moonshot/kimi-k2-0711-preview"))
            .unwrap();
        assert_eq!(resolved.provider_name, "opencode");
        assert_eq!(
            resolved.model_id,
            Some("moonshot/kimi-k2-0711-preview".to_string())
        );
    }

    #[test]
    fn resolve_anthropic_prefix_routes_to_opencode() {
        let registry = test_registry();
        let resolved = registry
            .resolve(Some("anthropic/claude-3-5-sonnet"))
            .unwrap();
        assert_eq!(resolved.provider_name, "opencode");
        assert_eq!(
            resolved.model_id,
            Some("anthropic/claude-3-5-sonnet".to_string())
        );
        assert!(!resolved.capabilities.supports_json_schema);
    }

    // -- Prefix-based routing: codex/ error --

    #[test]
    fn resolve_codex_prefix_returns_not_implemented() {
        let registry = test_registry();
        let result = registry.resolve(Some("codex/anything"));
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            RegistryError::ProviderNotImplemented(ref name) if name == "codex"
        ));
    }

    // -- Shorthand resolution (no provider prefix) --

    #[test]
    fn resolve_shorthand_sonnet() {
        let registry = test_registry();
        let resolved = registry.resolve(Some("sonnet")).unwrap();
        assert_eq!(resolved.model_id, Some("claude-sonnet-4-6".to_string()));
        assert!(resolved.capabilities.supports_json_schema);
    }

    #[test]
    fn resolve_shorthand_kimi() {
        let registry = test_registry();
        let resolved = registry.resolve(Some("kimi-k2")).unwrap();
        assert_eq!(
            resolved.model_id,
            Some("moonshot/kimi-k2-0711-preview".to_string())
        );
        assert!(!resolved.capabilities.supports_json_schema);
    }

    #[test]
    fn resolve_shorthand_unknown_returns_error() {
        let registry = test_registry();
        let result = registry.resolve(Some("some-unknown-model"));
        assert!(result.is_err());
        match result.unwrap_err() {
            RegistryError::UnknownAlias { alias, available } => {
                assert_eq!(alias, "some-unknown-model");
                assert!(available.contains(&"haiku".to_string()));
                assert!(available.contains(&"sonnet".to_string()));
                assert!(available.contains(&"opus".to_string()));
                assert!(available.contains(&"kimi-k2".to_string()));
                assert!(available.contains(&"kimi-k2.5".to_string()));
                assert!(available.contains(&"kimi-k2.6".to_string()));
            }
            other => panic!("expected UnknownAlias, got {other:?}"),
        }
    }

    #[test]
    fn resolve_unknown_alias_error_lists_available() {
        let registry = test_registry();
        let result = registry.resolve(Some("nonexistent"));
        let err = result.unwrap_err();
        match &err {
            RegistryError::UnknownAlias { alias, available } => {
                assert_eq!(alias, "nonexistent");
                // Available list should be sorted
                let mut sorted = available.clone();
                sorted.sort();
                assert_eq!(available, &sorted);
            }
            other => panic!("expected UnknownAlias, got {other:?}"),
        }
        // Display message should be well-formed
        let msg = err.to_string();
        assert!(msg.contains("nonexistent"));
        assert!(msg.contains("Available aliases:"));
        assert!(msg.contains("sonnet"));
    }

    // -- No model spec (None) --

    #[test]
    fn resolve_none_uses_default_provider() {
        let registry = test_registry();
        let resolved = registry.resolve(None).unwrap();
        assert_eq!(resolved.model_id, None);
        assert!(resolved.capabilities.supports_json_schema);
        assert!(resolved.capabilities.supports_sessions);
    }

    // -- Error cases --

    #[test]
    fn resolve_empty_registry_default_fails() {
        let registry = ProviderRegistry::new("claudecode");
        let result = registry.resolve(None);
        assert!(result.is_err());
    }

    // -- Registry API --

    #[test]
    fn has_provider_returns_true_for_registered() {
        let registry = test_registry();
        assert!(registry.has_provider("claudecode"));
        assert!(registry.has_provider("opencode"));
    }

    #[test]
    fn has_provider_returns_false_for_unregistered() {
        let registry = test_registry();
        assert!(!registry.has_provider("nonexistent"));
    }

    #[test]
    fn provider_capabilities_returns_correct_values() {
        let registry = test_registry();

        let claude_caps = registry.provider_capabilities("claudecode").unwrap();
        assert!(claude_caps.supports_json_schema);
        assert!(claude_caps.supports_sessions);
        assert!(claude_caps.supports_system_prompt);

        let open_caps = registry.provider_capabilities("opencode").unwrap();
        assert!(!open_caps.supports_json_schema);
        assert!(open_caps.supports_sessions);
        assert!(!open_caps.supports_system_prompt);
    }

    #[test]
    fn provider_capabilities_returns_none_for_unregistered() {
        let registry = test_registry();
        assert!(registry.provider_capabilities("nonexistent").is_none());
    }

    #[test]
    fn provider_names_lists_all_registered() {
        let registry = test_registry();
        let mut names = registry.provider_names();
        names.sort_unstable();
        assert_eq!(names, vec!["claudecode", "opencode"]);
    }

    // -- Alias table tests --

    #[test]
    fn claudecode_aliases_are_correct() {
        let aliases = claudecode_aliases();
        assert_eq!(aliases["sonnet"], "claude-sonnet-4-6");
        assert_eq!(aliases["opus"], "claude-opus-4-6");
        assert_eq!(aliases["haiku"], "claude-haiku-4-5-20251001");
        assert_eq!(aliases.len(), 3);
    }

    #[test]
    fn opencode_aliases_are_correct() {
        let aliases = opencode_aliases();
        assert_eq!(aliases["kimi-k2"], "moonshot/kimi-k2-0711-preview");
        assert_eq!(aliases["kimi-k2.5"], "opencode/kimi-k2.5-free");
        assert_eq!(aliases["kimi-k2.6"], "moonshot/kimi-k2.6");
        assert_eq!(aliases.len(), 3);
    }
}
