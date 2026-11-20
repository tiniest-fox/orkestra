---
name: jev
description: Ask typed questions of text and get calibrated probabilities back instead of prose, one item or hundreds. In bulk, classify and score a corpus far larger than you can read — the last fifty pull requests, every trak in the event log, every hunk of a large diff, every entry in a backlog, every test file — then read only the rows that stand out. On a single item, get every probability the model holds about one diff, file or log. Runs a local script against Jev, TypeSafe's System One model. Triggers on "patterns across", "classify these", "triage", "which of these", "too many to read", "find the interesting ones", "score this", "bulk".
---

# Labelling with Jev

**Jev is a sieve, not a reader.** Label a corpus larger than you can read, sort the
table, then read the few rows that stand out in full, yourself. Fifty pull requests with
their bodies and file lists came to half a cent.

It is a **System One** model: it takes some text — the *state* — and a set of typed
questions, and returns one typed answer per question with a calibrated probability. It
generates no text at all, so it cannot summarise, explain, quote or hold a conversation,
and there is no prompt that makes it. You bring the judgement about what the labels mean.

## Run it

**Bulk** — many items, one row each, to sort and count:

```bash
node .agents/skills/jev/jev.mjs questions.json < items.jsonl > labelled.jsonl
```

stdin is one JSON value per line: `{"id": "…", "state": <string or object>}`, where
`state` is all Jev sees. With no `state` key, the rest of the object is the state.

**Single (`--one`)** — one item, and no JSON to build:

```bash
git diff | node .agents/skills/jev/jev.mjs questions.json --one
```

All of stdin becomes the state as-is, so anything that prints goes straight in. It
implies `--raw` and prints indented JSON — at one item there is no table to keep narrow.

Both modes answer with the same keys: each question's name carries its value, and a
choice or a score adds `<question>_confidence`. `questions.json` maps a name you choose
to a question; the names are never sent, and a name that would collide with a column the
script owns is refused before anything is paid for. A failed item carries `"error"`
instead of stopping the run, and the exit code is 1. **Check for those** — quietly
reading 43 of 50 rows as the whole picture is the way this tool lies to you.

Every run prints its item count, token count and cost on stderr. `--limit 3` prices a
bulk run before you pay for it, `--format tsv` makes it eyeballable, and `--raw` adds the
distributions in bulk too. `--help` has the rest.

**The two modes compose.** Label the whole corpus, narrow with `jq` to the handful that
stand out, then go deep on each of those few with `--one`. Questions in one call run in
parallel and never see each other, so nothing chains — the narrowing is yours to do in
between.

The key comes from `TYPESAFE_API_KEY`, or from `.env` in the main checkout — a worktree
has none of its own, and the script walks back to find it. **The state leaves the
machine**, so treat it as you would any other outbound request.

## The three questions you can ask

| Need | `type` | Returns |
|---|---|---|
| one of a set you name | `choice` | the option, plus `confidence` |
| a degree along a rubric you write | `score` | a weighted position across your ordered levels, plus `confidence` |
| whether a statement is true | `noul` | the probability it is true. No confidence — the number is the answer |

```json
{
  "area":     { "type": "choice", "instructions": "Which part of the system does this change?",
                "criteria": { "client": "The React user interface",
                              "workflow": "The state machine and its runtime",
                              "other": "Anything else" } },
  "risk":     { "type": "score",  "instructions": "How likely is this to break something at runtime?",
                "criteria": ["Text or configuration only", "One module, clear boundary",
                             "A shared contract many callers depend on"] },
  "is_rework":{ "type": "noul",   "instructions": "This repairs something a recent change to this same repository broke." }
}
```

## Writing the questions is the whole job

The script is plumbing. Every bad run traces back to one of these.

- **The state must contain the answer.** Jev sees nothing but the state — not the repo,
  not your other questions. Ask whether a pull request touched documentation having sent
  only the first forty file paths, and you get a confident answer about forty paths.
- **One judgement per question, and ask them all in one call.** They run in parallel
  against the same state. Extra speculative questions are close to free — ask them.
- **The question must stand alone.** Its name is not sent. Put the whole judgement in
  `instructions`, and the answers it may give in `criteria`.
- **Score levels describe situations, not grades.** *"Touches process handling or
  persistence"* works; *"high"* does not. Order them, and keep them comparable across items.
- **Leave somewhere for a misfit to go** — a `none` or `other` option — or every item
  that fits nothing is forced into your nearest category.
- **Point at nested state with backticks**: `` `files[0].path` ``, `` `body` ``.
- **Name the output key so a column reads on its own** — `repairs_recent_work`, not
  `recent`. You read these as a table, away from the prose that defined them.

## When it is the right tool

Three things have to be true. The first is the one that catches people out.

1. **You can write the answers down before you see the data** — the options of a choice,
   the levels of a score, the statement of a noul. If you would have to read ten items to
   know what the categories are, read ten items, then come back and write them.
2. **The text you send contains the answer.** Jev fetches nothing and remembers nothing
   between calls.
3. **A number is enough.** It never says why, and there is no follow-up question.

Anything you can get one item per line out of is a corpus: `gh pr list --json`, `git
log`, the trak events under `.orkestra/.database/`, the hunks of a large diff, a backlog
file's entries, every test file. A directory of files is one line:

```bash
for f in notes/*.md; do jq -n --arg id "$f" --rawfile state "$f" '{id:$id,state:$state}'; done > items.jsonl
```

**Reach for something else** when you want to know *why* rather than *what*, or when the
judgement needs two items held side by side — Jev sees each one alone, and the comparing
is yours to do in `jq` afterwards.

**`--one` is not a substitute for reading one item.** If you can read it, read it. Single
mode earns its place when you want a number comparable with other items scored the same
way, or a cheap prior before you spend attention on something long.

## What to make of the answers

Under `--raw` a choice adds `<question>_probabilities` keyed by your option names, and a
score adds `<question>_levels` keyed by your level text, so a distribution reads without
the questions file open beside it.

**Confidence is how concentrated the distribution was, not whether the answer is right.**
A confident wrong answer is ordinary when the state was thin. A `noul` of 0.5 means *as
likely as not*, never *medium intensity*.

- **The extremes are the signal.** The middle is where the model is telling you it could
  not decide. Sort by the number and read both ends yourself.
- **A count of labels is not a measurement.** Check three rows against the source before
  you report a finding, and say which claims you checked and which are still labels.
- **Set any threshold on your own data.** The probabilities are calibrated, but to the
  model's training rather than to your rubric. Look at where your items actually fall
  before choosing where to cut.
- **Two scores compare only if they were asked the same way** — same levels, and state
  prepared the same. Truncating one item's file list and not another's quietly breaks the
  comparison.

## Limits

One state per request, against a token budget the script warns about on stderr when an
item looks long — so a large diff is split into hunks. The live docs are the source of
truth on that budget, the rate limit and the price, and are worth reading before anything
unusual: the index is at https://docs.typesafe.ai/llms.txt, and any page serves markdown
by appending `.md`.
