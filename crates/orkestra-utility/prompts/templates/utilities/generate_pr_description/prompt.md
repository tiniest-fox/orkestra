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
  3. `## Change Walkthrough` — Act as a map for the reviewer, not an exhaustive tour. The code itself is the full picture; your job is to orient them so they can read it confidently. Start with context: what area of the codebase is affected and what the high-level structure looks like. Then trace the primary flows and key architectural relationships — what triggers what, how the main components interact, and the path data or control takes. Guide them through changes in a logical reading order, not necessarily file order. Use visual structure throughout: bullets, sub-sections, tables, code snippets, before/after comparisons. For multi-file changes, lead with a table mapping files to what changed and why. Use inline code references (`function_name`, `FileName`) liberally. Where it would help clarify architecture, data flow, state transitions, or structural relationships between components, include a fenced Mermaid diagram (` ```mermaid ... ``` `) — GitHub renders these natively. Use diagrams for multi-component changes or flow changes; skip them for simple single-file edits.
- Write for a human reviewer who has not seen the task description. The PR body should stand alone.
- If a plan is provided, use it to write a better summary. Do not copy the plan verbatim.
- Each section should be substantive but concise. Omit a section only if genuinely not applicable.
