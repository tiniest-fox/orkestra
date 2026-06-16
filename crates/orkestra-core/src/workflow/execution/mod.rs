//! Execution layer for the workflow system.
//!
//! This module provides components for executing workflow stages:
//!
//! - **`StageOutput`**: Parsed output from agents (artifacts, questions, approval, etc.)
//! - **`AgentRunner`**: Runs agents via `ProcessSpawner`
//! - **`ScriptHandle`**: Async script execution for script-based stages
//! - **`PromptBuilder`**: Generates prompts from workflow configuration
//! - **`ProviderRegistry`**: Maps provider names to `ProcessSpawner` implementations
//! - **parser**: Agent output parsing with provider-specific extraction

mod prompt;

pub use crate::workflow::stage::{deduplicate_activity_logs_by_stage, ActivityLogEntry};
pub use orkestra_parser::{
    AgentParser, ClaudeParserService as ClaudeAgentParser, CodexParserService as CodexAgentParser,
    OpenCodeParserService as OpenCodeAgentParser, ResourceOutput, StageOutput, StageOutputError,
    SubtaskOutput,
};
pub use prompt::{
    build_resume_prompt, build_user_message, determine_resume_type, get_agent_schema,
    load_agent_definition, resolve_stage_agent_config_for, sibling_status_display,
    AgentConfigError, IntegrationErrorContext, PrCheckContext, PrComment, PromptBuilder,
    QuestionAnswerContext, ResolvedAgentConfig, ResumeQuestionAnswer, ResumeType,
    SiblingTaskContext, StagePromptContext,
};

// Re-exports from orkestra-agent (backward-compatible aliases)
pub use orkestra_agent::start_hook_server;
pub use orkestra_agent::AgentRunner as AgentRunnerTrait;
pub use orkestra_agent::HookServer;
pub use orkestra_agent::ProcessAgentRunner as AgentRunner;
pub use orkestra_agent::{
    claudecode_aliases, claudecode_capabilities, codex_aliases, codex_capabilities,
    opencode_aliases, opencode_capabilities, AgentCompletionError, ExecutionMode,
    ProviderCapabilities, ProviderRegistry, RegistryError, ResolvedProvider, RunConfig, RunError,
    RunEvent, RunResult, ScriptEnv, ScriptHandle, ScriptPollState, ScriptResult,
};

// Internal-only imports for build_production_registry — not part of the public API.
use orkestra_agent::{pty_claude_capabilities, StubPtySpawner};

#[cfg(any(test, feature = "testutil"))]
pub use orkestra_agent::{default_test_registry, MockAgentRunner};

// ============================================================================
// Production registry factory
// ============================================================================

/// Build the canonical production provider registry.
///
/// Registers claudecode, opencode, and claude-pty with their standard
/// capabilities and aliases. This is the single source of truth — all three
/// production callers (`StageExecutionService`, daemon, Tauri) use this function.
pub fn build_production_registry() -> ProviderRegistry {
    use crate::workflow::adapters::{
        ClaudeProcessSpawner, CodexProcessSpawner, OpenCodeProcessSpawner,
    };
    use crate::workflow::ports::ProcessSpawner;
    use std::sync::Arc;

    let mut registry = ProviderRegistry::new("claudecode");
    registry.register(
        "claudecode",
        Arc::new(ClaudeProcessSpawner::new()) as Arc<dyn ProcessSpawner>,
        claudecode_capabilities(),
        claudecode_aliases(),
    );
    registry.register(
        "opencode",
        Arc::new(OpenCodeProcessSpawner::new()) as Arc<dyn ProcessSpawner>,
        opencode_capabilities(),
        opencode_aliases(),
    );
    registry.register(
        "codex",
        Arc::new(CodexProcessSpawner::new()) as Arc<dyn ProcessSpawner>,
        codex_capabilities(),
        codex_aliases(),
    );
    registry.register(
        "claude-pty",
        Arc::new(StubPtySpawner) as Arc<dyn ProcessSpawner>,
        pty_claude_capabilities(),
        std::collections::HashMap::new(), // no bare aliases — reach via "claude-pty/<model>" prefix
    );
    registry
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify that `build_production_registry` wires `claude-pty` with `ExecutionMode::Pty`.
    ///
    /// This is the orchestrator-level integration check: if `execution_mode` is wrong, the
    /// `ProcessAgentRunner` dispatch in `service.rs` routes PTY tasks to the headless path.
    #[test]
    fn production_registry_claude_pty_has_pty_execution_mode() {
        let registry = build_production_registry();
        let resolved = registry
            .resolve(Some("claude-pty/sonnet"))
            .expect("claude-pty should be registered");
        assert_eq!(
            resolved.capabilities.execution_mode,
            ExecutionMode::Pty,
            "claude-pty must use ExecutionMode::Pty for correct dispatch"
        );
    }

    /// Verify claudecode stays on the Process path after the PTY provider was added.
    #[test]
    fn production_registry_claudecode_has_process_execution_mode() {
        let registry = build_production_registry();
        let resolved = registry
            .resolve(Some("claudecode/sonnet"))
            .expect("claudecode should be registered");
        assert_eq!(
            resolved.capabilities.execution_mode,
            ExecutionMode::Process,
            "claudecode must use ExecutionMode::Process"
        );
    }

    /// Verify codex is registered with the correct capabilities.
    #[test]
    fn production_registry_codex_routes_and_has_correct_capabilities() {
        let registry = build_production_registry();
        let resolved = registry
            .resolve(Some("codex/o4-mini"))
            .expect("codex should be registered");
        assert_eq!(resolved.provider_name, "codex");
        assert_eq!(resolved.model_id, Some("o4-mini".to_string()));
        assert_eq!(resolved.capabilities.execution_mode, ExecutionMode::Process);
        assert!(resolved.capabilities.supports_json_schema);
        assert!(resolved.capabilities.generates_own_session_id);
        assert!(!resolved.capabilities.supports_system_prompt);
    }
}
