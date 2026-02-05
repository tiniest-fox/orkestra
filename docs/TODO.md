# TODO

Technical debt and future improvements.

## Bugs

- [ ] **Fix session resume for early agent failures** - When an agent process starts successfully (gets PID) but fails immediately before producing valid output (e.g., API limit errors, auth failures), the session ID is saved and `spawn_count` is incremented. Subsequent spawn attempts try to resume the broken session with `--resume`, which fails because no valid Claude Code session state exists. Need to detect these early failures and clear the session ID so the next spawn starts fresh. See investigation notes from deeply-factual-koel task failure (2026-02-04).

## UI Feature Ideas

- [ ] **Icon stage history in task cards** - Display a visual timeline of completed stages using icons on task cards, allowing quick identification of a task's current position in the workflow without opening details.
- [ ] **Assistant panel on the left** - Add a collapsible left sidebar with a conversational assistant for task creation, workflow guidance, and quick actions, reducing friction for common operations.
- [ ] **Chat with an issue** - Enable direct conversation with task context, allowing users to ask questions, request clarifications, or provide feedback inline without switching to separate approval/rejection flows.

