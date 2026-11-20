---
name: new-module
description: What to wire up when you create a new directory under src/, a new workspace package, or a new entry point — because every rule in this repo is an allowlist and a directory nobody listed inherits none of them. Read before creating a directory or package, not after.
---

# Adding a module

**Every boundary rule here is an allowlist of directory globs.** A directory nobody
listed is not loosely governed — it is ungoverned, and nothing says so at the time. An
unlisted module under `src/` silently escapes the import boundaries, the purity rules
and the inject-time-and-randomness rule; a workspace package outside `lint` and
`fmt:check` passes a green `pnpm verify` while unformatted.

`pnpm docs:check` fails on both shapes: every directory under `src/` must appear in
`.oxlintrc.json`, and every workspace package must be reached by `lint` and `fmt:check`
or by a `verify` the root chains. **The gate catches the omission; it cannot choose the
rules.** That part is below.

## The checklist

Work down it in the same change that creates the directory — "I'll classify it once
there's something in it" is how a module ends up ungoverned.

| # | Question | What to do |
|---|---|---|
| 1 | What may it import, and what may import it? | An `overrides` entry in `.oxlintrc.json`, even if only to record "nothing special". Read **The `overrides` gotcha** in `where-code-goes` first — oxlint replaces rather than merges, so each glob repeats everything that applies to it. A package with its own `.oxlintrc.json` states `extends` and keeps it: a nested config replaces the root one rather than layering on it, so without that line the package keeps almost none of the root's rules and nothing reports it. |
| 2 | Is any of it pure? | Pure sub-directories (`types/`, `logic/`, or a whole module) get the no-ports-no-adapters restriction. |
| 3 | Does it generate time, randomness or ids? | Those belong in an adapter or an entry point — never in a mapper, a pure module or `domain/`. **A value you cannot source from a port is not a field.** See `testing-tiers`. |
| 4 | Does it reach something that costs money or holds a lock? | Route it through one file and restrict the import to that file. `src/app/drive.ts` is the worked example: only it may import `advance`, because only it claims custody first. |
| 5 | Can anything in it move a trak? | It owes a tier-2 test for the surface — refusals, and a second-driver case. See the entry-point row in `testing-tiers`. |
| 6 | Is it a workspace package? | `pnpm-workspace.yaml`, a `knip.json` workspace entry naming its entry points, **and** the gates: its path appended to the root `lint` and `fmt:check`, and a `verify` chained from the root if it has a toolchain the root cannot run (`client/`'s Vite and RTL, `desktop/`'s Electron build). |
| 7 | Does it need different compiler flags from the root? | Then it needs its own `tsconfig.json` *and* a line in `check` that runs it. A tsconfig nothing runs is decoration. `shared/`'s drops `types: ["node"]`, so a Node global in the wire contract fails. |
| 8 | Does a document describe the module map? | `where-code-goes`'s Axis 1 and `CLAUDE.md`'s code block both list modules. Update them here; `docs:check` does not read prose. |

## A new entry point

Loose `.ts` files at `src/` root, one per entry (`ork.ts`, `serve.ts`, `main.ts`,
`smoke.ts`, `docs-check.ts`, the `real*.ts` scripts). Three things, none optional:

1. **The `no-console` override.** Entry points print; the rule is `error` everywhere
   else. Add the filename to that `files` list — do not disable the rule inline.
2. **A `package.json` script.** It is also what makes `knip` treat the file as an entry
   rather than dead code.
3. **The money table in `references/commands.md`, if it can spend.** Anything that spawns a
   real `claude` belongs there with what it costs, and in `CLAUDE.md`'s short table, so a
   reader deciding whether to run something does not have to read the source.

**If it opens a listener, bind `127.0.0.1` explicitly.** Node's default for a bare
`{ port }` is every interface — which puts any unguarded endpoint that can spawn
`claude` on the local network. The engine widens only on `--host`, and refuses that
without `ORKESTRA_PASSPHRASE` — `src/app/guard.ts` is the guard, and `bindPlan` there is
the refusal. A second listener wants the same guard in front of it, not a flag.

## What not to do

**Do not create a module to hold one file.** The cost of a directory is the rules it
needs, and this checklist is that cost made visible. If the answer to 1–4 is "nothing
special" every time, the file belongs in a module that already exists.

**Do not weaken a rule so new code passes.** A new module that cannot satisfy the rules
is telling you something about the design.
