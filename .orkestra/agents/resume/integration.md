<!orkestra-resume:integration>

Integration failed with the following error:

{{error_message}}

{{#if conflict_files}}
**Conflicting files:**
{{#each conflict_files}}
- {{this}}
{{/each}}
{{/if}}

Please resolve the merge conflicts by running `git rebase main`, then continue your work and output your result.
