<!orkestra:resume:{{stage_name}}:integration>

Integration failed: {{error_message}}

{{#if conflict_files}}
Conflicting files:
{{#each conflict_files}}
- {{this}}
{{/each}}
{{/if}}

Please run `git rebase {{base_branch}}` to resolve conflicts, then continue and output your result.