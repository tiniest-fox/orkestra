---
name: walkdown
description: Author a walkdown — an interactive record of a change, or a snapshot of some code, that walks from its headline down to the lines it is about, with its tradeoffs, open questions, risks, breaking changes and measurements as claims in the tree where they apply. Use when asked to record, explain or document a change, a pull request, a commit or a part of the codebase so that someone can walk through what was built and why, before its pull request or after it merged.
---

# walkdown

A walkdown is one record of one change, the diff from a `base` commit to a `head` commit,
or a snapshot of the code at one commit, checked and built by the `walkdown` command. A record is a folder of markdown files, one claim in each: the folder's
`index.md` is the central claim, drawn as the top page, and every other claim is a
supporting claim under it, drawn as a row that opens its own page. Code is never pasted into
it: the record names hunks and source references by id, and the tool takes the code from
git.

Every field, every figure and an annotated example record folder are in
`references/format.md`, beside this file. `walkdown reference` prints the same fields
from the installed tool, so trust it where the two differ. A proposed shape for each kind
of change is beside it too: `references/fix.md`, `references/feature.md` and
`references/refactor.md`.

## Why a walkdown exists

A walkdown answers a reader's questions about a change, or about a part of the code as it
stands. It has two readers: a
reviewer meeting a feature they do not know, and an implementer checking an agent's work
who may have been hands-off while it was done. One record serves both, and it teaches them
what someone who had been hands-on would know.

- **Progressive disclosure.** A reader goes only as deep as they need. The top page and
  the pages that open from it carry everything important. Each level deeper adds
  specifics, and never teaches something critical that belonged higher up.
- **Figures over prose.** Draw what prose would carry worse, in the
  simplest figure that carries it: everything that needs conveying and nothing extra. A
  `shift` for what the change
  moved, a `before-after` for one text as it was and as it is, side by side, an `excerpt`
  for source text with its provenance, or two versions of it drawn as one diff, with claims
  beside its lines where it needs pointing at, a `cases` figure for named examples that go
  different ways, a `sketch` for the whole change in pseudo-code on the top page, a
  `snippet` for the code doing the work, by hunk id and with claims beside its lines, a
  `compare` for options set against each other aspect by aspect, peers or the change's
  choice among them with the picked one `chosen`, a `table` for anything else with
  attributes, or for measurements read from a CSV with a bar or line chart drawn into it,
  an `image` for a screenshot
  or a drawing, a `gallery` for several screenshots of one change in named groups (widths,
  states), an `atlas` for peers a reader explores one at a time, such as a system's
  components, a `flow` for a value followed through steps, with each step's code, a
  `walkthrough` for a decision the reader answers one question at a time.
- **About three figures that explain the change, and as many that show as it needs.**
  The header on the top page does not count. A record with many flows, walkthroughs,
  sketches and shifts shows off the format rather than explaining the change: the reader
  cannot tell which one matters. Lenses, payloads, spans and the rest stay unused unless
  the explanation needs them. Past three, each of those has to earn its place. A figure
  that shows a claim instead of stating it, an example or a piece of evidence, does not
  count against the three: put one under any claim it makes plainer.
- **A flow that forks has lenses, one way out of each fork per run.** A lens takes one
  way out of every fork it passes; round a loop, a later run may take another. A fan's
  readers are not a fork, so a fan needs no lenses. Repetition is a back hop that a lens
  takes, never a second lens for the second run; where a step does something different
  when the lens comes round to it, say so in that lens's `again`. A flow carries step code
  or payloads, never both. `check` refuses a flow that breaks any of these.
- **Code as an annotated snippet.** Wherever code is a key part of a claim, show it as a
  `snippet` with claims beside the lines that do the work, rather than as a flow's step
  code or in prose. The same holds for an `excerpt` and a case's text. Where a line has
  any decent reason to be pointed at, a guard, a value it sets, a field a reader would
  miss, annotate it; leave a snippet or a text plain only when its claim's line already
  says everything there is to see in it. Step code, on a flow or a walkthrough, is a line or two the reader
  takes in beside the step: write it as `key` lines alone. A paragraph of code beside a
  step is hard to parse; it belongs in a snippet on the step's own page.
- **The telling figure goes on the top page.** One figure explains the change better
  than any other. Pick it by the shape of the change's core idea, not by its kind. These
  are likely defaults, not a lookup table:
  - a decision: a `walkthrough`;
  - a new flow through the system: a `flow` with `before` and `after` lenses;
  - a pipeline: a rail `flow`;
  - a part of the codebase made of components a reader takes one at a time: an `atlas`;
  - UI work: a `gallery`.

  A walkthrough or a flow is decided by the reader's question, not by the graph's shape.
  "Which way does this go, and why?", with steps that are questions with thresholds,
  is a walkthrough. "What happens to it, in what order?", with steps that transform a
  thing, is a flow. A flow there is
  explanatory, high level and easy to parse: the shape of the change, with the detail left
  to the pages below. It goes in full in the central claim's body, so it is on the first screen with nothing to click. The header
  already carries the motivation and a sentence each of before and after, as a pull
  request does (a snapshot's, the motivation alone), so the body is for what goes deeper.
- **A sketch where the code is spread out.** When the change's code runs across files and
  the reader needs its shape before its lines, put a `sketch` in the top page's body, the
  one place it may go. Each group of its lines is a supporting claim of the top page with
  `code`, so its row links to the real code it stands for. Write its `text` in the
  notation the `pseudo` skill sets out, installed beside this one by `walkdown init`, and
  read it before writing one: rules lines for concurrency and retries, handlers for what
  fails, holes for what is not worth showing, and a call only for a name the code has, so a
  reader can find it in the linked code. Keep it to a screen. A sketch that says as much
  as the code is the code again, and a snippet does that better.
- **Pseudo-code in prose is a ```` ```pseudo ```` fence.** Where a body needs a few lines
  of how something works and no group needs a claim of its own, fence them as `pseudo` in
  the markdown. The page draws them in the same colour and dashed mark as a sketch. The
  sketch is still the one figure of the whole change's shape.
- **Lists as lists.** Where a paragraph lists things, such as the surfaces a change
  touches or the cases a guard covers, write them as a bulleted list, one to a line. This
  holds in any markdown: a body, a claim's `line`, a caption, a table cell. `check` does
  not look for it, so catch it while you draft.
- **Concrete examples, threaded into figures.** A traced API call, the value at each step
  of a flow, realistic rows in a table, the UI with realistic data, the input that takes
  each branch. Be generous with them: wherever a claim describes behaviour, a value or a
  format, an example of it is usually clearer than the sentence. Gather real data when
  it is reasonable to get; a subagent can fetch it while you write. A synthetic example
  is fine and often clearer, because full realism can bury the point. An example sits
  inside the claim it illustrates, not in a claim of its own.
- **Show the evidence a claim rests on.** A claim the reader would otherwise take on
  trust, that a query got faster, that a request hits the cache, that a plan uses the
  index, is stronger with what shows it. Give it under every such claim you can get it
  for, not only the headline one:
  - measurements: a `table` reading a CSV in the record folder, under a `measured` claim,
    with a bar chart to compare numbers or a line chart for counts over time. The CSV is
    the whole data or a sample, and its `note` says which and how it was sampled;
  - a tool's output, such as a query plan, a log or a response: an `excerpt` with
    `annotations` on the lines that bear on the claim, given a `before` and an `after`
    where the change moved it;
  - behaviour that differs by input: a `cases` figure, one case for each way it goes, a
    cache hit and a miss, a high score and a low one. Different inputs, never one input
    drawn several ways.

  Capture these from a real run where it is reasonable to; a subagent can run it while
  you write.
- **Don't overstate what you don't know.** Where a source states the reason for the
  change (a task, the PR description), give that reason. Otherwise infer it from the old
  behaviour against the new, and claim no more certainty than you have. `measured` is only
  for a check that was actually run, and `src: captured` only for text taken from a real
  run or file.

## The process

Six stages, in order. The person agrees the questions and the shape when they are
present; when nobody is (a CI run, a background agent), carry on and say in your reply
that you did.

### 1. Gather

The default source is a pull request: its diff, through
`walkdown hunks <base>..<head> --repo <dir>`, which lists every hunk with the id a record
names, and its description. Read the issue or task behind it, an agent session's history
or a run log too, when there is one.

First settle what the record walks, because every hunk id is numbered within that diff,
and moving `base` or `head` renumbers them. The record names both as full SHAs:

- **One commit:** `head` is the commit and `base` its first parent, the diff
  `walkdown hunks <commit>` lists for a commit alone.
- **One pull request, or several merged in a row:** `base` is the commit before the
  first, `head` the last. List each pull request in `prs`, in order.
- **Before its pull request**, so the record can ship in it: `base` is where the branch
  left the branch it merges into, and `head` the last commit before the record's own. A
  record cannot name the commit that holds it, so its own files sit in the pull request's
  diff and not in the record's. Leave `prs` out until there is one. A squash merge
  replaces the branch's commits: build the page before the merge, and point `base` and
  `head` at the new commits by hand if the record has to resolve after it.
- **A part of the codebase, tied to no change:** a snapshot. Name `head` alone, usually
  the full SHA of `HEAD`, and leave out `base`, `prs`, `change`, `before` and `after`.
  Its code is all source references.

`base..head` is a direct diff of the two trees. It is never `base...head`, the diff from
their merge base, which moves when `base`'s branch does; `hunks` refuses three dots.

### 2. Questions

Propose the questions the record will answer. Start from these four, and add ones
particular to the change:

- What's the most important thing to know about this change?
- If someone asks how it works, what do I tell them?
- What key decisions could have gone another way, and why this choice over the
  alternatives?
- If something breaks in a week, where do I start looking?

For a snapshot, ask them of the code rather than of a change. Wait for the person to
agree them, if they are present. The agreed list goes in the
central claim's `questions:`. The page never shows it; the crit reads it.

### 3. Shape

Propose the tree of claims, with the same wait. One record covers one diff or one
snapshot.

Start from the reference for the change's kind: `references/fix.md`,
`references/feature.md` or `references/refactor.md`, the same kind as the central claim's
`change`. Each proposes a shape; bend it to the change. A change that is none of the three,
or that one of them fits badly, takes its own shape from the agreed questions and leaves
`change` out if it is none of them. A snapshot is no change, so it takes its shape from
the questions and has no `change`.

First work out what the reader already knows of the area and what they do not: the
grounding the rest of the shape is written against. It decides which claims need
`context` and which words go in the glossary. It is yours to work out for each record,
not a file to keep.

Propose the shape as a markdown outline in chat, before writing any file: the telling
figure and its type, the top page's sections, each claim's title with its kind, figure
type and `context` where it has one, the hunks and line ranges each code form draws, and
the terms the glossary will define. Add a mermaid sketch where a flow's steps and forks
are easier to agree as a picture.

- Code outside the diff, and all of a snapshot's code, is a source reference, accepted
  wherever a hunk id is: a path alone for the whole file at `head`, or a slice over the
  file's own line numbers, `src/a.ts:82-92`. It draws as plain code with no diff.
- Each independent change in the diff is a top-level claim, and the central claim says
  why they shipped together.
- A value followed through steps is a flow: its steps are its claim's own supporting
  claims, or labels for a point no claim is about. One value read in many places is a
  flow too, from a label such as `manual_edit = true` to each reader, and draws as a fan;
  a reader it breaks is a `breaking` claim.
- A flow step's claim is written as part of the flow. Its title says, concisely, what
  happens to the thing going through at that step: supporting evidence for the flow. The
  bigger story of that step goes in the claim's body or its supporting claims. The step
  list draws no hop labels, so a step whose claim is about a choice explains that choice
  in its own prose.
- Draw the decision, not the call graph. A figure follows what the reader asks, not the
  control flow of the code: a retry, or a sub-question asked once, is detail on the step's
  own page rather than a loop on the figure. A rare side exit, such as a failure, stays off
  the figure as a claim below it.
- A decision is a walkthrough. Its steps are its claim's supporting claims or label
  steps, and each option out of a step carries its `label`, its `rule`, what taking it
  `means`, and the table cells it `narrows`. Write each option's narrowing yourself; the
  page never works it out from the rule. Under a step's heading the page draws its claim's
  line and body, so write that body as a short bulleted list of how the step works. The
  table the decision reads is a YAML file beside the claim, with one real example per
  outcome.
- Inputs traced through a flow are lenses and payloads on the flow, not a table beside
  it. A lens names the steps one case takes (`CRLF edit`, `what broke`) and the reader
  picks it above the flow. Where a fork rejoins and the case took one side, give the lens
  its `hops` too, or a payload, whose stages say which hops it took. A payload is the data that case carries, stage by stage, in a
  YAML file beside the claim that the lens names; the page diffs each stage against the
  one before it. A stage that scores several things at once can be a `table` in place of
  `data`, a row per candidate. Under a lens the page draws only that lens's steps, each with its stage
  under its row, so a step one case never reaches belongs to another lens. Keep a stage
  at every lit step the payload passes, a second pass round a loop included, where the
  flow has one: the reader scrolls on into it.
- Peers a reader explores one at a time, such as a system's components, are an atlas.
  Each entry is one of its claim's own supporting claims, drawn in the atlas and never
  again as a row, so it cannot also be a flow step or an annotation's claim. Its `group`,
  its `values` and its `excerpt` go in the atlas fence, by entry, not in the entry's own
  header. Name the `attributes` once per atlas: the few things every entry is described
  by, each given a value by every entry. The card draws only the first paragraph of the
  entry's body, so open the body on a prose paragraph that says what the entry is and why
  a reader would open it; the rest of the body and its supporting claims wait on its
  page. Where the entries happen in an order, they are a flow's steps, not an atlas.
- A tradeoff, something left open, a risk, a breaking change or a measurement is a
  claim with that `kind`, placed in the tree where it applies.
- Everything else is claims under claims.
- A claim that leans on one elsewhere in the tree names it rather than retelling it: a
  link to `#` and its id, `[the size guard](#guard.size)`, in any markdown, opens it.

Titles state the answer, not the question: "The step prompt opens on its own
instruction", not "What changed in step.md". An atlas entry is the exception: its title
is its short name, "trak" or "plan", because the atlas rail and the phone's chips draw it
and have room for no more, and its answer goes in its `line`.

Every row orients its reader. The reader knows the codebase at a high level and may know
parts of it deeply, but assume they have only a passing familiarity with the area this
change touches: they know it exists, not how it works or why it is built that way. A row's title and `line` say, at a glance, why it is worth
opening (a side effect, something that breaks) and how it bears on the change, not only
what the code does. "Offloaded text keeps its storage key" says what the code does; its
row also has to say that without it, every save of a large document would still be marked
as an edit. Write plain technical English, with no term the reader would have to look up
unless the record says what it means.

`line` may be left out where the title says all there is: an item in a list of cases, a
file that is only renamed. A claim with a title alone, and no body, code or supporting
claims, draws as one row that opens nothing and keeps its kind. A row that opens a page
keeps its line, since that is where it says why it is worth opening.

Never trade clarity for brevity. A few more words that say where something runs and why
it exists cost the reader far less than a terse phrase they can only decode by already
knowing the mechanism.

Wherever the area is not obvious to someone new to it, give context: a claim's `context`
names where its code runs in the pipeline, as a breadcrumb of a few short parts
(`[document sync, checking whether content changed]`), not its direct caller. The page
draws it over the row and over the claim's page. `check` does not look for it, so give it
while you draft.

A page with many rows can group them under headings: a `- section: <heading>` item in a
claim's `claims` heads the rows listed after it. The top page's sections also label the
outline a reader moves around the record by, so name them for what a reader looks for.
A section heads rows only, never the body or a flow's steps.

Words this area uses that a reader new to it would not know go in the record's glossary:
`glossary.yaml` beside the root `index.md`, a list of terms, each with the `aliases` the
prose also writes it as and a `definition` of a sentence or two. The page dots every
occurrence of a term in its prose, shows the definition on hover, and lists each term on
a glossary page with the claims that use it. Only the term and its aliases match, never a
looser form, so list each inflection the prose uses (`envelope`, `envelopes`). `check`
refuses a word two terms claim and warns about a term the prose never uses. Define the
words of this change, not the codebase's everyday ones.

Put a record at `.walkdowns/YYYY-MM-DD/<id>/` at the repository root, dated by the merge,
or by the day it is written for a record before its merge or a snapshot, unless the person
or your other instructions say otherwise. The folder's name is the central claim's id, so
the date stays out of it.

Give the record a `slug`, lowercase words joined by `-`: the header strip draws it, and
`publish` puts the page at `<repository>/<slug>.html`. Keep it when the record changes,
so a published page stays at its link. Two records of one repository with one slug
publish over each other.

### 4. Draft and check

Write the record, then run `walkdown check <record> --repo <dir>`. Fix every error; each
is named by file and line. `check` also warns about hunks no claim names. Leaving
mechanical hunks unnamed is fine: lockfiles, generated files, formatting churn. Any other
unnamed hunk is a part of the change the record does not account for.

### 5. Crit

Hand the record to a subagent that did not write it. It reads the output of
`walkdown read <record> --repo <dir>` — the record as text: its outline, then page by
page, each page headed with its level and its context printed as `where:`, then the
glossary and the changed files; an atlas prints every entry's card in full, under its
group, though the page shows one at a time — and answers the agreed questions in two passes:

1. From the pages at levels 0 and 1 only: the top page and the pages that open from it.
2. From the whole record.

A key question it can answer only in the second pass is buried: move what answers it
higher up. The crit also flags every row, at any level, that does not say why it is worth
opening and how it bears on the change, that states what an example or evidence could
show, that leaves a snippet or text plain where a line wants pointing at, that leans on a term the reader would have to look
up and the glossary does not define, that reads only to someone who already knows the mechanism, an atlas card whose
paragraph does not say what its entry is, or that lacks context where its area is not obvious to someone new to it. It flags a
top-page section whose heading does not say what a reader would look for under it.
Rewrite each row and heading it flags. Then fix whatever the crit got wrong or could not answer, and run `check`
again.

### 6. The person's review

Build the page with `walkdown build <record> --repo <dir> --out <file.html>` and give the
person the file to open. `build` refuses a record `check` reports errors for. Take their
feedback in chat, change the record, check it and build it again.

While you are still writing the record, give the person
`walkdown serve <record> --repo <dir>` to run in their own terminal, and never run it
yourself: it runs until stopped, and a server you start outlives your turn. It prints an
address; the page there draws again on every save, and while the record fails `check` it
keeps the last good page with `check`'s errors under it. It writes no file, so `build` is
still how the person gets a page to hand on. `walkdown serve` with no record lists every
record in the repository's `.walkdowns/`, each opening its own live page, and `--repo`
can be left off when the record's commits are in the repository it is run in.

When they want a link instead of a file, `walkdown publish <record> --repo <dir>` puts the
page on Cloudflare R2 and prints it. The page is sealed: it opens with the full SHA of the
record's `head`, which anyone who can read the repository can find, so tell the person that and
nothing needs sending. Pass `--unsealed` only when they ask for an open page — anyone with
the link can read one. Publishing again replaces the page at the same link.

The tool assumes nothing about where anything lives. Every path is yours to give.
