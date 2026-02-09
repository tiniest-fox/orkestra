Generate a git commit message for the following changes.

Task: {{title}}
Description: {{description}}

Changed files:
{{diff_summary}}

Rules:
- Just output the JSON immediately - do not use any tools
- Title: imperative mood, max 72 characters, no trailing period
- Body: 2-4 sentences describing what changed and why
- Be specific about the changes based on the file list
