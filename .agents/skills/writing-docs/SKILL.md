---
name: writing-docs
description: The two buckets orkestra's documents fall into, and what each one owes. Read before editing README.md, CLAUDE.md, a skill or anything under docs/ or notes/, before changing the keys a `.orkestra/` file accepts, whenever a change reverses a decision a document records, and before adding a follow-up you are not going to do now.
---

# Writing this repository's documents

**The root is kept true; `notes/` is a snapshot.** That is the whole split, and which side
a document is on decides what it owes.

## Reference — kept true, kept minimal

`README.md`, `CLAUDE.md`, `references/*`, `.agents/skills/*`, `docs/*`.

**Name a skill at `.agents/skills/`, never at `.claude/skills/`.** Both reach the same
file — the second is a committed symlink to the whole directory, there because Claude
Code reads that name — but the symlink is the one that can be removed, and every path
written through it dies with it.

**Except `atelier/` and `atelier-proof/`, which are the `atelier` CLI's, and `stillroom/`
and `walkdown/`, which are those CLIs'** — each tool rewrites its skill from its own
templates whenever it is run, so an edit is deleted by the next `atelier shot` or
`walkdown check` and the deletion lands in somebody's diff as noise. They are vendored
documentation, not ours to keep true. A rule we need an agent to read
goes in one of the skills we write.

A snapshot of what exists today, written so an agent finds what it needs and answers
a common question fast. **Change the code, fix the sentence in the same change** — you
are the last person who will know it went stale. `pnpm docs:check` catches the
machine-checkable half (a named file that does not exist, a `notes/` pointer to no
such file, a module with no lint rules); whether a sentence is still *right* about
the thing it names is yours. `pnpm docs:check --changed-since <ref>` lists every file
changed since `<ref>` with the reference documents that name its exact path, so the
sentences to re-read are found rather than remembered.

**Default to the minimum that conveys the rule, and expand only once the minimal form
has proven insufficient.**

**Explain, don't justify.** An explanation says what breaks *now* if you ignore the
rule, in the present tense — that is what lets a reader apply the rule to a case you
did not write down. A justification recounts how we found out. Keep the first, cut the
second:

| Keep | Cut |
|---|---|
| a query that stopped asking never learns the fact that would restart it | this reverses the original rule / it cost a two-hour run |
| `EPERM` means the process exists and is not yours | a bare `catch` treated it as dead, four times |
| a section title parsing as an integer sorts to the front | the first draft got this wrong |

**Never name a past state of the code.** "This used to be called `fold`", "the action
bar was cut", "`routeTo` is gone" — the reader cannot see any of it, and a rule that
depends on knowing what a thing was called is unusable. State what is true.

## Don't write what is going to go stale

**Write the surprising, the novel and the counter-intuitive.** Anything a competent
reader would guess correctly is costing space and acquiring a shelf life. The thing that
ages worst is a fact that was incidentally true when written:

| Goes stale | Write instead |
|---|---|
| "Four rules about X" over a list | no count — the list is the list |
| "the 20 `TrakState._tag`s" | "every `TrakState._tag`" |
| "`pnpm smoke` — 8 checks" | "`pnpm smoke` — checks against the real CLI" |
| "see the third bullet above" | name the thing |
| a line number, a file size, a test count | the rule the line expresses |

**A count that is itself the rule stays.** "Two files per port, not five" and "five
tones, and a sixth means a state was not thought about" are constraints — the number is
what is being asserted, and breaking it should be visible. A count that merely totals
what happens to be below is decoration that silently goes wrong.

Same test for a cross-reference: name a file or a rule, never a position.

## Working — everything under `notes/`

Three files and a directory, and what separates them is **size and commitment at the
moment you write**,
which is the only thing you know when you are mid-task and do not want to lose something.
Nothing here is checked, and nothing here is kept in sync with the code.

| File | What goes in it | Leaves by |
|---|---|---|
| `notes/IDEAS.md` | one line — no trigger, no design | promotion, or deletion |
| `notes/todo/<slug>.md` | one piece of deferred work, and the trigger that settles it | being **done** |
| `notes/BUGS.md` | what is broken now — no trigger, being broken is one | being **fixed** |
| `notes/YYYY-MM/<slug>.md` | the thinking, once it outgrows a screen | nothing — it is frozen |

**`BUGS.md` is not `todo/` with a label.** A `todo/` entry is waiting for an event; a
bug is already earned its place, so it is ahead of everything deferred and it names no
trigger. A defect in work still in flight belongs in neither — it goes back with the
review, which is what sends work back.

Promotion runs one way and nothing is ever copied: an idea becomes a `todo/` entry when
it acquires a trigger, or a dated note when it acquires a design worth arguing with; a note
produces `todo/` entries. The one thing a note *is* worth keeping for is **why** — which
alternative was tried, and what it cost.

**A dated note is never edited after it is written.** That is what makes it a snapshot
instead of a document with an upkeep debt, and it is why its status line records what was
true *then* and is left alone. Supersede by writing a new dated file that says what it
replaces, never by editing the old one.

## Which file, and what question it answers

| File | Question | Bucket |
|---|---|---|
| `README.md` | what this is, for someone who has never seen it — and what is not built | reference |
| `CLAUDE.md` | the minimum an agent needs before touching anything — and which skill to open | reference |
| `references/glossary.md` | **what a word means**, for a reader who hit it in another document | reference |
| `references/commands.md` | **what each `pnpm` command does and spends**, and which presses in the UI spend | reference |
| `.agents/skills/*` | **how to do a thing**, at the moment you need to do it | reference |
| `docs/*` | **what a `.orkestra/` file and each of its keys do**, for an agent setting Orkestra up in another project | reference |
| `notes/BUGS.md` | **what is broken now**, and how sure we are of it | working |
| `notes/todo/*` | what we deferred, one file per entry, and the trigger that settles it | working |
| `notes/IDEAS.md` | what we might want, before it has a trigger or a design | working |
| `notes/YYYY-MM/*` | design work, and why it went the way it did | working |

Put a fact in the one whose question it answers, and nowhere else. A second copy is a
second thing to forget.

**Kept-true prose may cite a dated note, never `todo/`, `BUGS.md` or `IDEAS.md`.** A frozen file is
safe to point at precisely because it is frozen; a queue entry is deleted the day its work
lands, which is also the day the sentence citing it goes false.

**`docs/` is the public reference to `.orkestra/`, and holds nothing else.** It is
published raw to agents setting Orkestra up in another project, so it describes the
product as any project sees it — never what this repository's `.orkestra/` holds, its
`pnpm` commands or its skills. Plain GitHub-flavored markdown, and every link between
pages relative, because a site may wrap the files later. A plan, an architecture map or a
findings log does not go there: each describes the code well enough to go stale and badly
enough to be worth less than reading it. **A rule with no home is a rule whose skill is
missing, not a document waiting to be written.**

**A change to the keys a `.orkestra/` file accepts updates its `docs/` page in the same
change.** Each `src/library/logic/*-file.ts` loader is documented on the page named for its
kind in the plural — `process-file.ts` on `docs/processes.md` — and every key in its
allowed list is named there as `` `key:` `` with its type and default; a key it refuses
by name goes in that page's table of refused keys. `pnpm docs:check` fails on an allowed
key the page does not name, and on a loader with no page. The files read elsewhere —
`models.yaml`, `fleet.yaml`, `worktrees/`, `deploy.sh`, `ORKESTRA.md`, `COMPOSITION.md`,
`GOALS.md` — each have a page the index in `docs/README.md` names, and the same rule.

**`references/` holds only what a reader needs *outside* the code.** `glossary.md` says what a word denotes; `commands.md` says what each command does and what it spends. None says how the code is arranged — that goes stale on any
change that touches it, so behaviour an agent needs while writing belongs in the skill
that owns it, and a `references/` file that starts describing flow has become the
architecture map again. In the glossary: **define the word, then stop.**

## Documents and skills are not the same shape

A document is organised by **question for a reader**. A skill is organised by **moment
of need** — loaded when someone is about to write a test, a prompt, or a `catchAll`,
so everything in it must be usable right then.

**A working rule an agent must follow belongs in a skill.** A rule about *why* the
system is shaped this way belongs in a document. Writing the same sentence in both
means one of them is wrong — and it was: `CLAUDE.md` and the skills were the same
document written twice.

`.orkestra/` is a third thing again: policy an agent is *given* at runtime, not
knowledge it goes and reads.

## Reversing a rule

**Rewrite it in the same change, and state the new rule plus why the alternative
fails.** Not that it was tried — a reader who knows only that something was reversed
still cannot tell which way to go. "Poll unconditionally; a query that stops asking
never learns the fact that would restart it" is the whole of it. The record of what we
tried is the commit.

## The three queues, and what keeps them short

An entry leaves one by being **done** or **promoted**, never by being annotated — git
holds the record of what left, so a second record of it is pure upkeep.

`todo/` stays scannable at any length because of what it refuses, not how it is
arranged: **every entry names its trigger**, the observable event that would make you pick
it up. Twenty entries that each say *you will know when* stay readable; six that say *we
should probably* are clutter already. Keep an entry to what breaks and what settles it —
the case for deferring is a decision already made, and anything longer than a screen is a
dated note with a pointer from here.

**One entry is one file**, `notes/todo/<slug>.md`, titled with the entry's own sentence.
Two traks deferring two things then touch two files, and a merge has nothing to argue
about; one file that every trak appended to was the most conflicted file in the
repository. Point at an entry by its path — from a comment, a skill, a check — and
`docs:check` refuses a path that names no file, so an entry that is done takes its
pointers with it.

`BUGS.md` is bounded by being ahead of the other two: nothing keeps a list of defects short
except fixing them, and a bug that has sat there long enough to need a case made for it was
a `todo/` entry all along. Say how sure you are — *found by reading*, *reproduced 4 runs
in 6* — because the next reader's first question is whether to trust it.

`IDEAS.md` has no such filter, so it is bounded structurally instead: **one line each, no
headings, twenty entries.** A line that needs a heading is not loose any more and is due
for promotion; full means deleting one to add one, which is the only mechanism that has
ever kept a list short — a cleanup ritual is a thing you skip.

Something simply not built yet, that nobody has to decide anything about, is a line
in `README.md`'s *Not built* instead.

## Cut it after you write it

**Everything written to be read gets a second pass** — a document, a skill, an agent
brief. Short is not a standard you draft to; it is what is left. Take every sentence,
clause and example through four questions, and a no on any one is a cut rather than a
rewrite.

| Ask | Cut when |
|---|---|
| Does the reader already do this? | it is behaviour a competent agent defaults to. The highest-yield question, and the one that finds whole paragraphs |
| Would removing this phrase change what anyone does? | it is rhetorical — emphasis, a stake-raiser, the point made a second time |
| Does this example clarify, or fill a slot? | it is invented and generic. One taken from a real failure earns its place; a plausible one does not |
| Is it enforced somewhere already? | a lint rule, a schema, a permission or a check makes it true — or another document this same reader is already handed. Prose restating either is a second copy to forget |

What this finds that nothing else does:

- **A rule that only counterweights a rule you deleted.** *Read the code early* existed
  to reverse *read the code only when the topic is in it*; once the second went, the
  first was answering nothing.
- **A rule the machine already enforces.** `permission: read-only` denies the edit
  tools, so *you are not building it* was decoration — what was worth keeping was the
  permission it implied, not the prohibition.
- **A rule the reader is already handed.** An agent brief restating what
  `src/prompts/templates/system/` injects into every step, or a skill restating
  `CLAUDE.md`, is one document written twice. Find who else writes to this reader
  before you write the rule, not after.

Expect this pass to remove rules and not only prose.

**In anything a model writes *from* — a brief, a section description — only a cap
binds.** *Be concise* and *as long as it needs* both read as licence. A word limit, a
row limit, and *omit when there is nothing* are what change what comes back.

**Cite nothing by number.** Comments used to point at a numbered finding in a log of
them, which made every rule a pointer to a file that had to survive forever. State the
point where it applies; if it is too long to state there, it is a skill.

## Keep the shape

Table-and-short-paragraph, dense on purpose — read by agents as well as people. Title
the *lesson*, not the symptom.
