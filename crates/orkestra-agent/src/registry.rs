//! Provider registry for resolving model specs to process spawner implementations.
//!
//! The registry maps provider names (e.g., "claudecode", "opencode") to their
//! `ProcessSpawner` implementations and handles model alias resolution.
//!
//! Model spec format: `provider/model` (e.g., "claudecode/sonnet", "opencode/kimi-k2").
//! Shorthand without provider prefix is supported — the registry checks all providers'
//! alias tables for a match, defaulting to "claudecode" if none match.

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
    /// e.g., "sonnet" → "claude-sonnet-4-5-20250929"
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
}

impl std::fmt::Display for RegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownProvider(name) => write!(f, "Unknown provider: \"{name}\""),
        }
    }
}

impl std::error::Error for RegistryError {}

// ============================================================================
// Provider Registry
// ============================================================================

/// Registry that maps provider names to `ProcessSpawner` implementations.
///
/// Handles parsing model specs (e.g., "claudecode/sonnet") into a provider
/// and resolved model ID. Supports alias resolution within each provider
/// and shorthand specs without a provider prefix.
pub struct ProviderRegistry {
    providers: HashMap<String, RegisteredProvider>,
    default_provider: String,
}

impl ProviderRegistry {
    /// Create an empty registry with the given default provider name.
    ///
    /// The default provider is used when a model spec has no provider prefix
    /// and no provider's alias table matches the spec.
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
    /// Model spec formats:
    /// - `"provider/alias"` — Look up provider, resolve alias (e.g., "claudecode/sonnet")
    /// - `"provider/raw-id"` — Look up provider, pass raw ID through (e.g., "claudecode/claude-sonnet-4-5-20250929")
    /// - `"alias"` — Search all providers' alias tables; first match wins.
    ///   If no match, use default provider with the spec as a passthrough model ID.
    ///
    /// Returns `None` for `model_id` only when the spec is `None` (use provider default).
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

    /// Resolve a non-empty model spec string.
    fn resolve_spec(&self, spec: &str) -> Result<ResolvedProvider, RegistryError> {
        if let Some((provider_name, model_part)) = spec.split_once('/') {
            // Explicit provider: "claudecode/sonnet"
            self.resolve_explicit(provider_name, model_part)
        } else {
            // No provider prefix: "sonnet" — search alias tables
            self.resolve_shorthand(spec)
        }
    }

    /// Resolve an explicit `provider/model` spec.
    fn resolve_explicit(
        &self,
        provider_name: &str,
        model_part: &str,
    ) -> Result<ResolvedProvider, RegistryError> {
        let provider = self
            .providers
            .get(provider_name)
            .ok_or_else(|| RegistryError::UnknownProvider(provider_name.to_string()))?;

        let model_id = provider
            .aliases
            .get(model_part)
            .cloned()
            .unwrap_or_else(|| model_part.to_string());

        Ok(ResolvedProvider {
            spawner: Arc::clone(&provider.spawner),
            model_id: Some(model_id),
            capabilities: provider.capabilities.clone(),
            provider_name: provider_name.to_string(),
        })
    }

    /// Resolve a shorthand spec (no provider prefix) by searching alias tables.
    fn resolve_shorthand(&self, alias: &str) -> Result<ResolvedProvider, RegistryError> {
        // Search all providers' alias tables for a match
        for (provider_name, provider) in &self.providers {
            if let Some(resolved) = provider.aliases.get(alias) {
                return Ok(ResolvedProvider {
                    spawner: Arc::clone(&provider.spawner),
                    model_id: Some(resolved.clone()),
                    capabilities: provider.capabilities.clone(),
                    provider_name: provider_name.clone(),
                });
            }
            // Also check if the alias matches a provider name itself
            // (e.g., "claudecode" with no model → default for that provider)
            if provider_name == alias {
                return Ok(ResolvedProvider {
                    spawner: Arc::clone(&provider.spawner),
                    model_id: None,
                    capabilities: provider.capabilities.clone(),
                    provider_name: provider_name.clone(),
                });
            }
        }

        // No alias match — use default provider with passthrough model ID
        let provider = self
            .providers
            .get(&self.default_provider)
            .ok_or_else(|| RegistryError::UnknownProvider(self.default_provider.clone()))?;

        Ok(ResolvedProvider {
            spawner: Arc::clone(&provider.spawner),
            model_id: Some(alias.to_string()),
            capabilities: provider.capabilities.clone(),
            provider_name: self.default_provider.clone(),
        })
    }
}

// ============================================================================
// Built-in Alias Tables
// ============================================================================

/// Claude Code provider alias table.
pub fn claudecode_aliases() -> HashMap<String, String> {
    HashMap::from([
        (
            "sonnet".to_string(),
            "claude-sonnet-4-5-20250929".to_string(),
        ),
        ("opus".to_string(), "claude-opus-4-5-20251101".to_string()),
        ("haiku".to_string(), "claude-haiku-4-5-20251001".to_string()),
    ])
}

/// `OpenCode` provider alias table.
pub fn opencode_aliases() -> HashMap<String, String> {
    HashMap::from([
        (
            "kimi-k2".to_string(),
            "moonshot/kimi-k2-0711-preview".to_string(),
        ),
        (
            "kimi-k2.5".to_string(),
            "opencode/kimi-k2.5-free".to_string(),
        ),
    ])
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

    // -- Explicit provider/model resolution --

    #[test]
    fn resolve_claudecode_sonnet_alias() {
        let registry = test_registry();
        let resolved = registry.resolve(Some("claudecode/sonnet")).unwrap();
        assert_eq!(
            resolved.model_id,
            Some("claude-sonnet-4-5-20250929".to_string())
        );
        assert!(resolved.capabilities.supports_json_schema);
        assert!(resolved.capabilities.supports_sessions);
        assert!(resolved.capabilities.supports_system_prompt);
    }

    #[test]
    fn resolve_claudecode_opus_alias() {
        let registry = test_registry();
        let resolved = registry.resolve(Some("claudecode/opus")).unwrap();
        assert_eq!(
            resolved.model_id,
            Some("claude-opus-4-5-20251101".to_string())
        );
    }

    #[test]
    fn resolve_claudecode_haiku_alias() {
        let registry = test_registry();
        let resolved = registry.resolve(Some("claudecode/haiku")).unwrap();
        assert_eq!(
            resolved.model_id,
            Some("claude-haiku-4-5-20251001".to_string())
        );
    }

    #[test]
    fn resolve_claudecode_raw_passthrough() {
        let registry = test_registry();
        let resolved = registry
            .resolve(Some("claudecode/claude-sonnet-4-5-20250929"))
            .unwrap();
        assert_eq!(
            resolved.model_id,
            Some("claude-sonnet-4-5-20250929".to_string())
        );
    }

    #[test]
    fn resolve_opencode_kimi_alias() {
        let registry = test_registry();
        let resolved = registry.resolve(Some("opencode/kimi-k2")).unwrap();
        assert_eq!(
            resolved.model_id,
            Some("moonshot/kimi-k2-0711-preview".to_string())
        );
        assert!(!resolved.capabilities.supports_json_schema);
        assert!(resolved.capabilities.supports_sessions);
        assert!(!resolved.capabilities.supports_system_prompt);
    }

    #[test]
    fn resolve_opencode_raw_passthrough() {
        let registry = test_registry();
        let resolved = registry
            .resolve(Some("opencode/some-custom-model"))
            .unwrap();
        assert_eq!(resolved.model_id, Some("some-custom-model".to_string()));
    }

    // -- Shorthand resolution (no provider prefix) --

    #[test]
    fn resolve_shorthand_sonnet() {
        let registry = test_registry();
        let resolved = registry.resolve(Some("sonnet")).unwrap();
        assert_eq!(
            resolved.model_id,
            Some("claude-sonnet-4-5-20250929".to_string())
        );
        // Should resolve to claudecode provider
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
        // Should resolve to opencode provider
        assert!(!resolved.capabilities.supports_json_schema);
    }

    #[test]
    fn resolve_shorthand_unknown_falls_back_to_default() {
        let registry = test_registry();
        let resolved = registry.resolve(Some("some-unknown-model")).unwrap();
        // Should fall back to claudecode with passthrough
        assert_eq!(resolved.model_id, Some("some-unknown-model".to_string()));
        assert!(resolved.capabilities.supports_json_schema);
    }

    // -- No model spec (None) --

    #[test]
    fn resolve_none_uses_default_provider() {
        let registry = test_registry();
        let resolved = registry.resolve(None).unwrap();
        assert_eq!(resolved.model_id, None);
        // Default is claudecode
        assert!(resolved.capabilities.supports_json_schema);
        assert!(resolved.capabilities.supports_sessions);
    }

    // -- Error cases --

    #[test]
    fn resolve_unknown_provider_returns_error() {
        let registry = test_registry();
        let result = registry.resolve(Some("unknownprovider/model"));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, RegistryError::UnknownProvider(ref name) if name == "unknownprovider")
        );
        assert!(err.to_string().contains("unknownprovider"));
    }

    #[test]
    fn resolve_empty_registry_default_fails() {
        let registry = ProviderRegistry::new("claudecode");
        // No providers registered — default lookup fails
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
        assert_eq!(aliases["sonnet"], "claude-sonnet-4-5-20250929");
        assert_eq!(aliases["opus"], "claude-opus-4-5-20251101");
        assert_eq!(aliases["haiku"], "claude-haiku-4-5-20251001");
        assert_eq!(aliases.len(), 3);
    }

    #[test]
    fn opencode_aliases_are_correct() {
        let aliases = opencode_aliases();
        assert_eq!(aliases["kimi-k2"], "moonshot/kimi-k2-0711-preview");
        assert_eq!(aliases["kimi-k2.5"], "opencode/kimi-k2.5-free");
        assert_eq!(aliases.len(), 2);
    }
}
