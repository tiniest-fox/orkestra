<!orkestra:spawn:{{stage_name}}>
{{#if workflow_stages}}

## Your Workflow

{{#each workflow_stages}}
{{#if this.is_current}}
[{{this.name}}] ← YOU ARE HERE — {{this.description}}
{{else}}
[{{this.name}}] — {{this.description}}
{{/if}}
{{/each}}
{{/if}}

---

## Your Current Task

**Task ID**: {{task_id}}
**Title**: {{title}}

### Description
{{description}}

{{#if artifacts}}
## Input Artifacts

{{#each artifacts}}
### {{this.name}}

{{this.content}}

{{/each}}
{{/if}}
{{#if activity_logs}}
## Activity Log

Prior stages have recorded the following activity:

{{#each activity_logs}}
### {{this.stage}} (iteration #{{this.iteration_number}})

{{this.content}}

{{/each}}
{{/if}}
{{#if question_history}}
## Previous Questions and Answers

{{#each question_history}}
**Q: {{this.question}}**
A: {{this.answer}}

{{/each}}
{{/if}}
{{#if feedback}}
## Feedback to Address

{{feedback}}

{{/if}}
{{#if integration_error}}
## MERGE CONFLICT - Resolution Required

{{integration_error.message}}

{{#if integration_error.conflict_files}}
**Conflicting files:**
{{#each integration_error.conflict_files}}
- {{this}}
{{/each}}
{{/if}}

Run `git rebase {{integration_error.base_branch}}` and resolve the conflicts, then continue your work.

{{/if}}
{{#if worktree_path}}

---

## Important: Worktree Context

You are working in a git worktree at: `{{worktree_path}}`
{{#if base_commit}}
You branched from `{{base_branch}}` at commit `{{base_commit}}`. To see all changes (committed and uncommitted) made in this worktree, run:
```
git diff {{base_commit}}
```
{{/if}}

If you spawn any subagents (via the Task tool), you MUST explicitly tell them this worktree path. Subagents do not automatically inherit your working directory and may otherwise operate on the wrong codebase.
{{/if}}