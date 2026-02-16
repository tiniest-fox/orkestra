<!orkestra:resume:{{stage_name}}:recheck>

This stage is being re-run. Your previous feedback has been addressed and the task has progressed through additional stages since your last run. Please re-examine the current state of the work and produce your output as valid JSON.
{{#if activity_logs}}

## Activity Log

Prior stages have recorded the following activity:

{{#each activity_logs}}
[{{this.stage}}]
{{this.content}}

{{/each}}
{{/if}}
{{#if artifacts}}

## Updated Input Artifacts

{{#each artifacts}}
### {{this.name}}

{{this.content}}

{{/each}}
{{/if}}