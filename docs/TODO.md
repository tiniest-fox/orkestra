# TODO

Technical debt and future improvements.

## Bugs

- [ ] **Fix session resume for early agent failures** - When an agent process starts successfully (gets PID) but fails immediately before producing valid output (e.g., API limit errors, auth failures), the session ID is saved and `spawn_count` is incremented. Subsequent spawn attempts try to resume the broken session with `--resume`, which fails because no valid Claude Code session state exists. Need to detect these early failures and clear the session ID so the next spawn starts fresh. See investigation notes from deeply-factual-koel task failure (2026-02-04).

## Refactoring

- [ ] **Move script logs to database** - Script stage output is currently written to `.orkestra/script_logs/*.jsonl` files. Should be stored in the database alongside agent logs for consistency and to avoid filesystem clutter.
