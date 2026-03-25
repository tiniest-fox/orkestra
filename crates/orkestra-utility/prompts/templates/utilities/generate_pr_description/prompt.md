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
  3. `## Change Walkthrough` — Show how the changes connect using visual structure, not prose paragraphs. Use bullets, sub-sections, tables, code snippets, before/after comparisons, and concise flow descriptions to make the content easy to scan. For multi-file changes, lead with a table mapping files to what changed and why. Then trace the key flow using bullets or sub-headings: what triggers what, how components interact, and the path data or control takes. Use inline code references (`function_name`, `FileName`) liberally. Write so someone unfamiliar with this part of the codebase can follow without reading every diff.
- Write for a human reviewer who has not seen the task description. The PR body should stand alone.
- If a plan is provided, use it to write a better summary. Do not copy the plan verbatim.
- Each section should be substantive but concise. Omit a section only if genuinely not applicable.
