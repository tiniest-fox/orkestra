---
name: prompts-are-files
description: How prompt text is authored and assembled in orkestra — templates as .md files, the mechanism versus policy split, the .orkestra frontmatter contract for agents and checks, Mustache partials and their whitespace traps, and what belongs on the session rather than in a turn. Read before editing anything under src/prompts/ or .orkestra/, before adding a Trigger, a template, an agent or an engine tool, and before putting agent-facing wording in a .ts file.
---

# Prompts are files, not string literals

**Every word sent to an agent lives in `src/prompts/templates/*.md`.** No prompt text in
a `.ts` file. `workflow/domain/prompt.ts` and `agent/interactions/elicit.ts` decide only
_what data_ goes in.

`src/prompts/index.ts` is Effect-free because `workflow/domain` imports it — the
`Prompts` tag lives in `ports/`, the loader in `adapters/`.

**`templates/outside/` is Orkestra Cloud's, not the engine's.** It holds the descriptions
of the tools Cloud's own MCP endpoint serves to a person's agent, and no turn renders
them. `src/app/outside-tools.ts` reads them itself, from `TEMPLATES`, and imports
nothing under `prompts/`, because Cloud's host code may not. Cloud depends on the nine
file names in `OUTSIDE_TOOLS` and on `readOutsideTools(dir?)` returning a
`ReadonlyMap<OutsideTool, string>`: the wording may change, but renaming a file or
changing that signature breaks Cloud at its next pin bump. The nine files are still in
`TEMPLATE_NAMES`, so a missing one fails the engine's boot too.

**A template that needs the wall clock is given it, spelled.** The composer is told the
current local time with its offset — `spellLocal`, off `Clock` at the call site — and no
other template carries a date. An agent's own sense of _now_ is the provider's: Claude
Code injects one, another provider need not, and neither carries the zone a `wait_until`
resolves in.

## Mechanism and policy

|               | Where                                                                                                   | Who owns it                 |
| ------------- | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Mechanism** | `src/prompts/templates/*.md`                                                                            | us — ships with the tool    |
| **Policy**    | `.orkestra/` — agent briefs, `COMPOSITION.md`, `ORKESTRA.md` — over the fleet in `src/library/shipped/` | the user, over our defaults |

Policy is **data injected into** mechanism. A user changes what an agent knows; never
how Orkestra frames a turn. **A frontmatter field that would let a project change
framing is the boundary talking.**

## An agent is told what to file, never who reads it

**Neither side of that split says what becomes of a document after the agent files
it** — who reads it, who approves it, what it buys. A gate can run unattended, so the
sentence is false whenever it does, and it invites the agent to write for a reader
rather than answer the question it was given.

Where the document's _form_ is the deliverable, say what the words become and stop:
`pull-request`'s sections are sent as the body verbatim, and it has to know that to
write them.

## The `.orkestra` contract — the format policy is authored in

Parsed by `src/library/logic/{agent-file,check-file,process-file,tool-file}.ts`. This is the only place the
format is written down; the loader and its tests are the only other authority.

```
.orkestra/
  agents/*.md          YAML frontmatter + brief — a named role, or fields over a shipped one
  fleet.yaml           refused: [...] — shipped roles this project turns off   (optional)
  models.yaml          default: <a listed model> + models: {<cli>: [{name, effort?}]}
                       + context_windows: {<a listed model>: <tokens>} — a fallback
                       ceiling a screen divides by where the CLI reported none  (optional)
  COMPOSITION.md       → Library.composition, sequencing guidance only   (optional)
  GOALS.md             → Library.goals, a goal composer's first turn only (optional)
  ORKESTRA.md          → Library.guidance, injected into every step      (optional)
  checks/*.sh          `# ` comment frontmatter + a script — one registry, three lists:
                       an agent's `checks:` (must PASS), its `effects:` (must ACT) and
                       its `conditions:` (asked before the step; 0 met, 1 not yet, else gives up)
  processes/*.sh       `# ` comment frontmatter (`description:`, `page:`, `ready_seconds:`, `needs:`)
                       + a script that serves on `$PORT` — a hosted process, started by a
                       press or before each turn of an agent whose `processes:` lists it
  tools/*.sh           `# ` comment frontmatter (`description:`, `version:`) + a script that
                       installs `<name>` into the directory it is handed — a sandbox tool,
                       installed at its first call where `<name>` is not on PATH
  deploy.sh            → Library.deploy, what answers the `deployed` condition   (optional)
  worktrees/setup.sh   → Library.setup, run once per new worktree, beside the first turn
  worktrees/teardown.sh → Library.teardown, run in a checkout before the engine removes it
  worktrees/env.sh     → Library.env, sourced before every spawn in a worktree
  .local/              the same layout again, one person's, git-ignored by the engine
```

**A session's MCP servers are not an `.orkestra/` file.** The host lists them through
`Connections.servers` at every session start, and an engine no host started lists none;
the engine never reads `.orkestra/mcp.yaml`. A `${NAME}` in a listed server is filled
from the engine's own environment only — never from `worktrees/env.sh`, a backup file's
`secrets:` or a reserved variable. A server left out — an unset secret, a
sign-in the host will not hand, or a host that could not be asked — costs a `Note` on the
session's transcript, never the turn.

**`.local/` is a private mirror of the directory, merged over it at load** — a way to
run an agent nobody has been asked to review yet. The engine adds it to the
repository's `info/exclude` with the runtime directories when a trak starts, so a
clone needs no setup.
An agent file layers over the team's field by field, as below; a check replaces the
team's of its name whole, as a hosted process and a tool do, and the loader logs each one it hides at boot; `ORKESTRA.md`,
`COMPOSITION.md`, `GOALS.md`, `fleet.yaml`, `deploy.sh`,
`worktrees/setup.sh`, `worktrees/teardown.sh` and `worktrees/env.sh` are replaced outright, so no agent reads
two pieces of guidance; `models.yaml` lays its `models:` over the team's — an entry
naming a team model replaces it, effort and all — its `default:` overrides, and its
`context_windows:` lay over the team's model by model rather than entry by entry, so
switching one model's effort locally does not drop the window beside it. A
`context_windows:` key naming a model the merged `models:` does not list fails the
load, blaming the file it came from, as `default:` does.
`generic` is refused there as it is in `agents/`. Nothing on the
wire or on screen marks a definition as local. Promotion is `git mv` into the team's directory — the name, and
so the commit subject, does not change.

**Three layers make each role: shipped, team, private.** The engine's
`src/library/shipped/agents/*.md` are the fleet every project starts from; a file of the
same name in `agents/`, then in `.local/agents/`, lays over it **field by field**, the later
layer winning. `output:`, `checks:`, `effects:`, `conditions:`, `processes:` and `skills:` are each one field,
replaced whole, and a body replaces the brief only when one is present. The merged role is
what is validated, so an override may hold a single key — while a role nothing ships has to
be whole in the project's files, `model:` included. The loader logs each layered role once
at boot, naming the fields each file sets. `shipped/checks/*.sh` join the script registry
the same way, and a project script of the same name replaces one. `fleet.yaml`'s
`refused:` leaves shipped roles out; a name Orkestra does not ship, and a refused role a
project file also defines, both stop the load.

**A shipped brief is every project's, so it names nothing of one repository** — no skill
name or path, no command such as `pnpm verify`, no repo path or domain word; external
tools such as `gh` and `atelier` stay. What one repository adds lives in its override:
`skills:` for the skills to read, a body where the brief itself differs. No check catches
a breach, so grep `src/library/shipped/` after editing a brief there.

**A body is a Mustache template with one flag, `opening`**, which the step prompt fills
before inserting the brief: `{{#opening}}…{{/opening}}` for what only the entry a trak was
opened with is told, `{{^opening}}…{{/opening}}` for the rest. Any other tag — a variable,
a partial, a misspelt flag — refuses the file at load, naming it and the tag, because
Mustache renders an unfilled name as nothing and the guidance it wraps would vanish.
`opening` is true on New Chat and on New Trak with an agent named, and false on an Ask, a
composed plan's step and a spawned child's. Guidance that differs between those cases goes
behind the flag, never in prose asking the agent to work out its case from its place in the
plan. A new flag is a name in `BRIEF_FLAGS` (`src/library/types/agent.ts`) and its value in
`briefFlags` (`src/workflow/domain/prompt.ts`).

**The merged fleet may not be empty.** A plan entry names an agent, so a project
without at least one cannot compose anything. The directory is still the opt-in: `ork
wipe` and `ork list` do not read policy and must keep working in a project that has not
written one.

**Strictness is asymmetric: a directory is a shared space, a file is a contract.**
Unknown entries in `.orkestra/` are ignored — a real one also holds `.database/` and
`.worktrees/`, and `skills/` costs the loader nothing because the skills an agent file names
are the repository's, found beside `.orkestra/` rather than in it. An unknown _key_ inside a definition file is an error, and **nothing is
parsed-and-ignored**: that outcome gives the author no error and no effect.

An agent's `name` comes from the filename, so it is the one field a file cannot lie
about. It must be lowercase-kebab, because the composer writes it back verbatim.

| Agent key                                        |                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`                                    | required                   | the composer's only selection signal, and the only thing it sees                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `model`                                          | required                   | must be an entry in `models:` — checked at load. **A bare name runs on `claude`; `<provider>/<name>` names the CLI**, so `codex/gpt-5.6-sol` runs on `codex`. A shipped role names none and runs on `default:` unless a project file over it names one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `effort`                                         | optional                   | the reasoning effort this role's turns run at on its own `model:`, over that model's `effort:` in `models.yaml`. Checked at load against the levels the model's CLI takes — the CLI itself warns and runs anyway on one it does not know. Absent means the model's default, else the CLI's. Refused in a file the engine ships, with `model:`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `permission`                                     | required                   | `read-only` or `write`. What it becomes is the provider's: Claude a deny list, Codex a sentence in the prompt and nothing else — every Codex turn runs with the sandbox open, so a reading step that edits the checkout is not stopped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `output`                                         | required, non-empty        | a **mapping** of section title → description, or → `{description, required: false, when, figure}`. `required: false` and `when:` — the fact that makes the section due — go together; either alone is refused. `figure:` names one of `FIGURES`, and an unknown name is refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `checks`                                         | optional                   | names from `checks/` — validated at load, not at decode. Run after the artifact, before the gate; non-zero means the work is **wrong**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `effects`                                        | optional                   | names from the same registry, run once that step's work is **on the branch**. It acts outside the checkout rather than judging, so non-zero means it **could not do it** and settles `Failed{project}`. Written to be idempotent — a restart re-issues it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `conditions`                                     | optional                   | names from the same registry, asked **before a step of this agent starts**. `exit 0` runs it; `exit 1` rests the trak at `Finished` holding the entry, asked again on the script's `asked_every_seconds:`; any other exit gives up and stops the asking, and a timeout is not yet. The one list with a third meaning. Two names need no script: `merged` — the branch went in — and `deployed` — merged, then `.orkestra/deploy.sh` run with the merge commit as `$1`, listable only where that file exists. No script may take either name — nor `wait_until`, the time a plan entry waits for, which the composer writes on the step and the engine answers before this list. A plan entry may name either engine name itself as its `wait_for`, asked after its `wait_until` and before this list, a name both carry asked once. **A trak that merges itself is merged through a wait the merge answers** — `merged`, `deployed`, or a `wait_until` on an entry that also has a `wait_for` — and held by a script or a `wait_until` alone. So a review the merge must wait for is a script on a step before the one that waits on the merge: on that same entry it is asked only after the merge. A `permission: write` agent is refused at load for listing either, and at decode for following one in a plan, on an agent or a step's `wait_for`, or for any place in a plan once the branch has gone in |
| `processes`                                      | optional                   | names from `processes/` — validated at load. Each is started in the checkout before every turn of this agent; one that does not come up still lets the turn run, and the prompt says it is down. The turn is told every running process's address, as `$HOSTED_<NAME>_URL` too. A trak that declares any process hands its sessions the process tools on the `orkestra-trak` server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `skills`                                         | optional                   | names of the **repository's** skills — a directory holding a `SKILL.md` under `.claude/skills/`, then `.agents/skills/`, the first holding a name winning — validated at load. Each is named with its path on the step's session by `system/skills.md`, so a project points a shipped brief at its skills in one line rather than copying the brief. A shipped file may not name any                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `start`                                          | optional, defaults `false` | this role can open a trak — no plan, no prior step, just the request. `GET /api/agents` sends **every** agent and carries this as a field, because a plan entry may name any of them and a surface has to resolve its `icon:`; New Trak filters on it. An agent needing a prior step says `false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `icon`                                           | optional                   | the glyph a surface draws it with, kebab, as `lucide.dev` spells one. **Not validated** — checking it would put a client library's icon set in the engine, so an unknown name draws that surface's fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `place`                                          | optional, defaults `sandbox` | `host` asks for a trak this role **starts** to keep its checkout on the engine's machine, with no sandbox, where a runner would sandbox it — honored only where `HostTraks` (`src/vcs/ports/host-traks.ts`) allows it, and only when the checkout is first made. An engine with no runner never sandboxes, so the key changes nothing there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `disallowed_tools`, `sections`, `check`, `title` | **rejected**               | each message names where the thing went                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**A step's `continues:` overrides its agent's `model:` for the turn.** The runtime
resumes the named session on the model it was minted with — the minting entry's own pick
where New Chat or the plan gate made one, else its agent file's — so a session never changes model, and a
Codex resume of a Claude uuid cannot be composed by naming a `codex/…` agent. `modelAt`
in `workflow/domain/trak.ts` is the one place the rule lives. **Renaming or deleting an
agent file while a trak runs drops the borrow**: nothing can say what model that entry's
session was minted with, so the step starts fresh on its own instead.

**One shipped agent file sits outside the fleet**: `src/library/shipped/generic.md`, the role-less
agent a person asking something of finished work is put in front of. Same format, same
parser, held on `Library.generic` rather than in `agents` — so the composer's index and
the set that validates a plan cannot reach it, and a project file of that name is refused
at load rather than shadowing it. It is `start: true`: a person opens a trak with it
through New Chat, and the composer still cannot put it on a plan. Like every shipped file
it names **no `model:`, `effort:`, `checks:`, `conditions:`, `processes:` or `skills:`**, and `effects:`
only from `shipped/checks/` — checked in `shippedLayer`: the rest resolve against the
project, which the engine cannot know. It runs on `default:`. On a trak
that has landed, or whose parent has, it runs read-only rather than being refused — the
one declaration `SpawnStep` reads down instead of obeying.

**Every step's session is handed the `orkestra-trak` server** wherever an engine is
listening, and three groups of tools on it are every agent's: `run_check`, wherever the
project has a check that keeps a pass; the process tools; and the read tools —
`turn_status`, `list_traks`, `read_trak`, `read_artifact`, `list_goals`, `read_goal`,
`read_transcript`, `read_events`, `engine_log` and `snapshot_logs` — which
`src/app/read-tools.ts` answers. A goal's composer is offered every read tool but
`snapshot_logs` beside its own, on its own route, in any goal state and under no permit.
**`generic` is the one agent also offered `open_goal`**, the one engine tool that acts:
`offersEngineTools` in `src/workflow/runtime.ts` decides it by the engine's own name, so no
project file is read.
There is no per-agent `tools:` key: once a second role needs `open_goal`, every agent gets it.

**Every read tool asks `People.readable(caller)`** (`src/app/people.ts`) which traks and goals
it may name, and refuses or leaves out the rest, saying why. `PublicPeopleLayer` reads
everything; a host may provide a narrower answer. **Every answer on the server is redacted** by `hidingAnswers` in `src/app/tool-answer.ts`, whichever tool made it — a goal's read answers too — of
each secret value the engine holds — the engine's own key and passphrase, any variable
a host names as a secret, the CLIs' sign-ins, and each GitHub token minted for a
spawn (`MintedSecrets`, which an environment never holds) — raw or JSON-escaped, and says how
many it took out. A tool that shortens what it read takes each piece through the call's
`hide` first, as the read tools do before cutting an entry: a cut can keep half a secret.

**No tool on the server retries, halts, restarts or kills a turn, a trak or a goal** —
those stay with a person on the screen. The read tools are every agent's and
`People.readable` admits every trak, so a tool that acted would let any step
stop work it was never given. A read tool answers from what the engine itself keeps —
`Store`, `GoalStore`, the live turns on `TurnTools`, `.orkestra/.database/engine-log.jsonl` —
never the CLI's session files or the machine's processes.

**Adding an engine tool** is an entry in `ENGINE_TOOLS` and one in `ENGINE_MOVES`, both in
`src/app/trak-tools.ts`, and its description as `trak/tool-<name>.md`, named in
`TEMPLATE_NAMES`. A tool every session handed the server gets goes in `PROCESS_TOOLS` and
`processCall` instead, or, where it only reads, in `READ_TOOLS` and `readMove`. A tool in
`READ_TOOLS` reaches a goal's composer too, which has no checkout and calls it in any goal
state, unless `goalReadToolNames` leaves it out as it does `snapshot_logs`; its
description and every result key it renders say "you", never "this trak". Its
arguments are a `Schema.Struct`:
Claude Code loads no tool from a server where one tool's input schema has no top-level
`type: object`, and `inputSchemaOf` gives one only to the empty struct. What a call answers is a key `trak/tool-result.md` renders, and every
tool shares that template: reuse a key only where it means the same thing. A tool that
writes keys the write on the call id the CLI sends, as `open_goal` does, so a retried
call answers with what the first one did instead of writing twice. An argument is the
agent's string, not a route parameter, so it may hold a `/`: check an id against
`Store.list()` before it reaches a path.

**A brief is prose written to be read, so it gets the same second pass** — `writing-docs`,
_Cut it after you write it_. It bites hardest here: a brief telling an agent to do what it
already does by default is the common way one doubles in size.

**`output:` is a mapping, so section order is document order.** A title that parses as
an integer sorts to the front rather than staying put, so a section called `2024 Risks`
needs quoting. A section given as a plain string is shorthand for a required one with
that description.

**An optional section names the fact that makes it due.** `required: false` without a
`when:` is refused at load, and so is a `when:` on a section that is always owed. The
condition has to be checkable against the checkout or the trak's documents — a proof
file that exists, a plan that split, a finding cut from a table — and reachable from
work anywhere in the repository, since it deletes the section wherever it does not
hold. It also has to be no narrower than the description: it names the class of fact
the section reports, not one instance of it. _Omit when there is nothing_ is not a
condition — sections left to the agent's judgement came back filled in 88–100% of
documents, most of them a heading saying "none".

**`figure:` asks for a section to be written as a figure** — a fenced block labelled
with the figure's name, which the client draws and the next agent reads as written. The
contract teaches the grammar of each figure the step's sections declare, from
`system/figure-<name>.md`, plus `table`, which every step is taught. A grammar is stored
inside every document that used it, so a change to one must still parse the old form.

A grammar has two halves in two packages, and nothing binds them: the engine teaches it
in `system/figure-<name>.md`, and the client reads it with a parser in
`client/src/format/` — `markedTable.ts` for `table`, `decision`, `scope`, `criteria`,
`files` and `runs`, `changeMap.ts` for `changes`, `overview.ts`, `walkthrough.ts`. **Every example a template teaches must parse
in its client parser**; a parser that refuses it draws the fence as its source, with
nothing failing. Adding a figure is all of these:

1. the name in `FIGURES` (`src/library/types/agent.ts`), which the loader checks
   `figure:` against;
2. its template in `TEMPLATE_NAMES` and in `GRAMMAR` in `workflow/domain/prompt.ts`,
   which fails to compile without it;
3. a parser in `client/src/format/` that returns `undefined` for text it cannot read,
   and a branch in `Markdown`'s `pre` that draws the figure only when the parser returns
   one — so a fence that does not parse falls through to the plain plate, never an
   error;
4. the template's examples run through that parser, by hand until a test does it.

`output-shape.md` states the line rules every grammar shares — an indented line belongs
to the line above, and only the table figures and `changes` take a `## Heading` — so a new grammar
holds to them or that paragraph changes with it.

**A number in a section description is a width or a count**, and `.orkestra/ORKESTRA.md`
says how each is read: a width is a cap, a count is what a section of that kind usually
runs to. Write the number and not the rule — a brief restating how to read one is the
copy that goes stale.

| Check key                    |                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`                | required                                                           | what it verifies, told to the agent before it starts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `timeout_seconds`            | optional                                                           | positive, defaults 60. A check that hangs is a check that failed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `asked_every_seconds`        | optional, at least 60                                              | how often a **condition** is asked again while a trak waits on it — the whole scheduling policy. Required on a script named under `conditions:`, optional on `deploy.sh`, which is otherwise asked every minute, and refused on one named only under `checks:` or `effects:`; all three checked in `assembleLibrary`, where the lists are known                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `exclusive`                  | optional, defaults `false`                                         | `true` runs it one at a time across every trak the engine drives, queued behind another exclusive check; `timeout_seconds` counts from its turn                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `cache`                      | optional, defaults `true`                                          | a step's check that already passed on exactly these files — the checkout's tree, the script's text, its name, and the platform part `cache_across` sets — is not run again, and `ChecksPassed` names it under `reused`. `false` for a check whose answer depends on anything outside the checkout. The tree leaves out ignored files, and only the named script's text is in the key, so an edit to an ignored file or to a script it runs does not run it again on its own. Failures, effects and conditions are never reused. **An agent runs any `cache: true` check during its turn through the engine's `run_check` MCP tool** — its own first, then every other one no agent lists as an effect or a condition. The tool reads and records through the same `passKey` and `Passes` as `RunChecks` — so a pass it keeps is reused after the turn. It keeps one only when the tree after the run is the tree the key was built from, and none for a run the turn's end interrupted. Anything else that runs a check keys and records it the same way, never in a store of its own |
| `ignores_linguist_generated` | optional, defaults `false`                                         | `true` leaves every file `.gitattributes` marks `linguist-generated` out of the tree `cache` keys on, so an edit to those alone reuses the pass. A promise the script never reads them, which the engine cannot check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `units`                      | optional, a label                                                  | the check is handed `ORKESTRA_UNITS_OUT`, a file it appends each unit it proved to, a line each, and `ORKESTRA_UNITS_PROVEN`, the units already proven under this label on this tree and platform part, to skip. Every check with the same label shares them, provided they also agree on `ignores_linguist_generated` and `cache_across`, which set the tree and the platform part. Units are kept from a run however it ends, and a last line with no newline is dropped. The engine never reads a unit, unless the check also declares `fingerprint:`. Ignored where `cache` is `false`; refused on a script named under `conditions:` or `effects:`.                                                                                                                                                             |
| `fingerprint`                | optional, a list of tool names, and only beside `units`            | the check runs with the recording hook loaded into every Node process through `NODE_OPTIONS`, and its test runner lists the setup file `ORKESTRA_RECORDING_VITEST` names. A unit is then a test file's path from the checkout root. A unit whose print — its executed functions, file reads and spawns of the listed tools — still agrees with the checkout is added to `ORKESTRA_UNITS_PROVEN` on any tree, and is not proven on this one. Prints are kept by the OS and architecture whatever `cache_across` says, and by the recording format, so a stricter hook never reads a looser one's prints. `[]` opts in and trusts no tool                                                                                                                                                                                                                                                                                                      |
| `cache_across`               | optional, `platform` or `os`, defaults `platform`                  | how much of the machine a kept pass and a unit proof are tied to: `platform` is the OS and architecture, `os` the OS alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `reaches`                    | optional, `local` or `external`, on the two worktree scripts alone | how far outside the checkout the script's work goes, and read only where a host provides a runner. `local` is this machine and nothing else; `external` is anything another machine holds. A `local` teardown is not run, because releasing the sandbox takes everything it would have undone, and an `external` one runs in the checkout before the release. A `local` setup runs again on each sandbox the trak is given, and an `external` one is not repeated — running it twice makes a second resource rather than finding the first. No key runs the teardown, with one line saying what declaring one would change, and repeats the setup. Refused on every other script in `assembleLibrary`, where `asked_every_seconds:` and `units:` are refused for the same reason                                                                                                                                                                                                                                                                                                                      |
| `model`, `disallowed_tools`  | rejected                                                           | a check is a script, not a turn                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `expect_failure`             | rejected                                                           | the contract is always `exit 0 = pass`; invert in the script's own exit logic, where a reader can see it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `assumes`                    | rejected                                                           | which assumptions a print may lean on is the machine's to say: an engine accepts every one, and one with `CI` set only the floor — `trustsOn`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Written as a `# ` comment block rather than `---`, because the first line of a shell
script belongs to the kernel.

**A check or effect on a goal's trak with a goal branch is handed
`ORKESTRA_TARGET_BRANCH`**, the bare name of the branch its pull request goes into, and
it is unset on every other trak. A script that opens a pull request or compares the
branch with where it lands reads it, rather than assuming the default branch.

**A step's check that keeps a pass is handed `ORKESTRA_PASSED_TREE`**, the tree id it last
passed on in this checkout, and nothing where it has passed on none there. A script that
chooses its work by what changed diffs against it rather than against where the branch
began, since every earlier step is already committed — `verify.sh`'s light tier does.

**A trak's check is handed `ORKESTRA_BASE_COMMIT`**, the commit its checkout was cut from.
A script that measures the branch's own changes takes its merge base with that commit, not
with the default branch: a trak cut from a goal branch or a parent's branch began there.

**Every check is handed `ORKESTRA_STAGES`**, the path of the engine's stage runner,
`src/check-stages.ts`. `node "$ORKESTRA_STAGES" [--parallel] [--keep-going] <command>…` runs
the commands in order, stopping at the first that fails. It resolves `pnpm [--filter <pkg> |
-r] <script> [words…]` through that package's `package.json`: a chain joined by ` && ` part
by part, a script starting with `vitest` as a test stage, and anything else as a static
stage, run as written, which prints its own output only when it fails. `--parallel` starts
consecutive static stages together and reports them in chain order; `--keep-going` runs
every test stage after a failure.

A hosted process is the same file kind with the opposite contract: it is expected never
to exit. Its filename is kebab, because `processes:` names it and it becomes
`HOSTED_<NAME>_URL`. The script serves on `$PORT`, which the engine picks; it runs in
the trak's checkout with `env.sh` laid over it, and lives until a press, a turn's
`stop_process`, the trak's archive or the engine's exit. It is given no
`HOSTED_*_URL` and no credentials: a script that has to find another process names it
under `needs:` and reads the registry below.

**A project opts its tests in to `fingerprint:` with four things**, and vitest is the only
runner the hook knows:

1. the check file declares `units: <label>` and `fingerprint: [<tool>, …]`;
2. the script runs only the test files `ORKESTRA_UNITS_PROVEN` does not name;
3. a reporter appends each test file that passed to `ORKESTRA_UNITS_OUT`, as its path from
   the checkout root;
4. every vitest project lists `ORKESTRA_RECORDING_VITEST` first in `setupFiles`, and
   nothing when it is unset. A project under a DOM environment also names the file in
   `server.fs.allow`, beside its workspace root, or Vite refuses a file outside the project
   and every test file fails.

Without the setup file no test file is claimed, so nothing is printed and nothing is ever
skipped by fingerprint, and no error says so.

A test stage run through `ORKESTRA_STAGES` does the second to the fourth itself, with no
reporter and no config lines: it leaves out the proven files, appends each passing one, and
lists the setup file first in each resolved project's `setupFiles` and in its
`server.fs.allow`. This repository's `verify.sh` runs every test stage that way, so its
configs list nothing.

**A test file runs every time when its recording is unsure**: it spawned a tool
`fingerprint:` does not list — `sh` for `shell: true` — or a listed one outside a
directory it made with `mkdtemp`, or with an argument that climbs out of that directory;
it read a device, a socket or a pipe; it connected anywhere but a listener its family
opened, opened a UDP socket or started a worker thread; it wrote outside its temp
directory, linked a directory, or called an `fs` function the hook does not know; or V8
ran code it could not map back to a file. Anything unsure in the runner's own process
makes every file unsure. **A Node child records itself** — `node`, `fork`, a package's
`.bin` shim, a script whose `#!` line runs `node`, and every process that child starts in
turn — appending what it reads and
doubts to a log the test file folds in, and is unsure only if it never says it loaded the
hook. A directory copied with `cp` is every file under it. What `tsx` reads and writes in
its cache under the temp directory is neither an input nor a write, since an entry is named
for the source it compiled; a cold compile runs `esbuild`, which is unsure. A tool named in
`ORKESTRA_RECORDING_VOUCHED` in a process's environment is accepted wherever it runs, with its
binary as the only input, because the test that set it reads what the tool read. A write under the temp
directory, `ps`, a `git config --global` read, and a native addon or a dependency's
directory taken whole, make it lean on `tmpdir`, `ps`, `gitconfig` or `lockfile` instead,
and it runs every time on an engine with `CI` set. A change that
makes `src/recording-hook.ts` doubt or assume something it used to let pass raises
`RECORDING_FORMAT`, or a check still skips on the prints the looser hook made.

A recorded input that changed also reruns the file, unless the edit sits wholly inside the
body of a function the file never called and the file still compiles. **A barrel** — a file
whose top level is only `export { … } from` and `export type { … } from` blocks, with no
`export *` and nothing declared — also holds when the edit only adds names: to an `export
type` block or one with a bare source, always; to any other block, or as a new block, only
where the source is a file the test ran, or a relative path inside the barrel's package
whose nearest `package.json` declares `"sideEffects": false`. A new block from a bare
source misses even under that declaration. A change to anything
the runner loaded itself — the vitest config, a plugin, a `globalSetup`, `tsconfig.json` —
reruns every file.
Every module loaded or run is recorded with every `package.json` from its directory up to
the nearest, whose `type` and `exports` decide what an import resolves to, and a workspace
package with its `node_modules/<name>` link — so an edit to a package's `exports` reruns
the files that import it. A module inside an entry of pnpm's store that the lockfile pins
is recorded as that entry and the lockfile alone.

**`process.env`, the clock and randomness are not recorded**, so a test whose result turns
on one of them can be skipped wrongly. Pin what a test reads in vitest's `env`, which the
config file carries as an input. Listing a tool is the same promise: that it depends on
nothing but its binary, its arguments and its environment. `git` keeps it only with its
global config, identity and dates pinned, as `vitest.config.ts` does.

**A declaration is read from the checkout it runs in.** At a trak, a script under that
checkout's `.orkestra/processes/` is listed, started and resolved under `needs:` at that
trak alone, over the project's by name, and is read again on every call. One there that
does not parse, or whose `needs:` cannot be met, is left out and reported rather than
failing the load. The project checkout reads the engine's own library.

| Process key                              |                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `description`                            | required                   | what the process is, told to every turn it is listed for or running beside                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `page`                                   | optional, defaults `false` | it serves a page a person looks at. Without one it is still probed on `$PORT`, and nothing offers to draw it                                                                                                                                                                                                                                                                                                                                                                                           |
| `ready_seconds`                          | optional                   | positive, defaults 30 — how long `$PORT` has to answer. A run that exits first has not come up, whatever its code                                                                                                                                                                                                                                                                                                                                                                                      |
| `needs`                                  | optional                   | names from `processes/` — validated at load, and a cycle is refused; in a trak's checkout, left out and reported instead. Starting this process starts each one first and spawns this only once all are running; one that fails leaves this `DidNotComeUp`, naming it. Stopping, restarting or an exit of one stops this first, and a restart starts it again. `ready_seconds` counts from this one's own spawn. A needed process outlives what needs it, and an agent's `processes:` need not list it |
| `port`                                   | rejected                   | the engine assigns it, so two checkouts never take the same one                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `timeout_seconds`, `asked_every_seconds` | rejected                   | a process is started once and runs until stopped                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**The process registry is a public contract**: tools outside Orkestra read it to find a
checkout's processes. It is `.orkestra/.processes.json` in the trak's checkout — or the
project checkout, for the processes a person starts there — ignored by git
beside `.orkestra/.trak/`, and only the engine writes it — whole, to a temporary file
renamed over it, on every Starting, Running and terminal state and again at boot after the
reap. A state change the supervisor gains rewrites it too, and a change to its shape breaks
readers this repository cannot see. A trak with no checkout of its own has none.

```json
{
  "web": {
    "state": "running",
    "pid": 41210,
    "started": "Wed Oct  7 15:47:16 2026",
    "port": 29983,
    "url": "http://127.0.0.1:29983/"
  },
  "gallery": {
    "state": "starting",
    "pid": 41188,
    "started": "Wed Oct  7 15:47:18 2026",
    "port": 29984
  }
}
```

- Only a `starting` or `running` process has an entry; nothing live is `{}`. A reader
  treats a missing file as `{}`.
- `url` is on `running` alone, and is the loopback that answered — `http://127.0.0.1:<port>/`
  or `http://[::1]:<port>/`.
- `started` is what `ps -p <pid> -o lstart=` printed at the spawn, and is absent where `ps`
  said nothing.
- **An entry is live only while `pid` exists and `ps -p <pid> -o lstart=`, trimmed, equals
  `started`.** Anything else is stale — an engine that crashed left it, or the pid was
  reused — and an entry without `started` cannot be shown live.

**A runner — what puts a trak's work in a sandbox on another machine — and a backup are a
host's to provide**, through the optional `Runners` port (`src/vcs/ports/runners.ts`).
`pnpm serve` and `pnpm ui` provide none, so every spawn stays on the engine's machine.

## One agent per step, and nothing unions

A named agent resolves nothing, so two failure modes are unrepresentable rather than
forbidden: two sources each declaring output sections, and checks emerging from
whichever knowledge a step happened to carry.

**Checks belong on the agent, not on a step.** Verification is a property of a role —
_every agent that can write declares a check_ is a rule you can state, where _every step
that writes code gets `verify` attached_ is one the composer has to remember on each
plan.

**The composer chooses one name, and that is all.** It sees `name — description` and
nothing else: not the model, not the permission, not the sections, not the checks.
Showing it what each agent costs invites it to plan for the wrong thing.

A check reads the **repository**: it runs before the commit, when the only thing on disk
under `.orkestra/.trak/` is what the _previous_ step was given — so a check is `pnpm
check`, a grep, a test run, and it cannot inspect the document its own step produced.
`output:` covers that case, at decode time.

**An effect can read that document**, and it is the one difference in what the two see:
`RunEffects` rebuilds the projection before running anything, so `.orkestra/.trak/<key>.md`
holds what the step just filed. No arguments are passed in either way — one script
contract, and everything a script reads is in the directory it runs in.

**One registry, three lists, and what a non-zero exit means comes from the list rather
than the file.** A reader of the script alone cannot tell _wrong_ from _could not do it_
from _not yet_, which is what `description:` has to carry.

`worktrees/setup.sh` is the same file kind read by the same parser but sits outside the
`checks` registry: it runs once per new worktree, beside the first turn, because a composer
that could attach setup to a step would be choosing when the workspace exists.

`worktrees/teardown.sh` is setup's mirror: it runs in the checkout just before the engine
removes it, and is skipped when the checkout is already gone. A failure or a timeout
blocks the removal — the trak settles `Failed{archive}` with the checkout and branch
kept, and a resume runs the script again. A restart can run it twice, so it must be safe
to run twice.

**Under a runner a host provides, each of the two declares `reaches:`**, which is what decides whether a
sandbox runs it at all — the row above says what each value does. A project whose setup
only installs dependencies and whose teardown only drops something on this machine says
`reaches: local` on both, and then an archive of a trak whose work this machine holds
sends nothing into the sandbox at all. Without a runner the key is read by nothing.

`deploy.sh` is the same file kind, outside the registry too, and read with a condition's
exits. It runs from the project root rather than a checkout, with the merge commit as
`$1` — the one script handed an argument. It is asked on its interval while a trak waits
on `deployed`, and again while a merged trak's page is open. Its output may carry a line
holding one JSON object: `url`, `version` and `detail` are read from it where they are
strings, any other key is dropped, and the last such line wins. Every other line is shown
as text.

`worktrees/env.sh` is the same file kind again, and nothing chooses it either. The engine
sources it with `bash` in the spawn's own directory before every agent turn, check, effect,
`setup.sh` and `teardown.sh`, and lays what it left **exported** over that spawn's inherited environment
— never cached, never wrapped around the command, and never before the engine's own `git`
and `gh`. It is how a repository says how its toolchain loads (`eval "$(mise env -s
bash)"`) without the engine learning what a tool manager is. A sandbox may have no
mise, so a script that loads mise has to return 0 where `mise` is not on `PATH`, leaving
the sandbox's own tools in place. A
tool the sandbox lacks is not installed from `env.sh`: it is a `tools/<name>.sh`, whose
`# ---` header holds `description:` and `version:` and nothing else, and whose body is run
once, at the tool's first call, as `<name>.sh <dir>` and must leave an executable
`<dir>/<name>`. `<dir>` becomes `~/.cache/orkestra-tools/<name>/<version>/` once the
install is whole. The launchers sit last on the sandbox's PATH, so a tool `env.sh` or the sandbox already puts
on PATH wins. A
script that exits non-zero or times out fails the spawn it was for, with its stderr, and there is no fallback to the
inherited environment: a turn is `TurnFailed` before any session starts, a check fails and
goes back to its agent like any other, an effect settles `Failed{project}`, and `setup.sh`
or `teardown.sh` settles `Failed{worktree}` or `Failed{archive}`. What it prints goes to stderr, so `echo` there is harmless. **It is
sourced, so it ends with `return`, never `exit`**: `exit` ends the shell before the
variables are read, and the engine fails the spawn rather than guess.

**Every artifact runs `RunChecks`, and every step boundary runs `RunEffects`, including
for an agent that declares neither** — `decide` cannot read policy, so an empty list is
the degenerate case rather than a branch. `domain-model` has why.

## Per-turn body vs. per-session framing

- `templates/*.md` — the **per-turn bodies**.
- `templates/system.md` and `templates/system/*.md` — the **standing brief**, in two
  halves: `system.md` is the core every role shares, and `system/step.md` or
  `system/composer.md` is the role's contract. `buildSystemPrompt` renders both and
  hands them to the provider apart (`StandingBrief`), because how they reach the CLI
  is the provider's: Claude puts both on `--append-system-prompt` every turn; Codex
  has no such flag, so the harness writes both into the body of the turn that opens
  the conversation, the contract alone into a turn that takes over another position's
  conversation, and nothing into an ordinary resume.

**What is constant per session goes on the session.** The output contract lives there
because it cannot change between a step's turns. The caller names a template for the
contract half — an `{{#isStep}}` in `system.md` puts back a boolean-selected body that
per-trigger templates exist to remove.

`conversational` is the one conditional inside `system/step.md`, and it earns its place
by the same rule: it is a field on the _plan entry_, so it is fixed for the life of the
step's session. **It moves one line and nothing else** — the shapes, the sections and the
escalation rules render identically enforced or not, and a test cuts that paragraph out
of both and requires the rest to be the same string. **A flag that varies per turn does
not belong here.**

## One template per `Trigger` per role

`step-message.md`, `step-answers.md`, `step-unanswered.md`, `step-unread.md`,
`step-filing.md`, `step-check-failure.md`, `step-interrupted.md`, `step-permitted.md`,
`step-refused.md`, the composer's four,
beside the full `step.md` / `composer.md` a fresh session gets.

**Selection is one `Match.exhaustive` per role, where each arm names its template _and_
builds that template's data**, so a new trigger is a compile error. Mutually-exclusive
Mustache sections chosen by a hand-maintained negative condition let a new trigger fall
through silently.

**A bare body is the signal that a human is typing.** Only `step-message.md` and
`composer-message.md` have no heading, and that is load-bearing: `Interrupted` is the one
resume that runs through `elicit` rather than `converse`, so a bare `Continue.` gets
answered in prose instead of an artifact. It is `## Continue`.

**`stopped-tasks.md` is owed to a session, not a trigger.** `withStopped` in
`workflow/domain/prompt.ts` appends it to whichever body a session is sent next after a
filing of its own stopped background work, a bare message included, and adds nothing
otherwise. A re-ask is not one of those bodies: `elicit-retry.md` carries the refusal
alone, and the notice waits for the prompt after the turn files. The rule itself is in
`system.md`, so the notice only names the tasks.

**A message steered into a running turn has no trigger**, and it is a bare body for the
same reason: the provider writes the person's words down the turn's pipe as typed.
Nothing may frame them. `steered.md` adds only the list of files sent with them, and is
rendered only where there are any. The text the CLI reports back is what the
transcript's `Said` row draws, and under Claude it is also what pairs the report with the
message — `provider-hazards`.

**A person's files follow their words through the `attached` partial**, which renders
nothing where none were sent. Every body that carries what a person wrote places it after
the words: `step-message.md`, `composer-message.md`, `intent.md`, `steered.md` and
`goal/turn.md`. A new body left without it hands the agent the words and no paths, so an
image it was shown inline is one it cannot open or name. The view is `attachedView`; a
template with two lists wraps each in a section of its own, as `goal/turn.md` does with
`askedFiles` and `saidFiles`.

## Traps

- **Escaping is off.** Mustache HTML-escapes `{{x}}` by default, turning a quote into
  `&quot;`. `render` passes a no-op escape per call. Use plain `{{name}}`.
- **Shared text is a partial** — `{{> system/contract}}`, not a copy. A name may contain
  a slash; it is a map key the loader turns into a path.
- **Mustache drops the newline after a standalone `{{> …}}`**, so a partial that renders
  empty still consumes one. It shows up only in the transcript.
- **`oxfmt` must skip `src/prompts/templates/`**, subdirectories included — it inserts
  blank lines around standalone Mustache tags. See `ignorePatterns`.

## Duplication you can't remove becomes duplication a test maintains

`step-output.test.ts` reads the variant tags off the `AgentOutput` Schema's AST and fails
if `system/step.md` does not document each one. Another test asserts no `_tag` appears in
any output-contract template.

## After you change a template

**Read the transcripts** — `test/e2e/logs/<file>/<test>.xml` holds the exact text each
agent saw, deterministically. It is the only review surface showing the whole prompt
rather than the few substrings assertions check. The directory is git-ignored, so run
the suite with `ORKESTRA_PROMPT_LOGS=1` and read the files locally — they never appear in
a diff, and without the variable they are not written.
