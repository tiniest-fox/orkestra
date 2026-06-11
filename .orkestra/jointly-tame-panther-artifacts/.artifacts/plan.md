# Plan: Include Token Counts in PR Footer

## Summary

Add total token usage (input + output) to the hardcoded PR footer so every Orkestra-created PR shows how many tokens the task consumed. The token tracking infrastructure (`TaskTokenUsage`) and PR footer (`format_pr_footer`) already exist — this connects them.

## Scope

**In scope:**
- Fetching token usage at PR creation time and passing it to the footer
- Formatting token counts in the footer (human-readable, e.g. "120.4k input · 45.2k output")
- Including the total across all stages (planning, breakdown, work, review)

**Out of scope:**
- Per-stage token breakdowns in the PR footer
- Cost estimates or pricing calculations
- Changes to the `update_pr_description` flow (it already preserves the footer as-is)
- Changes to the token tracking/extraction logic itself

## Success Criteria

- PRs created by Orkestra include a token usage line in the footer (e.g. "Tokens: 120.4k input · 45.2k output")
- When token data is unavailable (zero or missing), the footer still renders correctly without a token line
- Existing footer elements (Co-authored-by lines, "Powered by Orkestra") are unchanged

## Open Technical Questions

- **Footer formatting**: Should token counts use compact notation (e.g. "120.4k") or exact numbers (e.g. "120,432")? Breakdown agent should check if there's a formatting precedent in the CLI's `ork trak usage` output.
- **Cache tokens**: Should cache_creation and cache_read tokens be shown separately, rolled into the input count, or omitted? Breakdown agent should decide based on what's useful to a PR reader.