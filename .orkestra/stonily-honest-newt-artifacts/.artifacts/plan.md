## Summary

Accepting an assistant-chat proposal fails silently with an `[object Object]` toast. Two independent bugs: (1) the promotion-guidance prompt hardcodes a stale stage name (`planning` instead of `plan`), causing backend validation to reject, and (2) the frontend coerces error objects to strings incorrectly, hiding the real message. Fixing both makes proposal-accept work and ensures future backend errors surface readable messages.

## Scope

**In scope:**
- Rewrite the promotion-guidance prompt template to contain only instructions and an explicit list of available stages (injected dynamically) — no example stage names that could be copied verbatim by the model
- Add a shared error-message extractor to the frontend that handles both `{ code, message }` objects and `Error` instances
- Replace `String(err)` calls in feed handlers (`handleAcceptProposal`, `handlePromote`, `handleArchive`, `handleStop`, delete-modal) with the shared extractor
- Verify both Tauri and WebSocket transport error paths surface readable messages

**Out of scope:**
- Making `promote_to_flow` fall back to the first stage on invalid `starting_stage`
- Reconciling other differences between `WebSocketTransport` and `TauriTransport` beyond error message extraction
- Refactoring the assistant chat promotion flow itself

## Success Criteria

- Accepting a valid proposal from assistant chat promotes the chat to a Trak without error
- The promotion-guidance prompt contains no hardcoded stage names — only instructions and a dynamically-injected stage list
- A backend rejection (e.g., invalid stage) surfaces a human-readable error message in the toast, not `[object Object]`
- Error messages display correctly through both Tauri and WebSocket transports
- `cargo fmt --all --check`, `cargo clippy --workspace --tests`, `cargo test --workspace` all pass clean

## Open Technical Questions

- Where should the shared error-message extractor live in the frontend — a utility module, or colocated with the transport types? The breakdown agent should check existing frontend error-handling patterns.