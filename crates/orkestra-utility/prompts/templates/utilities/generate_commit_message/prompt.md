Generate a git commit message for the following changes.

Task: {{title}}
Description: {{description}}

Changed files:
{{diff_summary}}
{{#if recent_commits}}

Recent commits on this branch (for style and context):
{{#each recent_commits}}
- {{this}}
{{/each}}
{{/if}}

Rules:
- Just output the JSON immediately - do not use any tools
- Title: imperative mood, max 72 characters, no trailing period
- Body: 2-4 sentences describing what changed and why
- Focus on the actual diff content to describe specific changes, not just file names
- If recent commits are provided, match their style and tone
