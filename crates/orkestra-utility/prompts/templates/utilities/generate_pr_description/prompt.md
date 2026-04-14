You are generating a GitHub pull request title and description.

You are running in the task's git worktree with full tool access. Use your tools to understand the changes before writing.

Below is orientation to get you started — commit titles showing the arc of work, and a list of changed files with line counts. This is NOT sufficient context to write a good PR. Before writing anything:

1. Read the changed files to understand what actually changed
2. Run `git diff {{base_branch}}...HEAD` (or read specific file diffs) to see the actual code changes
3. Read the workflow stage artifacts listed below to understand the planning and review context

Only after you have a thorough understanding of the full scope, write the PR title and description.

Trak: {{title}}
Description: {{description}}
Base branch: {{base_branch}}
{{#if artifacts}}

## Workflow Stage Artifacts

These files contain planning and review context — read them:

{{#each artifacts}}
- **{{this.name}}**{{#if this.description}} — {{this.description}}{{/if}} (`{{this.path}}`)
{{/each}}
{{/if}}

## Commit Titles

{{commits}}

## Changed Files

{{diff_summary}}

Rules:
- Describe the final state of the code, not the journey taken to get there. A reviewer only cares about what was built and why — not false starts, moved files, or abandoned approaches along the way.
- Title: what changed and the key reason why — one line, max 70 characters, no trailing period
- Body must be valid GitHub-flavored markdown with exactly three sections:
  1. `## Summary` — **Scale to scope: 1 bullet for a small fix, 3 max for a large refactor.** First bullet: the single most important decision or approach — the one choice that explains why the code looks the way it does. Remaining bullets: other notable outcomes. Focus on intent, not mechanics. A reviewer reading only the first bullet should understand the key choice.
  2. `## Decisions` — 1-3 bullet points for significant architectural choices or tradeoffs visible in the final code. Only include a decision if it explains why the code looks the way it does in a way that is non-obvious from reading it. Skip entirely (or omit the section) if there are no meaningful choices to explain. Do NOT include: dead ends, false starts, internal implementation explorations, files that were moved during development but now live in one place, or anything a reviewer cannot observe in the final diff.
  3. `## Change Walkthrough` — Act as a map for the reviewer, not an exhaustive tour. The code itself is the full picture; your job is to orient them so they can read it confidently. Start with context: what area of the codebase is affected and what the high-level structure looks like. Then trace the primary flows and key architectural relationships — what triggers what, how the main components interact, and the path data or control takes. Guide them through changes in a logical reading order, not necessarily file order. Use visual structure throughout: bullets, sub-sections, tables, code snippets, before/after comparisons. For multi-file changes, lead with a table mapping files to what changed and why. Use inline code references (`function_name`, `FileName`) liberally. Where it would help clarify architecture, data flow, state transitions, or structural relationships between components, include a fenced Mermaid diagram (` ```mermaid ... ``` `) — GitHub renders these natively. Use diagrams for multi-component changes or flow changes; skip them for simple single-file edits.
- Prefer tables, bullets, and diagrams over prose throughout. For multi-file changes, a table (file | what changed | why) is usually the clearest opening for Change Walkthrough. Prose paragraphs are acceptable only for genuinely flowing narrative.
- Write for a human reviewer who has not seen the Trak description. The PR body should stand alone.
- Use the workflow stage artifacts as context for the overall arc of the work. Do not copy them verbatim.
- Each section should be substantive but concise. Omit a section only if genuinely not applicable.
- Do NOT fixate on any single input. The last few commits are often minor cleanup ("fix lint", "add tests") — look past them to the substantive work. The task title may be a rough one-liner that undersells the scope.
