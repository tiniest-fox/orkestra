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
- Compare the current PR description against the current branch state
- Update any sections that no longer accurately reflect the changes
- Add information about new changes that are not yet described
- Preserve the overall structure (## Summary, ## Decisions, ## Change Walkthrough sections)
- Do NOT remove or change content that is still accurate
- Preserve any manual edits the user may have made (unusual formatting, extra sections, etc.)
- Preserve the footer (Co-authored-by lines and Powered by Orkestra)
- If the current description already accurately reflects the branch state, return it unchanged
- The output should be the complete updated PR body, not a diff
