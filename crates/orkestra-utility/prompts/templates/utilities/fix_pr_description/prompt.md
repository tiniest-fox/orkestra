You are fixing a GitHub pull request description that contains validation errors.

Trak: {{title}}

## Current PR Description (contains errors)

{{broken_body}}

## Validation Errors

{{#each errors}}
- {{this}}
{{/each}}

Rules:
- Just output the JSON immediately - do not use any tools
- Fix each validation error listed above
- Common fixes:
  - Mermaid diagrams: remove parentheses `()` from node labels, use `[...]` or `{...}` or plain text instead
  - Mermaid diagrams: quote labels containing special characters with double quotes
  - Markdown: fix malformed code fences or headings
- Preserve all content that is not affected by the errors
- Preserve the overall structure (## Summary, ## Decisions, ## Change Walkthrough sections)
- Preserve the footer (Co-authored-by lines and Powered by Orkestra)
- The output should be the complete corrected PR body, not a diff
