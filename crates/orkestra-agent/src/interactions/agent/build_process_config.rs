//! Builds a `ProcessConfig` from `RunConfig` and resolved model ID.

use std::path::PathBuf;

use orkestra_process::ProcessConfig;

use crate::types::RunConfig;

/// Build a `ProcessConfig` from `RunConfig` and resolved model ID.
///
/// Centralizes the mapping logic shared between `run_sync` and `run_async`.
/// Returns `(ProcessConfig, prompt, working_dir)` tuple.
pub fn execute(
    config: RunConfig,
    resolved_model_id: Option<String>,
) -> (ProcessConfig, String, PathBuf) {
    // Destructure to consume all fields (compiler enforces exhaustiveness)
    let RunConfig {
        working_dir,
        prompt,
        json_schema,
        session_id,
        is_resume,
        task_id: _,
        model: _,
        system_prompt,
        disallowed_tools,
        env,
        prompt_sections: _,
    } = config;

    let mut process_config = ProcessConfig::new(json_schema);

    if let Some(sid) = session_id {
        process_config = process_config.with_session(sid, is_resume);
    }

    if let Some(model) = resolved_model_id {
        process_config = process_config.with_model(model);
    }

    if let Some(sp) = system_prompt {
        process_config = process_config.with_system_prompt(sp);
    }

    if !disallowed_tools.is_empty() {
        process_config = process_config.with_disallowed_tools(disallowed_tools);
    }

    if let Some(env) = env {
        process_config = process_config.with_env(env);
    }

    (process_config, prompt, working_dir)
}
