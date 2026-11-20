---
name: atelier
description: Design screen options the user can look at and tweak live. Use whenever the user asks for UI/screen/page/layout designs, mockups, "some options for", "a few directions", or wants to compare visual approaches before committing to an implementation. Renders React designs in a gallery with a control panel for typography, color, spacing, and any custom prop, and saves the chosen state as JSON. For looking at a component that already exists — checking, screenshotting or verifying UI you have just built rather than choosing between new options — use the `atelier-proof` skill instead.
---

# atelier

A local design harness. You write React designs; the user views them in a gallery,
tweaks knobs in a side panel, and saves the state they like as JSON.

Spend your effort on the design. The harness handles display, controls, and saving.

**A knob is one line; a round trip is a message, a rebuild, and a reload of the user's
attention.** So expose generously — but only within the question being asked. A knob on
something already decided is not generosity, it is a fourth thing to read.

## Not every look is a study

If the component already exists and the job is to **see** it — check a state, look at a
screen after a refactor, find out what a spacing change did — there is no question being
asked, so there is nothing to open here. That is a **proof**: one throwaway file that
imports the real component, gives it props and renders it on its own.

**It has its own skill — `atelier-proof` — and that is where the whole of it lives.** Read that
instead of this one. Do not boot the host application for it, and do not open a study
either: a study is dated and kept, and a look at what already shipped is neither.

Everything from here down is about a study.

## Before you open a study

**Three parts, in order, and each is a message the user answers before the next one is
written.** A round that answers a question nobody asked costs a rebuild, a look and the
user's attention, and none of it is bought back by the designs being good.

1. **Ask.** Read what the repo already answers, then ask about everything left — what
   kind of thing you are making, the job, the boundaries of the round, and what the user
   wants to see differ. No design has a name yet.
2. **Propose the directions.** State the settled brief, then name each direction, explain
   the idea behind it, and ask about it. Then ask what else they want in.
3. **Build.** `## Workflow`, below.

**Parts one and two never arrive in the same message.** A scoping question and a named
design direction landing together makes the user answer both at once — and the answer to
the first is what the second should have been built on. While you are still asking,
propose nothing. Once you are proposing, the asking is over.

### Part one — ask

**Read first** — the tokens are in a config, the component you are replacing already has
its states, a PRD may be sitting in the tree. A question whose answer you could have read
spends the user's attention and buys nothing.

**Settle what kind of thing you are making before anything else.** It comes ahead of the
four dimensions below because it decides how their answers are read, and three answers
cover it:

| | the round is | where it is covered |
|---|---|---|
| **a prototype** | one design at full fidelity, built to be clicked rather than compared | `references/prototype.md` |
| **a fresh set of directions** | several designs disagreeing about what the screen is for | `references/comparing.md` |
| **a pass over what is already there** | the thing that exists, moved rather than replaced | `references/existing-code.md` |

**Where the request leaves it open, ask it — never infer it.** *Redesign the documents
page* is the shape of the problem: it reads equally as *keep this page and make it better*
and as *show me what else this page could be*, and those two rounds have nothing in
common. Guessing costs the whole round in either direction — the user who wanted the first
gets three pages they recognise nothing in, and the user who wanted the second gets three
versions of what they already have.

**Ask about the gaps, and ask about all of them.** This is the only part that settles the
brief — a question you save for later is a question asked after the thing it would have
changed was built. Four dimensions, and which one is missing is what changes between jobs
of work, not which questions exist.

| | what it settles | usually missing on |
|---|---|---|
| **job** | what this has to do, and for whom | anything whose design does not follow from its name |
| **reference** | the world it lives in — comps, tokens, a system to obey | greenfield and marketing work |
| **survival** | the surfaces, states and extremes it must hold up under | a design system |
| **interest** | what they want to see differ, and what they hold constant | anything handed over in one line |

**These are the inputs to the four decisions below, not a second list beside them.**
Reference settles *open or closed space* and *new or existing code*; job and survival
settle *page or widget*; the kind above and interest together settle *choosing, dialling,
showing, prototyping or fitting*. Answering that table by inference is how a round comes
out well made and off-target.

**Ask in closed choices — three or four, each carrying the default you would pick.** The
default is the proposal: answering is altering it rather than composing one from nothing,
which is why the answer is allowed to be a shrug. An open field gets skipped or gets an
essay, and neither is worth the round trip.

**Every default here is a part of the brief — a surface, a token set, a reference world.
Never a named design.** A direction offered as one of these choices is part two arriving
early, and it lands while the brief it should rest on is still a question.

Four things decide what the answers are worth:

- **An adjective is a search key, not a rubric.** *Warm, inviting, modern* prunes a world
  that is otherwise open and gives you something to fetch comps with — but nobody can say
  whether a design is *inviting* until it is on screen, so never treat one as an
  acceptance test. Ask for comps as links or images; if none come, name the world yourself
  — "Stripe-sober rather than Linear-dark" — and let them reject the name.
- **Survival is answered in `specimens`, not designs.** *Which surfaces must this hold up
  on* is an inventory; turning it into three tiles to choose between is the groove rather
  than the decision.
- **Scope the job when the design does not follow from it.** "Build me a button" needs
  nothing: the job is in the name. "Build me a reporting graph" needs *who reads it* and
  *what they should walk away knowing*, because those decide what it plots — the job is
  the design. The test is not how big the thing is, it is whether the answers would change
  what appears on screen. When they would, ask.
- **An undecided job is said out loud, not picked quietly.** Settle it in conversation and
  then open the study — that thinking is not what the gallery is for, and a round drawn on
  a job you chose silently has the user answering a question about layout while the real
  one sits unasked. The exception is narrow enough to have its own rule:
  `references/comparing.md`, "one altitude above the coarsest layout".

**The message ends with the questions.** Nothing follows them — no directions, no names,
no sketch of what you would draw. Those are what the answers decide.

### Part two — propose the directions

**Nothing here goes out until the asking is done**, and done means every part of the brief
has either been said by the user or been offered to them as a default they declined to
change. A shrug at a default you put in front of them is an answer; an assumption you
never showed them is not.

**State the settled brief first, and write it down as you say it.** One line, carrying what
the answers decided and the **axis** with them — what this round chooses between, and at
what altitude. The axis is the one thing that never becomes a question: it is a fact about
the round rather than about the design, nobody volunteers it, and it is what a round does
not recover from getting wrong. `references/comparing.md` is that decision in full.

```
atelier note checkout-flow "asking: how should this page be organised. Tokens settled — obey them. Lands on src/checkout/Summary.tsx. Colour and copy are constants this round."
```

Saying it and recording it are the same move, so do not do the first without the second.
The brief is the only part of this that survives a context clear — nothing reconstructs it
from the `.tsx` — and `atelier brief` prints it, so a compacted session recovers the
question and not just the artifacts.

**The directions follow the brief, in that same message.** The brief settles the axis; the
positions are where each design sits on it, so they belong with it rather than in a third
round trip. That is `meta.name`, `meta.claim` and `meta.why`, settled before the files
exist rather than by whoever ends up writing them.

**Explain each one, then ask about each one.** The name and the claim are the headline;
what the user is approving is the idea underneath — what this design does differently and
what it gives up, in a couple of lines, at the altitude of the concept rather than the
layout. Take them one at a time and ask about each explicitly, so a direction can be
struck or redrawn without touching its neighbours. Then ask what else they want in: the
idea you did not think of is theirs, and here it costs them a sentence.

**Proposed first, then solicited.** *Which directions would you like* as an opening move
is the open field that gets skipped or gets an essay. Named positions with a claim each
are a proposal the user edits — striking one, adding one, or moving one along the axis —
and a shrug is still an answer, because the proposal was the default. The invitation to
add their own lands after that, when there is something on the table to add to.

**How many is theirs, and proposing them is how you ask.** Three is conventional here and
nothing measured says three; what the evidence supports is *more than one*, and the number
above that is the judgement `references/comparing.md` declines to make on the user's
behalf. So propose three, say the count is adjustable in both directions, and let striking
or adding a position be the whole of the answer. That is what makes this the cheap moment
to settle it: a position costs a sentence here and a few hundred lines in step 2.

The ceiling is set by what a design costs in this round, which is the same split the
fan-out turns on. A thin round over a fat `shared.tsx` runs around thirty lines a design,
so one more candidate is nearly free. A self-contained round is a few hundred lines and a
context apiece — the fan-out makes those concurrent rather than cheaper, so it buys
latency and not a bigger round. And if the honest answer is *one*, the round is not
offering a choice: that is `references/comparing.md`'s dialling case, and it changes the
shape of the round rather than its count.

Two things this buys, worth knowing so the step does not decay into ceremony:

- **The cheap version of a test that already runs.** *If you cannot say what a design
  argues for, it is not a direction — it is a nudge* is the rule step 2 has always
  carried, and it currently runs while the design is being written, when failing it costs
  a file. Here it costs a sentence, and the repair is free rather than a deletion: the
  nudge becomes a knob on another design before anyone has drawn it.
- **The alternatives become the user's.** A round is a comparison only if somebody chose
  what is being compared. The axis makes the designs comparable; approving the positions
  on it is what makes them the user's rather than yours, and that is the difference
  between offering a choice and presenting three things you happen to have made.

**Then wait.** The approval is a message back, not a silence you read as one.

**Record the approved positions with the brief.** Same command, same moment:

```
atelier note checkout-flow "positions: Quiet Ledger — totals lead and everything else recedes. Split Rail — the decision beside its evidence. One Sheet — no chrome, one column, read top to bottom."
```

Not for whoever writes the designs — they are in your context and the handoff carries them
from there. This is for the clear. The round's notes are what `atelier brief` reads back,
and without this line a compacted session re-asks a question the user has already answered.

**Part two collapses only when the position is already approved.** A repair, or a v2
dialling in a direction the user already picked, has one position and it was approved when
the direction was.

**A round that never offered a choice still gets part two — it proposes one thing instead
of three.** A prototype and a fitting are both single-design rounds nobody has agreed to
yet, and a single design is the expensive kind to get wrong, because there is no second
tile to make the miss visible. So state the brief, propose the one thing, and ask. For a
prototype that is which screens exist, which paths work and what is faked
(`references/prototype.md`); for a fitting it is the single position and what in the
system it obeys (`references/comparing.md`). Then ask what else they want in, the same as
any other round.

### Part three — build

`## Workflow` below is the whole of it. **Do not run `atelier new` before part two has been
answered** — the names you pass it are the approved positions, so creating the files first
turns the proposal into a description of work already done.

## Four decisions, and where each is settled

Answer all four before you write anything — before `atelier new`, because the names you
pass it are already the fourth answer. They are independent, and each one changes what
the round is made of. Answer them **from the brief above rather than from inference** —
the middle two are facts about the host repo, and guessing a fact is the one kind of
wrong here that no amount of care in the designs recovers from.

| decide | if | then | detail |
|---|---|---|---|
| **page or widget** | a whole screen, or how one responds across sizes | default export, no `frame` | `specimens.md` |
| | a part, shown at a width you choose | `frame: { width, ground }`; several exhibits → `specimens` | `specimens.md` |
| **open or closed space** | tokens still in flight | free values, and a lot of them | `controls.md` |
| | tokens already decided | knobs carrying the system's own class names, and few | `controls.md` |
| **new or existing code** | greenfield | nothing more to do | — |
| | it touches code that exists | `adopt` the subject, `inject` for context | `existing-code.md` |
| **choosing, dialling, showing, prototyping or fitting** | between directions | several designs, one altitude | `comparing.md` |
| | how far in one direction | one design, a generous manifest | `comparing.md` |
| | every state one thing has to survive | one design exporting `specimens` | `specimens.md` |
| | what a flow is like to click through | one design at full fidelity, navigation on knobs | `prototype.md` |
| | one position inside a system that already decided | one design, few knobs, the system's own names | `comparing.md` |
| **finished or wireframe** | the treatment is part of the question | finished — the default, and nothing to do | `comparing.md` |
| | the question is structure or flow, and treatment is held still | the wireframe kit, inside `<Wireframe>` | `wireframe.md` |

You never declare which space you are in. **Options do.** A knob with `options` offers a
choice the system already made; a knob without them offers a free value. That is the
whole distinction, and it is expressed once, in the manifest.

The files that table names are the rest of the skill. Read what the table asks for and no more —
the point of the split is that a greenfield page never pays for `adopt` — and they
cross-reference each other by filename when you need the next one. `comparing.md` is the
one to read on time rather than on demand: it is about the round rather than the design,
so read it before writing one and again before opening the next.

## Workflow

0. **Read `HOUSE.md` beside this file, if there is one.** Everything in this skill is
   generic; that file is where this repo says what is true only here — how its code gets
   rendered into a round, what has to be loaded before anything looks right, which
   subjects cost a database record before they will draw at all. It is written by the
   people who work in this repo and never overwritten by the tool, so where it disagrees
   with this skill about anything local, it wins.

   Nothing else here depends on it and a repo without one is not misconfigured. But a
   round that rediscovers a house fact the hard way is a round that should have added a
   line to it — do that while you still remember what you had to work out.

0b. **Optional — a worked reference, if you want one.** The contract is three exports and
   the section below states all three. If that is enough, start at 1. Reach for an
   example when you are about to do something you have not done here before: `specimens`,
   an injection, a design that owns its own dark ground.

   **Prefer one this repo already has.** `atelier list` says whether there is one — a
   study named `example-…` ships with the tool, anything else somebody here wrote — and
   theirs wins, because it carries this repo's fixtures and tokens and is the house style
   you are about to match. Open one file, not the round; reading a round back is
   `atelier brief`'s job and a different one.

   **The shipped examples are in `.atelier/2026-01/`.** They are regenerated on every
   command, so copy one into a study of your own rather than editing it in place — an
   edit there is gone on the next run.

   | | when |
   |---|---|
   | `example-marketing` | several whole screens compared. Three designs, one round, `frame: 'page'` |
   | `example-field-states` | one part under every input it has to survive. `specimens`, `frame: 'widget'`, a v1 → v2 showing `shared.tsx` carried forward, and a knob declared `when` another is off |
   | `example-wireframe` | two information architectures at one treatment. The wireframe kit, and every knob an interaction rather than a value |

   Read the one that matches what you are about to do. Reading both costs tokens and
   teaches you nothing the other does not.

1. **Create a study** — one study per design question. Name the designs as you
   create them; a file called `b.tsx` is a design nobody can talk about.

   ```
   atelier new checkout-flow --names "Quiet Ledger,Split Rail,One Sheet"
   ```

   Creates `.atelier/<YYYY-MM>/checkout-flow/<today>-v1/{quiet-ledger,split-rail,one-sheet}.tsx`,
   each seeded with a working example and its `meta.name` filled in. `--count 3` still
   gives you `a/b/c` if you genuinely do not know yet. It also sets up `.atelier/` and
   this skill on first run, so it is safe to run in a repo that has never used atelier.

   The directory is dated and the index sorts by it. Everything else — refs, URLs, saved
   JSON — calls the round `v1`, so re-dating one by renaming its directory strands
   nothing, and a round with no date still loads, filed under "Undated".

   **Rounds.** Designs live in a numbered round. Running `new` again on a name that
   already exists opens the next one:

   ```
   atelier new checkout-flow --names "Quiet Ledger v2,Split Rail v2"
   ```

   That is the gesture for "the user has seen these and wants another pass". Do not
   edit the previous round to incorporate feedback — v1 is the record of what was
   shown and rejected, and overwriting it destroys the argument for whatever wins.
   **Deleting from it is the same act.** `atelier prune` reaching into a round that
   has been shown takes the losing half of the comparison with it, and what is left
   says three directions were weighed when four were.
   Most of what the user says back is *not* feedback in that sense; see **When they come
   back with something**, below, before you open a round.

   **Carry the fixtures forward; do not retype them.** A new round almost always keeps
   the previous round's `shared.tsx` and `_`-prefixed files and changes only the
   designs. Copy them:

   ```
   atelier new checkout-flow --names "Quiet Ledger v2"
   OLD=.atelier/2026-07/checkout-flow/2026-07-30-v1
   NEW=.atelier/2026-07/checkout-flow/2026-07-31-v2
   cp $OLD/_* $OLD/shared.tsx $NEW/
   ```

   v1 stays byte-identical, so the record is intact — and the round costs what actually
   changed rather than what it contains. Retyping a 20KB `shared.tsx` to alter four
   lines of it is the single most expensive habit available here.

2. **Write the designs.** Replace each seeded file with a real design, and deliver the
   position it was given. The directions were settled and approved before this step, so
   the work here is not deciding what to differ about — it is making one position real
   at the structural level the axis named: information hierarchy, navigation model,
   density, what gets emphasis. Not the same layout with different padding; the panel
   already covers padding.

   **`meta.name`, `meta.claim` and `meta.why` are the approved position, written in
   verbatim.** You are transcribing what the user agreed to, not summarising what you
   built. A claim quietly edited to match the design it ended up describing is a design
   nobody approved, and 3c then grades it against a rubric it wrote for itself — builder
   and reviewer agree, and nothing catches it. If the position stops being true of what
   is on screen, stop and say so: that is a finding about the axis and it goes to the
   user, not into `meta`. `references/comparing.md` is the decision behind those fields
   in full, including how to tell a direction from a nudge.

   This is where the four decisions above cash out: read whichever of `controls.md`,
   `specimens.md` and `existing-code.md` your answers pointed at, and read them now
   rather than after the first draft. Read `references/habits.md` whatever the answers:
   the defaults generated designs fall into, each shipped only with a stated reason.

   **A self-contained round is written in parallel, one subagent per position.** Which
   shape the round is is `references/controls.md`'s distinction, and it decides this.
   Designs that each draw the whole thing run to a few hundred lines and are worth a
   context apiece. Designs that are a spread over a fat `shared.tsx` come out around
   thirty lines, and a handoff long enough to be safe would be longer than the file it
   asks for — write those yourself.

   **The order is the safety property, not the fan-out: axis, then fixtures, then
   positions, then dispatch.** The axis and the positions were settled with the user
   before the study was opened. `shared.tsx` and the `_`-prefixed fixtures are yours,
   written before anything is handed out. Subagents each told *build a design* from one
   prompt is the arrangement measured to produce work that is individually inventive and
   collectively alike, so a fan-out that skips the first two steps commits the failure
   `references/comparing.md` exists to prevent, and commits it in parallel.

   Each subagent gets one prompt and owns one file:

   ```
   your position: <name> — <claim, verbatim>
   what it gives up: <why, verbatim>
   the axis: <the one line from the brief>

   frame: page | widget        space: open | closed
   code: greenfield | adopt    shape: choosing | dialling | showing

   you own <name>.tsx and nothing else
   shared.tsx is written and frozen — read it, import it, never edit it
   a helper it does not have goes in your own file
   if the position stops being true of what you build, stop and report back
   ```

   It reads its own seeded file, which is a working design and therefore the contract;
   `shared.tsx`, which is the round's fixtures and defaults; and `.atelier/CLAUDE.md`,
   which arrives on its own. Anything past that — `specimens`, an injection, a design
   owning its own dark ground, `references/habits.md` — the prompt has to name, because the seed does not show it
   and nothing else will say it was wanted.

   **Hand the four decisions over as answers.** They are settled from the brief, and
   subagents each reading this skill fresh will each settle them again and may settle them
   differently. A round whose designs disagree about whether they adopt real components or
   mock them has compared nothing.

   **Nothing needs isolating and no worktree is wanted.** `shared.*` and `_`-prefixed
   files are not designs, a round's files are self-contained, and every design is one
   `.tsx` with one owner — so no two writers reach the same file. The same helper turning
   up in two of them is a finding for the next round's `shared.tsx`, not a conflict to
   resolve in this one.

   **This buys context, not variety.** Each design gets a whole context for one job, and
   the main thread keeps its own for the axis and the conversation. What makes a round
   varied is the positions differing and the user having approved them, and that already
   happened.

   **Read back what you just changed, while you are still changing it.**

   ```
   atelier read checkout-flow/quiet-ledger --scope totals
   ```

   You can check that code is correct by reading it back. You cannot check that a design
   is — reading your own source tells you what you *intended*, and whether the intention
   survived the render is not in it. That is the gap this closes, for about forty tokens:

   ```
   totals  320×64  at 0,0
     bg      #dc2626
     ink     #ffffff   4.8:1
     pad     16px 24px
     3 text nodes, none clipped
   ```

   Tag anything you want to be able to ask about with `data-atelier="<name>"`. It costs
   nothing, it is not a knob, and it does not have to become one — `--scope` is how you
   point at a region, and tagging liberally is the habit that makes the pointing cheap.

3. **Check it, then have it reviewed.**

   **3a — is anything actually broken?**

   ```
   atelier check checkout-flow
   ```

   The one command here that fails. Everything else reports; this rules, because what it
   asks has answers rather than opinions — did each design render, does its manifest still
   match the harness, and does every knob move something when you turn it. It exits
   non-zero and names what broke.

   Run it before you look at anything. A screenshot of a design that threw is a picture of
   a stack trace, and a read of one reports `0 text nodes` as though that were an answer.

   It works in stages and stops at the first that fails, which is why the output is short:
   a design that did not render has *every* knob look dead, so reporting twenty findings
   for one `TypeError` would bury the only line that matters.

   A design using the wireframe kit is checked further: each part's value is compared
   against the knob it names, so local state where a prop belongs is caught on the first
   render rather than by the sweep. `references/wireframe.md` has both messages.

   The knob sweep is the part nothing else can do. A knob wired to nothing looks exactly
   like a knob that works until someone drags it — no error, no warning, and a screenshot
   that is correct. It is checked by turning each one and re-reading the whole render, and
   a knob declared `when` is turned with its gate satisfied, so a correctly-inert knob is
   not reported as dead.

   **3b — did what you intended happen?** This is the reading in step 2, not a phase of its
   own. Confirm the values you set are the values on screen, region by region, as you go.
   It is cheap enough that it should not be an event.

   **3c — does each design deliver the claim it makes?** One pass, dispatched to a
   subagent that did not watch the designs get written, handed the shots and
   `atelier brief`. The question is not *is this good* — it is **where does this design
   fail its own argument**, against the position the user approved and the design carries
   in `meta.claim` and `meta.why`.

   Ask for problems, never a score. On real heuristic evaluation of interfaces a frontier
   model finds about a fifth of what human experts find, and severity ratings across models
   agree with each other at almost exactly chance — a severity number would be noise
   printed with a decimal point. Running the pass twice does not improve it. So: once, in
   prose, then stop.

   Set your expectations to match. At a fifth of expert recall **this is a filter, not a
   gate.** It exists to catch a design that fails its own stated claim before a person
   spends attention on it, and most of what is wrong will still be found by the user in
   step 4.

   **This is the one place a picture is not optional.** Its question — does the emphasis
   land where the claim says it does — is about composition, and composition is the one
   thing an image is the right instrument for. Everything else in the loop has a
   determinate answer and a cheaper way to get it.

   **Skip 3c when the round is not offering a choice.** A repair, or a v2 dialling a
   direction the user already picked, has no claim on trial — so it has nothing for a
   reviewer to hold a design against, and no reason to shoot.

   ```
   atelier shot checkout-flow
   ```

   Writes PNGs to `.atelier/<month>/checkout-flow/<round>/.shots/`, and refuses to write
   one for a design that is not rendering — a picture of a stack trace costs a full image
   to learn what the text already said. Anything wrong with a *manifest* is `atelier
   check`'s to report, in 3a, before you get here.

   **A shot of a page is one screenful, and says so when the design runs past it.** The
   line under the path gives the design's real height and names `--full`, which captures
   the whole document — stopping at a ceiling, and saying so when it stops there. Read
   that line: without it a picture of the top of a long page reads exactly like a picture
   of the whole design. A fit and a widget are cut at the viewport instead, with no line
   and no help from `--full`, so give a long one the height as well: `--height 2400`.

   **Looking is the most expensive thing you do here, so aim it.** A screenshot is
   priced by its pixels and never leaves the conversation once read — in real sessions
   it has run to a third or more of everything spent, outweighing the writing of the
   designs. The pictures are worth it; taking the same one repeatedly at full size is not.

   | what you are asking | how to look | cost |
   |---|---|---|
   | did *that change* land | `atelier read <ref> --scope <name>` | ~40 |
   | what is this design actually made of | `atelier read <ref>` | ~300 |
   | did the whole design come out | `atelier shot <ref>` | ~1,500 |
   | is *this one state* right | `atelier shot <ref> --specimen off` | ~150 |
   | which value of this knob is right | `atelier shot <ref> --sweep gap=8,16,24` | one sheet, ~800 |
   | is it right on a phone | `--width 390 --height 844` | ~440 |

   **The cheapest look is not looking.** Read the values before you photograph the pixels.
   A picture is the right instrument for a question about *composition* — balance, rhythm,
   whether the emphasis lands where you meant — and the wrong one for any question with a
   determinate answer. "Is the header the red I asked for" and "did the total end up
   right-aligned" are arithmetic, and asking a model to judge them from an image is both
   the most expensive way to ask and the least reliable: colour ratios and small
   misalignments are exactly what visual judgement is worst at.

   So **reach for `shot` when you need to see it, and for `read` the rest of the time.**
   In practice that leaves 3c as the only place a round shoots at all — and never to
   confirm that a value landed, which is what `read` is for.

   `read` also says, without being asked, what it noticed while it was in there: text under
   4.5:1 against the colour actually painted behind it, text clipped with nothing declaring
   it should be, something painted over something else, a box with no area, and how many
   distinct type sizes, colours, radii and spacings the design used. All of that is
   advisory — nothing fails, nothing is blocked, and a flag you disagree with is a line you
   skip.

   `--scope` crops or reads everything tagged `data-atelier="<name>"`. `--sweep` is both
   cheaper than three shots and a better answer, because the comparison is the question.
   They compose one way — `--specimen focus --sweep radius=0,6,14` is the cheapest real
   *picture* the tool has — while `--scope` and `--specimen` each name the axis you look
   along, so reach for one or the other rather than both.

   Two rules that follow:

   - **Do read while writing; do not shot while writing.** Reading back the region you
     just changed belongs in step 2, next to the change. A photograph does not: write
     every design, then look once with `atelier shot <study>`.
   - **Send 3c to a subagent** — not to save tokens, but for accuracy. It is the one look
     that most decides something, and the reason to delegate it is that a reader who did
     not write the designs is not defending them. It buys no tokens and that is fine.

4. **Serve it and hand over the URL — the user is the gate.**

   Nothing before this point decides anything. `check` gates, `read` reports, `shot` shows, 3c filters;
   the design is chosen here, by a person, and this step is the terminal state of the
   workflow rather than the last of four chores.

   ```
   atelier dev
   ```

   This blocks, so run it in the background. Its port is derived from this checkout, so
   it is the same one every time here and a different one in the worktree next door —
   but **read the URL it prints rather than assuming a port**, because a port already in
   use silently becomes the next one, and a link to the wrong port is a link to nothing. The
   gallery already shows each design's name, claim and reasoning, so your handover
   message does not need to repeat them — say what is worth looking at first, and what
   you are unsure about.

   **Every screen has an address, so link to the one you mean.** A bare URL is the
   library; `?p=<round>` is that round's grid, `?d=<design>` a design in focus, `?s=` a
   specific set of knob values. Both refs are loose the way the CLI's are —
   `?p=checkout` is that study's newest round, `?d=ledger` a design by name — and both
   are rewritten to full ids once the page loads, so what you copy back out of the bar
   is unambiguous. "Start with Split Rail" is better said as a link to Split Rail.

   **Add `full` when the design deserves the whole window.** `?d=<design>&full` is that
   design expanded: the chrome gone and the design filling the browser window, at its own
   size — a widget keeps its declared width, nothing is magnified. `full=<specimen>` is
   one specimen alone. The person gets there themselves from the View · Expand cell in
   the header or the icon ending a specimen's caption line, and leaves with Escape. There
   is no panel while expanded, so link to it when the question is how the thing looks,
   and to plain focus when the question is a knob.

   **Leave it running.** Adding, editing or removing a design reloads the open page, so a
   later round needs no restart. Running `atelier dev` again is safe and does nothing: it
   finds the one already serving this `.atelier`, prints that URL and exits. So you never
   have to track whether the user started one — ask, and you are told.

   Leaving it up also makes `atelier read` quicker, because it attaches to the running
   gallery instead of booting its own.

   **A gallery is one checkout, and every command follows the one you are in.** A round
   living in another git worktree is not in this gallery and not in `atelier list` — a
   design there imports that branch's code, and only a server booted there resolves it.
   The checkout at the foot of the chrome's spine is the user's way across: it opens that
   checkout's gallery, starting one if it has none. You have no equivalent, so to *work* on a round in
   another worktree, run the CLI with that worktree as the working directory.

   **Say which knobs are the question**, and which are a detail riding along — the panel
   draws the two identically, so nothing on screen tells them apart.
   `references/comparing.md` says why that one sentence decides what gets answered. A
   wireframe round can put it on the design instead, with `WireAsk`, where it survives a
   context clear — `references/wireframe.md`.

   **Write down what they say, as they say it.**

   ```
   atelier note "Split Rail is the direction; the totals column is what sold it"
   atelier note "rejected One Sheet — reads as a receipt, not a decision"
   ```

   A note is one line appended to the round's `notes.md`. This is the cheapest thing in
   the tool and the only one that survives a context clear: the `.tsx` files keep the
   designs, but nothing keeps *which one they liked and why*, and reconstructing that
   from the files is impossible because it was never in them.

   **Notes are not only theirs.** Write down what *you* decided too — a direction
   abandoned and why, a round rendering against live code that will stop working when
   the app moves, a question the round turned out not to answer. `atelier brief` prints
   the lot, and by the time anyone reads them nobody remembers who said which.

   **They can write their own, by pointing.** The Pin cell in the header turns the design
   into a surface that catches clicks: they click a spot, type one line, and it lands in
   the same `notes.md` carrying what the point resolved to — the element, its own text,
   its size, and any knob already filed under the region it sits in. So a line in a brief
   that ends `⟨ledger · button[submit] "Continue" · 148×32 · at 24,412⟩` is theirs rather
   than yours, and the bracket is the part you act on. **Read the bracket before asking
   which one they meant** — a pin exists precisely because the answer was hard to say in
   words, and asking for it back in words spends the whole thing.

5. **When they pick one**, record it:

   ```
   atelier pick checkout-flow/v2/split-rail
   ```

   That writes the design again into a round called `final`, with every output
   knob replaced by the value chosen for it — no `controls` and no panel. A knob
   marked `state` stays live in the file's own state instead, so a design with a
   control in it still moves after it is settled, and one that writes an *unmarked*
   knob is refused rather than settled with a dead control. It renders like any
   other design, so the user can look at the settled thing directly, and it reads
   top to bottom with no JSON to cross-reference. The round's notes are copied in
   beside it, because the values are only half of what was decided: a CSS fix that has to happen in the app, a question left open, a
   bug the round found are all things no value can state.

   `--set k=v` overrides a value, `--values <file>` takes a set from somewhere
   other than `saved/`. Picking again **swaps** what is there, since a study
   usually settles on one design; `--add` keeps the others, for a study that
   genuinely settled on two.

   **If they change their mind about a study, update the pick or remove it.**
   `atelier pick` again to update, `atelier prune <study>/final` to remove.
   Neither is optional. A settled round says *this is what was chosen* and it is
   committed like the rest of the study, so one left behind after the decision
   moved is a file asserting something untrue to everyone who reads the repo.

   Then **implement the real thing in the actual source tree**. `.atelier/` is
   scratch space — production code never lives there, and a settled round is still
   a design: the data is invented, nothing fetches, nothing fails, and the
   structure argues rather than being built to be maintained.

   **A specimen set freezes whole by default, and `--specimen <name>` takes one.**
   Which you want is the inventory-or-comparison question and only you can answer
   it: an inventory ships every state, so freezing the set is right; a comparison
   had a winner, so hand over the winner.

   ```
   atelier pick empty-state --specimen framed
   ```

   Picking one **drops the knobs the others owned** — the unscoped globals stay,
   so does any scope nobody claims, and so does this specimen's own. That is the
   rule `references/specimens.md` already states for the `json` action on a
   caption, and it is the reason to declare `scopes` when candidates compete: a
   set that declares none owns nothing, so nothing is dropped, and the handoff
   carries the losers' knobs with no way to tell.

   **If the round has to reach someone who is not at this checkout**, export it:

   ```
   atelier export checkout-flow
   ```

   One HTML file holding the round — the real gallery, with the designs live and
   opened on the values that were saved. It needs no Node, no checkout and no
   server, so it can go in a pull request or a message to someone who has never run
   atelier. The round itself is committed, so a colleague with the repo can already
   open it; this is for everyone else — a reviewer on the web, someone without a
   checkout, anyone you would otherwise be sending screenshots to.

   It lands in `.atelier/.exports/`, which is ignored like every other derived
   thing here — so it costs the repo nothing and there is nothing to tidy up
   afterwards. Send it somewhere deliberate with `--out` when it is going to be
   committed rather than attached. The command prints the path either way.

   It is read-only: there is nowhere for a static file to save to. `--tweakable`
   leaves the control panel live for someone who should be able to explore the
   space rather than just be shown the answer.

   **They can do it themselves, and sometimes they should.** Export is a cell in the
   gallery's header, right after Prompt — the round from its grid, a design alone from
   focus, with the same read-only, tweakable, sealed and R2 choices. It runs this
   command, so the file is the same. The difference is what goes into it: the cell
   offers to save any design whose on-screen values differ from `saved/` first, where
   this command ships what was saved and not what they are looking at. A password
   generated there stays on their screen until they dismiss it, and never reaches you.

   **Name a design instead of a round and that design goes out alone:**

   ```
   atelier export checkout-flow/v2/quiet-ledger
   ```

   The design and nothing else — no library, no round beside it, no claim, no why,
   no notes, no panel. Its own frame decides how it sits in the window: a page or a
   fit fills the browser, a declared width is centred at that width, and a specimen
   set arrives as the sheet. The tab takes the design's `name`.

   The two are for different readers, and the difference is the argument. A round
   is for someone choosing — they need the alternatives and the reasoning that came
   with them. A design alone is for someone being *shown* a position: a client, a
   stakeholder, anyone for whom the other three directions are noise and the
   internal reasoning is not theirs to read. Reach for it when what you want to
   hand over is the thing rather than the case for it.

   It is fixed at the values that were saved, and `--tweakable` is refused: the
   panel is part of the gallery, and there is no gallery in this file.

   `--password` seals it: the file is encrypted and asks for a password before it
   will render, and the command prints the password once — four words,
   `visa-unpaired-wagon-outspoken`, because it gets read down a phone and typed back. Reach for it when a round
   is going somewhere you do not control — a link, a shared drive, an inbox that
   forwards. The gate is inside the file, so it holds wherever the file goes,
   including off a disk. It is a lock against someone who should not wander in, not
   against someone determined: whoever holds the file can guess at it forever, and
   the only way to change the password is to export again.

   `--r2` puts it on the internet and prints the link. It goes through the account
   holder's own `wrangler login`, so atelier never holds a credential, and it does the
   one-time setup itself — creating the bucket and turning on public reading. Every
   round lands at the same shape of address, `<repo>/<study>-<round>.html` — and a
   design at `<repo>/<study>-<round>-<design>.html` — so a link
   is guessable, stable when the round is republished, and unchanged but for its host
   if the bucket ever moves. **Pair it with `--password`** unless the round is one you
   would be happy for a stranger to read.

   The bucket is **one per owner**, named after the git remote —
   `atelier-exports--<owner>` — and created in the account already logged in, so it is
   theirs and not atelier's. A repo with no remote has no owner to be named after, so
   one is invented — `atelier-exports--barn-tableful-survivor` — and written to
   `.atelier/atelier.config.json` so it never changes again. One bucket rather than one per repository because R2
   gives each bucket its own public hostname, and repositories are kept apart by the
   key instead; expiry still works per repository, since lifecycle rules are scoped by
   key prefix. `--bucket <name>` overrides it, which is the answer when a name is
   already taken, when there is no remote to name one after, or when a team keeps its
   exports somewhere already decided.

   **`atelier shot <ref> --r2` publishes a picture** to the same bucket, at
   `<repo>/<study>-<round>-<design>.png`, so it sits beside the round's own export and
   the link is guessable from it. It takes the same `--bucket`, and it publishes the
   file `shot` just wrote, whatever qualified it — a `--sweep` sheet, one `--specimen`,
   a `--scope` crop or a `--set` combination all go up as captured.

   **It renders for a person, because that is who opens a link.** Every other default
   on `shot` is priced for an agent reading the picture back, and the two that would
   cost a human something move: the capture is taken at `--dpr 2` rather than 1, and a
   contact sheet is no longer squeezed to fit one agent-sized image — a three-value
   sweep of a page design comes back with each tile at full size instead of a 2.6×
   downscale of each. Name `--dpr` or shoot without `--r2` to get the cheap picture
   back. Expect a published sheet to be several thousand pixels wide and a few hundred
   KB; that is the right size for something someone clicks to zoom, and the wrong size
   to read back into a conversation.

   **It is for putting a picture in a pull request**, which is the one place an export
   cannot go: the link serves `image/png`, so `![](<url>)` renders inline in a
   description, a comment or an issue, where an HTML attachment is a download prompt at
   best. That is also the honest reason it exists rather than dragging the PNG into the
   comment box — dragging needs hands, and an agent that has just shot a design has
   none.

   ```
   atelier shot checkout-flow/v2/ledger --r2
   ```

   Three things to know before leaning on the link.

   **Republishing does not reliably refresh a picture someone has already been shown.**
   The key is stable — no date, no content hash, not the width and not the specimen — so
   shooting that design again with `--r2` replaces the object at the same address the
   moment the command returns. What a reader sees is a different question. A host that
   renders images inline generally proxies them to a domain of its own first, GitHub
   included, and then serves the copy it took: the comment you republished to fix goes
   on showing the old picture. Post a new comment, or hang a throwaway `?v=2` on the
   URL. Another republish is the one thing that will not help.

   It cuts the other way too, and that is the half worth relying on least. A proxy is a
   cache and not an archive, so it may re-fetch whenever it likes — an old comment is
   *usually* frozen at what it was posted with, never guaranteed to be. So a published
   shot is **the current picture of that design** and not a record of what a review saw.
   When the record is the point, `--out` it under a name of your own and attach the
   file, where nothing can replace it.

   **It cannot be sealed.** A gate rides inside an exported HTML file; a PNG has nowhere
   to put one, so the link is the whole of the access control and anyone who finds it
   can read it. `--password` does not apply here and there is no substitute.

   **The ref has to name a design.** A bare ref shoots a whole round, and six pictures
   should not reach a public bucket because a word was left out. `atelier shot
   checkout-flow --r2` refuses and prints the ref it wanted.

   Prefer `atelier export` whenever the reader could open an HTML file. It ships the
   round live and on its saved values, where a shot is a picture of the declared
   defaults unless `--set` says otherwise — so a link to a *round* is worth more than a
   link to a picture of one, wherever both are possible.

   A machine that unlocks one is offered the chance to be remembered for a week, so a
   round under review is not a password hunt every morning. What it keeps is the
   derived key rather than the password — same access to that one file, nothing
   reusable anywhere else. Untick the box on a machine that is not yours, and open the
   file with **`?forget`** to make it ask again, which is the only way back once a
   machine stops being prompted.

   **A round that no longer renders cannot be exported**, and says so — naming the
   file and the symbol. That is deliberate: an export is read by someone who cannot
   check it, so failing is better than shipping a convincing picture of a design
   that stopped working.

6. **Then look at what you built, and stop using this skill for it.** Once the design is
   a real component in the real source tree it has real props, and checking it is a
   **proof** rather than a round — one throwaway file importing it, `atelier check` to
   prove it renders, `atelier read` for the geometry, `atelier shot` when you need to see
   it. The **`atelier-proof` skill** has the whole of it. Do not open a v2 to inspect your own
   implementation, and do not boot the host application for it either.

## When they come back with something

The gallery is live, so most of what comes back is not a round. Sort it by altitude
before you touch anything:

| what they said | what it is |
|---|---|
| a value inside the design's argument — narrower, softer, less round | a knob they should be dragging. If it is not one yet, add it; the page reloads on save |
| a change to what the design *argues* — "what if the totals moved left" | a new design, in a new round |
| "yes to this one, now go finer" | v2, with round 1's saved answers written in — `references/comparing.md` |
| it did not render, or it renders wrong | edit it in place. v1 is the record of what was *shown*, and a design that never drew was never shown |
| "drop that one" | usually nothing to do. A direction ends by not being carried into v2, and the round keeps what lost because that *is* the comparison. `atelier prune <study>/<round>/<design>` is for a file that should never have existed — a duplicate, or one written against the wrong position — not for one that came second |

Only two of these open a round: a change to what the design *argues*, and *now go finer*.
The first row is what the panel is for, the render fault is a repair, and *drop that one*
is usually nothing at all — treating any of them as a round spends a rebuild answering a
question the user never asked. The failure that costs most is the first row misread as
the second: a round trip and a new round to settle something they could have settled by
dragging.

A round opened from the second row goes through the same gate the first one did: propose
the positions and get them approved before writing anything. What they said is usually one
of them already, so this is a short message rather than a fresh interrogation — but the
other positions in a v2 are still yours until somebody agrees to them.

**A pin sorts itself for the first row.** What lands in `notes.md` from the Pin cell
carries the knobs already filed under the region it hit, so a note saying *this should be
bigger* with `knobs: card.size` in its bracket has answered its own altitude question —
that is a knob they should be dragging, and the honest reply is to say so and point at it
rather than to build anything. An empty knobs list is the opposite signal: there is
nothing to drag, so the row is real.

**And if what they are pointing at is the shipped component rather than the mockup, none
of these rows apply** — that is a proof, not a round — the `atelier-proof` skill. A study is for choosing between
things that do not exist yet; a look at what already ships has its own skill.

## Picking the work back up

If the conversation was cleared or compacted, **do not read the round back**. A round runs
to tens of kilobytes of `.tsx`; almost none of it is the argument, and re-reading it is how
a session that already ran out of context runs out again.

```
atelier brief checkout-flow
```

That prints, for every design in the round: its name, claim and reasoning, every knob
with its default, the values the user actually saved marked `←`, anything the manifest
lint objects to, and the notes. It is read out of the running designs, so it cannot
drift from what the gallery shows, and it is smaller than the round it describes by
something close to two orders of magnitude.

**A ref always briefs the whole round**, at every level. Naming a design —
`atelier brief checkout/v1/quiet-ledger` — marks it `→` and says the question was about
it, while still listing its siblings, because in a round of thin designs the
alternatives *are* the question. Name a design to aim attention, not to hide the rest.

Read the `.tsx` only when you are about to edit it — and then **edit it**. A knob is a
few lines; re-emitting the whole file to add one is the second most expensive habit
here, and it is the one that follows a context clear, because the file no longer feels
like yours. It is. Add the lines.

## The design format

Three exports. That is the entire contract.

```tsx
import { defineControls, defineMeta, type Props } from 'atelier'

export const meta = defineMeta({
  name: 'Quiet Ledger',
  claim: 'One column, receipt-like',
  why: 'Totals are the only thing anyone checks twice, so nothing competes with them. Costs you the side-by-side comparison a table would give.',
})

export const controls = defineControls({
  // The subject's own knobs, unscoped.
  radius: { type: 'enum', options: { sharp: 'rounded-none', soft: 'rounded-md', pill: 'rounded-full' }, default: 'soft' },
  pad: { type: 'enum', options: { sm: 'px-3 py-1.5', md: 'px-4 py-2', lg: 'px-5 py-3' }, default: 'md' },

  // A scope: a part of the design that needs its own answers.
  solid: {
    bg: { type: 'color', options: { brand: { value: 'bg-brand-600', swatch: '#4f46e5' } }, default: 'brand' },
    label: { type: 'color', options: { white: { value: 'text-white', swatch: '#ffffff' } }, default: 'white' },
  },
})

export default function Design({ radius, pad, solid }: Props<typeof controls>) {
  return (
    <button className={`${radius} ${pad} ${solid.bg} ${solid.label}`} data-atelier="solid">
      Continue
    </button>
  )
}
```

**One design is one `controls` export and one `saved/<design>.json`.** Knob values are
stored per design and nothing ties two designs together — which is why candidates that
have to be judged at identical settings must be `specimens` of one design rather than
designs of their own.

Values reach the component **as props and nothing else**. There are no CSS variables and
no second channel. An injected replacement is not an exception: it gets its knob values by
closing over the design's props, which is why `inject()` is called in the body. There is
no `useAtelierValue()` and there will not be one — a design never *reads* a knob except
through its props.

### A design can write a knob back — `useTweak`

The other direction is open, and only that one. A design with a real control in it — a
tab strip, a segmented switch, a disclosure — can put the value it was clicked to into
the knob it came from:

```tsx
import { defineControls, useTweak, type Props } from 'atelier'

export const controls = defineControls({
  view: { type: 'enum', options: { list: 'list', grid: 'grid' }, default: 'list', state: true },
})

export default function Design({ view }: Props<typeof controls>) {
  const setView = useTweak('view')
  return <Tabs value={view} onSelect={setView} />
}
```

The knob stays the only state. The panel moves with the click, `--set view=grid` still
reaches the same state without one, and `saved/<design>.json` records what was on screen.
**Do not use `useState` for this.** A design holding its own copy has two truths — the
panel says one thing, the screen shows another, and the saved file records the panel's —
and nothing anywhere reports it, because both halves are behaving.

Five things to know, and the first decides whether the design can be settled at all:

- **Mark the knob it writes `state: true`.** A knob a control in the design moves is where
  you were standing rather than a decision, so it is a state knob — and `atelier pick`
  refuses a design that writes an *output* knob, naming it, rather than freezing it under a
  control that would go dead. `references/controls.md` is the account of the two kinds.
- **Call it in the design's own body.** The picked file declares the setter there, so a
  `useTweak` in a helper component is refused; pass the setter down instead.
- **Write the option's name, not the value it resolves to.** State records `grid`; the
  props carry whatever `grid` maps to, so a design cannot read its own prop back as a
  name — keep the names in a list if you need to map over them. Writing the resolved
  value throws rather than rendering something subtly wrong.
- **A scope takes a dotted path** — `useTweak('solid.bg')`. One level, like the manifest.
- **A path that names no knob is reported by `atelier shot`**, and the write throws when
  it happens. Neither is silent.

Reach for it when the *interaction* is what is being judged. When it is the states, reach
for `specimens` instead — a knob you can click is still one state on screen at a time,
and four states of a field want four papers on one sheet. This is not permission to turn
every state into a switch.

**A prototype draws the line in a different place**, and it is the one round that does:
navigation is knobs, everything below it is `useState`, because a design built to be
clicked has more interactions than a panel can hold. `references/prototype.md`.

If you need a variable — for `:hover`, `:focus`, a media query or a pseudo-element —
declare the one you need where you need it:

```tsx
<div style={{ '--accent': accent } as CSSProperties} className="hover:bg-[var(--accent)]">
```

### A component the host's server renders — `RemoteComponent`

A thing with no React form — a Rails ViewComponent — goes on screen through
`RemoteComponent`, with `component` naming what the host renders and `props` carrying
exactly what the host receives. The knobs tune it like any other design and every change
to `props` renders again on the host. It needs a `remoteComponent` key in
`.atelier/atelier.config.json`; `references/remote.md` covers what the endpoint has to
be, how a host whose port differs per worktree is found, what an export carries, and why
such a round cannot be exported tweakable.

### The manifest is one level deep

The root of the manifest **is the thing you are designing**. In a button study,
unscoped means the button.

Scope when two things on screen need different values for the same knob — otherwise the
knob is a property of the subject, and scoping it just adds a word. On a greenfield page
the scopes are roles (`heading`, `body`, `cta`), not components. Two levels means the
design has a nesting problem; the harness will tell you so.

### Every scope must be tagged

```tsx
<h1 data-atelier="heading">
```

The attribute is what connects a panel section to the thing it controls. Declaring a
scope is the opt-in: it asserts there is a thing on screen, so it has to be named there,
and a scope with no tag is reported.

**The reverse is not true, and tagging widely is encouraged.** `data-atelier` is also how
you *address* a region — `atelier read --scope totals`, `atelier shot --scope totals` —
so tag anything you might want to ask about later, whether or not it will ever hold a
knob. Nothing warns about a tag with no scope: the cost of tagging a region is meant to
be nothing, because pointing at what you just changed is the most common thing you do.

It is not an id. A scope appearing in four cells of a specimen grid tags all four, and
`read` reports each of them.

**Name it for what it is, not where it sits.** `totals`, `heading`, `cta` — a role
survives the layout moving and `right-column` does not, and the name is what you type six
turns later, once the column is on the left. These are also the words you and the user
use pointing at the screen, so pick ones a person would say out loud.

**A manifest scope is always a tag; a tag is usually not a manifest scope.** That is the
asymmetry above said once more, because one other place says `scopes` and means the
manifest kind specifically: a design exporting `specimens` can attribute its knobs to one
competing candidate with a `scopes` array, and only a declared scope can be attributed.
`references/specimens.md` has it.

That is the contract. **The five control types and their fields are in
`references/controls.md`** — along with how many knobs the design space wants and how to
bundle several values under one name. Do not guess a field name; the manifest lint will
catch it, but a round trip to learn `min`/`max` is a round trip.

### Naming a design, and saying why

`meta` is how a design introduces itself. The gallery is built around it — the name
titles the tile, the claim sits underneath, and the reasoning fills the rest of the
cell. A design with no `meta` shows as an unnamed tile with a visible gap where its
argument should be, which is deliberate: it should look like an omission.

| field | what it is |
|---|---|
| `name` | What the design is called. **"Bureau", not "Option A".** Defaults to the filename. |
| `claim` | One line: the position it takes. A headline, not a sentence. |
| `why` | Two or three sentences arguing for it — **including what it gives up**. |

Named designs can be argued about; `a`, `b` and `c` can only be pointed at. The claim
is what the user repeats back to you when they choose one, so make it the thing you
would defend, not a description of the layout.

`meta` also carries what the design is *for*. `minWidth: 768` — or `desktopOnly: true`,
which is shorthand for a `minWidth` of 1024 — disables the viewport presets the design was never drawn for,
instead of letting a 390px preview look broken. Say it out loud at handover too: "these
three are desktop-only". **Pages only** — a widget has no viewport to put a floor under,
and the checker says so.

That pair is also the shape for the common case where a design is a whole screen and the
viewport is *not* the question: a page, composed at desktop, with the presets it was never
drawn for switched off. Responsiveness is one reason to reach for a page, not the
definition of one — `references/specimens.md` opens with both lists.

### Colour arithmetic is in the box — do not rewrite it

`atelier` exports six functions. Import them the way you import `defineMeta`.

```tsx
import { alpha, blend, contrast, luminance, mix, readableOn } from 'atelier'

contrast('#ffffff', '#4f46e5')            // 6.29  — WCAG 2.2, order-free
luminance('#f5b512')                      // 0.53
alpha('#18181b', 0.1)                     // '#18181b1a'  — what you set
blend('#18181b', 0.1, '#ffffff')          // '#e8e8e8'    — what you can measure
mix('#000000', '#ffffff', 0.5)            // '#808080'    — t of the way from a to b
readableOn('#f5b512')                     // '#000000'    — by measurement, not by guess
```

**Write these by hand and you will get them wrong quietly.** The WCAG luminance formula
was hand-written once for a round in this repo and shipped with the blue channel skipping
its gamma transform — white came out at luminance 19.34 instead of 1, so every ratio on
the sheet was inverted. It rendered. It looked plausible. Nothing failed.

Three things worth knowing before you reach for them:

- **`contrast` throws on a translucent colour** rather than ignoring the alpha, because
  the ratio depends on what is behind it. That is what `blend` is for, and why `alpha` and
  `blend` are a pair: one gives you the value to put in the CSS, the other the flat colour
  you can measure.
- **`mix` is sugar over `blend`**, so there is no colour-space choice hiding in it — sRGB,
  the same as `color-mix(in srgb, …)`. Two distant hues go muddy through the middle, which
  is the space rather than a bug. Tints and shades against white or black are unaffected.
- **`readableOn` returns the better ink even when neither clears 4.5.** If you need to know
  it failed, ask `contrast` yourself.

**There is no `lighten`, no `darken` and no scale generator, and that is deliberate.** The
first two mean nothing without naming a space and an amount convention — say
`blend(c, 0.2, '#fff')`, which states what it does. A modular type scale is worth knowing
the argument against: it breaks *downward*, since UI needs 12/14/16 (a ratio near 1.15)
while headings want 1.25–1.5, and one ratio cannot serve both. At 1.5 from a 16px base the
caption step is 10.7px. Every mature system generates and then hand-tunes the small end;
Material 3's shipped sizes run 1.14, then 1.375, then 1.25. Pick the numbers.

The line for anything added here: **arithmetic with a specification behind it, never
anything with a taste in it.** How many steps a ramp has, what a swatch grid should look
like, which pairs are worth checking — those are the design question, and they are yours.


## Rules

- **Fixtures must include what breaks layouts.** The longest realistic string, the zero
  state, a three-digit number, the missing avatar. Content that is all median length is
  how a design passes review and fails in production.
- Imports use the bare specifier: `from 'atelier'`. It resolves from any depth.
- Files named `shared.*` or prefixed with `_` are **not** treated as designs. Put mock
  data and helpers the options have in common in `shared.tsx` and import it relatively,
  so the designs differ in design rather than in fixtures.
- Designs are **sandboxed** by default: they do not see the host repo's components,
  aliases, or theme. **A closed-space study almost always wants to opt in** — you cannot
  copy the subject and import its neighbours without it. `references/existing-code.md`
  has the config and its two cautions, which are not the same size.
- Each design renders in its own iframe, so **width** media queries behave like a real
  browser — the design gets an actual viewport, not a div that merely looks narrow.
  Design responsively; the user has 390 / 768 / 1280 / full viewport presets.
- `prefers-color-scheme` is the exception: it follows the machine, so a design keyed on
  it has one appearance and no way to see the other. Make dark a knob —
  `references/specimens.md`, "A design that goes dark owns its own ground".
- A broken design fails in its own frame and nowhere else. In focus you get the stack;
  on the grid the design is simply marked as not rendering. Do not go looking for the
  gallery to have crashed.
- A round's *files* are self-contained. `shared.tsx`, `saved/` and `.shots/` all live
  inside it, so a later round is free to change its fixtures without disturbing the
  earlier one. That is not a promise it renders forever — a round reaching into live
  code stops working when the app moves, which is the trade `references/existing-code.md`
  describes.
- **An undefined custom property kills the whole declaration, not just itself.**
  `padding: var(--space-48)` where the scale stops at 40 leaves the element with no padding
  at all, and nothing anywhere says so — CSS drops the declaration and moves on. It reads
  as a layout that ignored you rather than a name that does not exist, which is why it gets
  looked for last. Check the token exists before hunting the rule.
- **A backtick inside a CSS comment ends the template literal.** Styles written as
  `` <style>{`…`}</style> `` are a JS string first, so a comment mentioning a
  `--property` in backticks terminates it and the error surfaces somewhere else entirely.
  Write those names bare.
- Never edit `.atelier/atelier.ts`, `.atelier/CLAUDE.md` or `.atelier/proof/CLAUDE.md` —
  all three are regenerated.

## Commands

```
atelier new <name> [--names a,b] [--count 3] [--empty]   start a study
atelier dev [--port <n>] [--open]          serve gallery + panel (blocks; run in background)
                                           already serving this .atelier? says where, exits
atelier check [ref]                        is anything broken? renders, manifest, every knob
                                           — the one command that exits non-zero
atelier read [ref]                         what a design is actually made of, as text
atelier read <ref> --scope totals          one data-atelier region — the cheapest look there is
atelier read <ref> --specimen off          one exhibit of a design that draws several
atelier read <ref> --set dark=true         read a particular combination of knobs
atelier read <ref> --css font-family       any computed property, and which face is painting
atelier read <ref> --only contrast         one advisory check on its own
atelier shot [ref]                         headless PNGs — when you need to *see* it
atelier shot <ref> --set pad=lg            render a specific knob combination
atelier shot <ref> --set heading.size=32   a knob inside a scope
atelier shot <ref> --scope fields          crop to one data-atelier region — a cheap look
atelier shot <ref> --specimen off          one specimen of a design that produces several
atelier shot <ref> --sweep gap=8,16,24     one labelled sheet comparing a knob's values
atelier shot <ref> --full                  the whole design — when a shot says it cropped
atelier shot <ref> --width 390 --dpr 2     a phone frame / retina, when detail is the subject
atelier shot <ref> --out <dir>             write the PNGs somewhere other than .shots/
atelier shot <ref>/<design> --r2           publish that one PNG and print the link
atelier proof <path> [--as <name>]         one throwaway file rendering a real component
                                           no study, no round — see atelier-proof skill
atelier proof                              what is on the proof, and how to clear it
atelier adopt <path>... [--round <ref>]    copy real components in, frozen, imports repointed
atelier inject <target> <host>             replace a component inside a live one, no copies
atelier inject <host>                      design something new inside a live one
atelier brief [ref] [--json]               the round in a page — read this after a clear
atelier export [ref] [--tweakable]         the round as one HTML file that runs anywhere
atelier export <design>                    that design alone — no library, claim, notes or panel
atelier export [ref] --password            the same, sealed behind a password
atelier note [ref] "<text>"                write down what was decided
atelier catalogue list                     every component the repo declares, and the knobs
                                           its props types imply — see references/catalogue.md
atelier list                               what exists
atelier prune                              what .atelier/ costs, split by what regenerates
atelier prune --derived                    the shots, exports and cache — all of it comes back
atelier prune <study>                      the record itself: the study, every round in it
atelier prune <study>/<round>              one round, the rest of the study kept
atelier prune <study>/<round>/<design>     one design, its saved values and its shots
atelier init                               set up .atelier/ without starting a study
```

**`atelier catalogue` is not a study and does not make one.** It is what already exists,
derived from the types and never written down — where the collection holds decisions. It
needs a `catalogue` key in `.atelier/atelier.config.json` and is absent without one.
`references/catalogue.md` covers fixtures, the wrapper a host with providers needs, and the
difference between an entry that is *blocked* and one that is *broken*.

`--empty` opens the round with no seeded files, for when you are about to write or copy
them all in anyway. `--json` gives `brief` the same content as an object — `{ round,
asked, notes, designs }` — for when you are extracting a saved value rather than reading.

Refs are loose, and every part but the name is optional. A ref with no round means the
latest one, which is almost always the round you are working in:

```
checkout-flow            checkout-flow/v1          2026-07/checkout-flow/b
checkout-flow/b          checkout-flow/v1/b
```

**`atelier prune` reads a bare ref the other way, and it is the only command that
deletes.** No round there means the *study* — all of it, every round — because deleting
the newest round and leaving the rest is a thing almost nobody means. So say
`prune <study>/<round>` when you mean one round. Naming a design removes that design
alone, along with the saved values and shots that would otherwise outlive it. Removing
one is for a mistake or a duplicate: a round is the record of what was tried, and a
design deleted for having lost leaves `notes.md` discussing something that is not there.

Use `--set` to check the extremes of your own controls — if a range goes to 32px and
the layout breaks at 30, tighten the `max` before the user finds it.
