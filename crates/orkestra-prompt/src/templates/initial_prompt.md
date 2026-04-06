<!orkestra:spawn:{{stage_name}}>
{{#if workflow_stages}}

## Your Workflow
{{#if has_input_artifacts}}

The following artifacts from prior stages are available in your worktree. You MUST read them before starting work.
{{/if}}

{{#each workflow_stages}}
{{#if this.is_current}}
**{{this.display_name}}** ← YOU ARE HERE
{{#if this.description}}{{this.description}}{{/if}}
{{else}}
**{{this.display_name}}**
{{#if this.description}}{{this.description}}{{/if}}{{#if this.artifact_path}}
`{{this.artifact_path}}`{{/if}}
{{/if}}

{{/each}}
{{#if activity_log_path}}
**Activity Log** (accumulated across all prior stages): `{{activity_log_path}}`
{{/if}}
{{#if resources_path}}
**Resources** (external references registered by prior stages): `{{resources_path}}`
{{#each resources}}
- **{{this.name}}**: `{{this.url}}`{{#if this.description}} — {{this.description}}{{/if}}
{{/each}}
{{/if}}
{{/if}}

---

## Your Current Trak

**Trak ID**: {{task_id}}

Your Trak definition is at `{{task_file_path}}`. Read it before starting work.

{{#if sibling_tasks}}

---

## Sibling Subtraks

This Trak is part of a breakdown. Here are your siblings:

{{#each sibling_tasks}}
- **{{this.short_id}}** {{this.title}}{{#if this.dependency_relationship}} [{{this.dependency_relationship}}]{{/if}} ({{this.status_display}})
  {{this.description}}
{{/each}}
{{/if}}
{{#if question_history}}

---

## Previous Questions and Answers

{{#each question_history}}
**Q: {{this.question}}**
A: {{this.answer}}

{{/each}}
{{/if}}
{{#if feedback}}

---

## Feedback to Address

{{feedback}}

{{/if}}
{{#if integration_error}}

---

## MERGE CONFLICT - Resolution Required

{{integration_error.message}}

{{#if integration_error.conflict_files}}
**Conflicting files:**
{{#each integration_error.conflict_files}}
- {{this}}
{{/each}}

A merge is in progress in your worktree. Resolve the conflict markers in each file (`<<<<<<<` / `=======` / `>>>>>>>`), then `git add <resolved-files>` and `git commit`.
{{else}}
To reproduce and resolve the conflicts, run: `git fetch origin && git merge origin/{{base_branch}}`. Resolve the conflict markers in each file (`<<<<<<<` / `=======` / `>>>>>>>`), then `git add <resolved-files>` and `git commit`.
{{/if}}

{{/if}}
{{#if worktree_path}}

---

## Important: Worktree Context

You are working in a git worktree at: `{{worktree_path}}`
{{#if base_branch}}
You branched from `{{base_branch}}`. To see all changes (committed and uncommitted) made in this worktree, run:
```
git diff --merge-base {{base_branch}}
```
{{/if}}

If you spawn any subagents (via the Agent tool), you MUST explicitly tell them this worktree path. Subagents do not automatically inherit your working directory and may otherwise operate on the wrong codebase.
{{/if}}