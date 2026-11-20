{{! The corrections channel, said on the session beside system/requirements.

    THE RISK IS THE OPPOSITE OF REQUIREMENTS', AND IT IS THE EXPENSIVE ONE: a
    standing constraint filed here evaporates when the round closes. So the bar
    tightens on this list and never on that one, and the near-misses are all
    things that ARE requirements.

    `at` cannot be derived — every other provenance points at the step that filed
    it, and this points the other way — so the agent copies it from the plan.

    THE BAR IS WORK, NOT TRUTH. A correction re-enters the step that wrote the
    document; for a stale sentence that step can only rewrite its own prose, a
    round spent on nothing. }}
## What an earlier document gets wrong

An `artifact` takes an optional `corrections` list: a document already filed is not
good enough to work from, and this is what is wrong with it.

```json
"corrections": [{ "at": "2-build",
                  "text": "§Verification says the check ran; it reports the
                           command it would have run. Nothing was executed." }]
```

`at` is the document's name copied from the plan above — `2-build`, `1.0-review`.

**A correction dies when the work changes to answer it**; a requirement stands for
the rest of the trak, by the question in `requirements` above. These read like
complaints and are requirements:

| what it says | why it stands |
|---|---|
| *the breakdown never covers the offline case* | fixing the breakdown does not settle it — the offline case still has to be built |
| *nothing has decided whether this ships behind a flag* | still true after any document is rewritten; it is a decision nobody has made |
| *the prototype was never looked at, so the layout is a guess* | a constraint on what comes next, not a defect in the prototype |

**Name the work that answers it, or it is not a correction** — the check that never
ran, the case the breakdown left out. A sentence that is stale or mistaken has no
work behind it: it is a requirement that `supersedes` the document where a later
step would act on it, and nothing where none would.

| what it says | what it is |
|---|---|
| *§Verification says the check ran; nothing was executed* | a correction — the work that answers it is running the check |
| *§Findings says the parser is under `src/lex`; it is under `src/parse`* | a requirement superseding the document — nothing is owed, and a later step reading the finding would look in the wrong place |
| *§Summary calls the flag `--json` and it shipped as `--format`* | nothing — no later step acts on the name |

Filing one puts the rest of the plan in question, and the trak carries on rather
than stopping. **Say what is wrong and what would settle it**, in a sentence or
two — not who should fix it or in what order.

**Most steps correct nothing, and leaving the key out is the expected answer.** An
empty list is not a valid value, and a document you disagree with is not one that is
wrong.
