---
name: code-review-lens
description: What to look for when reviewing a change in orkestra specifically — the failure modes this codebase is prone to, not generic review advice. Read before reviewing a diff here, before approving a change that touches error handling, the state machine, or a port, and when deciding whether a finding is worth sending work back for.
---

# Reviewing a change here

In order of what it costs.

**1 · A catch-all that returns a value.** For every `catchAll`, `catch` and bare `try`
in the diff: **when this fires, is the value it returns a fact or a guess?** A caught
error that becomes a verdict — "the agent gave up", "there is no such branch", "the
process is dead", "the reply was empty" — is silent and destroys work. Flag `catchAll`
where `catchTag` would do. HIGH.

**1a · Three questions for any code that runs against the world.** Ask each of every
read, probe and multi-step write in the diff. HIGH.

- **What can change between this read and this act?** A take-over that re-reads only
  `atRest` before it appends acts on a trak whose drive moved in between.
- **What does this return when it could not ask?** An `anyRunning` that answers `false`
  on a timeout says "nothing is running" when it does not know — item 1's question, for
  code with no `catch` in it.
- **What state is left if this stops halfway?** An install that deletes the old app
  before renaming the new one into place leaves no app at all if the rename fails.

**2 · One way in, out of several.** A failure mode arrives more than one way: in-band
*and* by exit code; a worktree that is gone *and* one git still lists. When a diff fixes
a failure path, ask what the other way in is.

**The same question one altitude up, and the more expensive one: when a derivation gives
a wrong answer, the defect is the derivation, not the input that showed it.** A predicate
over the event log is wrong on a *set* of logs. Enumerate the ones the engine can
actually produce, say which of them it gets wrong, and settle all of them in one finding
— `overriddenIn` was sent back three times for one sentence because each round named the
next log shape rather than the set. A derivation that restates rules living in `decide`,
`runtime` or `replay` is the shape most prone to it: nothing it can be tested against
knows those rules, so it is only ever as correct as the last case somebody thought of.

**3 · A floating Effect.** `store.append(…)` without `yield*` does nothing and no linter
catches it. A test passes over code that never ran.

**4 · Boundary erosion.** Does `workflow/domain/` still import nothing — and if the
change wants it to, is the answer a `Command`? Did I/O appear outside `adapters/`? Did
`agent/`, `library/` or `vcs/` grow an import from `workflow/`?

**4a · A mechanism field on the wire.** `lastGate`, `failedFrom` and `composerSession`
exist because `decide` is context-free; they are scaffolding, not facts about a trak.
**Does the diff project one?** A DTO, a CLI line and a log view read `state`. Reading
`lastGate` as "is this parked?" appends an event `decide` cannot route — settling a
healthy trak `Failed{engine}`, or, for an approval, absorbed as a press already taken
and silently lost. HIGH.

**5 · A comment the diff falsifies, or one narrating history.** A comment explaining why
something must be defensive is a claim about the rest of the system — if the diff changes
what it depends on, the comment is part of the diff. Equally: **a comment naming what a
thing used to be called or used to do sends the reader after a symbol that is not there.**
Present tense, or delete it. See `house-style`. **Code comments never cite atelier
studies or past design work** — a `.atelier/...` path or "the study settled" points at
material outside this repository; the comment states the reason itself.

**A claim you have now found wrong twice is not one to correct a third time — delete
it.** Prose that needs re-measuring every time the code moves was never load-bearing,
and correcting it one sentence per round is how a comment fix costs five of them.

**6 · A test written around the exception.** An assertion carving out the one case that
fails the rule it checks; an invariant covered by hand-picked histories where the whole
matrix would catch the bug. **Ask what the test would have to fail on.**

**7 · A mechanism nothing surfaces.** If a change adds a state, a failure kind or a
recovery path, ask where a human sees it — a correct `failedFrom` and retry offer are
worth nothing behind a line that prints `Failed after 36 events`.

## The visual lens

The `exercise` step judges what a change renders, from screenshots of the finished build
**in `sim`, never the person's engine** — this repo's `.orkestra/agents/exercise.md` says
how. A review reads its shots rather than taking its own, and leaves judging them against
`client-style` to it.

## The documents a diff names

After reading the diff, list the reference documents that name a changed file, and read
each cited passage against the diff. It reads only `README.md`, `CLAUDE.md`,
`references/` and the skills, matches the exact path, and exits 0 whatever it finds:

```bash
pnpm docs:check --changed-since "$from"
```

A sentence there that the diff has made false is a finding you apply yourself. A file it
lists under no document may still be described by one without its path — the listing
finds the citation, not the description.

Size the pass to what is at risk: a comment fix needs a glance; a change to `decide`,
`advance`, a port's shape or a prompt template needs the whole list.

## The three simplicity tests

1. **Could this have been data instead of code?** A new `if` on a provider name, a stage
   name or a config flag is the smell.
2. **Does this add a file, or a case?** Cases stay findable in the exhaustive structure
   that already exists.
3. **Does `domain/` still import nothing?**

## The bar for a finding

> **Would you stop a colleague's PR for this? If you'd leave a comment but approve
> anyway, it's an observation, not a finding.**

**Finding nothing is a complete review** — say so rather than manufacturing a nit.

**A finding you send back costs a cycle; one you fix yourself costs a paragraph.**
Severity sets fix order. What decides whether the change goes back is whether the fix
was yours to make — a correction visible in the diff you have already read is; anything
that changes behaviour is not.

**The fix being small is not a reason to downgrade.** Code that is incorrect but happens
not to crash is still incorrect. Don't rationalise a defect because error handling
absorbs it or current data avoids triggering it.
