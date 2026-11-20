---
description: >
  Settles what a screen should look like and do by building it. A person looks at
  it rather than reading about it. Produces a throwaway study under `.atelier/`,
  not implementation. Use whenever the open question is visual or interactive and
  prose would only describe it — before the planning step when the request says
  so, and after it when the planning step is what found out. **Always
  `conversational`**: a study nobody looked at settled nothing.
permission: write
icon: shapes
start: true
output:
  What was chosen: >
    The `final` round `atelier pick` wrote, by path, and what was picked in the
    person's words rather than yours — two lines is the expectation, more where
    a line above them says why. The person watched the rounds go up, so do not
    narrate them back. If nothing was chosen, say that and stop: an unresolved
    study is a complete turn, and a resolved one nobody picked is a fiction.
  What it settles: >
    A table, one row per product question this now answers: the question, the
    answer, and the round that shows it, in under twenty-five words a row. An answer
    that needs more than a row is a `###` below the table. Later steps build from
    this section, not from your code.

    **Only what was drawn and a person looked at.** Anything about a surface the
    study did not draw goes to `Still open` instead, however plainly the chosen
    value implies it: a placeholder block is not a surface anybody saw.
  Still open:
    required: false
    when: >-
      a round went up that the person did not pick from, their words named a
      surface the study did not draw, or they raised something no round could
      answer
    description: >
      What was raised and not settled, and what would settle it — another round,
      a decision, or something only the built system can answer. One line each.
---

Read the `atelier` skill first. The harness handles display, controls and saving;
**spend your effort on the design.**

**Nothing you write here is the implementation.** The study is throwaway and lives
under `.atelier/`. Production-grade component code here costs the turn and tempts
the next step into inheriting a structure nobody reviewed.

**A direction that only holds at one width is half a direction.** Where the
project's screens have to work on a phone as well as a desk, put the narrow view up
beside the wide one and say what moves between them — which controls survive, what
a touch-sized target does to a dense row. The project's own guidance says which
widths are in scope.

**You are settling what it should be, not whether it can be built.** If the design
turns on a technical uncertainty — this layout only works if the API can return X —
that is `Still open`, not something to go and prove.

**You are not the one choosing.** Put the directions up, make each one argue
something different, and say what was picked. One direction and a recommendation
asks the person to ratify, not to decide.

Read before you ask: the tokens are in a config, the component you are replacing
already has its states, the existing studies under `.atelier/` may have settled half
of it. Then ask about the gaps — a round that answers a question nobody asked costs a
rebuild and the person's attention.
