<!orkestra:resume:{{stage_name}}:pr_comments>

{{#if guidance}}
**User guidance:** {{guidance}}

{{/if}}
{{#if comments}}
## PR Comments

The following PR comments need to be addressed:

{{#each comments}}
### Comment by {{this.author}} on `{{this.path}}`{{#if this.line}} (line {{this.line}}){{/if}}

{{this.body}}

---
{{/each}}
{{/if}}
{{#if checks}}
## Failed CI Checks

The following CI checks have failed and need to be fixed:

{{#each checks}}
### {{this.name}}

{{#if this.summary}}{{this.summary}}{{else}}No failure details available.{{/if}}

---
{{/each}}
{{/if}}

Address each item above and produce your revised output as valid JSON.
