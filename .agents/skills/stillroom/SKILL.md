---
name: stillroom
description: Keep a data experiment in stillroom — a folder the agent writes and a read-only page the person reads — so its aim, stages, attempts, outputs and findings live in one place instead of scattered CSVs, notebooks and pasted stdout. Use when running, iterating on or reporting a data experiment, an evaluation, a backfill, an analysis or any long-running job whose outputs a person needs to look at.
---

# stillroom

stillroom is where a data experiment lives while an agent runs it. You write the experiment
as files under `.experiments/<name>/`, and each take's work as steps in its `pipeline.yaml`.
`stillroom run` runs the steps and owns the plumbing around your code: reading and writing
tables, other takes' outputs, running rows in parallel, API calls and their responses, failed
rows, and re-running only what changed. It keeps every output with how it was made, so your scripts hold only the logic. The person runs `stillroom open <name>`, or `stillroom open` for an
index of every experiment, and reads one page: what the experiment is for, every attempt in every stage, what each found, and
every row of every CSV or JSONL output, through views you prepared.

The page is **read-only for the person**. Every change — a new take, a verdict, the kept
take — goes through you. The code is yours and arbitrary; the page draws only what you
filed, never code written for it.

## Words

Use these words, with these meanings, when you talk to the person and in what you write.

| word | meaning |
|---|---|
| experiment | the folder `.experiments/<name>/`: everything the experiment has |
| aim | what the experiment is for, in `aim.md`. Rarely changed |
| stage | a top-level part you choose: a pipeline step, a question, a page covered. Refer to one by its name, the folder's, such as `judge`, as the page shows it beside the stage's title, and never by its number: the number moves whenever `stages:` is reordered |
| take | one attempt within a stage: a folder with its code, inputs, lenses and runs |
| run kind | which rows a run covered, chosen each time you run a take: `trial`, `labelled` or `full`. A take keeps only its latest run's tables, and its verdict and measure describe that run |
| trial | a run on a small sample of the pipeline's `rows` table, to see that the code works: `stillroom run <take> --trial` |
| labelled | a run on only the rows of the `rows` table that the take's gold set labels, both splits, to see how well the take scores: `stillroom run <take> --labelled` |
| full | a run on every row, and the default. Only once the person says so |
| kept take | the take, with a full latest run, that a later stage reads. You mark it |
| outtake | any take in a stage other than its kept take. Its tables stay and can still be read |
| intent | what a take tries, in one sentence, compared with the take it came from, in its `take.yaml`. A take's only descriptive text besides its verdict. Written when the take is made, before it runs |
| verdict | what a take's latest run showed, in a line, in its `take.yaml`: how it compares with the take it was copied from and with the kept take. Rewritten after each run |
| notes | a take's running notes, in `notes.jsonl`: anything longer than a line, each added with `stillroom note` and dated. Only ever added to |
| pipeline | a take's `pipeline.yaml`: the tables it reads, then the steps that make its exhibits |
| step | one entry in a pipeline: `script` (a table at once), `map` (row by row) or `call` (one request per row). Each writes one table |
| run | one execution of a take's pipeline under `stillroom run`. A take may have several |
| exhibit | a table a step wrote to the take's `exhibits/` |
| input | a file in the take's `inputs/` that the code reads, such as a prompt template with `{{story}}` in it, or hand labels |
| error row | a row a step could not make: the input row as it was, with `_error` saying why and `_from` saying which row |
| `_from` | a row's position in the table its step read, from 1. A position, never a key: join on a key column you carry |
| call log | a JSONL exhibit, one line per model or API call: what was sent, what came back, whether it was cached, the time, how many times it was sent, the token counts where the request file says a response keeps them, and the row's columns the step keeps. A `call` step's table is one, and so is a `script` step's marked `recorded`, for calls stillroom did not send |
| response cache | the experiment's store of call responses, shared by its takes, so a repeated request is not sent again |
| lens | a view over one exhibit you prepare: which rows, in what order, which columns |
| files.yaml | what you say about the files of a take, keyed by each one's path in it: a note on any file, which code reads an input, a sentence on each column of an exhibit, and ranges of lines with a line on each |
| gold set | labels written by hand, in an exhibit, each saying which split it is in: `tune` (used to choose) or `holdout` (never used to choose); with no split, every label is `holdout` |
| card | one block of an overview or of Results: a stat row, a bar chart, scores, a flow, a table, code, findings or text. Every number on it is worked out from an exhibit, never written |
| overview | a take's `overview.yaml`: the cards that sum up what the take found, drawn as its first tab. A stage opens on its kept take's overview |
| results | the experiment's `results.yaml`: the answer, the final list, the scores and the method, as cards on the Board, then each stage's findings and unknowns |
| findings | what a stage learned, a line each, in its `stage.yaml`, rewritten like a verdict whenever its kept take changes; also a card kind for a take's own |
| unknowns | what a stage has not settled, a line each, in its `stage.yaml` beside its findings, drawn under them on Results |
| as-of | what a piece of your text was written against, `static/take-2 run 2`, copied from `stillroom check`. Text a later run or a change of kept take overtook is marked outdated on the page until you confirm or rewrite it |

## The folder

```
.experiments/
  .gitignore              # `*`, written by stillroom once: nothing here is committed unless you except it
  <experiment>/
    experiment.yaml       # title, asked, stages
    aim.md                # what the experiment is for
    results.yaml          # the experiment's answer, as cards
    glossary.yaml         # the experiment's words
    <stage>/
      stage.yaml          # title, purpose, kept | none-kept-because, findings, unknowns
      <take>/
        take.yaml         # created, from, intent, verdict, measure
        pipeline.yaml     # inputs, then steps
        notes.jsonl       # running notes, appended by stillroom note
        files.yaml        # what each file is for, its readers, columns and ranges
        lenses.yaml       # views over this take's exhibits
        request.yaml      # a call step's request; any name, named by the step
        gold.yaml         # the gold set this take files, and its tables' joins to one
        overview.yaml     # the take's overview, as cards
        inputs/           # what the code reads: one input per file
        …                 # your code, any layout
        exhibits/         # one <table>.jsonl for each step, written by `run`
        runs/<n>/         # written by `run`: run.json, stdout.log, stderr.log
```

Names of experiments, stages and takes are one path segment: letters, digits, `.`, `_`, `-`.

You write `experiment.yaml`, `aim.md`, `results.yaml`, `glossary.yaml`, each `stage.yaml`, and
each take's `pipeline.yaml`, `files.yaml`, `lenses.yaml`, `gold.yaml` and `overview.yaml` by hand. `stillroom take` writes `take.yaml`; `stillroom note` appends to `notes.jsonl`; `stillroom run` writes
`runs/`. Every YAML file is strict: a key not listed here is refused by name.

```yaml
# experiment.yaml
title: Reader interest by story
asked: "which stories do readers want next? stories, not headlines"   # the person's words, verbatim
stages: [cluster, label, score]     # in reading order; a folder not listed is not drawn
```

```yaml
# <stage>/stage.yaml
title: Cluster headlines into stories
purpose: one story per event, so counts are per story     # optional, one line
kept: take-3                         # the kept take, once there is one
# none-kept-because: each take answered its own question   # instead of kept, when none will be
findings:                            # what the stage learned, gathered on Results
  items:
    - "Headlines a day apart about one event merge only above 0.82."
  as-of: cluster/take-3 run 2        # copied from check: see Outdated text
unknowns:                            # what it has not settled, drawn under its findings
  items:
    - "Whether wire copy repeated a day later is one story or two."
  as-of: cluster/take-3 run 2
```

```yaml
# <stage>/<take>/take.yaml — `take` writes it; you fill in the rest
created: 2026-10-01T09:12:00.000Z
from: cluster/take-2                           # the take `take` copied it from
intent: raise the threshold from 0.78 to 0.82, to stop unrelated headlines merging    # when you make it
verdict: 412 stories, down from 455; the merges take-2 showed are gone, at the cost of 3 split stories   # after each run
measure: {label: stories, kind: yield, value: 412}   # the one number to compare across the stage
```

`from` is what the page marks each file's change against; leave it as `take` wrote it. What a
take reads comes from its pipeline, the takes its inputs name, and what it ran on from its
latest run: its kind, and how many rows the cut kept. Writing `reads`, `scope` or `scope-note`
by hand in a take with a pipeline is refused. A take from before pipelines keeps its own.

A measure's `kind` says what its number is, and the page draws each kind its own way:

| kind | what it is | as in |
|---|---|---|
| `yield` | how many came out, a whole number; neither way is better | `{label: stories, kind: yield, value: 412}` |
| `pass` | how many got through of a whole, `value` of `of` | `{label: flagged, kind: pass, value: 6, of: 128}` |
| `labels` | what a labelled take found of a whole, `value` of `of` | `{label: positives, kind: labels, value: 14, of: 78}` |
| `score` | from 0 to 1, higher better, such as an F1 | `{label: hold-out F1, kind: score, value: 0.86}` |
| `time` | milliseconds, more than 0, lower better; each take reads as so many times faster or slower than the kept take | `{label: cold count, kind: time, value: 1.6}` |

A cost is a measure only when the question is about that cost. When a stage asks which take
is fastest, its measure is a `time`; otherwise tokens, money and time are what a run spent,
not what a take measures, and the call log already shows them. Give every take in a stage the same measure
label and kind: the Bench names the measure once, on the stage's tab, from the kept take,
and shows the stage's takes as cards side by side under it, each marked against the kept
take, and `stillroom check` warns when they differ. A take's intent and verdict
are shown when the person points at its card, which is how they compare the takes of a
stage: say in the verdict what a reader of the cards needs, and put the rest in a note.
`label` and `changed` are retired from `take.yaml`, and so is a measure's `type`; `check`
refuses them. Fold what they said into `intent`.

```yaml
# glossary.yaml
- term: story
  aliases: [stories]                 # every other form a reader would see
  definition: a group of headlines about one event
  not: headline                      # what it is easily confused with
```

## Pipelines

A take's work is a list of steps in `pipeline.yaml`. Each step reads tables by name and
writes one table, `exhibits/<writes>.jsonl`. Every intermediate table is kept, so the person
can follow a row from the first step to the last.

```yaml
# <stage>/<take>/pipeline.yaml
inputs:
  pairs: candidates/take-2/candidates.jsonl   # <stage>/<take>/<exhibit>: one exact take's exhibit
  labels: inputs/labels.csv                   # or a file in this take's inputs/
rows: pairs                                    # the one table a trial or labelled run cuts
trial:                                         # optional: how a trial cuts it
  size: 40                                     # rows, or a percentage such as 5%; 10% and at most 25 by default
  by: [source, kind]                           # columns to spread the sample across; at random otherwise
  seed: 7                                      # optional; a fixed default otherwise
steps:
  - script: node $STILLROOM_TAKE/gold.mjs      # a table step: one process
    reads: [pairs, labels]
    writes: gold
  - map: python $STILLROOM_TAKE/judge.py       # a row step: long-lived workers
    reads: gold
    writes: judgments
    parallel: 4                                # workers at once; 4 by default
    cache: never                               # only for a step that reads something undeclared
```

- **An input names one exact take**, never "the stage's kept take", so a run always
  reads what it says it read. The page marks the read when that take is no longer its
  stage's kept take or its contents changed after your latest run read them. `check`
  warns about the second always, and about the first only in a kept take, because a
  take that is not one, such as a comparison, may read an older take on purpose. Nothing
  re-runs on its own: copy the take forward and point it at the new one.
- **Every table has its own name, and a cut keeps it.** `rows` names an input or a table a
  step writes, and a trial or labelled run cuts it as it is read or written, before any step
  reads it, so the steps after it are the same in every kind. Name one table only: the one
  whose rows are the units the take judges, never a lookup table read beside it. Cut as late
  as the pipeline allows, since every step after the cut runs again when the kind changes. A
  cut input is written to `exhibits/` under its own name, so the rows a run kept are there to
  read. A subset meant to last, rather than chosen per run, is a `script` step.
- **A trial picks the same rows every run.** With `by`, it takes one row from each
  combination of those columns' values in turn, so a small sample holds every kind of row
  before it holds two of one. Name the columns whose kinds the code treats differently.
- **A labelled run keeps the rows whose key is in the gold set** that the take's
  `gold.yaml` joins name, both splits. The `rows` table needs the gold set's key column, or
  the run fails naming it.
- **Carry a key column through every step**, and join tables on it: a script step's own
  join, a gold set's, a call log's. `_from` is a row's position in the table its step read,
  which a cut or a filter before it changes.
- **Every table stillroom writes is JSONL.** CSV is read only as an input, such as hand
  labels from a spreadsheet, and every cell arrives as a string: convert it in your code.
- **A command runs through `sh -c` from the repository root**, with `STILLROOM_TAKE` set to
  the take's folder and `PYTHONUNBUFFERED=1`. Data goes on stdout and logs on stderr.
  stillroom keeps every step's stderr in `runs/<n>/stderr.log`, each line prefixed by the
  step's table name. A line on stdout that is not what the step owes fails the step with the
  line quoted, so send every log line to stderr, and keep a runner's boot warnings off stdout.
- **A `script` step** receives `{"inputs": {"<name>": {"path", "rows", "errors"}}}` as JSON on
  stdin and prints its table as JSONL on stdout, one object per line. A step with no `reads`
  is a source: it gets `{"inputs": {}}`. `rows` never holds an error row; those arrive in
  `errors`, and stillroom appends them to the step's table for you, so a join or a count
  cannot miscount by forgetting them.
- **A `map` step** starts `parallel` workers. A worker reads one JSON row per line on stdin
  and answers each with exactly one line on stdout, flushed: an array of rows (`[]` drops the
  row, several expand it), or `{"_error": "why"}`. It gets the next row only once it has
  answered, so keep it simple: read a line, answer it, repeat until stdin ends. stillroom
  writes the table in input order whichever worker finished first, and tags each row with
  `_from`, the input row's number. A worker that exits without answering a row has crashed,
  whatever its exit code, and a new worker starts. When the one that crashed had answered
  rows before, the row goes to the new worker again, because that worker may have ended
  before reading it. A row that crashes a fresh worker becomes an error row. Three
  fresh-worker crashes in a row with no answer between them fail the step, so two bad rows
  in a row are two error rows, and a command that never answers fails. Error rows from
  earlier steps are never sent to a worker: they pass through.
- **A step is reused when nothing it depends on changed**: all of the take's code (every file
  but stillroom's own, `inputs/` included), the step's own entry in the pipeline, and the
  contents of the tables it reads. Change any file of code and every step runs again; change
  one step's entry and only it and what reads it do. A step that reads anything its inputs do
  not say — a database, an API, the clock, a file outside the take — is marked
  `cache: never`, or its first result is reused for ever. When such a step's output comes out
  the same, the steps after it are still reused.
- **A `call` step** sends one request per row, `parallel` at a time (4 by default), from a
  request file in the take, and needs no script. Its table is the call log, described below.
- **`exhibits/` always matches the pipeline and the latest run.** A run deletes every exhibit
  no step writes, and a take keeps only its latest run's tables, whatever its kind.
  When a step fails, nothing after it runs, and its exhibit and theirs are removed.
  `stillroom run` says how each step went — run, reused and from which run, or failed and
  why — and `runs/<n>/run.json` keeps it, with the run's kind, each input's hash and each
  table's row and error counts.

## Calls

A `call` step sends an HTTP request for each row it reads. Write no network code: a step
before it prepares one row per call, and a step after it parses the responses.

```yaml
# pipeline.yaml
  - call: request.yaml                         # a file in the take
    reads: prepared
    writes: calls
    keep: [pair]                               # the row's columns copied into the call log
    parallel: 8                                # calls in flight; 4 by default
    repeat: 3                                  # optional: sends each row 3 times, never from the cache
```

```yaml
# <take>/request.yaml
url: https://api.example.com/v1/judge/{{id}}    # a placeholder in the path or query is URL-encoded
method: POST                                    # POST with a body, GET without, by default
headers:
  Authorization: Bearer {{env.JUDGE_KEY}}       # a secret comes only from the environment
cache: 7d                                       # how long a response is kept: 30m, 12h, 1d (the default), or none
retry: 2                                        # sends again after a 429, a 5xx or a network failure; 2 by default
tokens:                                         # where a response keeps its token counts, as dotted paths
  in: usage.input_tokens
  out: usage.output_tokens
body:                                           # a YAML tree, sent as JSON
  code: '{{a_code}}'                            # a whole value: the row's value as it is, quotes and all
  pair: '{{pair.id}}'                           # a dotted path reaches into a nested value
  questions: '{{questions}}'                    # an array or an object stays one
  note: 'pair {{pair.id}} of {{total}}'         # inside a longer string: the value's text
```

- **Build the body as a tree, never as text.** A placeholder that is a whole value is
  replaced by the row's value, so source code full of quotes cannot break the request. A row
  without a value a placeholder names becomes an error row.
- **Its table is the call log**: one row per call, with `_from`, the columns the step keeps,
  the `url` and `body` sent, the `status`, the `response` (parsed when it is JSON), `cached`,
  `ms`, and `attempts`, how many times it was sent: 0 when the cache answered it. `ms` is how
  long the API took, from the cache too, so read latency off every line; a response cached
  before the cache kept times has `ms` empty. The Log's time block describes only the sends
  of this run, so a step the cache answered whole shows no time there: put latency on a
  `summary` stat. With
  `tokens` in the request file, it also has `tokens_in` and `tokens_out`, read from each
  response at those paths; name them whenever the API reports its tokens, because the page
  draws them. Headers are never written. A call that still fails after its retries, or that
  the server refuses with a 4xx, becomes an error row; when the server answered, the row
  keeps its `status` and `response`, so a lens can pick out the 403s.
- **A url a row holds goes in whole**: a placeholder the url opens with, `url: '{{url}}'` or
  `url: '{{base}}/v1/judge'`, and one in the scheme and host are written as they are. Every
  placeholder after them is encoded, so a slash in an id stays inside its segment.
- **Keep the row's key in the call log** with `keep: [id]`, and join the log back to the rows
  it was sent from on it. A kept column a row lacks is written empty, and one the log
  already has, such as `status`, is refused.
- **`repeat` sends each row that many times**, to sample how long a call takes or how its
  answer varies: one line per send, with `_repeat` from 1 after `_from`, and none from the
  cache or into it. The log then has a line per send for every key, so a scores card or
  accuracy stat over it needs a lens that keeps one send, `where: [{col: _repeat, op: eq,
  value: 1}]`; `check` names it when one is missing. Time stats read every send. A take that
  only replays cached responses cannot use it.
- **Responses are cached for the experiment**, keyed on the method, the url, the body and the
  headers, so a request already answered is not sent again, by any take in it: a labelled run
  pays only for the rows the trial did not send, and a full run only for the rest. A failure is never
  cached. The cache is the hidden `.experiments/<experiment>/.responses/`; set `cache: none`
  for a call whose answer must be fresh every time.
- **Put every secret in the environment and name it as `{{env.NAME}}`.** stillroom refuses
  to run the step when one is not set, and writes `{{env.NAME}}` in its place everywhere it
  would appear: the call log, a response that echoes it, an error, a log line and the cache.
  Never write a key into the request file or into a row.
- **A call step is reused like any other step**: when the take's code, its entry and its
  input are unchanged, no request is sent at all. Editing `request.yaml` is a change to the
  take's code, and the response cache decides which requests are sent again.

### Calls stillroom cannot send

Some calls cannot be a `call` step: your own MCP reads, which go through connectors only
your session can reach, and calls another program makes, such as an app's API client. Log
them as a call log anyway, and mark the step that writes it `recorded`, so the page draws
them beside the calls stillroom sent and says it did not send them.

```yaml
# pipeline.yaml
inputs:
  reads: inputs/mcp-calls.jsonl                # written as you made the reads
steps:
  - script: node $STILLROOM_TAKE/pass.mjs      # prints each line of reads as it is
    reads: reads
    writes: mcp_calls
    recorded: true
```

```json
{"url": "mcp://sentry/search_events", "body": {"query": "transaction:/admin"}, "status": "ok", "response": {"data": []}, "ms": 812}
```

- **Every line says what was called and what came back**: `url`, with an MCP read written
  `mcp://<server>/<tool>` and its arguments in `body`, and `response`, or `_error` saying why
  there is none. Any other call-log column it has holds what a call step writes there:
  `status` a number or text such as `ok`, `ms` milliseconds or `null`, `cached` true or
  false, `_from` and `_repeat` whole numbers from 1. Add columns of your own as a step keeps
  them, such as the key the call was for. When a read's returned rows are a table of their
  own, carry one key column in both, so each row joins the line that fetched it.
- **Write each MCP read to the file under `inputs/` as you make it**, with the time it took
  when you know it; `null` when you do not, which the page counts as empty. A step that
  calls an app which logs its own calls reads that log instead, and is `cache: never`.
- **A line that is not a call fails the step**, naming the line, and `check` names any such
  line in the exhibit. The page draws the step's calls, status and time, marks it
  `recorded`, and says nothing was sent or retried here.
- **Describe a recorded log's columns yourself** in `files.yaml`: stillroom describes only
  the columns of a log it wrote.

## Lenses

A lens is declarative: which rows (`where`, every condition must hold), in what order
(`sort`), and which columns (`columns`; all when absent). It is applied on the server over
every row of the file, so its count is exact however large the file is. Prepare a lens for
each question the person asks of an exhibit, and quote their words in `question`.

```yaml
# <take>/lenses.yaml, keyed by exhibit name
stories.jsonl:
  - id: unread
    name: Never read
    description: stories no reader opened in the week
    question: "show me a given week, what we flagged"
    where:
      - {col: readers, op: eq, value: 0}
      - {col: week, op: eq, value: "2026-09-21"}
    sort: {col: headlines, dir: desc}
    columns: [story, headlines, readers]
```

Operators: `eq neq gt gte lt lte contains empty nonempty`. `gt`–`lte` compare as numbers;
`contains` ignores case; `empty` and `nonempty` take no value. `stillroom check` warns
about a lens naming a column its file does not have.

Exhibits a lens names come first on the page, in `lenses.yaml`'s order, then the rest by
name: key the exhibit that holds the answer first.

## Inputs

Every file in a take's `inputs/` is an input: the prompt template, the questions sent with
each call, the hand labels. CSV and JSONL are drawn as tables and other text as it is
written. A table the pipeline reads is named in its `inputs`; anything else, such as a prompt
template, your code reads from `$STILLROOM_TAKE/inputs/`. Nothing is copied into the notes:
the page shows the inputs beside the code. Say what each one is in `files.yaml`.

## Describing the files

`files.yaml` says what each file of the take is, so the person can read the take's code and
inputs without guessing at them. Key it by each file's path in the take; every key is
optional, and so is every file:

```yaml
# <take>/files.yaml
pipeline.yaml:
  note: Prepares one state per pair, asks the judge, and parses its verdict.
inputs/questions.json:
  note: The three questions, sent with every call as `questions`.   # markdown
  read-by: [prepare.mjs]               # the code that reads it, by its path in the take
prepare.mjs:
  note: Builds each pair's state from its two symbols.
  ranges:
    - lines: 13-14                     # or one line: 13
      says: The nearest match is sent only above 0.3 similarity.   # optional
      hash: "3f2a9c01"                 # what check printed for these lines, in quotes
    - lines: 36-45
      hash: "b7e0d412"
      pseudo: |                        # optional: these lines in the pseudo notation
        each pair in pairs, parallel
          state = {the pair's state, from its two symbols}
          when: no match
            skip
exhibits/judgments.jsonl:
  note: One verdict per pair.
  columns:                             # one sentence on each column you want explained
    verdict: extract, use-kit or keep, whichever is likeliest.
    thin_wrapper: How likely the symbol is only a call into a kit import.
```

- **A `note`** on any file says what it is for, in markdown. Say what the code does, never
  paste it, and put no outline or pseudo-code in it: the page shows the code itself, and a
  range's `pseudo` is where pseudo-code about a file goes.
- **`read-by`** names the files of code that read an input. The page puts each input just
  before the first file that reads it, so give every input you do not name in the
  pipeline's `inputs` a `read-by`. An input the pipeline names is read by the steps that read
  it already.
- **`columns`** gives a sentence on each column of an exhibit you wrote, shown when the person
  hovers on it. A call log's own columns, from `_from` to `tokens_out`, stillroom describes
  itself: describe only the columns the step keeps.
- **`ranges`** point at the lines of a file of code or an input that do the work. The lines
  are read from the file whenever the page is drawn, so never paste them. Ranges go in order
  and do not overlap. Each carries the `hash` of the lines it was written against: write a
  range without one, run `check`, and copy the hash it prints. `check` warns when the lines
  no longer match, because an edit above a range moves other code under it; point the range
  at the lines it means, then write the new hash.
- **`pseudo`** on a range is its lines in the pseudo notation, which the `pseudo` skill
  describes; `stillroom init` installs it beside this one, so read it before writing any.
  Method then reads the file by its pseudo, one group for each range that has some, in file
  order, with the range's real lines beside its group, and a switch to the source. Write it
  without a fence, indented two spaces a level. It is held by the range's hash, so when
  `check` says the lines changed, rewrite the pseudo with the range. Give pseudo to the
  ranges of a file whose shape a reader wants before its lines, such as a script that
  loops, retries or branches, not to a file whose lines already read plainly, and never to
  an input.
- `check` also warns when a file `files.yaml` describes changed after `files.yaml` did: when
  you change a file, say what it does now. `take` keeps file times when it copies, so a fresh
  take is not stale.
- **`notes.md` is retired**, and `check` refuses a take that still holds one: add its
  contents with `stillroom note`, then delete it.
- **`how.md` and `inputs.yaml` are retired**, and `check` refuses a take that still holds
  either one. Move each snippet's file and ranges into `files.yaml` under the file, the prose
  about a file into its `note`, and each `inputs.yaml` line into the `note` of
  `inputs/<file>`. Drop the outline, rewrite any pseudocode that stands for a range as that
  range's `pseudo`, and delete both files.

## Gold sets

A gold set is a table of labels you wrote by hand, keyed by the same column as the
tables it is compared with. Keep the labels in `inputs/` and have a step write them as its
table: a run deletes any exhibit no step writes. It has the fixed column `label`, the one answer
a key is filed under, and optionally `also`, further answers that are as right; `split`
(`tune` or `holdout`); and `reason`. Leave out `split` when nothing was tuned on the labels:
every label then counts as `holdout`. In JSONL `also` is a list or one value; in CSV a cell
holds one value. The take that files one says so in its `gold.yaml`; a
take whose tables are compared with it names the gold take, and the column holding its own
answer, per exhibit:

```yaml
# gold/take-2/gold.yaml — this take files the gold set
files: gold.jsonl                  # the exhibit
key: pair                          # its key column
positive: [extract, use-kit]       # the labels a score counts as positive; `true` always is
```

```json
{"pair": "csv.ts#parseCsv", "split": "tune", "label": "extract", "reason": "only csv.ts uses it"}
{"pair": "csv.ts#readHead", "split": "holdout", "label": "extract", "also": ["use-kit"], "reason": "the kit has one; either is right"}
```

```yaml
# judge/take-3/gold.yaml — this take's tables join to it, on the column named `pair`
joins:
  judgments.jsonl: {gold: gold/take-2, answer: flag} # flag is compared with label
  calls.jsonl: {gold: gold/take-2}                   # marked by split, nothing compared
```

On a joined table the page stripes every labelled row by split, filters by Tuning,
Hold-out and Unlabelled, and, with an `answer`, by Disagrees, where the answer, as text, is
neither the label nor an `also` value. An answer the gold set accepts is right everywhere:
the gold column, Disagrees, a lens comparing with it, and every score. The gold column shows
only `label`, so where a reader needs to see what else is right, carry `also` into a column of
the joined table. Name the gold take, never "the kept take": a join stays on the labels
it was compared with. A labelled run covers both splits: choose with the tuning split, and
report the hold-out separately in the verdict.

`check` warns about gold keys no row of a joined table has, and about a label the answer
column never takes on any key filed under it, such as `yes` against an answer of `true`: either means the join
compares less than it seems to. A take whose latest run is a trial is left out, since its
sample holds only some of the rows; a labelled run is not, since it holds every labelled row.
A table that holds fewer rows than the gold set on purpose keeps the warning;
say why in a note.

A card scores an answer against a gold set (see Overviews and Results). An answer or a label
is positive when it is one of the gold set's `positive` labels, or `true`. Name `positive` once,
in the gold take's `gold.yaml`, so every card scores the set the same way. When an answer the
gold set accepts has the other polarity from `label`, the answer's polarity counts as the
truth, so a right answer is never a miss. A gold set with no positive label is a choice among
several, and is scored as accuracy and recall per label rather than precision, recall and F1.

## Overviews and Results

An overview sums up one take: what someone would put at the end of a notebook, as cards. Results
sums up the experiment. Both are an ordered list of cards; the page lays them out as masonry,
each card at its natural height, in 2, 3 or 4 columns by the window's width. What to say comes
first below, then how to say it in cards.

### What to say

Every overview and Results says four things, in this order:

1. **What it is for and where it stands.** The question it answers, and how far it has got.
2. **How it works.** The method at the level of its decisions: what each step does to the rows,
   where they part ways, and the lines that decide.
3. **The key results, at a glance.** The numbers and charts a reader looks for first, before
   any prose.
4. **The exhibits worth reading.** The rows and lines a reader should look at to ground the
   results in, each picked out by a lens rather than left in the whole table.

Each level says them for its own question, once. A reader starts at Results and goes down only
for the detail, so nothing below repeats what is above it, and a take says more about how it
works than Results does: a reader who opens one take follows it from its overview alone.

| part | take, in `overview.yaml` | experiment, in `results.yaml` |
|---|---|---|
| for and where it stands | what this attempt tries, against the take it came from, beyond its one-sentence intent; and its state: labelled or full run, kept or not, what it leaves for the next take | the answer to `asked`, in the person's words, and how far to trust it: which stages have a kept take and which are still open |
| how it works | in full: its decisions as pseudo, a flow with one row followed through, and the code that decides | the method in one wide flow over the kept takes |
| key results | a stat row of its own exhibits, findings on what it showed that its verdict has no room for, and the charts behind them | the stats a reader looks for first, and a scores card on the hold-out split |
| exhibits | the tables and lines that show its findings, each through the lens that picks out the rows to read | the final list: a table card on the exhibit and lens a stage produced |

Between the two, a stage's `findings` and `unknowns` in `stage.yaml` say what the stage
established that the next stage, or the answer, rests on, and what it left open.

- **A take's opening card says what its intent and verdict do not.** The page shows both beside
  the take, so the card says why the take was worth running and what state it is in, never the
  intent again. Where it stands goes stale like any text, so it carries `as-of` and is marked
  when a run overtakes it.
- **Results leaves out what a stage's findings say**: it draws them after its cards.
- **A stage's findings** are a few claims, each one a sentence a later stage acts on, written
  like a verdict: what holds and under what condition, such as "headlines a day apart merge
  only above 0.82". Never a history of the takes tried; that is what the takes are. Rewrite
  them whenever the kept take changes.
- **A stage's unknowns** are what it could not settle and a reader should not assume, a line
  each, such as a number measured on a laptop rather than in production. Put them on the stage
  that raised them, not in a Results text card, and take each out once a take settles it.
- **Put counts and scores in cards, not in prose.** A figure written into text goes stale the
  run after; a card works it out again. A value you chose, such as a threshold, is not a
  result and may stay in the text.
- **Overviews are for the takes worth reading.** A take with no `overview.yaml` has no Overview
  tab and opens on Exhibits. `take` copies `overview.yaml` forward, so a new take starts with
  its cards; write the text again for the new take.

### How to say it

```yaml
# <stage>/<take>/overview.yaml — results.yaml beside aim.md has the same shape
cards:
  - kind: text                       # markdown: what it is for and where it stands
    wide: true                       # runs across every column; every other card is narrow
    title: What this take is for
    text: Whether a name check alone finds the duplicates, so the model sees fewer rows …
    as-of: static/take-2 run 2       # copied from check
  - kind: stats
    wide: true
    stats:
      - {label: symbols, count: {of: symbols.jsonl}}                  # rows of an exhibit
      - {label: flagged, count: {of: flags.jsonl, lens: flagged}}     # rows a lens lets through
      - {label: hold-out F1, score: {of: judgments.jsonl, split: holdout, metric: f1}}
      - {label: accuracy, score: {of: judgments.jsonl, split: holdout, metric: accuracy}}
      - {label: latency, summary: {of: calls.jsonl, column: ms, as: median, lens: sent}}   # a column summed up
      - {label: kept measure, measure: judge/kept}                    # a take's measure
  - kind: findings
    title: Findings
    items: ["Similarity finds the real duplicates; the portable signal is mostly noise."]
    as-of: static/take-2 run 2
  - kind: bar
    title: Flagged by package
    of: flags.jsonl
    lens: flagged                    # optional
    by: package                      # rows counted by this column's value, over every row
    # column: total_ms               # or, with as, this column summed up for each value of by
    # as: sum
  - kind: scores                     # precision, recall and F1, or accuracy and recall per label
    title: Against gold · hold-out
    split: holdout                   # one split; every split when absent
    of:
      - {exhibit: compare/kept/scored.jsonl, answer: flagged, lens: one-combo, label: static flag}
      - {exhibit: judge/kept/judgments.jsonl, label: Jev}   # the join's answer column
  - kind: table                      # the Exhibits grid, with a link to the exhibit
    of: compare/kept/shortlist.jsonl
    lens: record-chain
    columns: [symbol, verdict]       # optional: these, in place of the lens's; the key stays first
  - kind: code                       # a file's lines, held by a hash as a range in files.yaml is
    file: agree.mjs
    lines: 20-31
    hash: "3f2a9c01"
  # or a row's cell: {kind: code, of: symbols.jsonl, key: "src/csv.ts#parseCsv", column: source, lang: ts}
  - kind: flow                       # the method: its steps in order, or with hops a map
    wide: true
    steps:                           # the first is where the flow starts
      - name: extract
        title: Every exported symbol
        line: one row per exported top-level symbol
        count: {of: static/kept/symbols.jsonl}
        example: {of: static/kept/symbols.jsonl, key: "src/csv.ts#parseCsv", columns: [id, kind]}
      - name: check
        title: Cheap check on name and similarity
        facts: {similar at: 0.5, signals: "name, imports"}   # chosen values, never a result
      - {name: judge, title: Ask the model, facts: {model: jev-small}}
      - {name: shortlist, title: The shortlist, count: {of: judge/kept/shortlist.jsonl}}
      - {name: drop, title: Left in its tool}
    hops:                            # optional: forks and joins, never a loop
      - {from: extract, to: check}
      - {from: check, to: judge, label: flagged, count: {of: static/kept/flags.jsonl, lens: flagged}}
      - {from: check, to: drop, label: no signal}
      - {from: judge, to: shortlist, label: keeps, facts: {cut: "kit_score ≥ 0.18"}}
      - {from: judge, to: drop, label: below the cut}
    paths:                           # optional, with hops: named routes a reader can light
      - {name: model route, steps: [extract, check, judge, shortlist]}
```

Choose each card for the part it says and the question it answers:

| kind | part | suits | as |
|---|---|---|---|
| `text` | for and where it stands; how it works | markdown: what it is for and where it stands, the answer, an argument a list would break up, or a ` ```pseudo ` fence for how a take works | wide when it opens the page or is long, narrow otherwise |
| `stats` | key results | the numbers a reader looks for first: rows in, rows a lens lets through, a column summed up, one score (`accuracy`, `precision`, `recall` or `f1`), a measure | wide |
| `findings` | key results | what was learned, a claim a line | narrow |
| `bar` | key results | how rows divide by one column with few values, or how a number such as time does; the twelve largest are drawn and the rest folded into one line | narrow |
| `scores` | key results | one or more answers against one gold set, side by side: precision, recall and F1, or with no positive label accuracy and recall per label | narrow |
| `flow` | how it works | the method: each step's count over every row and one example row, so a reader can follow a row through; with `hops`, the decisions inside a take, where rows fork and join | wide |
| `code` | how it works; exhibits | the lines that decide, such as a threshold rule, or a row's cell, such as a prompt or a query plan | narrow |
| `table` | exhibits | the rows themselves: the final list, or what a lens picks out | narrow, or wide for more than one column beside the key and gold; give it a lens, and `columns` when a wide column crowds out the rest |

- **Every number is worked out, never written.** No field takes a number: a count, a summary, a
  bar, a score and a measure are read from the exhibits whenever the page is drawn, so a card never
  goes on saying a figure the take no longer has. Prose is for what was learned.
- **A name is a take's exhibit or file.** In `overview.yaml` a bare name, `flags.jsonl`, is the
  take's own; anything else is `<stage>/<take>/<exhibit>`. `results.yaml` takes only that form.
- **`<stage>/kept` follows the stage's kept take**, whichever it is when the page is drawn, and
  is allowed only on a card: a pipeline input names one exact take, so a run says what it
  read. A Results card naming a stage with no kept take is drawn empty and says so. `kept` is
  never a take's name.
- **The final list is an exhibit a stage produces.** Results points at it with a table card;
  a card never selects rows a step did not write, so the answer always has a run behind it.
  Put the lens that is the list's view on the exhibit, in `lenses.yaml`.
- **A scores card scores an exhibit with a gold join** (its take's `gold.yaml` `joins`), on the
  join's answer column or the card's `answer`. A labelled key with no row counts as wrong and as
  a negative prediction, and the card says how many had none. `accuracy` is the keys whose
  answer the gold set accepts, over every labelled key in the split, and works on any gold set;
  `precision`, `recall` and `f1` need a positive label. A key with two rows is refused: narrow the
  rows to one per key with a lens.
- **A `summary` sums up one numeric column** over the rows a lens or none lets through, `as`
  one of `median`, `mean`, `min`, `max`, `sum`, `p90`, `p95` or `p99`. A row with no value is
  left out, and a value that is not a number fails the card. The median and percentiles are
  nearest-rank, as the Log's are. A stat or bar over a column named `ms` or ending `_ms` draws
  it as a time; the grid and a flow's example show the raw number. A bar
  card takes the same `column` and `as` to sum up a column for each value of `by` instead of
  counting rows. There is no stat for the ratio of two others: put the two side by side.
- **A table card's `columns`** are shown in their order in place of its lens's, through the
  same rows. The exhibit's first column is put first when you leave it out, because the grid
  pins it and a row is opened by it. `columns` makes no room: a narrow card fits the key, a
  joined table's gold column and about one more, and cuts off the rest, so make a card that
  shows more `wide`.
- **A flow's `example`** is one row, matched on the exhibit's first column or on `match`, shown
  with the `columns` you name; a code card's cell is matched the same way.
- **A flow is drawn as a map** running left to right, a fork's branches stacked down, and a
  flow longer than its card goes on in another row below. Without `hops` its steps are joined
  in the order written. Give a flow hops when
  rows part ways at a decision, such as a cheap check that sends some rows to a model and drops
  the rest, and leave them out when every row passes every step. Count a hop when how the rows
  divided is the point. Write `paths` when a reader would follow one kind of row through, such
  as the rows the model kept; with none, nothing on the map is dimmed. A hop names two steps;
  its `label` says which rows take it, and its `count` how many did, worked out like a step's.
  Every step must be reachable from the first, and `check` refuses a loop. `facts` on a step
  or a hop are the values you chose, such as a threshold or a model, as a short label and
  short text; a count or a score is never a fact. Each of `paths` names a route a reader can
  light, its steps in order, each joined to the next by a hop.
- **How a take works, at the level of its decisions, is a text card holding a ` ```pseudo `
  fence**, in the notation the `pseudo` skill describes, with a sentence of prose around it
  saying why. The page draws it coloured and marked as pseudo. Its lines point at no code: to
  tie pseudo to the lines it stands for, give the file's ranges `pseudo` instead. Pseudo goes
  in these two places only; a note, a finding or a verdict says what the code does in words.
- **A card a kind does not cover is a code card or text**: an SQL plan is code. Card kinds
  are fixed; `check` refuses any other.
- **Order the cards by the four parts, so masonry leaves no gap.** Cards between two wide cards
  share the columns, so fewer of them than columns leave a column empty: put wide cards first
  or last, and keep four or more narrow cards together. `check` names any band that leaves a
  column empty and the widths it shows at. On a take, open with a wide text card on what it is
  for and where it stands and the wide stat row, then the narrow findings, charts, pseudo, code
  and tables together, and end with a wide flow. Results draws each stage's findings, with its
  unknowns under them, after its own cards, so end it with a wide card or with narrow cards
  they can join.

### Outdated text

Four kinds of text go stale: a findings or text card, in either file, and a stage's
`findings` and `unknowns`. Each carries `as-of`, the take and run it was written against (on Results, a list
with one for each stage's kept take), and `check` prints the stamp to paste. Write the text without it, run `check`, and copy the `as-of` it prints,
the way you copy a range's hash.

| text | follows | marked outdated when |
|---|---|---|
| a card in a take's `overview.yaml` | that take's runs | a later run changed an exhibit, or failed |
| a stage's `findings` and `unknowns` | the stage's kept take | the kept take changes, or its runs do as above |
| a card in `results.yaml` | every stage's kept take | any stage's does |

A re-run that left every exhibit as it was marks nothing. The page marks outdated text with a
pill naming what overtook it, and text with no `as-of` as not confirmed; `check` warns about
both. **After each run, and after any change of kept take, run `check` and settle each piece of
text it names**: when it is still true, paste the new stamp; otherwise rewrite it, then paste
the stamp. Either way the mark goes and leaves nothing behind.

## Commands

When `stillroom` is not on PATH, do not install it yourself: ask the person to run
`./scripts/install.sh <a directory on PATH>` from `packages/stillroom` in a tiniestfox
checkout, which puts one `stillroom` command on the machine for every repository.

- `stillroom take <experiment>/<stage>/<take> [--from <take>]` — start a take. It copies the
  stage's newest take (or `--from`, a take in this stage or `<stage>/<take>`): code,
  `pipeline.yaml`, `inputs/`, `files.yaml`, `lenses.yaml`, `gold.yaml` and `overview.yaml`, never its notes,
  exhibits or runs, and records the take it copied as `from`. The first take of a stage starts
  empty: write its `pipeline.yaml`. Write the take's `intent` in its `take.yaml` before you run
  it.
- `stillroom run <experiment>/<stage>/<take> [--trial | --labelled]` — run the take's
  pipeline, as a trial, a labelled run, or with neither, in full. Steps whose code, entry or
  inputs changed run; the rest are reused. It records the commit, timing and every
  step's outcome in `runs/<n>/`, prints the take's link on the page, and exits non-zero
  when a step failed.
- `stillroom note <experiment>/<stage>/<take> "<markdown>"` — add a note to the take, dated
  and placed after its latest run; `-` in place of the text reads it from stdin. Write one
  whenever you learn something about the take that its verdict has no room for. Notes are
  never edited: a correction is a later note.
- `stillroom check <experiment>` — what is wrong with the files. Run it after every change
  you make by hand, and fix every error.
- `stillroom open [<experiment>]` — the person's page, served until stopped; with no name,
  every experiment from one port, each under `/<name>/` beneath an index of them. Tell the
  person to run it; do not run it yourself in the background. Each experiment has a port of
  its own, the same on every `open <experiment>`, so the link `run` prints stays good. When
  another experiment holds that port, `open` takes the next free one: give the person the
  address it printed instead.

A step's command finds the take through `STILLROOM_TAKE`, its absolute path:

```yaml
steps:
  - script: bin/rails runner $STILLROOM_TAKE/export.rb   # the host application's own runner
    writes: stories
    cache: never                                         # it reads the database
  - map: python $STILLROOM_TAKE/score.py
    reads: stories
    writes: scores
```

For code that needs the host application, keep the script in the take and run it through
the application's own runner (`bin/rails runner <script>`), rather than writing a task
elsewhere: the code that matters then stays in the take and is copied forward with it.

## Working with the person

- **Agree the experiment in chat before you write a file.** Propose the aim, the stages with
  a line each, what each stage hands the next, the gold set, and the measure each stage is
  judged by. Then wait: the agreement is a reply, not a silence you read as one. Write the
  experiment only once they have answered, and in the first take of each stage, say in its
  intent or notes what the stage hands on and how it is measured.
- **Run each take in order: trial, then labelled, then stop.** Run a trial, fix the code and
  run it again until it works; then run it labelled, write the verdict, and stop. A take
  with no gold set to join stops after the trial. Tell the person the verdict, give them the
  link `run` printed, and propose the next take's intent. One reply covers both: what they
  think of this take, and whether to run that one. Re-running a take to fix a mistake in it
  needs no stop.
- **Run a take in full only once the person says so.** A full run costs every row; the
  labelled run is what they decide on. When it has run, rewrite the verdict and measure for
  it.
- **When the person asks for several variants at once**, propose each one's intent, run
  them all, and check in once, with every verdict and link.
- **When a take is kept**, rewrite the stage's `findings` and `unknowns` for it, settle every piece of text
  `check` then names, and look at Results: its cards follow the new kept take, and its answer
  may no longer be what the page now shows beside it.
- **Give a take the person will read an overview**, and the experiment a `results.yaml` once
  a stage has a kept take worth summing up: the person reads those first, and the tabs behind
  them for the detail.

## Rules

- **The aim and an intent are written once and never edited**, and notes are only ever
  added to: `stillroom note` appends each one with its time and run, and `check` refuses
  `notes.jsonl` edited by hand. The aim and intent stillroom does not enforce; you do. What you learn later goes in a later take.
  A verdict and a measure describe the take's latest run, so rewrite them after each run, and
  say in the verdict which kind of run it was. What each file is for goes in `files.yaml` and
  the inputs in `inputs/`, never in the notes: the page shows both beside them.
- **Write `intent` when you make a take, and `verdict` after each run**, with a `measure`
  where the stage has a number worth comparing. Intent is one sentence: what this take tries,
  against the take it came from. They are what the page shows for each take; a note is
  where you say it at length. `check` warns about a take
  with no intent, or one that has run with no verdict.
- **A new idea is a new take.** Re-run a take in place to fix a mistake in it (a typo, a
  crash) or to move it onto a changed format, which tries nothing new;
  try something different in a new take, so the board shows what was tried.
- **Try a change in the cheapest place first.** A change that could go in more than one
  stage, such as dropping a kind of row, goes where it costs least to try, often a filter in
  a late stage. Move it upstream only once it wins there, and then start one new take in
  each stage after it, each reading the one before.
- **Make every output the person should see a step's table.** A step writes only to stdout;
  `exhibits/` holds one table per step and nothing else.
- **Mark `cache: never` on every step that reads something its inputs do not name.** A step
  that queries a database, or calls an API from a script, without it reuses its first answer
  on every later run. A `call` step needs it only when its answer can change; then set the
  request file's `cache` too.
- **Mark the kept take** in `stage.yaml` once a take whose latest run is full is the one
  later stages build on, and point the next stage's inputs at it. `check` refuses a kept
  take whose latest run is a trial or labelled, and warns about any take reading one. Nothing orders or re-runs stages
  for you; the record of what was read is the point. When `check` says an input is an
  outtake or has changed, start a new take that reads the current one.
- **Send model and API calls with a `call` step**, never with `fetch` in a script: it
  retries, caches, logs every call and keeps secrets out of what it writes. When a call
  cannot be one, such as an MCP read, file it as a recorded call log (see Calls), with at
  least what was called, what came back and the time. Where cost matters, extract it from the responses in a step, like any other value.
- **Put every input in `inputs/`**, such as a prompt template, so a take's inputs are
  copied forward and visible beside its code.
- **Describe every take you run in `files.yaml`**: a note on each file of code and each
  input, `read-by` on each input, and ranges on the lines that do the work. Update it
  whenever you change a file it describes.
- **Define every word the person might misread** in `glossary.yaml`. Marked terms on the
  page lead to their entries, and each entry lists the takes whose intent, verdict or notes
  use it.
- **Nothing under `.experiments/` is committed unless the person asks for it**, and nothing
  is exported or published. To commit one experiment, add an exception to
  `.experiments/.gitignore`, which stillroom writes only when it is missing, and keep the
  response cache out:

  ```
  !.gitignore
  !<experiment>/
  !<experiment>/**
  <experiment>/.responses/
  ```

  `run` keeps the repository root out of `stderr.log`, so a committed log names no one's
  home directory.
