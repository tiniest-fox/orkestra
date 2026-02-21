<!orkestra:resume:{{stage_name}}:recheck>

This stage is being re-run. Your previous feedback has been addressed and the task has progressed through additional stages since your last run. Please re-examine the current state of the work and produce your output as valid JSON.
{{#if artifacts}}

## Updated Input Artifacts

The following artifacts have been updated. Re-read them:

{{#each artifacts}}
- `{{this.file_path}}`{{#if this.description}} — {{this.description}}{{/if}}
{{/each}}
{{/if}}