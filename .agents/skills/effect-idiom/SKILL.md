---
name: effect-idiom
description: Write Effect the way orkestra writes it, and avoid the traps here that fail silently — a floating Effect, Effect.forEach over a Schema function, and a catch-all that turns "I could not tell" into a verdict. Read before touching ports, adapters, interactions or the runtime, and before writing any catchAll, catchTag or try/catch.
---

# Effect, this codebase's way

## Traps, all silent

**1 · A floating Effect does nothing.** `store.append(…)` without `yield*` is a value
that is never run, and **no linter catches it.** It is the most common way to write a
passing test over code that did nothing.

**2 · `Effect.forEach(items, schemaFn)` breaks.** `forEach` passes `(item, index)` where
a Schema function expects `(item, ParseOptions)`. Wrap it: `Effect.forEach(items, (i) =>
schemaFn(i))`.

**3 · A catch-all that returns a value turns "I could not tell" into a verdict.** The
returned value is indistinguishable from a real answer, so the mistake is silent and
downstream code acts on it:

| Caught | Wrongly becomes |
|---|---|
| a dropped connection | the agent's own `failed` output — terminal, and the work is stranded |
| `GitFailed` from `branchTip` | "there is no such branch" — and the branch gets deleted |
| `EPERM` from `process.kill(pid, 0)` | "the process is dead" — it exists and is not yours |
| an `ApiError` in the stream | empty text — re-prompted, then filed as the agent giving up |

**Catch the tag you mean (`catchTag`), or discriminate on the exit status.** When you
genuinely cannot tell, ask which direction is safe: a leaked process beats a wrong kill;
a retryable failure beats a terminal verdict about work nobody read.

**Check a fix against every channel the failure arrives through** — most of these have a
second one.

**4 · Interruption skips everything after the effect it interrupts.** A fiber killed from
outside unwinds through its scopes' finalizers and nothing else, so every `tap`,
`andThen` and `catchAll` further down the pipe is passed over. An adapter holding state
about something in flight is then left holding it: `checks-shell.ts` kills the script when
the scope closes, and without an `Effect.onInterrupt` outermost it hands the run to every
reload as still going. Settle that state in the adapter, not at the caller — the caller is
the fiber that was killed.

## How to write one

- **Takes parameters** → `Effect.fn("Name")(function* (a) {…})`. Span, real stack trace.
- **No parameters** → `Effect.gen(function* () {…})` as a value.
- **Recursive or generic** → an annotated arrow returning `Effect.gen`. `Effect.fn`
  cannot infer through a self-call.
- **`E` and `R` both `never`** → make it a plain function. `Effect<A, never, never>` is
  a smell, and `Either` is a value pure code can return.

## Read `R` to judge whether an interaction does too much

The `R` channel names everything an interaction touches, transitively, and there is no
way to hide it — so "is this doing too much?" is readable off a signature.

```ts
(i: In) => Effect<Sha, VcsError, Vcs>                        // one job, one dependency
(i: In) => Effect<void, …, Store | Vcs | Agent | Checks>     // suspicious
```

A coordinating chain legitimately requires several things. A broad `R` on something
*named like a single operation* means it should be split, or it belongs a layer up in
`runtime.ts`.

## Dependencies, not options bags

Ambient things — observers, transcript sinks, config, loaded templates — are
`Context.Tag` services. **If a parameter is the same on every call in a flow, it's a
dependency.** Ports are Services; interactions are plain exported functions over ports.

## Exhaustiveness

Prefer `Match.exhaustive` or a tagged enum's `$match` over a `switch` with a `default:`,
so a new case is a compile error. Never hand-write `{ _tag: "X" }`.

## Re-read a defensive comment when its premise moves

A comment explaining why something must be defensive is **a claim about the rest of the
system**, and nothing re-checks it when that system changes. If your diff moves what one
depends on, the comment is part of the diff.
