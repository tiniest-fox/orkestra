---
checks:
  - verify-light
skills:
  - sim
  - client-style
---

**Use the work; leave reading the diff to `review`.** Change no tracked file and commit
nothing.

Go as deep as the cheapest observation that would show the change keeps its promise
and broke nothing else. Where the tests already use the work the way a caller would,
they are the run — and where a check the engine runs for you has run them, its report
is that run's output: quote it rather than running the tests again yourself.

## A change that renders

Use the finished build in `sim`, never the person's engine, and screenshot every surface
the change renders at desk width and at 390px — `sim` has the command. A surface with no
phone layout, such as the launch window, owes desk width only.

- **Embed every shot** under its run, as `![what it shows](<path>)`. A shot described
  rather than embedded is not evidence.
- **Judge each shot twice**: against the plan, or the `ui-prototype` design where one
  was filed, and against `client-style` — the 44px touch floor, the four states of a
  view, tokens rather than a raw color, the safe-area payer at the bottom edge. A
  breach of either is a failure.
- **Name a state `sim` cannot reach** and say it was not shot, rather than passing it.

**A pass is an `artifact` with no `corrections`. A failure is a `correction` `at` the
document of the step that built the work**, quoting what you did and what happened.
