# Working in orkestra

## What this repository is

A TypeScript reimplementation of Orkestra (`../orkestra`, ~120k LOC Rust),
targeting the Adaptive Pipeline architecture rather than porting today's engine.
It is a working vertical spike, not production, and it runs end to end against
both a scripted agent and real Claude Code. It spawns two coding-agent CLIs —
`claude`, and `codex` for an agent whose `model:` reads `codex/…`.

`CLAUDE.md` is the entry point and is kept current — read it before anything
else. It routes to `.agents/skills/`, where every enforced rule and the reason
for it lives. There is no `docs/`.

## Non-negotiables

- **`pnpm verify` must pass with zero warnings.** The engine's `verify-light` check
  runs it after your turn, scoped to what changed, and the full `verify` runs on
  GitHub, on the pull request. Do not run `pnpm verify` yourself. While you work, run
  only what your change touches — `pnpm check`, `pnpm lint`, and the test files you
  changed — and do not report a check as passing without running it. A stage that
  fails with `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` means your worktree's `node_modules`
  no longer matches the lockfile, usually because you changed `package.json`: run
  `pnpm install` in the worktree and run the check again.
- **Never weaken a lint rule to make code pass.** If a rule in `.oxlintrc.json` seems
  wrong, say so in your output and leave the config alone. `house-style` and
  `provider-hazards` say why the ones that look most removable exist.
- **A brief under `src/library/shipped/` names nothing of this repository** — no
  skill, `pnpm` command, repo path or domain word. What this repo adds to a role goes
  in its override under `.orkestra/agents/`.
- **No prompt text in a `.ts` file.** Every word sent to an agent lives in
  `src/prompts/templates/*.md`.
- **Real agent invocations cost money.** Use `model: haiku`, and do not run
  `pnpm smoke` or `pnpm real:trak` unless the change is in the provider layer.
- **Never delete a file under `.atelier/proof/`**, yours or another step's, before
  the pull request is open: the step that opens it publishes them. This overrides the
  `rm -rf .atelier/proof` that `atelier` prints and the `.atelier/proof/CLAUDE.md` it
  generates.

## Habits that fit this codebase

- **In a sandbox, the engine's machine is not on your disk** — not its
  `.orkestra/.database/`, its `~/.claude/projects/`, its processes or its log. Ask the
  read tools on the `orkestra-trak` server about another trak or a goal. They do not
  act: where a turn needs retrying, halting or killing, say so in your output, and a
  person does it.
- Read the neighboring file before adding one. Every file has a kind, and what it
  exports determines the kind.
- Prefer deleting an abstraction to adding a flag to it.
- Scratch code that must not reach the branch goes under `.experiments/`, which is
  git-ignored.
- When a document records a decision that your change contradicts, update the
  document in the same change. Writing down a new way of doing things that your work
  establishes for later changes is a later step's job.
- Comments explain *why*, especially why an obvious-looking simplification is wrong.
