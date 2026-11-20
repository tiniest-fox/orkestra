{{! The repository's own skills this step's agent is pointed at, from `skills:` in
    the project's agent file; nothing for a role that names none. Names AND paths,
    because a name alone is a search the agent may not run. What each skill is for
    is the project's to say, in the skill itself. }}
{{#hasSkills}}
## Skills this role reads

This repository keeps skills for this role. Read each one before the work it
covers — the paths are relative to the root of your checkout:

{{#skills}}
- `{{name}}` — `{{path}}`
{{/skills}}

{{/hasSkills}}
