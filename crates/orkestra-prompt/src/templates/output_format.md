## Output Format

Produce your output as valid JSON with a `type` field. Your output artifact is: **{{artifact_name}}**

{{#if show_direct_structured_output_hint}}
**IMPORTANT:** When calling the StructuredOutput tool, pass your JSON properties directly as input fields, NOT as a JSON string in a `content` field.

✅ CORRECT:
```json
{"type": "{{artifact_name}}", "content": "..."}
```

❌ INCORRECT:
```json
{"content": "{\"type\": \"{{artifact_name}}\", ...}"}
```

**If you cannot use the StructuredOutput tool**, you MUST wrap your JSON output in a fenced code block labeled `ork`:
{{else}}
You MUST wrap your JSON output in a fenced code block labeled `ork`:
{{/if}}

```ork
{"type": "{{artifact_name}}", "content": "Your content here"}
```

Do NOT output raw JSON without {{#if show_direct_structured_output_hint}}either the StructuredOutput tool or {{/if}}an `ork` fence — it will be automatically rejected.

**Output EXACTLY ONE block per response.** Do not include multiple fenced code blocks containing JSON with a `type` field. Your single output block must contain all required fields for your chosen output type.

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
For simple Traks that don't need parallel execution, output a single Subtrak — it will be automatically inlined on the parent Trak (no child Trak created).
{{/if}}

### Terminal states
- Failure: `{"type": "failed", "error": "Description of what went wrong"}`
- Blocked: `{"type": "blocked", "reason": "Why you cannot proceed"}`
