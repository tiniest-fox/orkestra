{{! The files a person sent with what they wrote, by their paths in the checkout. A
    partial, placed after the words they belong to, and nothing at all where none were
    sent. An image was also handed over inline — or as a local image — beside the
    prompt, so the agent need not open it to see it, and the path is how it finds the
    file again or names it to somebody else. }}
{{#attached.length}}

Attached, in this checkout:
{{#attached}}
- `{{path}}` ({{type}})
{{/attached}}
{{/attached.length}}
