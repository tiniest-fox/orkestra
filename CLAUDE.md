# CLAUDE.md

A TypeScript reimplementation of Orkestra (~120k LOC Rust),
targeting the **Adaptive Pipeline** architecture rather than porting today's
engine. **Status: a working vertical spike, not production** — it runs end to end
against a scripted agent and against real Claude Code, driven by this repo's own
`.orkestra/` directory.

**Non-negotiable: Orkestra invokes a coding-agent CLI — `claude`, or `codex` for an
agent whose model is `codex/…`.** A product requirement, not an implementation choice.
Spawning the CLI rather than driving the API or the Agent SDK is what buys subscription
auth, automatic inheritance of the worktree's `.claude/` and the user's `~/.claude/`
(`.agents/` and `AGENTS.md` under Codex), and bidirectional session handoff — a session
Orkestra starts can be picked up by a human running `claude --resume <id>` or `codex exec
resume <id>`, and the reverse. **Anything that owns its own agent loop severs all
three.**

## Before you finish

**`pnpm verify` must pass with zero warnings.** It is `fmt:check → check → lint → knip →
docs:check → test`. Nothing is complete until it has been run — not paraphrased, not
assumed. Under Orkestra the engine runs only the `verify-light` check, after each step
that changes files — the same chain, but each static stage only for the projects a changed
file reaches, only the tests that import what changed since it last passed in the checkout,
or since the branch began, and no builds — and the full chain and the browser tier run on GitHub, on the pull
request. The engine does not run it again on files it already passed on. So an agent there
runs only what its change touches — `pnpm check`, `pnpm lint` and the test files it changed.

**A `pnpm` command refuses to run when `node_modules` does not match the lockfile**, and
`pnpm install` — never refused — is what a person runs to clear it.

## Some commands spend real money

These spawn a real agent CLI — `claude`, or `codex` for a step whose agent names a
`codex/…` model. Everything else is free.

| | |
|---|---|
| `pnpm real`, `real:compose`, `real:trak` | one turn; the composer alone; the whole engine, approving on your behalf |
| `pnpm compose-lab`, `pnpm ork` | the composer for real; `ork` with real permissions, **writing to the directory you started in** |
| `pnpm serve`, `pnpm ui` | free to boot and read; a press or route that acts spawns a turn |
| `pnpm smoke` | checks against the real CLI (~$0.08) |

Don't run one unless the change is in the provider layer or you were asked to.
When you do, use `model: "haiku"`.

What every command does, and which of `pnpm ui`'s presses spend: `references/commands.md`.

Free, and the fastest way to understand the system: `pnpm walkthrough` and `pnpm spike`.
`PORT=<n> pnpm sim` is the whole app with every agent turn scripted — `sim` has it.

## You are not the only thing running

A worktree is a checkout of this repository on the machine that is also running the
person's `pnpm ui` and every other trak.

- **Never kill by pattern.** `pkill -f vite`, `pkill -f src/serve.ts`, `killall node` —
  your worktree's command lines are identical to theirs, so the pattern that clears
  yours takes down the engine somebody is watching, and it takes `pnpm ui` whole
  because either half dying kills the other. The derived port pair separates the
  bindings, not the names. Kill a pid you spawned, run `pnpm ui:stop` — which kills only
  the pid `daemon.json` names, and only once `/api/health` on the port it records reports
  *this project* — or leave it.
- **Don't boot the engine to look at a screen.** To check a component you have already
  built, render it on its own against fake props — `atelier-proof`. To weigh designs that
  do not exist yet, build them as a study — `atelier`. If a change genuinely needs the
  running application, use the simulated engine — `sim` — never the person's.
- **`.orkestra/.database/` is live state**, including the log of the trak you are
  running as, in `store.sqlite`. Never delete, edit or reset it. The push signing key is
  kept there too, beside every phone's subscription — a regenerated key kills them all
  silently, and each device has to turn notifications on again. **State about the machine rather
  than about a repository lives outside every worktree**, in `~/Library/Application
  Support/Orkestra/` — `~/.config/orkestra/` on Linux — the terminal and the editor a
  press opens a checkout in, and the desktop shell's recent projects and saved windows —
  so an engine or a shell you start here writes the person's real file. Take the fake in
  `test/support/openers-memory.ts` rather than the real picks.

## The code

`client/` has **its own `.oxlintrc.json` and `tsconfig.json`**, and every screen the
engine serves must work on a phone — read `client-style` before touching it.

Module boundaries and file kinds are lint-enforced, so a mistake here fails
`pnpm lint` rather than review. **A new directory inherits none of that** — the
rules are allowlists, so read `new-module` before creating one.

## Words

A term you do not recognize — *position*, *splice*, *reconsult*, *landing*, *at rest* —
is defined in one line in [`references/glossary.md`](references/glossary.md). Look a word
up there rather than inferring it from the sentence using it.

**Write American spelling** — *behavior*, *color*, *recognize* — in code, prose and
prompts, even where the text around it is British. Existing British spelling stays until
something else changes the sentence.

## Skills

Open the ones that match what you are about to touch — a menu, not a reading list.

They live in `.agents/skills/`, which Codex reads; `.claude/skills`, which Claude Code
reads, is a committed symlink to that directory, and `AGENTS.md` is one to this file.

| Skill | Read it before |
|---|---|
| `where-code-goes` | creating a file, moving code, adding a route to the engine, calling a macOS-only tool, or a `no-restricted-imports` error |
| `new-module` | creating a *directory*, a workspace package, or an entry point |
| `house-style` | writing any `.ts` — the rules that block a change, naming, `_tag` vs `type` |
| `effect-idiom` | writing Effect, and before any `catchAll`, `catchTag` or `try` |
| `domain-model` | touching `workflow/domain/`, or adding an Event, Trigger, Command or state |
| `testing-tiers` | writing a test, adding a fake, or when a test seems to need a `Layer` |
| `prompts-are-files` | editing anything under `src/prompts/`, or adding a Trigger or an engine tool |
| `provider-hazards` | touching `agent/providers/`, `process-node.ts`, `runs-file.ts` or `cli-provider.ts`, adding an engine action that crosses into a sandbox, or writing code that needs a GitHub token |
| `code-review-lens` | reviewing a diff here — the failure modes this repo has shipped |
| `writing-docs` | editing `README.md`, `CLAUDE.md`, a skill, anything under `docs/` or `notes/`, or a key a `src/library/logic/*-file.ts` loader accepts |
| `client-style` | creating any file under `client/`, touching a transport file under `client/src/api/`, adding a field or a frame to a wire slice under `shared/src/dto/`, laying out a screen, or reviewing a client diff |
| `sim` | using the running app to check a change — the simulated engine, which spends nothing |
| `pseudo` | writing or reading pseudo-code in a `pseudo` fence, or sketching how some code, job or flow works at the level of its decisions |
| `jev` | classifying or scoring more items than you can read — fifty pull requests, every trak in the log, every hunk of a diff. It calls a paid API, in fractions of a cent |

**When a skill tells you to send a subagent, that is me asking — send one.** No need to
check first; the request is standing, not per-task.

## Documents

**The root is kept true; `notes/` is a snapshot.** `writing-docs` has the rules, and
there is nothing outside these:

| | | |
|---|---|---|
| `README.md` | what this is, and what is not built | **reference** — kept true |
| `CLAUDE.md` | this file: what to know first, and which skill to open | **reference** — kept true |
| `references/glossary.md` | what each word means, one line each | **reference** — kept true |
| `references/commands.md` | what each `pnpm` command does and spends, and which of `pnpm ui`'s presses spend | **reference** — kept true |
| `docs/*` | every `.orkestra/` file and key, for an agent setting Orkestra up in another project; published | **reference** — kept true |
| `.agents/skills/*` | how to do a thing, at the moment you need it | **reference** — kept true |
| `.agents/skills/atelier*`, `stillroom`, `walkdown` | the skills the `atelier`, `stillroom` and `walkdown` CLIs write, which each rewrites on every run | **vendored** — never edit |
| `notes/BUGS.md` | what is broken now, ahead of anything deferred | **working** — a queue |
| `notes/todo/*` | what we deferred, one file per entry, and the trigger that settles each one | **working** — a queue |
| `notes/IDEAS.md` | one line each, no trigger yet | **working** — a queue |
| `notes/YYYY-MM/*` | design work, and why it went the way it did | **working** — frozen |

A dated note is never edited, so **read its status line rather than assuming it
describes the code**. Read one for *why* a decision went the way it did; for *what the
code does*, read `README.md` and the `domain-model` skill, which are kept true.

## Rules mostly nothing checks for you

**Build only what was asked, at the smallest size that works.**

- Prefer an existing tool over a new one; a command over a script; a script over a
  module; a module over a subsystem.
- A fix adjacent to the work is new work. Put it in `notes/todo/` with the trigger
  that would settle it, and leave it.
- **Stop and get explicit sign-off before adding** a dependency, a directory, a
  committed script, a gate, a config file, or an abstraction nobody asked for. Ask
  before building it, not after.
- Prefer a dev tool installed globally over one added to this repo.
- **Documentation is scoped the same way**: the minimum that conveys the rule, expanded
  only once the minimal form has proven insufficient. **Write the rule, not the argument
  for it** — unless the argument records a real tradeoff, or something the implementer
  must know to avoid getting it wrong.
- **So is talking to the user.** Lead with the answer or the result: what changed, what
  broke, and what needs a decision. Cut preamble, restatements of the request,
  self-assessment, and reasoning the user did not ask to see.

**Leave the reference documents true.** `README.md`, `CLAUDE.md`, `references/` and the
skills describe what exists today: change the thing, fix the sentence in the same change,
scoped to the claim you invalidated — a documentation audit is its own task. `pnpm
docs:check` catches the machine-checkable half. The same-change rule also covers a comment
whose premise your diff moves — see `code-review-lens`.

**No prompt text in a `.ts` file.** Every word sent to an agent lives in
`src/prompts/templates/*.md` — with one exception, the agent files under
`src/library/shipped/`, which are in the project's own format rather than templates. No linter
enforces this; it is the one convention that erodes silently.

**Nothing in `src/`, `shared/` or `client/` may know what this project's `.orkestra/`
holds.** Which agents exist, which are odd, what each one looks like — read from the
directory at runtime, never a fact the code carries. Where a surface needs to know
something about an agent, the agent file says it and the wire carries it — `start:`,
`icon:`, `conditions:`, a step's `checks:`, and its resolved `model:` with that model's
context window. **It fails silently**: a client map keyed by agent name draws the
fallback glyph for every agent added after it, and nothing breaks enough to notice.
On-screen and in-prompt prose counts too. **The fleet the engine ships is read the same
way**: no code names a role under `src/library/shipped/agents/`, and no brief there names
anything of one repository — a skill, a command such as `pnpm verify`, a path or a domain
word. What this repo adds goes in its override under `.orkestra/agents/`, as `skills:` or
a body.

**The wire's own grammar is not that knowledge.** A model reaches a surface as
`<provider>/<name>`, which is how the far end names the CLI to run it on rather than
anything this project's `models.yaml` chose — so a surface may split it and hold one
glyph per provider, and still may hold no list of models, no list of agents, and no map
keyed by either name.

**Never weaken a rule to make code pass.** Every rule in the lint config and every
tsconfig flag exists because of a specific failure, and the ones that look most
removable are the ones that cost the most — `house-style` and `provider-hazards`
carry the stories. If one seems wrong, say so and leave it in place.
