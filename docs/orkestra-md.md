# `ORKESTRA.md`

**Path:** `.orkestra/ORKESTRA.md`, or `.orkestra/.local/ORKESTRA.md`, which replaces it
whole.

Project-wide guidance given to **every step**: what an agent working in this repository
under Orkestra must know, whatever its role. It plays the part a `CLAUDE.md` or
`AGENTS.md` plays for an agent a person runs by hand, and an agent under Orkestra reads
those too, because the engine runs the CLI in the worktree.

## A minimal example

```markdown
# Working in this repository

- Run `npm test` before you finish; the `test` check runs it again after you.
- Never edit files under `generated/`. Run `npm run codegen` instead.
- Real API calls cost money. Use the fixtures in `test/fixtures/`.
```

## Format

Free markdown, with no frontmatter and no keys. Absent is normal.

## What the engine does with it

It writes the file into the prompt of every agent turn, after the trak's intent and before
the agent's brief. The composer does not receive it; the composer reads
[`COMPOSITION.md`](composition-md.md).

Put a rule here when every role needs it. A rule one role needs goes in that agent's
brief — see [agents.md](agents.md). Guidance an agent reads when it needs it, rather than
on every turn, goes in a skill the agent file names under `skills:`.
