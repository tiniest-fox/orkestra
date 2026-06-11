[plan]
- Read trak definition: small scope — "include final token counts in PRs as part of hardcoded footer"
- Explored codebase via subagent: found `format_pr_footer()` in orkestra-utility, `TaskTokenUsage` in orkestra-types, PR creation pipeline in orkestra-core
- Determined this is a wiring task (connect existing token tracking to existing footer) — no new infrastructure needed
- Skipped questions and self-review: scope is unambiguous

[task]
- Traced the full PR creation pipeline: `prepare_pr_creation` (lock + gather) → `PrPreparation` enum → `run_pr_creation` → `create_pull_request::execute` → `format_pr_footer`
- Confirmed `WorkflowApi` has `pub(crate) store` and `pub(crate) home_dir`, so `prepare_pr_creation` can call `query::token_usage::execute` directly
- Decided on compact notation (120.4k) over exact numbers (120,432) — PR footers need conciseness; CLI already uses exact with `format_num`
- Decided to omit cache tokens from display — PR readers care about input/output magnitude, not cache implementation details
- Single-subtask inline: all changes are tightly coupled across 3 files with no meaningful parallelism

