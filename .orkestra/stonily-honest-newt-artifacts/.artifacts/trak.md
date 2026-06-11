**Trak ID**: stonily-honest-newt
**Title**: Fix proposal-accept error + [object Object] toast

### Description
## Summary

Accepting an assistant-chat proposal fails with a useless `[object Object]` toast. Two independent root causes, both fixable:

### Bug 1 — Proposal emits a non-existent stage

The promotion-guidance prompt hardcodes a stale example stage (`planning`) that no longer exists in the `default` flow (renamed to `plan`). The model copies it, and backend validation rejects it at `crates/orkestra-core/src/workflow/human/interactions/promote_to_flow.rs:48-53` with `Stage "planning" not found in flow "default"`.

**Fix options:**
- Update the worked example in `crates/orkestra-core/src/prompts/templates/assistant/chat_promotion_guidance.md:8-12` to not hardcode a stage name (or reference only the dynamically-injected stage list from `assistant/service.rs:477-492`).
- Optionally make `promote_to_flow` fall back to the flow's first stage when `starting_stage` is invalid, rather than hard-erroring (`promote_to_flow.rs:54-58`).

### Bug 2 — `[object Object]` toast hides the real error

Tauri commands reject with a plain object `{ code, message }` (not an `Error`), but `handleAcceptProposal` does `showError(String(err))` at `src/components/Feed/AssistantDrawer.tsx:213`, coercing the object to `[object Object]`. The same pattern affects sibling handlers (`handlePromote`, `handleArchive`, `handleStop`, delete-modal). The two transports also diverge: `WebSocketTransport` wraps errors in a real `Error`; `TauriTransport` passes the raw object through.

**Fix:** add a shared error-message extractor that handles both plain `{ code, message }` objects and `Error` instances, and replace the `String(err)` calls across the feed handlers with it.

## Verification
- Accepting a valid proposal promotes the chat to a Trak.
- A backend rejection surfaces a readable message in the toast (both Tauri and WebSocket transports).
- `cargo fmt --all --check`, `cargo clippy --workspace --tests`, `cargo test --workspace` all clean.