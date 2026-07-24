# Orkestra Adaptive Pipeline

Replacing static, named `workflow.yaml` flows with a composed pipeline built from small, reusable Techniques. See [`design.md`](./design.md) for the full decisions and rationale — this README and the phase files are the execution plan derived from it.

Read [`design.md`](./design.md) first if you haven't already; the phase files below assume its terminology (Technique, Composer, Composed step, Mechanism vs. policy, etc.) without re-explaining it.

## Progress

- [x] [Phase 0 — Resolve open design questions](./00-resolve-open-design-questions.md)
- [ ] [Phase 1 — Mechanical resolution logic](./01-mechanical-resolution-logic.md) *(next up)*
- [ ] [Phase 2 — Author the Technique library](./02-technique-library-content.md)
- [ ] [Phase 3 — Composed-step execution (static)](./03-composed-step-execution.md)
- [ ] [Phase 4 — Composer agent, human-confirmed](./04-composer-agent.md)
- [ ] [Phase 5 — Recovery and escalation](./05-recovery-and-escalation.md)
- [ ] [Phase 6 — Subtask composition unification](./06-subtask-composition-unification.md)
- [ ] [Phase 7 — Frontend / API contract rework](./07-frontend-api-rework.md)
- [ ] [Phase 8 — Turn on composer clearance](./08-composer-clearance.md)
- [ ] [Phase 9 — Cutover](./09-cutover.md)

## Sequencing

```
Phase 0 (done)
  └─ Phase 1 ─┬─ Phase 2 (parallel, no shared dependency)
              │
              └─ Phase 3 ─┬─ Phase 4 ─┬─ Phase 5 ─┬─ Phase 6
                          │           │           │
                          └─ Phase 7 ─┘           │
                          (branches off Phase 3,   │
                           runs alongside 4-6)      │
                                      │             │
                                      └─ Phase 8 ────┘
                                                │
                                          Phase 9 (needs 2, 5, 6, 7, 8)
```

Each phase file below states what it's blocked by and what runs in parallel with it — treat this diagram as a quick-reference, not the source of truth.

## How to use these files

Each phase file has:

- **Status** — Done / Next up / Blocked, and what it's blocked by
- **Goal** — one or two sentences
- **Approach** — the actual reasoning and, where it exists, real file/line grounding from this codebase (not invented)
- **Steps** — checkboxes; check them off as you go
- **Exit criteria** — checkboxes; this is what "done" means for the phase, not a vibe
- **Open questions** — anything genuinely unresolved that needs a decision before or during that phase, flagged rather than silently guessed at

When a phase completes, check its box in the Progress list above and flip its own Status line to Done.
