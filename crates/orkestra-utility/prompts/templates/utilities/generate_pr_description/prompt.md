Generate a GitHub pull request title and description for the following code changes.

Study all the inputs below — the commit history, the changed files diff, the task description, and the workflow stage references — until you have a full, holistic understanding of what was built and why. Only then write the PR title and description.

Guidance:
- The **commit history** shows what was done step by step — this is your primary narrative. Read every commit, not just the last few.
- The **diff** is the ground truth of what actually changed in the code.
- The **task title and description** are the initial prompt that started the work — they may be vague, incomplete, or not reflect what was actually built.
- The **workflow stages** show what planning and review happened — use them as context for the overall arc, not as content to echo.
- Do NOT fixate on any single input. The last few commits are often minor cleanup ("fix lint", "add tests") — look past them to the substantive work. The task title may be a rough one-liner that undersells the scope.

Trak: {{title}}
Description: {{description}}
Base branch: {{base_branch}}
{{#if artifacts}}

## Workflow Stages

These workflow stages produced artifacts (available in the worktree for reference):

{{#each artifacts}}
- **{{this.name}}**{{#if this.description}} — {{this.description}}{{/if}} (`{{this.path}}`)
{{/each}}
{{/if}}
{{#if commits}}

## Commit History

{{commits}}
{{/if}}

## Changed Files

{{diff_summary}}

Rules:
- Describe the final state of the code, not the journey taken to get there. A reviewer only cares about what was built and why — not false starts, moved files, or abandoned approaches along the way.
- Title: concise description of the change, max 70 characters, no trailing period
- Body must be valid GitHub-flavored markdown with exactly three sections:
  1. `## Summary` — 1-3 bullet points describing what changed and why. Focus on intent, not mechanics.
  2. `## Decisions` — 1-3 bullet points for significant architectural choices or tradeoffs visible in the final code. Only include a decision if it explains why the code looks the way it does in a way that is non-obvious from reading it. Skip entirely (or omit the section) if there are no meaningful choices to explain. Do NOT include: dead ends, false starts, internal implementation explorations, files that were moved during development but now live in one place, or anything a reviewer cannot observe in the final diff.
  3. `## Change Walkthrough` — Act as a map for the reviewer, not an exhaustive tour. The code itself is the full picture; your job is to orient them so they can read it confidently. Start with context: what area of the codebase is affected and what the high-level structure looks like. Then trace the primary flows and key architectural relationships — what triggers what, how the main components interact, and the path data or control takes. Guide them through changes in a logical reading order, not necessarily file order. Use visual structure throughout: bullets, sub-sections, tables, code snippets, before/after comparisons. For multi-file changes, lead with a table mapping files to what changed and why. Use inline code references (`function_name`, `FileName`) liberally. Where it would help clarify architecture, data flow, state transitions, or structural relationships between components, include a fenced Mermaid diagram (` ```mermaid ... ``` `) — GitHub renders these natively. Use diagrams for multi-component changes or flow changes; skip them for simple single-file edits.
- Write for a human reviewer who has not seen the Trak description. The PR body should stand alone.
- Use the workflow stage artifacts as context for the overall arc of the work. Do not copy them verbatim.
- Each section should be substantive but concise. Omit a section only if genuinely not applicable.
