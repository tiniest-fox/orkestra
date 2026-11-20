# Shaping new functionality

A proposed shape for a record whose `change` is `feature`. Bend it to the change; it is a
starting point, not a template to fill.

A reader of a feature wants to know what it does for someone, how it works, and what it
was built on or around. The story is a capability and the path that serves it.

- **Telling figure.** The feature at work: a `flow` from the input to what the user sees,
  with each step's code, or an `image` of the feature with realistic data where what it
  looks like is the point.
- **Rows.**
  - One claim for each part a reader would ask about on its own, such as a new command,
    a new field, or a new screen, each with the code that makes it.
  - Choices that could have gone another way, as `tradeoff` claims.
  - What existing callers now see, as `breaking` claims.
  - What was left for later, as `open` claims.
- **Not a row of its own.** A tour of every file touched: name the plumbing in the claim
  it serves, by its hunks.
