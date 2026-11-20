# Shaping a refactor

A proposed shape for a record whose `change` is `refactor`. Bend it to the change; it is a
starting point, not a template to fill.

A reader of a refactor wants to know what moved, why the new arrangement is better, and
what guarantees behaviour did not change. The story is a structure before and after.

- **Telling figure.** The structure before and after: a `shift` naming what moved where,
  or a `flow` of the path through the code with `before` and `after` lenses where the
  order of calls changed.
- **Rows.**
  - One claim for each move a reader would trace on its own, with the code at its new
    home.
  - What keeps behaviour the same: the tests that pin it, as a `measured` claim when they
    were run.
  - Where it might not be the same, as `risk` claims.
- **Not a row of its own.** Mechanical churn, such as renames and formatting: leave those
  hunks unnamed, and `check` warns about them without failing.
