//! Canonical command name registry for drift prevention.
//!
//! These lists are the single source of truth for which commands exist
//! and how they are categorized. The parity test in this module verifies
//! that the WebSocket dispatch table stays synchronized.

/// Commands with shared handlers called by both Tauri and WebSocket.
pub const SHARED_COMMANDS: &[&str] = &[
    // Task CRUD
    "list_tasks",
    "get_task",
    "create_task",
    "create_subtask",
    "delete_task",
    "list_subtasks",
    "get_archived_tasks",
    "create_chat_task",
    // Human actions
    "approve",
    "answer_questions",
    "set_auto_mode",
    "interrupt",
    "archive",
    "reject_with_comments",
    "address_pr_feedback",
    "address_pr_conflicts",
    "request_update",
    "push_pr_changes",
    "pull_pr_changes",
    "retry_pr",
    "skip_stage",
    "send_to_stage",
    "restart_stage",
    "send_message",
    "promote_to_flow",
    // Assistant
    "create_chat_and_send",
    "assistant_send_message",
    "assistant_stop",
    "assistant_list_sessions",
    "assistant_get_logs",
    "assistant_send_task_message",
    "assistant_list_project_sessions",
    // Queries
    "get_config",
    "get_startup_data",
    "get_auto_task_templates",
    "get_iterations",
    "get_artifact",
    "get_pending_questions",
    "get_current_stage",
    "get_rejection_feedback",
    "list_branches",
    "list_project_files",
    "get_logs",
    "get_latest_log",
    "get_pr_status",
    "get_project_info",
    "get_branch_commits",
    "get_uncommitted_diff",
    // Git sync
    "git_sync_status",
    "git_push",
    "git_pull",
    "git_fetch",
    "task_sync_status",
    "force_push_pr_changes",
];

/// Commands that only exist in Tauri (desktop-only).
/// These must NOT appear in the WebSocket dispatch table.
pub const DESKTOP_ONLY_COMMANDS: &[&str] = &[
    "retry_startup",
    "get_orchestrator_status",
    "open_in_terminal",
    "open_in_editor",
    "detect_external_tools",
    "start_run_script",
    "stop_run_script",
    "get_run_status",
    "get_run_logs",
    "save_temp_image",
];

/// Commands with transport-specific implementations in both transports.
/// These exist in both dispatch tables but are NOT shared handlers.
pub const TRANSPORT_SPECIFIC_COMMANDS: &[&str] = &[
    // Diff commands (different DiffCacheState/SyntaxHighlighter types per transport)
    "get_task_diff",
    "get_file_content",
    "get_project_file_content",
    "get_syntax_css",
    "get_commit_log",
    "get_batch_file_counts",
    "get_commit_diff",
    // Background event commands (different notification mechanisms)
    "merge_task",
    "open_pr",
];

/// Commands that only exist in WebSocket (not in Tauri).
pub const WEBSOCKET_ONLY_COMMANDS: &[&str] = &[
    "ping",
    "list_devices",
    "revoke_device",
    "generate_pairing_code",
];

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Extract method names from the dispatch match arms in dispatch.rs.
    ///
    /// Reads the source file and parses quoted strings from match arms.
    fn extract_dispatch_methods() -> Vec<String> {
        let source = include_str!("dispatch.rs");
        let mut methods = Vec::new();
        for line in source.lines() {
            let trimmed = line.trim();
            // Match lines like: "method_name" => ...
            if let Some(rest) = trimmed.strip_prefix('"') {
                if let Some(method) = rest.split('"').next() {
                    if !method.is_empty() {
                        methods.push(method.to_string());
                    }
                }
            }
        }
        methods
    }

    #[test]
    fn shared_commands_are_in_websocket_dispatch() {
        let dispatch_methods = extract_dispatch_methods();
        for cmd in SHARED_COMMANDS {
            assert!(
                dispatch_methods.contains(&cmd.to_string()),
                "Shared command '{cmd}' is missing from WebSocket dispatch.rs. \
                 Add it to the dispatch match or remove it from SHARED_COMMANDS."
            );
        }
    }

    #[test]
    fn desktop_only_commands_are_not_in_websocket_dispatch() {
        let dispatch_methods = extract_dispatch_methods();
        for cmd in DESKTOP_ONLY_COMMANDS {
            assert!(
                !dispatch_methods.contains(&cmd.to_string()),
                "Desktop-only command '{cmd}' should NOT be in WebSocket dispatch.rs. \
                 Remove it from dispatch or from DESKTOP_ONLY_COMMANDS."
            );
        }
    }

    #[test]
    fn transport_specific_commands_are_in_websocket_dispatch() {
        let dispatch_methods = extract_dispatch_methods();
        for cmd in TRANSPORT_SPECIFIC_COMMANDS {
            assert!(
                dispatch_methods.contains(&cmd.to_string()),
                "Transport-specific command '{cmd}' is missing from WebSocket dispatch.rs."
            );
        }
    }

    #[test]
    fn all_dispatch_methods_are_categorized() {
        let dispatch_methods = extract_dispatch_methods();
        let all_known: Vec<&str> = SHARED_COMMANDS
            .iter()
            .chain(TRANSPORT_SPECIFIC_COMMANDS.iter())
            .chain(WEBSOCKET_ONLY_COMMANDS.iter())
            .copied()
            .collect();

        for method in &dispatch_methods {
            assert!(
                all_known.contains(&method.as_str()),
                "Dispatch method '{method}' is not in any registry list. \
                 Add it to SHARED_COMMANDS, TRANSPORT_SPECIFIC_COMMANDS, or WEBSOCKET_ONLY_COMMANDS."
            );
        }
    }

    #[test]
    fn no_duplicate_command_names_across_categories() {
        let mut all = Vec::new();
        all.extend_from_slice(SHARED_COMMANDS);
        all.extend_from_slice(DESKTOP_ONLY_COMMANDS);
        all.extend_from_slice(TRANSPORT_SPECIFIC_COMMANDS);
        all.extend_from_slice(WEBSOCKET_ONLY_COMMANDS);

        let mut seen = std::collections::HashSet::new();
        for cmd in &all {
            assert!(
                seen.insert(cmd),
                "Command '{cmd}' appears in multiple registry categories"
            );
        }
    }
}
