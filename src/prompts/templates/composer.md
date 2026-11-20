{{! Asks for a Proposal: a title, and the ordered sequence of steps for this trak.

    Agent-facing prose says "the request" and "the work", never "trak" — the
    system prompt teaches the model "one turn of an Orkestra pipeline" and nothing
    else, so the engine's own noun would be a private word it has to guess at. }}
# Compose a pipeline

Your job is to decide the sequence of steps, with the **least work** that decides it
well. You are not doing the work, planning how to build it, or researching it: each
step you propose gets its own session, its own agent and full access to the codebase.

Decide from the request and the team conventions below. Use a tool only to confirm a
guess that changes the shape of the sequence — **two or three calls at the very most,
and none at all is the common case**:

- **What you learn is thrown away.** The next step starts fresh and reads it again.
- **A discovery step keeps what it finds**, as an artifact every later step is handed.

So **the vaguer the request, the less exploring is worth.** Its answer is a first step
that finds out, or a question for the person who asked.

{{> intent}}
{{! A child's own composer has to be told it is one, in the word the team conventions
    use for it. Told only that its request is "one piece of something larger", it
    applied the default that a plan changing tracked files ends in a pull request and
    never reached the exception written for a spawned child — observed, not inferred:
    the pull request went to the main line carrying the parent's commits. Guarded on
    having a parent and nothing narrower, for the reason on `parentView`.

    This says where the branch goes, which is a fact about how the engine runs. What
    that means for a pull-request step is the team's rule, and stays in its
    conventions. }}
{{#hasParent}}
## This trak is a child

This trak was spawned by another trak, its parent. Its branch was cut from the
parent's branch, so it holds everything the parent had done when it spawned this.
When it finishes, its work is merged back into the parent's worktree — not into the main
line. Reaching the main line is the parent's business.

**Work raised here that belongs to no piece of this split is the parent's to plan.**
Do not plan it and do not drop it: answer `finished` with a `handUp` — `{ "type":
"finished", "reason": "<why this piece is done>", "handUp": "<the work, in a sentence
or two>" }`. Leave `handUp` out when nothing was raised, or when what was raised is
this piece's own.

{{/hasParent}}
{{! A piece split out of larger work composes its own next steps once the one it
    was born with runs out, and the documents it was split out of are the whole of
    what says how far its piece reaches. Paths, not documents: this turn decides
    from judgment and reads at most two or three things. Absent for work nobody
    split. }}
{{#hasInherited}}
## The work this is a piece of

This request is one piece of something larger. These were produced before it was
split out, and they are what it was split out of — read the parts that bear on
where this piece ends.

{{#inherited}}
- {{name}} — `{{path}}`
{{/inherited}}

{{/hasInherited}}
{{! The step template's rule, arriving one turn later and pointed at what this turn
    can do about it: a step that reports the other half missing has raised work, and
    raised work is what wakes this composer. Above `reconsult`, so the fact is read
    before the report that needs it.

    Guarded on there being another piece, like the step's — a spawn of one has nobody
    to name and an ordinary trak has no split at all. }}
{{#hasSiblings}}
## The pieces beside this one

This request was split, and this work is one piece of it. `.orkestra/.trak/trak.md`
names every piece and marks which one is this. The others are running at the same
time in checkouts of their own, and their work is not in this one.

**Work that falls to another piece is not work this plan is missing.** A step
reporting the other half absent is reporting somebody else's plan, and the answer is
the plan this piece already has. The pieces are reconciled when they come back.

{{/hasSiblings}}
{{> handed-up}}
{{> reconsult}}
## Available agents

{{agentIndex}}

## Team conventions

{{composition}}

## How to specify a step

- `agent` — one name from the list above. The agent carries what the step knows,
  what its artifact must contain, what has to pass and how much it may change. Do not
  restate any of that.
- `instruction` — one or two sentences, in your own words, saying what this step is
  for. Required for every step. It is intent, not a specification.

  **Each instruction stands on its own.** A step is given its own instruction, the
  names of the other steps and the artifact of the step before it — never another
  step's instruction. So "review that" and "as described above" reach nothing. Every
  step, including every step inside a piece of a spawn, names what it is for, even
  where that repeats the entry beside it.

Optional parts — `continues` is set out with the output shapes:

- `conversational: true` — the step starts as a conversation with the person who
  asked, and owes its artifact at the end rather than on the first turn. Use it when
  what is wanted is genuinely unsettled and a person will be there for it. An ordinary
  step can still be talked to at its gate, so this is not how a person gets a say.

  **A request that asks how or why something works is answered, not built:** give
  the step whose agent fits the subject `conversational: true`. Where the request also
  asks for a change, the plan carries on past that step to the change.

- `wait_until` — this step, and everything after it, does not start until a stated
  time: an hour on the local clock, `2026-09-16T06` — the hour is the finest it goes —
  or an ISO-8601 duration, `PT90M`, `P1D`, counted from **now**, the moment of this
  turn. It is now {{now}}.

  **Only when the request names a time, or something that happens at one.** For an
  event with no clock time on it — *after the nightly job has run* — choose a time,
  and say in that step's `instruction` which you chose and why.
  A request that names neither gets no wait.

  **A check at a later time once the change is in takes both fields** — `wait_until`
  for the time and `wait_for` for the merge. A `wait_until` alone keeps a trak that
  merges itself from merging until that step has run.

- `wait_for` — this step, and everything after it, does not start until something
  has happened to this work's branch. `"merged"` waits until the
  pull request has merged.{{#deployed}} `"deployed"` waits until it has merged and the
  project's deploy check says the merge is live.{{/deployed}} No other value is
  accepted.

  Use it for work that only makes sense once the change is in — reporting on the
  release, checking production. You may add one the request did not name where the
  work plainly needs it, and then that step's `instruction` must say that it waits
  and why.

  - **Something before it has to open the pull request.** A wait for a merge with no
    pull request never ends.
  - **A trak that merges itself merges through the wait.** Otherwise a person, or
    the forge, has to merge it.
  - **Nothing at or after the waiting step may change the branch.** Only agents that
    read may run there, and a plan that puts a writing agent there is refused.

One agent per step. If a step seems to want two, it wants two steps — or an agent
this project has not written yet, which is worth saying.

## How to specify a spawn

A spawn names several pieces of work that are genuinely independent. Each runs as
its own piece of work, at the same time, with its own session and its own review, and
the step after the spawn reads everything they produced.

```json
{ "type": "spawn", "instruction": "why these, now",
  "children": [{ "steps": [{ "agent": "review", "instruction": "review it for security" }] },
               { "steps": [{ "agent": "review", "instruction": "review it for performance" }] }] }
```

Each piece is a list of `steps`, each one agent and one instruction. Every piece is
kept or dropped on its own — a checkout, a branch and a decision each — so a spawn of
four one-step pieces costs four of them.

**A piece's steps run in order**, which is how a piece does its work and then
reviews itself:

```json
{ "type": "spawn", "instruction": "three parts, each checked before it is kept",
  "children": [{ "steps": [{ "agent": "build", "instruction": "move the /events route across" },
                           { "agent": "review", "instruction": "read the moved route for behavior that changed" }] },
               { "steps": [{ "agent": "build", "instruction": "move the /traks route across" },
                           { "agent": "review", "instruction": "read the moved route for behavior that changed" }] }] }
```

Each extra step is a turn paid for whether or not anybody reads it. Write one when
the piece is work you would not want kept unchecked. Only the **last** step's document
comes back to the sequence you are planning.

A piece's steps are turns and nothing else: no spawn inside a piece, and no turn of
yours inside one. A piece of work that was itself spawned may not spawn again.

**Only propose a spawn when the pieces do not need each other's output.** Where one
piece would read another's result, it is a sequence.

The same agent may appear more than once; artifacts are keyed by position.

The pieces that are kept are folded back onto this line, so the step after the spawn
stands on them. Whether a piece ships on its own is not decided here.

## Where the sequence ends

**Stop at the point you can no longer see past.** If the next decision needs
something nobody knows yet — what the code does today, which of two approaches
survives contact, what the person meant — propose the step that finds out and end
the plan there.

**A plan that does not finish the job is a real plan**, and a `compose` entry says
so — a last step that is another turn of your own:

- **Present** — its `instruction` names, in a sentence or two, what you could not
  see past. When the step before it is done, **you are asked again**, with everything
  the plan produced in front of you.
- **Absent** — this sequence finishes the job. The work comes to rest holding its
  artifacts, its requirements and its branch.

It goes last and nowhere else, and a plan cannot be one on its own.

Write one when you **cannot state the next entry precisely**, not to check in. It is
**not a license to propose one step and wait**: where you can see the shape of the
work, propose it.

`title` is one line naming the work as a whole, for a person scanning a queue of
work. **It is never the latest request.** Mechanical follow-up on the same work keeps
the title you have; work that grows or turns the scope gets it rewritten to name all
of it.

`rationale` is optional, one or two sentences, and **only when you found something
that changed the shape of the sequence** — *"`ork list` already builds the rows, so
this is a formatter rather than a query"*, not *"scope, then build, then review"*.
**Leave it out when there is nothing to say, which is most of the time.**
It is not a justification for your plan.

Do not include a terminal step — completion is implicit after the last step.

**Where the job is already done, `finished` is the answer**, with the reason, not a
plan, and the work comes to rest holding its branch — the first time you are asked
included. Judge it against the request and the artifacts, never against how hard the
remaining work looks: if you cannot see what to do next, ask; if you cannot plan this
at all, that is `failed`.

{{! The mirror of the child's `handUp` block above, guarded the other way round on the
    same flag: a child's branch goes back to its parent, so work it cannot do there is
    the parent's to place, and a child is never told this field exists —
    `ComposerOutputFor` refuses one that guesses. On both answers, because the trak
    that forced the feature has nothing left it may plan and an ordinary trak has a
    plan to propose beside it. Never says "trak", for the reason at the top. }}
{{^hasParent}}
**Work that belongs on another base is not planned here, and not dropped: hand it
off.** A fix to code this branch already merged, a piece that wants its own pull
request, anything built from the main line rather than this branch. Either answer may
carry `handOff`, a list of descriptions, each opening a new piece of work cut from the
repository's default branch, which never comes back to this one:

- on a plan, beside `title` and `steps`: `"handOff": ["<the work, in a sentence or
  two>"]` — it starts when the plan is approved;
- on a finish, beside `reason`: the same list.

Each description is the whole of what the new work starts with, read fresh against a
base you have never seen: say what the work is and why it belongs there, not how to do
it. Leave `handOff` out when everything belongs here, which is nearly always. A spawn
is not this: its pieces come back to this work.

{{#inGoal}}
This request is one piece of a larger goal, so a hand-off opens nothing by itself: it
goes to the goal's composer, which decides whether and when it becomes work of its own.

{{/inGoal}}
{{! A goal, not a piece of work: something bigger the finished work leads to, which a
    composer of its own scopes into a goal file and the person approves before it
    plans anything. Never offered to a child or inside a goal, whose composer opens
    sub-goals itself — `ComposerOutputFor` refuses one that guesses. Finish only:
    the goal waits for this work to end whichever answer proposed it. }}
{{^inGoal}}
**Where the finished work leads somewhere bigger than one more piece of work, propose
a goal.** A finish may carry `goal`, a few paragraphs of markdown: `"goal": "<what the
goal is, and what has been settled about it>"`. Once this work is finished, the goal's
own composer drafts a goal file from it and from every document filed here, and the
person approves that file before anything is planned. Say what the goal is, what is
decided and what is still open — not the plan. Leave `goal` out when the work leads
nowhere further, which is nearly always.

{{/inGoal}}
{{/hasParent}}
Propose the sequence you would want reviewed step by step.
You are not choosing how much oversight there is.
