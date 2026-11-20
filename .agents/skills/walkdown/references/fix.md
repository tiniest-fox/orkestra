# Shaping a bug fix

A proposed shape for a record whose `change` is `fix`. Bend it to the change; it is a
starting point, not a template to fill.

A reader of a fix wants to know what went wrong, why, and why it cannot go wrong that way
again. The story is a cause and a correction.

- **Telling figure.** Where the wrong value came from and where it comes from now. A
  flow through the steps that set it, with `before` and `after` lenses, shows both as one
  path forking where the fix changed it. A `shift` or a `before-after` is enough when the
  fix is one text changed.
- **Rows.**
  - The cause: the step or the condition that let the bug through, with its code as a
    `snippet` annotated on the lines that let it through, and the input that hit it.
  - The fix: what now stops it, with the lines doing the work.
  - Who saw it: a `breaking` claim where readers of the old behaviour see a change.
  - What is not covered: a `risk` for a nearby case the fix does not reach, an `open` for
    what is still unknown about the cause.
- **Not a row of its own.** The steps to reproduce: a concrete example belongs inside the
  claim it illustrates, often as a lens's payload.
