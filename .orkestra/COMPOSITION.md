# What the composer cannot work out for itself

It is about **sequencing only**: which agents, in what order, and how many. What
each one knows, what its artifact must contain, what it may change and what has to
pass before a human sees it are all declared in `.orkestra/agents/`, by a human,
once. You are not choosing any of that.

**Each agent's `description` says when to use it.** That is the guidance, and it
sits next to the thing it describes. What follows is only what a description
cannot tell you: facts about how the engine behaves, and costs you cannot see from
where you sit.

- **One agent per step.** If a step seems to want two, it wants two steps — or an
  agent this project has not written yet, which is worth saying rather than working
  around. The same agent may appear twice; artifacts are keyed by position, so a
  second `review` does not overwrite the first.

- **A change whose whole diff is prose is one `write-docs` step, and nothing reviews
  it.** Nothing is settled by scoping a document before it is written, and a review
  step has no behaviour to read — only the words, which the person at the gate is
  reading anyway. So a scope and a review here buy two gates and two turns of
  re-reading, and change nothing. This is the one case where *include a review before
  finishing anything non-trivial* does not hold: what earns a review its gate is
  something to check other than the prose, never the size of the change.

- **Work that adds a screen or reshapes one starts with a `ui-prototype` step**,
  ahead of the planning step, whether or not the request asks for one. Left off, it
  is the step the person sends the plan back from the gate to add.

- **Review scales with how far a diff reaches.** A diff confined to one slice, with its
  checks passing, gets one `review` step whose instruction names the slice and asks for
  `code-review-lens`'s failure modes — no second reviewer, and no read of the repository
  beyond the slice. A diff that reaches a hub, or two slices, gets the review it would
  otherwise get. Read the reach from the paths the work names: the request, a plan's
  breakdown, or the files a filed step changed.
  - A **slice** is one file under `shared/src/dto/`, `src/workflow/ports/` or
    `src/app/routes/`, or one directory under `client/src/features/`, with its tests.
  - A **hub** is a `common.ts` in any of those directories, and any other file the
    slices share, such as `src/workflow/runtime.ts`. A path in no slice counts as a hub.
  - **Never reviewed lightly:** a change to the state machine under
    `src/workflow/domain/`, to an existing port's operations or errors, or to a check
    under `.orkestra/checks/` — even where it sits inside one slice.

- **A change that renders or does something at runtime gets one `exercise` step**,
  after the step that builds it and before the code review, so the review reads what
  happened as well as the code. For a change that renders, its instruction names what
  renders, and the agent screenshots it and judges the shots. The builder
  is the one session that cannot judge its own picture. Where running the work shows
  more than reading it, as with a dependency bump, the review may be light or left out.

- **A failure nobody has reproduced in this checkout gets `diagnose` and then a
  `compose` entry**, not `investigate`. That covers a failure seen in a CI run, a log
  or another branch. At the `compose` entry, add `investigate`, the fix and its review
  only when the diagnosis confirms a bug that a test here can show. When it finds
  nothing to fix — already fixed on the main line, or never reproduced — the plan ends
  there with no `pull-request` step, as investigation does below. The reason: the
  `investigate` agent carries `expect-test-failure`, and nothing a step returns skips
  it, so an `investigate` step planned before the bug is confirmed has no honest way
  to finish without a person.

- **A plan that changes how anyone works here ends with a `write-docs` step**, after
  the last step that touches code and before the pull request. The test is whether an
  agent starting fresh would have to know what this work established — a surface, a
  convention, a boundary, a tool, a rule that moved. It is a sweep and not a
  correction: it reads the finished branch and writes what everything built after
  this now has to do, which is why it goes last rather than beside the work. Nothing
  reviews it, on the bullet above.

  **A builder fixing what its own diff made false is not this, and does not replace
  it.** A comment, a path, a sentence about the thing it changed — those ride along in
  the change and never buy a step. What a builder cannot see is that the work obliges
  every future change to something new, because it is standing inside one.

  **A change to the keys an `.orkestra/` file accepts carries its `docs/` page in the
  same step** — the step that changes the format, not a `write-docs` step after it.

- **A step whose document is sent outside this checkout goes last.** Some agents
  declare a script that runs once their step's work is on the branch, and the gate
  approving the document is what sends it — `pull-request` is the one here. Nothing
  tells you which agents those are and you do not need to know: what matters is that
  a step planned *after* one describes work the sent document could not have covered,
  so the thing outside is wrong until somebody runs that step again.

- **A plan whose work changes a tracked file ends with a `pull-request` step**, and
  the rule above is what places it. That default needs no reason; leaving it off does.
  A plan that changes nothing on the branch is the exception — investigation,
  research, a question answered — because its artifacts land in `.orkestra/.trak/`,
  which is not in the repository, so there is nothing to open a pull request for. Nor
  is a spawned child: its work folds back into the branch it was cut from, and the
  trak's own last step is where the pull request goes. A child that opens one anyway
  does damage rather than nothing: its branch was cut from its parent's, so the pull
  request targets the main line and carries every commit the parent made before the
  spawn, and merging it lands the child on the parent with none of its code — the
  parent's later steps then run against a tree missing the piece, holding a document
  that describes it.

- **The branch after a merge is not a base you can build on.** A trak's branch is cut
  when the trak is created and nothing re-bases it, so a step cannot sit on top of
  work that has since merged — it would read a tree that is no longer current. The
  engine holds you to it: an agent with `permission: write` is refused after an agent
  that waits on `merged` or `deployed`, and anywhere in a plan once the branch has
  gone in. Read-only work after the merge — checking the deploy, reporting on it — is
  what those waits are for. A spawn child is the same one level down: it branches
  from the parent's branch. Work that has to **change** anything after a merge is a
  **new trak**, not a later step and not a child.

- **A spawn is the only way two things run at once**, and it costs a setup and a
  review per child against turns that would otherwise have run one after another.
  It is for pieces that do not need each other's output; anything where one piece
  would want to read another's result is a sequence, and a sequence is what steps
  already are.

  **A plan that indexed `Pieces` has already made that call**, against the code,
  which you have not read — it stated the seam between the parts, and stating the
  seam is what independence means here. Spawn them. Re-deciding it as a sequence
  because a spawn looks expensive is how the parallelism gets lost, and it gets
  lost silently: nothing downstream reports the turns that ran one after another
  when they did not have to.

- **`conversational` is the one plan entry that asks for a person in the room while
  the step runs.** Nothing else asks for that, and asking for it where the work is
  settled buys a wait and changes nothing. A request to explain something is not
  settled work: it is answered at a conversational step rather than built.

- **A step that raised something has done its work.** Its artifact is filed and kept,
  and what you propose starts after it — so plan around what it raised rather than
  re-proposing the step. What it raised may well mean the steps planned next are
  wrong; dropping or replacing them is yours to do, and handing the tail back
  unchanged with one entry added is the ordinary answer.

- **A correction is answered by work, and by a step that can act on it.** It names
  the work owed behind a document, so the step that settles it is the one that does
  that work and re-files the document as a by-product — give it `continues` naming
  the same key, which puts it in the conversation that produced it. **Never onto a
  step that judges that document**: a reviewer resumed into its own conversation is
  marking its own homework, and nothing in the engine stops you.

  A planning step reads code and asks questions, neither of which you have done.
  **Getting work back from one is the system working**, not a plan you should have
  proposed differently.

- **A unit that names a choice is a question, not a step.** Two paths with a real
  tradeoff, or a fix that moves logic across a boundary, is for the person waiting
  to settle — ask, rather than picking one and planning it. And a thing you are
  planning a fix for the third time is telling you the narrow fix is not working:
  propose the one that closes it, even where that is bigger than the unit describes.
  **Give it its own entry.** A sweep appended to two named fixes is the half that
  gets skipped — the named ones are legible and terminate, and the clause after them
  gets a glance.

- **When a person asks you to replan a slot that is still owed its work, work up
  the ladder.** The same agent with a fresh session and an instruction naming what
  to do differently, then a *different* agent, then a smaller piece of the same
  job, then a question to the person waiting. What makes any of these work is the
  fresh context, not the model — every agent here runs on the same one.
