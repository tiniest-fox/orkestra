You are updating an existing GitHub pull request description to reflect the current state of the branch.

Trak: {{title}}

## Current PR Description

{{current_body}}

## Current Branch State

### Recent Commits

{{commits}}

### Changed Files

{{diff_summary}}

Rules:
- Just output the JSON immediately - do not use any tools
- Describe the final state of the code, not the journey taken to get there. A reviewer only cares about what was built and why — not false starts, moved files, or abandoned approaches along the way.
- Compare the current PR description against the current branch state
- Update any sections that no longer accurately reflect the changes
- Add information about new changes that are not yet described
- Preserve the overall structure (## Summary, ## Decisions, ## Change Walkthrough sections)
- Do NOT remove or change content that is still accurate
- The ## Decisions section should only contain significant architectural choices or tradeoffs visible in the final code — remove any bullet points that describe dead ends, false starts, or internal implementation explorations that a reviewer cannot observe in the final diff
- Preserve any manual edits the user may have made (unusual formatting, extra sections, etc.)
- Preserve the footer (Co-authored-by lines and Powered by Orkestra)
- If the current description already accurately reflects the branch state, return it unchanged
- The output should be the complete updated PR body, not a diff
