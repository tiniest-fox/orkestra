# Draft Technique Index & `COMPOSITION.md`

*Produced and validated during a lightweight composer-simulation exercise — not a build. No runtime wiring exists; nothing here has real frontmatter, check references, or model assignments yet (that's Phase 1/2's job). This is a starting point for [Phase 2](./02-technique-library-content.md), not the finished library.*

## How this was produced

The 18 files in `.orkestra/agents/*.md` were grouped by actual behavior, not filename — per Phase 2's own instruction that `reviewer.md`/`subtask-reviewer.md`/`prompt_reviewer.md`-style near-duplicates should collapse into one Technique with a depth dial, not three. `planner.md`/`quick_planner.md` were initially assumed to dissolve entirely into the composer/chat's own bootstrap behavior (per `design.md`'s original resolution) but were ultimately given their own Technique, `requirements-discovery` — see `design.md`'s Entry point section and Use Case 4 for why.

## How this was validated

An Opus agent was prompted to play the Composer role, given only this index (title + description — deliberately the *only* thing a composer sees per `design.md`'s resolved selection-mechanism decision) plus the `COMPOSITION.md` draft below, across 7 varied tasks (a self-evident CLI change, an ambiguous bug, a multi-deliverable feature, a frontend change, a prompt-tuning change, a docs-only change, and a genuinely shapeless ask) plus a follow-up recomposition scenario (a settled requirements artifact + "let's implement this"). No code was touched; this only tested composition judgment.

**What held up well:** domain separation was clean in both directions (no code techniques leaking into prompt-tuning/docs Traks, no `prompt-*`/`docs-*` techniques leaking into code Traks); elision was correct (skipped investigation only when genuinely self-evident); `red-green-investigation` was reached for unprompted on the one task that needed it; `clearance` tracked real risk rather than following a blanket rule; a fresh, memoryless recomposition correctly distinguished "still fuzzy, defer" from "settled, build it" given only durable facts (see `design.md`'s Use Case 4).

**What needed a fix, and got one:** the first pass under-decomposed a genuinely multi-deliverable task (rate limiting: config + enforcement + a CLI to inspect it), staying linear when it plausibly should have routed to `vertical-slice-decomposition`. The fix was a two-line addition to `COMPOSITION.md` (below) reframing the bar from "confirm a real interface seam" (requires codebase research the top-level composer doesn't have) to "notice the request bundles more than one plausible deliverable" (readable from the description alone) — retested clean, with no regression on the genuinely-indivisible case.

**Still open, not resolved here:** whether a bare `questions` output mode is needed at all once `requirements-discovery` exists as a Technique — across every test, including a maximally vague ask, the composer always preferred proposing `requirements-discovery` as a delegated step over a bare `Questions` output. Worth settling before Phase 4 decides the composer's exact output contract.

---

## Technique Index (title + description)

- **requirements-discovery** — Ask the human 1-4 targeted questions per round (intent, scope boundaries, success criteria, edge cases, priorities) to resolve what's actually wanted, then produce a lightweight requirements agreement (summary, in/out scope, success criteria, open technical questions). Use as an explicit first step when the *ask itself* is underspecified — not when the implementation approach is unclear (that's a downstream concern). Does no codebase research of its own.
- **implementation-conventions** — Follow existing codebase patterns, module structure (interactions/types/interface/service/mock), naming, and error-handling conventions. Grep for mirrored string constants and stale docstrings before finishing. Present in nearly every code-touching step.
- **standard-verification** — Baseline correctness floor for code changes: lint, build, and existing test suite must pass; write regression tests for bug fixes and new conditional branches. This is the near-universal verification technique for ordinary code changes.
- **red-green-investigation** — Investigate a reported bug by tracing it to root cause and writing a failing test that proves it, without fixing it. Use when root cause isn't yet confirmed and the bug is reproducible.
- **regression-safety** — Implement the minimal fix for a root cause already identified by a prior investigation step. Must not modify the investigator's failing test(s); fix only what's needed to make them pass.
- **vertical-slice-decomposition** — Research the codebase and split a Trak into independently-implementable, end-to-end vertical slices (not horizontal layers), each with clear interfaces and dependencies. Err toward routing here whenever a request bundles more than one plausible deliverable — this Technique's own research is what confirms whether a real interface seam exists; don't hold off just because separability isn't obvious from the description alone.
- **standard-review** — Independent review of a code change, sizing itself from a single focused pass (trivial changes) up to a full specialist panel (cross-cutting or high-risk changes) based on what's actually at risk in the diff.
- **integration-consistency-review** — After independently-composed child work merges back together, verify the pieces actually fit: no broken imports, consistent naming, no missing wiring between components that assumed each other's interfaces.
- **storybook-story** — Add or update Storybook stories covering each visual state (default, loading, error, empty) for any new or visually-changed UI component. Use for any Trak that touches `src/components/`.
- **prompt-investigation** — Understand what's wrong with an existing agent prompt (`.orkestra/agents/*.md` or Technique file) and what "better" looks like: read the current prompt, adjacent prompts for consistency, and relevant prompt-engineering practice.
- **prompt-writing** — Apply prompt-engineering craft (role clarity, instruction specificity, explicit output format, termination conditions) to revise a target prompt file, preserving what already works.
- **prompt-review** — Review a revised prompt against its requirements and prompt-engineering best practice: requirements coverage, internal consistency, consistency with neighboring prompts, and production risk.
- **docs-research** — Explore the codebase read-only and produce a structured analysis (purpose, concepts, config reference, examples, edge cases, internal-vs-user-visible distinctions) for a technical writer to work from without re-reading source.
- **docs-writing** — Turn a research analysis into MDX documentation, choosing the right Diátaxis type (tutorial/how-to/explanation/reference/overview) and following house style and persona guidance.
- **docs-editorial-review** — Evaluate documentation for accuracy against its source analysis, writing quality, style/frontmatter conventions, and completeness for the reader's actual goal.
- **compound-learning-capture** — Passive-first scan of what a Trak revealed (confusion, rejection patterns, repeated check failures, prompt/skill gaps) and place any genuine learning at its most local, discoverable source. Most Traks need zero action from this Technique.

## Draft `COMPOSITION.md`

Prose guidance for how this team likes Traks composed. Not mandatory rules — weigh these like any other context.

- When the Trak description leaves real ambiguity about what's actually wanted (not just how to build it), make `requirements-discovery` the first step rather than guessing. It's fine for that to be the only step you're confident proposing right now — the sequence after it can be decided once it resolves, the same way any step's outcome can trigger recomposition.
- `implementation-conventions` and `standard-verification` are the default baseline for essentially any code-touching step. Include them unless you have a specific reason not to.
- Bug reports without a clear, already-confirmed root cause: start with `red-green-investigation` before any fix step, rather than guessing at the fix directly.
- Frontend changes touching `src/components/`: include `storybook-story`.
- Unless changes are exceedingly trivial, include some independent review (`standard-review`) before Done. Trivial really means trivial — a one-line config change, not "small feature."
- Prompt/agent-definition changes (`.orkestra/agents/*.md` or Technique files) are a different domain from application code: use the `prompt-*` techniques, not `implementation-conventions`/`standard-review`.
- Documentation-only Traks (`docs/src/content/docs/**`) use the `docs-*` techniques, not the code techniques.
- When a Trak is large AND genuinely splits into independent pieces (not just "big"), use `vertical-slice-decomposition` rather than one long linear chain. If it's large but stays one coherent thread, keep it linear and let it run longer instead.
- When a Trak's request bundles multiple distinct deliverables (e.g. a config/data model plus a separate surface that consumes it — a CLI, a UI, an API), don't judge the interface seam yourself from the description alone. Route through `vertical-slice-decomposition` so a step with real codebase access can determine independently whether it actually splits and how. Only skip this when the request is unambiguously one indivisible unit of work.
- After independently-composed children merge, add one `integration-consistency-review` step at the parent level before Done.
- `compound-learning-capture` runs at the end of essentially every Trak; it's cheap to elide only for the most self-evident, single-line changes.
