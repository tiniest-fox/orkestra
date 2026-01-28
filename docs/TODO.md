# TODO

Technical debt and future improvements.

## Refactoring

- [ ] **Move script logs to database** - Script stage output is currently written to `.orkestra/script_logs/*.jsonl` files. Should be stored in the database alongside agent logs for consistency and to avoid filesystem clutter.
