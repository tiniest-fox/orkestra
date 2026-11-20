---
name: house-style
description: The lint rules that will block a change in orkestra, how to name things, the _tag versus type split, and what to do when pnpm verify fails. Read before writing or editing any .ts file here, and whenever oxlint rejects something that looks reasonable.
---

# House style

`pnpm verify` (`fmt:check → check → lint → knip → docs:check → test`) must pass with
**zero warnings**. The toolchain is oxc — **not** Biome, **not** ESLint. Config in
`.oxlintrc.json` / `.oxfmtrc.json`.

## Rules that will block you

| Rule | What fails |
|---|---|
| No `as` type assertions | `consistent-type-assertions: never`. Annotate, or use `satisfies`. Opt out per-site with `// oxlint-disable-next-line typescript/consistent-type-assertions -- reason` |
| No `any`, no `!`, no `@ts-ignore` | `no-explicit-any`, `no-non-null-assertion`, `ban-ts-comment` |
| Never hand-write `{ _tag: "X" }` | use the constructor — `TrakState.AgentWorking({ step: 0 })`, `Events.trakCreated(…)` |
| `_tag` is the only allowed dangling underscore | `no-underscore-dangle` with `allow: ["_tag"]` |
| `undefined` means absent; **never `null`** | `exactOptionalPropertyTypes`, `unicorn/no-null`, `strict-boolean-expressions` |
| No `default:` branch that silently does something | `Match.exhaustive`, a tagged enum's `$match`, or `assertNever` |
| ≤100 lines per function, ≤7 params, ≤3 depth | matches the clippy thresholds the Rust Orkestra uses |
| Named exports only | `import/no-default-export` |
| No prompt text in a `.ts` file | it belongs in `src/prompts/templates/*.md` |

## Comments describe the world today

A comment is read by someone deciding what to do **now**. Explaining what a function
used to be called, what a type replaced, or which field went away spends their attention
on a world they cannot see.

**State the rule and what breaks if you ignore it, in the present tense.** Keep the
causal half — `EPERM` means the process exists and is not yours — and cut the
provenance.

| Write | Not |
|---|---|
| `RunChecks` is unconditional: `decide` cannot read policy | this used to branch on the agent's checks |
| a kind rather than a state, because `Approve` means one thing everywhere | unlike the `AwaitingRejection` it replaces |
| resumes the session, and still owes an artifact | unlike `Instructed`, which is gone |

**Code comments never cite atelier studies or past design work.** No `.atelier/...`
path, no "settled in the study", no round or trak that decided it. The studies are not
in this repository, so the pointer dangles; state the reason the design gave, in your own
words, or leave it out.

**A comment is part of your diff.** If a change moves what a comment claims, the comment
is wrong in the same commit — see `code-review-lens`. Naming a deleted symbol is worse
than saying nothing: it sends a reader looking for something that is not there.

**A comment must save more reading than it costs.** That is a question of altitude, not
length:

| Altitude | Earns its place by |
|---|---|
| file / module | saying **why this exists** and what it is for, so nobody has to read the whole file to find out |
| type / export | the constraint, the invariant, or what goes wrong if you use it the obvious way |
| statement | the surprise only — a branch that looks wrong, an order that matters, a workaround |

**A comment that paraphrases the code beneath it in about as many words is dead weight.**
Delete it; the code already says that. The test is not "is this documented" but "does a
reader who skips the body still know what they need".

**Nothing with a shelf life.** Counts of what is below, line numbers, file sizes and "see
the case above" go wrong silently as code moves — name the thing, or state the rule. So
does a measurement of something outside this repo — what a tool prints, whether a
dependency colours its output — which that tool's next release falsifies with nothing
here failing on it. A count that *is* the constraint ("three attempts, then give up") stays. Full rule in
`writing-docs`.

## Make illegal states unrepresentable

Branded ids (`TrakId`, `SessionId`, `WorktreePath`, `CommitSha` via `Schema.brand`) so
passing one where another belongs stops compiling. `Schema.NonEmptyArray` where empty is
meaningless. **One representation of absence** — `undefined`, never `null`, never
empty-string-means-none.

## Naming

The usual bans — `handle`, `process`, `manage`, `do`, `data`, `info`, `utils` — plus
one this codebase adds: **generic FP operation names.** `fold` and `reduce` describe a
mechanism, not the domain.

Give each piece a noun, then let the verbs reference it:

| Generic | Here |
|---|---|
| `readonly Event[]` | `History` |
| `reduce` | `decide` — returns a `Decision` |
| `fold` | `replayHistory` — consumes a `History` |
| `step` | `applyEvent` — leaves "step" for the proposal concept |
| `run` | `runCommand` |

**Read the signature aloud and see whether it describes the domain.**
`replayHistory(id, history) → Trak` does; `fold(id, events) → Trak` doesn't.

## `_tag` inside, `type` on the wire

- **`_tag`** — everything the engine says to itself: `Decision`, `Command`, `TrakState`,
  `Event`, `HumanAction`.
- **`type`, snake_case values** — anything an **agent writes by hand**: `"artifact"`,
  `"questions"`, `"proposal"`.

`Schema.tag("artifact")` keeps `.make` filling the field. **Seeing `type` in a file is
the signal that the shape crosses the agent boundary.**

## When `pnpm verify` fails

- **Never weaken a rule to make code pass.** If one seems wrong, say so and leave it in
  place.
- **Read a suggested fix before applying it.** oxlint suggestions have proposed code
  that does not compile at this repo's TypeScript target.
- **`knip` failing means something is exported and unused — delete it**, rather than
  finding a caller.
- Don't report a check as passing without running it, and don't paraphrase the result.

Before you write Effect, know the trap no linter catches: **a floating Effect does
nothing.** `store.append(…)` without `yield*` never runs. See `effect-idiom`.

## `target` is pinned to the oldest TypeScript in the toolchain, not the newest

`tsc` here is 7.x — a Go binary with no `tsserver.js`, so editors fall back to their own
bundled 5.x. Set a value that 5.x rejects (`"ES2025"`) and the config fails to load
*in-editor only*: every file is then checked against ES5 defaults and reports phantom
errors while `pnpm check` stays green. Raise `target` when an API earns it, and **never
`"ESNext"`** — it re-defines itself on upgrade.

## Lint rules that must not be added

- **`unicorn/no-useless-undefined`** — its autofix strips the initial value from a
  `reduce`, changing the overload and breaking the build. A rule whose autofix
  introduces bugs is worse than no rule.
- **`unicorn/no-array-callback-reference`** — matches `.some(` textually and cannot tell
  `Option.some(value)` from `Array#some(predicate)`. False-positives constantly in an
  Effect codebase.

**`no-restricted-syntax` does not exist in oxlint**, so arbitrary AST-selector rules need
a custom plugin.
