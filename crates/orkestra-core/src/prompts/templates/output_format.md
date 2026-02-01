## Output Format

Produce your output as valid JSON with a `type` field. Your output artifact is: **{{artifact_name}}**

{{#if has_approval}}
### Approve or reject
```json
{"type": "approval", "decision": "approve", "content": "Your review here"}
```
To reject: `{"type": "approval", "decision": "reject", "content": "Issues to fix..."}`
{{/if}}

{{#unless has_approval}}
{{#unless can_produce_subtasks}}
### Your artifact output
```json
{"type": "{{artifact_name}}", "content": "Your content here"}
```
{{/unless}}
{{/unless}}

{{#if can_ask_questions}}
### Ask clarifying questions
```json
{{{questions_example}}}
```
{{/if}}

{{#if can_produce_subtasks}}
### Your output (with subtasks)
Include your full technical design in `content` alongside the structured `subtasks` array.
```json
{{{subtasks_example}}}
```
To skip breakdown: `{{{skip_example}}}`
{{/if}}

### Terminal states
- Failure: `{"type": "failed", "error": "Description of what went wrong"}`
- Blocked: `{"type": "blocked", "reason": "Why you cannot proceed"}`
