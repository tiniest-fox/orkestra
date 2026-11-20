{{! The standing channel, as the contract states it. Included by system/step.md,
    so it is said on the session: what qualifies does not change between turns.
    Shared by both envelopes that carry work, because a step that hit the wall has
    usually just learned something directional.

    `kind` exists because something branches on it: only `unplanned_work` wakes the
    composer (see `decided.ts`). Labeling the entry is the sorting question asked
    where a model can answer it.

    THE RISK IS OVER-FILLING — with what files changed and what the tests cover.
    Closed kinds and "none is expected" alone never held it; the near-miss tables
    are the lever that does, so they stay whole. The first catches an entry that is
    not one; the second catches a real entry labeled `unplanned_work` when nothing
    is owed, which buys the planning turn the split exists to stop.

    SUPERSEDES IS A FIELD, NOT A KIND, so it can sit beside `unplanned_work`. The
    restating rule is what makes folding a named requirement safe: the replacing
    entry is the whole of what stands. `intent.md` holds the read side. }}
## Requirements

Both shapes that carry work take an optional `requirements` list — what this turn
settled about **what is being built**, not about how you built it.

```json
"requirements": [{ "text": "the admin view is out of scope for this trak",
                   "kind": "out_of_scope", "source": "stated" },
                 { "text": "the footer layout has to be looked at visually before
                            anything is specced against it",
                   "kind": "unplanned_work", "source": "assumed" },
                 { "text": "the parser lives under src/parse; there is no lexer",
                   "kind": "constraint", "supersedes": ["1-investigate"],
                   "source": "assumed" }]
```

**Would this still be true after somebody fixed it?** Yes is a requirement. No is a
complaint about work that exists, which is `corrections` below.

`kind` says which of the four it is. Write one on every entry:

| kind | what it is |
|---|---|
| `out_of_scope` | taken out of this work, or left to another day — nobody does it here |
| `unplanned_work` | somebody has to do work this plan does not have |
| `constraint` | the work now has to hold to this |
| `ruled_out` | an approach ruled out, and what replaced it |

**Only `unplanned_work` changes the plan**, so it is also how you say the steps
after you are wrong. The other three reach every later step and cost no turn.

**`supersedes` lists what this entry replaces**, beside any kind: a document, by
its key as the plan above lists it — `1-investigate`, or `from-parent/1-investigate`
for one this trak was born holding — or a requirement, by the id the list above
prints under it — `1-investigate.2`. Your `text` is written above a named
document's first section; a named requirement is taken out of the list every later
reader sees. A name this step was not shown is refused.

**Superseding replaces the whole of what you name**, so your `text` restates
whatever of it still holds. It is the answer to a document that is stale; one short
of work is a correction, below.

The expensive question is **does somebody have to do work?** All five of these are
requirements, and only one is that:

| what it says | kind | why |
|---|---|---|
| *the footer has to be looked at before anything is specced against it* | `unplanned_work` | somebody has to build something to look at, and no step does |
| *the admin view is out of scope for this trak* | `out_of_scope` | nobody is doing it, here or later — there is no work to plan |
| *rate limiting is per key rather than per IP* | `constraint` | the steps that already exist hold to it; none is added |
| *the queue approach cannot preserve ordering, so it is off the table* | `ruled_out` | it removes work rather than adding any |
| *the parser lives under `src/parse`, not `src/lex` as `1-investigate` says* | `constraint`, superseding `1-investigate` | the document is stale, and no work is missing behind it |

**If it is visible in the diff, it is not a requirement**, whatever kind it would
have been. Nor is anything a later step would work out for itself:

| looks like one | reads as | why it is not |
|---|---|---|
| *the parser is now a separate module* | `constraint` | it is in the diff, and nobody has to be told to keep it there |
| *the retry logic could use a test* | `unplanned_work` | a job for whoever is next, not work this plan is missing |
| *the config format may need revisiting* | `constraint` | a worry, not a decision — nothing has been settled |
| *once the icons exist, the header can be laid out* | `unplanned_work` | ordering inside work already planned |
| *I used the existing helper rather than writing one* | `ruled_out` | the obvious choice, made obviously |

**A requirement is about the work, never about how the pipeline handles it.** Which
findings block, how closely to review, what a gate should ask — none of those.

`source`: *could you point at the sentence a person wrote?* Yes → `stated`, even
paraphrased. No → `assumed`, however reasonable the inference; an extension of what
someone said is an assumption.

**The test is consequence, not uncertainty.** Write one when the answer would be
expensive to reverse, **even when you are sure of it**.

**A requirement already recorded stands, so do not write it again.** The channel is
only appended to, and an entry an earlier step filed, restated, lands as a second
entry. Write what *this* turn settled.

**Most turns record nothing, and leaving the key out is the expected answer.** An
empty list is not a valid value, and a list of implementation notes buries the real
entries.
