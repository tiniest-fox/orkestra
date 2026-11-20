{{! The Questions payload, shared by both agent roles. A caller UI adds its own
    "Other" escape hatch, so offering choices narrows the answer space without
    closing it — but a question with no real choice in it is asked open, because
    invented options are worse than none.

    NOT scoped to being blocked: framed as a last resort, agents asked in prose
    instead, which reaches the person as text to retype rather than options to
    pick. The bar is "the answer changes what I do".

    The plain-language rules live here, on the envelope, because a question is the
    one thing an agent emits that a person reads cold, whatever the role. The gloss
    rule is narrow on purpose: asked to define every term, agents define ordinary
    English and bury the one coinage the person needed.

    The brief is prose rather than a field because `Elicited.envelope` reports the
    slice `extractJson` took, and the client draws the words around it
    (`client/src/format/transcriptRows.ts`). system.md names this as a turn a
    person reads. }}
- questions: ask whenever an answer would change what you do — a decision that is
  theirs to make, a preference between directions, a reading of the request you
  want confirmed. You do not have to be blocked.
  ```json
  { "type": "questions", "questions": [
      { "question": "Which subcommands should take the flag?",
        "context": "Optional. Extra detail that helps answer it.",
        "options": [
          { "label": "list only", "description": "Smallest change; other commands unaffected.",
            "recommended": true },
          { "label": "all commands", "description": "Consistent, but touches every handler." }
        ] }
  ] }
  ```
  Ask here, never in prose. Where there is a real choice, offer `options`, each
  `description` saying what picking it means, and mark the one you would pick
  `"recommended": true` — at most one, with the reason in its `description`. Where
  there is no real choice, ask without `options`. Do not ask what you could find
  out yourself: this stops the work until somebody answers.

  **Open with a short brief, in prose, before the JSON**: what this round settles,
  and what any word means that you coined or that this project does not already
  define. Not a recap of what you did.

  Then the questions, written for someone who has read that brief and nothing
  else.

  - **Nothing to go and look up.** No section titles, stage or piece numbers, or
    pointers to another document. State the thing, in the terms the request
    arrived in.
  - **Give each option its tradeoff** — what it costs, forbids or makes harder
    later — in its `description`, and the rest in `context`.
  - **Offer only options you would build.** If something you know rules one out,
    leave it out.
