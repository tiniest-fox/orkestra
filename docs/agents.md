# Agent files

**Path:** `.orkestra/agents/<name>.md`, and `.orkestra/.local/agents/<name>.md` for one
person's overlay.

An agent file defines one role: what the agent is for, what it may change, what its
artifact must contain, and what has to pass before a person sees it. A plan entry names
an agent by its filename, so `build.md` is the agent `build`.

## A minimal example

```markdown
---
description: >
  Builds an agreed change and reports what it did. Use for any step that changes
  code or tests.
model: sonnet
permission: write
checks:
  - test
output:
  Summary: What changed, in two sentences.
  Changes: One row per file, with what changed in it.
---
Build the change the plan describes. Run the tests before you finish.
```

This file needs a `checks/test.sh` beside it — see [checks.md](checks.md) — and `sonnet`
listed in `models.yaml`, or no `models.yaml` at all.

## Keys

Every key is optional in one file, because a file may be one layer of a role. The keys
marked **required** must be set by some layer once the layers are merged.

| Key | Type | Default | What it does |
|---|---|---|---|
| `description:` | string | **required** | When to use this agent. It is the composer's only signal for choosing it, so say what the role is for and when it is the wrong choice |
| `permission:` | `read-only` or `write` | **required** | `read-only` denies the agent the CLI's edit tools. It is not a sandbox: every trak already works in its own worktree |
| `output:` | mapping of section title to section | **required**, at least one section | The sections the artifact must contain, in the order written. See [Sections](#sections) |
| `model:` | string | **required**, except on a role Orkestra ships, which falls back to `models.yaml`'s `default:` | The model the agent runs on, as `models.yaml` lists it: a bare name such as `opus` runs on `claude`, and `codex/<name>` runs on `codex`. A name `models.yaml` does not list fails the load |
| `effort:` | string | the model's `effort:` in `models.yaml`, else the CLI's own default | The reasoning effort this agent's turns run at. Checked at load against the levels the model's CLI accepts |
| `checks:` | list of script names | `[]` | Scripts from `.orkestra/checks/` run against the worktree after each artifact. Non-zero sends the step back. See [checks.md](checks.md) |
| `effects:` | list of script names | `[]` | Scripts run once this step's work is on the branch and approved. Non-zero stops the trak as failed |
| `conditions:` | list of script names | `[]` | Scripts asked before a step of this agent starts. Also accepts `merged` and `deployed`, which the engine answers itself. See [checks.md](checks.md#names) |
| `processes:` | list of process names | `[]` | Processes from `.orkestra/processes/` started before each turn. A process that does not come up does not stop the turn; the agent is told it is down. See [processes.md](processes.md) |
| `skills:` | list of skill names | `[]` | Skills in the repository this agent reads. Each name resolves to the first of `.claude/skills/<name>/SKILL.md` and `.agents/skills/<name>/SKILL.md` that exists; a name that resolves to neither fails the load. The agent is given each path at the start of its session |
| `start:` | boolean | `false` | Whether this agent can be the first step of a trak, with nothing but the request to read. The app offers only these as opening moves |
| `icon:` | string | none | The glyph the app draws for this agent: an icon name in kebab case as `lucide.dev` spells it, such as `pencil-line`. Not checked; an unknown name draws the fallback glyph |
| `place:` | `sandbox` or `host` | `sandbox` | Where a trak this agent starts keeps its checkout when the project runs traks in sandboxes. `host` asks for a worktree on the engine's machine. It is a request: it applies only where the host allows it for the project, and only to the agent of a trak's first step |

**An unknown key fails the load.** These retired keys fail with a message that says where
the thing went:

| Key | Use instead |
|---|---|
| `disallowed_tools:` | `permission: read-only` |
| `sections:` | the keys of `output:` |
| `check:` | `checks:` |
| `title:` | `description:` — the filename is the agent's only name |

### Sections

A section is either a string, which is its description, or a mapping:

| Key | Type | Default | What it does |
|---|---|---|---|
| `description:` | string | **required** | What belongs in the section. It is written into the step's prompt |
| `required:` | boolean | `true` | Whether every artifact must contain the section |
| `when:` | string | none | The fact that makes an optional section due, such as *a file under `migrations/` changed*. Required when `required: false`, and refused when the section is required |
| `figure:` | one of `decision`, `scope`, `criteria`, `files`, `table`, `overview`, `walkthrough`, `changes`, `runs` | none | A fenced block the app draws in place of plain markdown, whose grammar is written into the prompt |

```yaml
output:
  Summary: What changed, in two sentences.
  Migration:
    description: The steps to run, in order.
    required: false
    when: the change adds a database migration
```

A title that YAML reads as an integer sorts to the front of the mapping, so quote one
such as `"2024"`.

## The body

Everything after the closing `---` is the **brief**: what this role does differently from
an agent with no instructions. It is required, and it is written into every turn's prompt
after `ORKESTRA.md`.

The body is a Mustache template that may use one flag and nothing else:
`{{#opening}}…{{/opening}}` is shown only on the step a trak was opened with, and
`{{^opening}}…{{/opening}}` everywhere else. Any other tag fails the load, because
Mustache would render it as nothing and drop what it wraps.

## Names

The filename, without `.md`, is the agent's name. It must be lowercase kebab case, such
as `scope-and-approach`. `generic` is reserved for the role-less agent Orkestra ships.

A `.md` file in `agents/` that does not open with a `---` line is passed over, so briefs
written for another tool can sit in the same directory. A file that opens with `---` is
read, and any error in it fails the load.

## Layering over a shipped agent

Orkestra ships a fleet of agents — see [fleet.md](fleet.md). A project file with the same
name as a shipped agent is laid over it rather than replacing it. The layers, bottom first:

1. the shipped file,
2. `.orkestra/agents/<name>.md`,
3. `.orkestra/.local/agents/<name>.md`.

**A later layer wins field by field.** A key a file leaves out keeps the value below it.
Each list (`checks:`, `effects:`, `conditions:`, `processes:`, `skills:`) and `output:` is
one field, replaced whole rather than merged. A body replaces the brief only when the file
has one. So a project file may hold only frontmatter. This is `.orkestra/agents/build.md`:

```markdown
---
model: opus
checks:
  - test
skills:
  - house-style
---
```

This keeps the shipped `build` brief, sections and permission, and adds a model, a check
and a skill. The engine logs each layered role at startup, naming the fields each file
sets.

A shipped file never names `model:`, `effort:`, `checks:`, `conditions:`, `processes:` or
`skills:`: each resolves against the project. A shipped role runs on `models.yaml`'s
`default:` until a project layer names a model.

A role with no shipped file under it must say everything itself: `description:`,
`permission:`, `output:`, `model:` and a body.

## What the engine does with it

- **At load**, it reads every layer, merges them, and checks every name the role uses:
  the model against `models.yaml`, scripts against `checks/` and `processes/`, skills
  against the skill directories. Any failure stops the engine from starting and names the
  file.
- **When composing**, it lists every agent's name and `description:` for the composer,
  sorted by name.
- **On each turn**, it starts the agent's CLI on the agent's model and effort, denies
  the edit tools where `permission: read-only`, starts the agent's `processes:`, and
  sends a prompt holding the intent, `ORKESTRA.md`, the brief, the skills, and the
  sections the artifact must contain.
- **After each artifact**, it runs `checks:`; after approval, `effects:`; before the
  step, `conditions:`.
