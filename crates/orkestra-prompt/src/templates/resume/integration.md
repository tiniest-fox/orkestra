<!orkestra:resume:{{stage_name}}:integration>

Integration failed: {{error_message}}

{{#if conflict_files}}
Conflicting files:
{{#each conflict_files}}
- {{this}}
{{/each}}
{{/if}}

A merge is in progress in your worktree. Resolve the conflict markers in each file (`<<<<<<<` / `=======` / `>>>>>>>`), then `git add <resolved-files>` and `git commit`. Then continue and output your result.