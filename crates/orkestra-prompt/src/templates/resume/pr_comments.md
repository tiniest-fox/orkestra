<!orkestra:resume:{{stage_name}}:pr_comments>

The user has selected PR comments that need to be addressed. Please review and address these comments:

{{#if guidance}}
**User guidance:** {{guidance}}

{{/if}}
{{#each comments}}
### Comment by {{this.author}} on `{{this.path}}`{{#if this.line}} (line {{this.line}}){{/if}}

{{this.body}}

---
{{/each}}

Address each comment and produce your revised output as valid JSON.
