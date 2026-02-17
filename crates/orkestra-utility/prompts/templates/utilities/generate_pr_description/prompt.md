Generate a GitHub pull request title and description for the following code changes.

Task: {{title}}
Description: {{description}}
{{#if plan}}
Plan:
{{plan}}
{{/if}}
Base branch: {{base_branch}}

Changed files:
{{diff_summary}}

Rules:
- Just output the JSON immediately - do not use any tools
- Title: concise description of the change, max 70 characters, no trailing period
- Body must be valid GitHub-flavored markdown with exactly three sections:
  1. `## Summary` — 1-3 bullet points describing what changed and why. Focus on intent, not mechanics.
  2. `## Decisions` — 1-3 bullet points highlighting key implementation choices or tradeoffs made.
  3. `## Verification` — 1-3 bullet points describing how the changes were tested or verified.
- Write for a human reviewer who has not seen the task description. The PR body should stand alone.
- If a plan is provided, use it to write a better summary. Do not copy the plan verbatim.
- Each section should be substantive but concise. Omit a section only if genuinely not applicable.
