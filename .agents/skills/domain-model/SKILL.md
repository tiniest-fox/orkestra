---
name: domain-model
description: The orkestra state machine — decide, applyEvent, replayHistory, advance, and the rules about what may move a trak. Read before touching anything under workflow/domain/, before adding an Event, Command, Decision, TrakState or Trigger, and before changing what happens at a gate or a failure.
---

# The domain model

One pure function decides everything; a thin loop does the work.

```ts
decide(trak, event)        → Decision           // pure, total, no Effect
applyEvent(trak, event)    → { trak, decision } // record facts, then decide
replayHistory(id, history) → Trak               // state is derived, never stored
advance(id, event)         → Effect<Trak, …>    // the ONLY way state changes
```

Every command's completion produces the next event, which re-enters `advance`.
**Nothing polls the log.** The daemon has two timers. The condition sweep
(`src/app/conditions.ts`) asks a resting trak's `conditions:` script again — or,
for an entry's own `wait_until`, its clock — and appends only where the answer changed:
met, given up, or a time passed with a condition still holding the step. The forge sweep
(`src/app/forge-sweep.ts`) asks GitHub about every `Finished` trak a goal opened or set to
auto-merge, and appends only an archive, a send-back or a stop — or, with no `origin`,
asks nothing and appends the local `Merged` the Merge press appends.

**`advance` holds the trak's *log* permit across the read, the decision and the append**,
and releases it before any command runs — `Locks` in `workflow/ports/locks.ts`, a pair of
semaphores per trak. A drive holds the other one, `withDrive`, for a whole turn, and
takes it at the outermost call because `advance` re-enters itself after every command and
a semaphore is not re-entrant. **The split is what lets an event land while a turn is
running**: an event that moves nothing is appended with no drive taken, so the turn
finishes on its own session and the next gate reads what the person changed.

**`advance` stamps the event's `at` before it applies it, and `stamped` keeps the first
stamp** — so the trak a command is handed and the trak the log replays agree about the
time, and `applyEvent` may read it. `Trak.planAt` is exactly that: the `at` of the event
that carried the plan, and what every `wait_until` on the unrun tail counts from.
`Store.append` fills one for anything appended around a drive; a site that *overwrote* a
stamp would move a time the trak was already derived from. `versioned` puts the engine
version on the three events that end a turn — `ComposerReturned`, `AgentReturned`,
`TurnFailed` — at the same append, first stamp winning, because the shipped roles a turn
runs under change with the engine rather than with the repository.

## `Decision` has exactly three cases, and there is no fourth

- **`Advance`** — new state, run these commands
- **`Await`** — park; someone owes us an event
- **`Settle`** — the engine does nothing further on its own

"New state, no commands, no reason" is unrepresentable, so a stalled trak cannot be
expressed. If a transition won't fit, the transition is wrong — don't add a case.

## `Settle` is not "immutable"

**`Finished`**, **`Closed`**, **`Merged`** and **`Abandoned`** are the at-rest states.
`atRest` in `domain/trak.ts` is the one place that says so, and both `Reentered` and
`Abandoned` route on it.

**`Failed`** is where a trak stops *until a human says otherwise*: it keeps its
worktree, records `kind` (`agent` · `provider` · `worktree` · `archive` · `merge` · `project` · `engine`), and
carries `failedFrom` so `Restarted` can re-issue the command for the position it failed
at. `project` is the odd one — a script the project wrote, declared under an agent's
`effects:`, could not do what it says — and it exists so an unauthenticated `gh` does not
read as the agent giving up on work nobody has complained about.

**Every failure is retryable, deliberately** — the alternative is the engine deciding
which ones deserve a human's time, and being wrong expensively.

**`failedFrom` is never itself a `Failed`.** A stopped trak can still be handed an
event, and an out-of-order one becomes `Failed{engine}` — file that blindly and the
trak records the *older* failure as the place to go back to, then alternates between
two failures forever.

## Nothing an agent decides moves a trak

Every `Advance` is caused by a human action — either one they took, or the one they took
in advance by choosing the trak's **run mode**. `Trak.mode` is `manual` · `smart` · `decider` · `auto`,
set by `TrakCreated`, inherited by a spawn's children, `manual` for every log written
before it existed, and changed mid-trak by `ModeChanged` — which moves nothing and is
read at the next gate. `HoldChanged` is the one-shot beside it: `Trak.holding` holds the step
running or gated when it was pressed until a person accepts it, whatever the mode says at
its gates — a spawn has no gate and is passed over — spent by `applyEvent` as that step is accepted (the commit that keeps it, a plan
entered from its gate, or rest — a child with one pending holds at `Finished` rather than
ending itself), never as a gate opens, and cleared by a change
to `manual`. Both are `reparked` in `decide`: a gate re-offered, any
other state left alone, never `unexpected`.

**`Trak.owner` and `Goal.owner` name the user the work belongs to**, set by
`TrakCreated` and by a goal's `GoalStarted` or `GoalAsked`, and routed on by nothing in
`decide`. Nothing changes it now. `OwnerChanged` and `GoalOwnerChanged` — which move nothing,
like `ModeChanged` — stay in the schema and in replay because older logs carry them. A
spawn's child and a handed-off trak take the owner of the trak they came from, a goal's trak
and a goal a trak's agent opens take their opener's. Absent is nobody named — every
trak an engine nobody hosts writes, and every log written before the field existed.

**A message sent off a gate moves nothing either, and is the one thing a park may owe.**
`MessageWaiting` puts it on `Trak.messages` and `MessageDelivered` — written by the turn
whose provider reported the model reading it — takes it off. Whatever is still there when
`advance` parks at a gate that takes `Chat` is sent as that chat with no press: `heldChat`
in `decide.ts`, asked after the decision rather than made part of it, so the log holds an
ordinary `HumanActed` and replay needs no rule. Both question gates are skipped — a
`Chat` there is `Failed{engine}`. A `StopRequested`, a `Stopped` or a `ChecksCancelled` moves every waiting
message to `Trak.returned` first, and so does coming to rest, so a stop never spends a
turn on words the person has not re-sent. `record` in `runtime.ts` is `advance` without
that chat, for a route appending from a request's fiber. On `auto`:

| gate | what happens |
|---|---|
| the plan, an artifact's approval | the press is taken — `approvedInAdvance` — except an artifact an entry planned as a conversation filed, which parks on every mode |
| `answers`, and the composer's own question gate | resumed on the same session with `Trigger.Unanswered`, which says nobody is coming, takes the option the agent marked `recommended` on each question that has one, and leaves the rest to its own judgement. Never an option it did not recommend. Bounded by `unanswered`: the position's `iterations` against `UNANSWERED_LIMIT`, then it parks after all |
| `conversation` | resumed with `Trigger.Unread` — the conversation has no other side, so file what the step owes. Bounded structurally: an `Unread` turn goes through `elicit`, whose union has no prose in it, so there is one per conversation |
| `checks` | **parks.** Approving there is taking work a script already knows is wrong |
| `stuck` | parks. Nothing is filed and the engine has nothing to say on the trak's behalf |
| `permission` | parks, on every mode and before the mode is read. Consent to a command the CLI's classifier refused is not the engine's to give |
| a **child's** ending | taken — merged where something was committed on its branch, archived where not. `endsUnattended`, and only for a child: a trak at the top would be merging into the checkout a person is standing in. `decider` takes it as `auto` does; `smart` only where nothing was committed; `manual` never. A goal's trak with nothing committed is archived on every mode — there is nothing to merge |

On `decider`, the plan and every artifact are taken as on `auto` and marked `Mode`, but
`approvedInAdvance` says no: `answers`, the composer's question gate and `conversation`
park for the person. The artifact-side stops are a plan carrying a hand-off or a finish
proposing a goal (`handedOff` and `proposedGoal`, the last rows of `STOPS` below) and an
entry planned as a conversation. Everything else in
the table above is as on `auto`.

**An entry planned as a conversation stops at its artifact on every mode**:
`plannedAsConversation`, asked in `warrantFor` ahead of the mode and after `resolving`. A
person's question of a trak at rest and New Chat's named agent both arrive as such an
entry (`conversationWith`), and nothing on it tells them from one the composer planned.

**A conflict auto-merge sent the trak back for answers every gate in advance, on every
mode**, until the trak rests: `Trak.resolving`, set by a `Reentered` whose `cause` is
`Conflict` and cleared by `applyEvent` at rest or by an `AutoMergeChanged` turning it off,
read by `approvedInAdvance`, and stamped `Resolving` rather than `Mode`. A pending hold still stands. A re-entry for failed checks
sets nothing and follows the mode.

On `smart`, **a gate goes past unless something asked for a person.** Every mode is
decided in one file — `domain/attention.ts`, the only place `Trak.mode` and `Trak.holding`
are read — and the reasons it still stops are an ordered list of named predicates there,
in `STOPS`:

| it stops when | read off |
|---|---|
| the turn reported **ambiguity** at or above the threshold | the rung in that position's slot, against `AMBIGUITY_STOPS_AT` |
| the position took more than one turn | `Slot.iterations` — a question a person answered, a check that failed, a chat the composer revised after |
| the step raised work nobody planned | the `requirements` half of the ask `withAsk` wrote into the plan, naming that step. A document sent back is the other half of the same entry and goes past |
| the round of fixing repeats itself, or is the fifth | `sameComplaintTwice` and `FIXING_ROUND_LIMIT`, both on the compose entry the entry hangs off |
| the composer handed work off to a new trak | `Slot.handOffs` on the compose entry — approving opens traks on the main line that never come back, which is the one reason here that costs more than this trak. `auto` opens them unread and `decider` stops; a finish carrying one takes this gate where a plain finish takes none. Never on a goal's trak, whose hand-off opens nothing and goes to the goal composer |
| the composer's finish proposed a goal | `Slot.goal` on the compose entry — the goal spends from its first turn once the trak finishes. `auto` lets it start unread and `decider` stops; a plain finish takes no gate. Refused at decode on a child and on a goal's trak |

**The plan gate is asked about the compose run that landed**, not about the entry
approving would enter: an entry that has not run has an empty slot, which reads as clean
and would take a gate on a plan nobody has seen. So a composer that reported nothing and
asked nothing has its plan run unread, and a round of complaint-and-fix costs no stop at
all: the verdict, the re-cut, the fix and the second verdict all go past. What bounds that
loop is `sameComplaintTwice` and `FIXING_ROUND_LIMIT`, not a person.

**`ambiguity` is a field an agent writes, and it does open a gate.** That is the rule
`clearance` broke, and two things make this one allowable: it can only *cost* a stop —
on `smart` passage is the default, so the lowest rung buys nothing the mode had not
already granted — and a false `none` is contradicted by the document it sits on, where a
confidence rating was checkable against nothing. **Nothing tells either agent what a rung
costs**; `system/ambiguity.md` describes the field in no gates at all and `prompt.test.ts`
asserts the absence. Do not "improve" that wording by explaining what the field buys.

**Absent reads as the lowest rung**, which is safe for the same reason: it grants no
passage, and reading it as the highest would stop every trak already in the database at
every gate it has left. What stops a live turn saying nothing is the refinement at the
turn — `StepOutputFor` and `ComposerOutputFor` re-prompt an agent that omits it — never a
default.

**Bounded by `check-progress.ts`'s two rules, one loop out from the checks that already
use them.** `sameComplaintTwice` is the one that decides — the same complaint said again,
compared on the words by `complaintSignature` and never on the document, because every
round complains about the one the round before wrote. A loop that finds something new
each round is a loop doing its job and is not charged for its length.
`FIXING_ROUND_LIMIT` is the backstop for what normalizing cannot see: a reviewer that
rephrases the same objection never repeats exactly. It is counted over the trak, for the
same reason the signature drops the document — a count keyed on one is a count the
composer resets by naming a different one.

**Nothing writes a `HumanActed` when a gate goes past unattended** — the engine advances
rather than recording that somebody pressed something — so `Trak.marks` is the only
account of it. `applyEvent` stamps a `Mark` from the same call the gate made
(`warrantFor`, `planWarrant`), holding what the rule *read*: the mode, or the rung the
turn reported. `Mark.Held` is the other outcome, stamped the same way: the entry a hold
held until it was accepted, which a log cannot tell from one the mode took.

**Stamped rather than recomputed, and that is the rule for anything read off a field a
person can change mid-trak.** What the engine decided is fixed at the moment it decided
it; re-derived at replay from today's `mode`, a change to `manual` would rewrite the
marks on every document already filed. **One mark per entry, by the type** — `Trak.marks`
is one map keyed by entry, so stamping either replaces the other, and a document that
carried both bands would say two things about itself. Nothing lands both on one entry
today: `warrantFor` refuses under a hold, so the mode takes no gate on an entry a hold is
standing at. The order is settled anyway, so the rule survives that refusal moving.
`applyEvent` decides it, not the surface drawing it.

Neither mark asks whether a person stood at the gate anyway, which a `smart` trak's
remaining gates make an ordinary thing to have happened; that reads `HumanActed`, so it
lives where the log is drawn — `stoodAt` in
`client/src/features/trak-detail/family/rows.ts`.

Beyond that, these exceptions:

- `SetupWorktree` after `TrakCreated`, and the first `Compose` after `WorktreeReady` —
  nothing has been proposed yet. **A trak holding a plan enters its first unrun entry
  instead**, and for the same reason: a spawn's child runs a plan a human already approved
  on its parent, a trak opened with a named agent runs the one entry the person chose, and
  a trak *re-entered* with one runs the entry that names it. The arm asks about the plan
  and never about the parent — see `onWorktreeReady`.
- `CommitWork` after the last approval — keeping the work is not a second thing to say
  yes to. Its other half, `RemoveWorktree`, is the opposite: **nothing inside a plan
  issues it** — only `Closing` or `Abandoning`, reached by a person's press, for a
  child by the run mode taking it (`endsUnattended`, above), or for a goal's trak by
  the forge sweep once its pull request merged.
- **An artifact runs its checks** before it reaches a gate: there is no point asking
  someone to read work a script already knows is wrong.
- A **failed check** re-enters its step: a human already approved it.
- An approved artifact carrying **`corrections`, or a requirement of kind
  `unplanned_work`**, composes. The other three kinds land on the trak's standing list
  and buy nothing — every planning turn is given that list anyway, so waking the composer
  would tell it nothing it will not read. **The only one caused by what an agent
  wrote**, and what makes it not an exception to the rule is
  where it sits: a person approved that artifact, having read both lists, and what comes
  back is a plan they approve at the plan gate they would have hit anyway. The agent
  bought a question, not a move.

A plan, a *verified* artifact, a stuck account, a question and a reply all park — back at
the gate they were called away from, which is what `Trak.lastGate` is for.

**`AskConditions`, `RunChecks` and `RunEffects` are unconditional**, including for an
agent that declares none of the three. The lists belong to the agent, which is
`.orkestra/` policy, and a `decide` that branched on them would either import `library/`
or replay an old log against whatever policy says today. `ConditionsMet`, `ChecksPassed`
and `EffectsRan` with an empty list are the honest record that nothing was required.

**A step's first entry asks its conditions before its turn, and only the first.**
`enterStep` asks on `Trigger.Initial` alone — every other trigger resumes a session at a
position already entered. `ConditionsMet` runs the turn; `ConditionsUnmet` rests the trak
through the door a plan running out takes, holding the entry on its slot (`Slot.waiting`,
read through `waitingAt`), and the daemon asks again on the script's interval. Met at
rest, `ConditionsMet` enters the held step. `WaitSkipped` is a person's press that enters
it with the wait unmet — every kind of wait, one that has given up included — after
`merged` is asked once more so a landed branch still refuses a writer; the step's first
prompt is told which condition was skipped. Those two and `Reentered` are the only events
that move a resting trak. A log written before the ask existed has no `ConditionsMet`, so
a turn's ending arriving in `ConditionRunning` is taken as the turn it recorded — `turnAt`.

**Re-entering a `Finished` trak whose pull request merged moves its branch first**:
`Drives.reenter` rebases the commits after the merged head onto `origin/<base>` and
force-pushes with lease, on the drive and under the trak's key, then appends `Reentered`
with `moved` in the same uninterruptible step — or refuses, appending nothing. A squash
merge leaves those commits in no history of the base, so a new door that re-enters a
finished trak goes through `Drives.reenter`, or the next pull request carries work that
already merged. `decide` never reads `moved`.

**A wait is not always a script.** `waitingAt` also returns the entry's own clock, under
the name `wait_until`, which no `checks/` script may take and none answers — so ask
`timeWaitOf` before looking a wait's name up in the library, as the sweep does. Falling
through to that lookup reads as the agent file having lost its interval, and the trak is
left alone with nothing on screen saying so.

**Nor is a wait always the agent's.** A step waits on its own time wait, then its entry's
`wait_for` — `merged` or `deployed`, read through `waitForOf` — then its agent's
`conditions:` less any name already asked, one list built in `declaredConditions`. Code
that asks whether a step waits on the merge reads the entry as well as the agent file:
the agent's list alone misses a wait the composer put on the step. Auto-merge reads the
wait the trak rests on through `mergesPastWait`, so a new kind of wait decides there
whether the merge answers it: one wrongly held never merges, and one wrongly passed
merges before what it waits for has finished.

**Idleness reads two lists in `domain/activity.ts`.** A new event a person's press or a
finished turn writes belongs in `touchedBy` or `activeBy`, or a trak it lands on stays
idle and sunk on the list. A new kind of wait is read through `waitingAt`, which `mayIdle`
asks: a wait it does not return lets the trak go idle, the sweep stops opening its log,
and the wait is never asked again with nothing on screen saying so.

**A person's `SkipChecksChanged` is honoured in the `RunChecks` handler, for the same
reason** — it is the one place the list is read. `Trak.skippingChecks` is `holding`'s
shape without its clamp: set by the event, spent by the `ChecksPassed` that names what it
skipped, offered on every mode, and never spent by a run with nothing to skip. The ending
stays inside `CheckRunning` so `gateTaken` stamps the mode's warrant exactly as a pass
earns it. A person's `ChecksCancelled` is the other press: the running check's only
ending, parking at the `checks` gate at once, with no strike and no agent turn — `recordFacts`
writes nothing for it.

**`EffectsRan` carries each effect's captured output where `ChecksPassed` carries none**,
and the difference is what the two kinds of script are: a check verifies, so *it passed*
says everything; an effect acts outside the checkout, so what it printed is the only
record that it did. **`decide` may never read it** — the world it acted on changes without
events, so a route keyed on it goes stale with nothing failing. A surface may render it,
and must render the time it ran beside it. What `decide` does read is whether
`EffectsRan` carries `skipped`: a person's skip of a failed effect, the one `EffectsRan`
accepted outside `Effecting` — from `Failed{project}`, at the step `effectFailedAt`
names — entering the next step as a run that passed enters it. It names the effect that
failed and every one declared after it, since one failed effect stops all that follow.

The check exception is unattended, so it is bounded: a repeated failure (compared on a
normalized signature) or a fourth one parks at `AwaitingHuman{kind: "checks"}`. See
`domain/check-progress.ts`.

## A requirement's id is its place in `Trak.decisions`

`identified` names an entry `<artifact key>.<ordinal among that step's>` — `3-scope.2`.
Nothing stores it, so the list's order *is* the name, and agents write these ids into
their own `supersedes` while `trak.md`, the record, the prompt and `RecordedDto` all
print them. **Never sort, reorder or drop from the list.** A step's later attempt is
unioned in by `accumulated`, which appends only what the list does not already hold
verbatim: keeping the last attempt's list instead deletes a constraint an earlier
attempt filed and nobody restated.

- **Number the whole list, then slice.** A reader showing part of it — the record,
  which leaves out what a child was born holding — numbers first, or one entry has a
  different name there than everywhere else.
- **Render the list through `standing`, not a filter of your own.** An entry another
  supersedes is left out wherever the requirements are listed, and `standing` takes ids
  already given so folding one moves no other's. The client repeats it over
  `RecordedDto`, because the wire carries the whole list.

Folding is safe only because the superseding entry restates whatever of the named one
still holds. That rule is the agent's, in
`src/prompts/templates/system/requirements.md`, and a change to either side has to keep
the pair.

## A trak's life is bracketed by its worktree

```
TrakCreated   → Preparing   → [SetupWorktree]  → WorktreeReady   → Composing
              (setup.sh, where there is one: SetupStarted before WorktreeReady, then
               SetupPassed, or SetupFailed → Failed{worktree} from wherever the trak is)
…
first entry   → ConditionRunning → [AskConditions] → ConditionsMet → AgentWorking
                                                    → ConditionsUnmet → Integrating → … → Finished, held
each approval → Committing  → [CommitWork]     → WorkCommitted   → Effecting
              → Effecting   → [RunEffects]    → EffectsRan      → the next step
                                              → EffectFailed    → Failed{project}
last approval → Integrating → [CommitWork]     → WorkCommitted   → Finished
Closed        → Closing     → [RemoveWorktree] → WorktreeRemoved → Closed
Merged        → Merging     → [MergeWork]      → WorkMerged{sha} → Closing{sha}
                            → [RemoveWorktree] → WorktreeRemoved → Merged{sha}
                            → [MergeWork]      → Conflicted{…}   → Composing
                            → [MergeWork]      → MergeFailed{…}  → Failed{merge}
                            → [MergeWork]      → WorkMerged{sha} → ConditionRunning   (held on `merged`/`deployed`: the checkout stays, `Trak.landed` is set)
                            → [MergeWork]      → ChangesDropped  → Closing{}           (a child whose parent landed: the branch's changes are dropped, its documents still reach the parent)
```

**A landed child sent back comes home again as `ChildRefiled`**, carrying only what the
parent does not yet hold — `filedSince` in `runtime.ts` reads that off the landing, which
the fold keeps whole, and files nothing when nothing is new. `decide` re-parks on it
in every state, like a change of mode; `recordFacts` folds it onto the landing while the
spawn still waits on its siblings, so the join carries it, and onto the trak itself once
the join has passed — its hand-up onto `Trak.handUps`, never as a spliced ask: an ask
written at `firstUnrun` on a parked parent stands in front of the entry a wait is holding,
and the sweep answers for the compose entry it finds there and walks past the held step.
The next composer turn, whatever asks for it, is shown the list — `handed-up.md`, in
every composer body, a resumed session's included — and the run that lands spends it. Whether the child's code merged or was dropped makes no difference to any of
this.

**A compose entry's hand-off is the birth that does not come back.** `HandOff` names the
traks and records the base; `driveHandOff` in `runtime.ts` opens each one that has no log,
cut from the repository's default branch and born holding its description and
`Trak.handedOffFrom` — no inherited documents, no split, nothing else. From its first gate
it is a person's. Nothing waits on it, joins it or reports to the trak that sent it: **the
link is drawn and never routed on**, and that is the whole of what separates a hand-off
from a spawn. A wait added to it makes it one.

**On the trak of a goal still going, `HandOff` names nothing** — `HandedOff` with no ids
and no base — and the goal's watcher (`settleHandOffs` in `app/goals.ts`) files the descriptions on the goal's
log as `TrakHandedOff`, once per compose entry, waking the goal composer to place them.
`HandOff` reads the goal's log as the gate goes past: a goal done or dropped has nobody to
place them, so its trak hands off the ordinary way. The `smart` stop cannot read that log
and skips every goal's trak, so on `smart` those open unread.

**A finish's proposed goal starts from the watcher, never from `decide`.** `Slot.goal` holds
the proposal; the trak takes its plan gate as for a hand-off, and nothing starts until the
trak is `Finished` — `goalOwed` reads no before that, so an abandoned proposal never starts.
The goal's watcher (`openProposedGoals` in `app/goals.ts`) then starts the goal on the
trak's mode and owner, with every document the trak filed on `GoalAsked.documents`, and
writes `GoalOpened` on the trak's log. **Two records make it once**: `GoalOpened` on the
trak, and `GoalAsked.call` set to `proposalCall(step)` on the goal, which a start cut off
before `GoalOpened` finds instead of opening a second. Without that lookup, a restart in
that window starts the goal twice. Refused at decode on a child and on a goal's trak.

**`HandingOff` is a state because naming the traks asks git.** The plan gate's approval
passes through it while `HandOff` runs, so a restart has a position to re-issue from and
git declining — a repository with no `origin/HEAD` — has somewhere to settle
`Failed{worktree}` from. Issuing the command beside the entry's own in a single decision
had nowhere to fail to. Nobody ever stands there.

**A conflict is the one git outcome that recomposes rather than failing.** Unmerged
paths are git's *answer* and the work disagreeing, where a dirty tree or a missing branch
is git *declining to answer* — so `Conflicted` is its own event carrying the paths as a
list. Git declining at `Merging` is `MergeFailed`, which settles `Failed{merge}` with
git's sentence kept: the checkout is fine and the fix is in the destination, so it is not
`worktree`. A `WorktreeFailed` in `Closing` or `Abandoning` settles `Failed{archive}` —
the work has run and the checkout is on its way out — and every other one
`Failed{worktree}`. The merge is
left un-issued: when the plan that answers runs out the trak is back at `Finished` with
the press on offer, because the destination is not ours and can move while the resolution
runs.

**Setup runs in the background, beside the first turn.** `SetupStarted` and
`SetupPassed` move nothing; `SetupFailed` is accepted in any state, fails one still going
and re-parks one already stopped or ending. A turn starts beside it only on a CLI whose
`CliProviderSpec.setupGate` holds its shell commands, and any other turn starts once setup
ends. A turn beside it is killed for it, and a check or an effect waits for it —
`setupBeside` in `runtime.ts`, which also starts it again for a retry or for a log that
says it started and never ended. A condition does not wait: it decides whether a step
starts, so waiting there holds a child trak's first turn behind setup. Only a trak's first
preparation runs setup beside anything; a remade sandbox or checkout runs it in the
foreground, before the work that needed the remake. A log with no `SetupStarted`
predates this: its `WorktreeReady` already means setup passed. `Setups.stop` ends the
run, writing nothing, when a press takes the drive over, and in `RemoveWorktree`.
Which preparation a trak is in — `PreparingPhase` — is never an event: `Preparation` holds
it in memory for the length of its work, and the work a restart resumes enters its own
again.

All three are **state-machine edges**, not something the runtime does around `advance`.
Setup can fail, so can the commit, so can `git worktree remove` and the project's
`teardown.sh` before it — and a trak that could not keep its work must say `Failed`
rather than report `Finished` over the top of it.
All three are re-runnable, because retrying a failed trak runs them again.

**Every kind of work that runs a command records where it ran**, as an optional `place`
on an event or transcript entry the engine already writes for that work — never a new
event, and `decide` never reads it. Take it from `Spawned.place`, and write
`Places.local()` where that is absent: a spawn on this machine carries none, and an
absent field means a log written before the place existed. New work that runs carries
the place on its live state and its DTO too, or its sandbox is invisible on screen.

**`Finished` holds its checkout.** The plan running out is not a person saying they are
done, so removal is a second decision with its own event — `Closed`, `Merged` or
`Abandoned`, which runs both halves in turn from one state. `Closing` carries the merge
commit, which is what makes one teardown serve two endings — and a plain close of a trak
that has **landed** (`Trak.landed`, set when a `merged` or `deployed` wait passes, or
when the `merged` asked once more at a skipped wait finds the branch in) carries that
commit too, so it ends `Merged`. A merge pressed on a trak held on either wait is
the wait passing rather than the ending: `onWorkMerged` keeps the checkout and re-asks
the condition, where one held on a project's own script ends as any merge does. The one trak that does not
hold is a child whose run mode takes the press — see the `auto` table above — and it
goes from `Integrating` straight into `Merging` or `Closing` on the catch-all commit,
with no `Merged` or `Closed` event, as nothing writes a `HumanActed` for a gate the
mode takes.

**The last approval only reaches `Integrating` when the plan actually ends there.** A
plan that stops short ends in a **compose entry**, so the commit before it enters a step
like any other and that step is the composer. Nothing on the trak says so and nothing has
to be cleared; the entry is the whole of it.

## One state per distinct routing; one gate kind per distinct thing to say

`approval` and `checks` share `AwaitingHuman` because **`Approve` means one thing
everywhere** — advance the plan. What differs between them is what a person is being
told, not where taking it goes.

`conversation`, `stuck` and `permission` are the kinds with **nothing to approve**: the step
has filed nothing, so advancing would step past work that has not happened. `decide` refuses an
`Approve` at all three — `AwaitReason` is what a gate advertises, not something `decide`
re-reads, so a surface offering one is not the last line of defence. One predicate,
`skippable`, answers *has this step filed?* for both questions, so the two cannot drift.

**What a step gate offers is written once, in `stepGate`**, derived from the kind:
`Replan` at every step gate, `Approve` only where something is filed and `Skip` only
where nothing is — both off `skippable` — and `AnswerQuestions` where the step asked,
`Permit` where it asked to run a refused command, `Chat` everywhere else. Every site that parks a step calls it, first park and re-entry
alike, and `test/domain.test.ts` asserts the two agree for every kind. The composer's two
gates are the only offers written by hand.

**A chat is answered in prose, and an envelope is held to less only where a document
stands.** `standingArtifact` is that condition, and it reads `Slot.filed` rather than the
gate: `Chat` is offered at every one, so a step that filed and then asked a question is
chatted at from the `answers` gate and owes the same envelope there as at `approval`. A
`stuck` account is filed among the artifacts under the same key, which is why the map
alone cannot answer. Where the relaxation holds, the envelope carries the sections the
reply edited and nothing else, and `amended` lays them over the filed document before the
event — so the log still carries a whole one and nothing replaying it learns that part of
one arrived. Where it does not hold, the turn owes the whole shape like any other.

**Two actions may share a routing when what differs is the fact recorded.** `Skip`
enters the next step exactly as `Approve` does, and is offered only where the step has
filed nothing — which is what keeps it from being an approval under another name.
`Slot.skipped` is the difference, and the next step's prompt is where it shows up.

**`Replan` is offered at every step gate**, and refused only at the plan gate, where
`Chat` already talks to the composer. It is one rule rather than a list to remember, and
it does not route backward: it goes to the composer, and where the plan comes back is
arithmetic the trak does. **The work is kept first, at every gate** — the same `keepStep`
an approval and a skip take — and the composer runs at the boundary after it, which is
the boundary a raised requirement already uses; `reconsultHere` reads both. A gate where
nothing is filed still has a checkout a conversational step edited, and a replan that
skipped the commit handed a spawn's children a branch without those edits.

**It is also the one press a route sends off a gate.** A recompose pressed mid-turn takes
the drive over, so `onPress` routes a `Replan` at `AgentWorking` — `keepStep`, as at a
gate — and stands still anywhere else the take-over's race can leave the step. The fact
`applyEvent` files is what makes standing still safe: the reason waits on the trak for the
resume that re-issues the position, and `reconsultHere` reads it at the boundary.
**Off a gate that fact does not overwrite an ask already standing** — the turn it raced
may have sent the plan back, and a step's corrections live in `reconsult.why` alone — so
`recordFacts` folds the standing ask into the person's as `Replanned.displaced`, and both
reach the composer on one turn. At a gate the person's words replace the ask whole: the
artifact and its complaints were on screen before they typed. `attention.ts` reads a
nested `Raised` through `raisedIn`; a `_tag === "Raised"` test on the entry misses it.
**The off-gate press also carries the killed turn's session**, read before the kill as a
stop's is, and `recordFacts` files it into the slot before it folds the ask. That is what
makes the position count as run: `firstUnrun` is where `withAsk` writes, and a slot with
no session names the interrupted entry as the join — so the ask landed *on* it, deleting
the entry and any model a person had picked for it.

**An action whose outcome must survive a restart writes the person's intent as an event,
and enters a state, before it does any work**, so a restart replays into that state and
`restartFrom` issues the work again rather than whatever the work interrupted. Its
attempt count, backoff and last error are progress: `SeamStatuses` holds them in engine
memory, and no event carries them.

**A stop is intent first, then the kill.** `StopRequested` — the session, step and spend
`Stopped` used to carry — moves `AgentWorking`, or `Composing` with a plan, to `Stopping`
and issues `StopTurn`; its `Stopped` opens the conversation gate or the plan gate. A
restart in `Stopping` issues the kill again, never the turn, and a turn's own ending that
lands there is decided as it would have been while running, with the step held so no mode
takes the gate it opens (`stopHeld` in `replay.ts`). The route appends through `intend`,
which runs no command, and the drive is taken over in the background to run it.

**`FilingAsked` is the press beside those actions, and an event rather than one of
them**: a person asking the step to file what it has, from a turn still running or from
a conversation it parked in. `Stopped`'s shape with the opposite ending — no gate opens,
the step re-enters at once on its own session under `Trigger.Filing`. Anywhere else it
re-parks, as a stop does.

`AwaitingProposal` and `AwaitingComposerAnswers` are separate **states**, because
approving a plan enters it at its resume point and answering the composer re-runs
`Compose` — neither of which `decide` can tell from a step's gate without reading a
display hint. **Nothing routes backward**: a state whose approval routes to an earlier
position is the signal that it should be its own state.

**An approval at the plan gate may carry the person's edits, and then the plan that runs
is not the one the composer proposed.** `recordFacts` lays `Approve.edits` over
`Trak.plan` before `decide` reads the first entry, and the newest `ComposerReturned`
keeps the composer's own proposal. So anything that means *the plan being run* reads
`Trak.plan`; the proposal on the log is what the composer asked for. An edit that cannot
apply is refused by the act route before anything is appended — `planEditsRefused`, which
runs `editRefusal` and then the composer's own decode on the edited tail, with a person's
model picks taken off since that decode refuses any `model`. A new kind of
edit is refused there too, because `decide` refusing it settles a healthy trak
`Failed{engine}`.

A gate carries no payload. What to show is read out of the log: the last agent output
for that gate, plus the last `CheckFailed` if that is why you are here.
`Trak.reconsult` is not an exception — it is a mechanism field the composer's prompt and
the splice read, and it never crosses a boundary. What it *is* answering goes onto a
compose entry the same moment, and **that** is what surfaces read: `withAsk` writes the
entry at the join when the ask is made, not when its run lands, so a composer already
working has a row of its own rather than leaving every surface pointed at the previous
compose. `withoutAsk` takes it back where the reason evaporates before the turn happens.

**What a press does outside this trak is not in the gate either, and every surface has
to learn it on its own.** Approving the plan gate opens the traks a compose entry
**handed off**; the state, the offer and the reason the gate is open are identical to a
plan carrying none, so a surface drawing from those alone shows nothing of it and a
person approves work nobody named to them. Attaching a consequence to a gate is
therefore a change to every surface that offers the press, not only to `decide`.

## Triggers say why an iteration is happening

- **`Reconsulted`** is the composer's: what should the rest of this plan be? **One
  trigger for every reason** it gets asked — a step raised something, a person replanned,
  the world came back, a merge conflicted, the plan ran out where the composer said it
  would — because they are one question asked from different positions, and the position
  is on the trak. It carries no payload for the same reason, and it starts a **fresh** composer
  session, which is what lets the fresh body carry the requirements filed since the
  original plan.
- **`Interrupted`** is a turn re-run by a human's choice — a crash *or* a retry of a
  failed trak. It names no cause, because `restartFrom` issues it for an `agent` failure
  too. It resumes the session and still owes an artifact.
- **`Unanswered`** is questions nobody is going to answer, on an `auto` trak. Both roles
  take it; it resumes the session and carries `picks` — per question, by position, the
  label the agent marked `recommended`, or nothing. **Not `Answers` with a canned
  string or the taken label per question** — that arrives under a heading in a person's
  voice, and an agent is entitled to record what it read there as something it was told.
  A taken pick renders as *your recommendation*, never as a reply.
- **`Unread`** is its twin: prose nobody is going to reply to, from a `conversational`
  step on an `auto` trak. A step's alone.
- **`Filing`** is a person asking the step to file what it has — the same deadline
  landing on the same session, and its own body because somebody *is* there. A step's
  alone, from `FilingAsked`.
- **`Permitted`** and **`Refused`** are a person's yes and no at a `permission` gate,
  from `HumanAction.Permit`. Each carries the command, read off `Slot.permission` — the
  step's envelope — never off the press, so the yes `step-permitted.md` writes names
  exactly the command asked for. Both resume the session.
- **`Unread` and `Filing` are the two that override `conversational`**, named in
  `overridesConversational` — `SpawnStep` puts either turn through `elicit` rather than
  `converse`, which is where the artifact's deferred deadline lands and what bounds the
  nudge to one. A trigger that should and is not in that predicate goes through
  `converse` on a conversational step, and the press looks broken with nothing failing.
- **A trigger that continues an existing conversation must be in `SpawnStep`'s
  `resumes` list**, beside `attempt > 0`. `Message`, `Unread` and `Filing` all follow a
  prose turn, and prose does not bump the attempt count — so left off, they mint a fresh
  session and silently discard the conversation they are a reply to.
- **A session keeps the model it was minted with.** Every resume runs on the model of the
  entry that started the conversation — `modelAt`, which the spawn site and the detail
  projection both read. Where that entry can no longer say which, because its agent file
  went while the trak ran, the borrow is dropped and the step starts fresh: resuming on
  another model hands `codex` a session id `claude` minted, or the reverse, and the turn
  fails every retry.
- `decide`'s `onRestarted` re-issues exactly the command the interrupted state implies
  and **never `unexpected`s**; a parked state re-parks unchanged.

A step a new plan schedules is an ordinary first run of a plan entry, so
`step.md`'s one directive hole is filled by the composer's instruction. **There is no
second source for one.**

## `Store` and `Runs` are a pair, not one port with more methods

- **`Store` is durable** — rows in `.orkestra/.database/store.sqlite`, append-only, each
  the line the file store writes.
- **A read reports two different failures, and the difference is the point.**
  `StoreUndecodable` is *the bytes arrived and are not this protocol* — a line written
  against a variant since deleted, which with no migrations is a thing that happens.
  `StoreFailed` is *I could not read it*. A surface may leave the first out and must
  not leave the second out: `GET /api/traks` drops an undecodable trak from the list
  and still fails on an unreadable one, because a list that quietly shortened would
  turn *I could not tell* into a count. Catch the tag, never a `catchAll`.
- **Every append names the read it rests on.** `append(id, events, {after, fence})` on
  `Store` and `GoalStore` alike: `after` is how many events the log held when the caller
  read it, and a log of any other length fails the append as `StoreConflict`. Pass the
  count from the read the decision was made on — `appended` in `runtime.ts` passes its
  `withLog` read's length, a goal write passes `goal.logged` read under `withGoal` — never
  a count taken again just before the append, which passes against a log nobody decided
  on. **Never catch `StoreConflict` and retry**: the retry re-decides over a write it
  never saw and hides the second writer. A retry belongs a level up, as a fresh read and a
  fresh decision. With one engine the log permit keeps a conflict from arising. `fence` is
  a lease's fencing token; an adapter that checks it fails a stale one as `StoreFenced`,
  and the file and memory adapters accept it and ignore it. Pass `locks.fenced(id, after)`
  rather than building `{after}` at a site a drive appends from, or that append carries no
  fence and a copy that lost the lease writes over the one that took it.
- **`Archive` is derived state the daemon keeps rather than replays, and every append
  maintains it.** It holds the ids `archived` answers true for, so the list and the
  condition sweep skip a put-away trak without opening its log: one full pass at boot
  fills it, and `publishingStore` classifies what each append left the trak as. **A
  second way into the log freezes it** — an inner `append` called directly, a `Store`
  layer built without that decorator — and a trak that ended stays on the list until the
  daemon restarts. Nothing fails, which is why the rule is written down rather than
  checked.
- **`Runs` is ephemeral, and it is custody rather than state.** `claim(id)` holds a trak
  for one CLI session; `holder(id)` answers the same question **without taking it**,
  because a listing that could change custody would race a `resume` in another terminal.
  `reap()` kills a stray only after reading its start time back and finding it equal to
  the one recorded when the agent was spawned.

## Mechanism fields, and the one rule about them

Some fields on `Trak` exist **only** because `decide` sees `(trak, event)` and nothing
else. They carry a fact that would otherwise be one event back in the log:

| Field | Holds | Stale by design? |
|---|---|---|
| `lastGate` | the gate a conversational reply returns to | **yes** — survives into `AgentWorking` on purpose |
| `failedFrom` | the position a `Failed` trak retries at | no — clears by construction |
| `composerSession` | the composer's session **while it is in flight**, before its run has landed on an entry | no |
| `reconsult` | the composer is owed a turn, and what it is answering. It carries no join — nothing that ran is replaced, so a revision appends. Its **ask** stands in the plan meanwhile | mostly no — cleared by whatever *begins* the plan that answers it, which is the next `AgentReturned` **or** `ChildrenSpawned`, and by a re-entry that names an agent, which owes the composer nothing. Either way the ask goes with it if its turn never happened. A composer answering `finished` begins no plan, so it survives onto the `Finished` trak — **not inert there**: `onWorktreeReady` reads this field before it reads the plan, which is why the second door discharges it rather than stepping around it |

**A mechanism field never crosses a boundary.** It is not part of what a trak *is*; it
is scaffolding for a context-free reducer. A projection — a DTO, a CLI line, a log view
— reads `state`, and if the answer is not derivable from `state`, that is a question
about the design, not a licence to export the scaffolding.

`decisions`, `slots`, `inherited`, `split`, `mode`, `holding` and `marks` are **not** on
that list: a requirement recorded, a step nobody ran, the documents a child was born
holding, the split it is one piece of, how much of it its person is standing at, whether
they asked to hold the current step, and what happened at each gate behind it are facts
about the piece of work, so they may be read anywhere — all three of the last cross on
`TrakDetailDto`.

**Everything about one position lives in its `Slot`** — the session, the attempts, the
skip and its note, the children, the failing checks, what it last filed. Read it through the total
`slotAt(trak, position)` and never `slots.get`: absent is an ordinary answer, and a
caller carrying its own default for an untouched position is a caller that can disagree
with the others. One value rather than five maps keyed alike, because they share a
lifetime — and a slot is **never dropped**, because a revision replaces nothing: a new
per-position fact is one field and needs no truncation of its own. That was a list of
five to keep in sync, and a list is a thing to forget.

**Two facts that cannot both be true of one key are one union keyed by it**, never two
collections kept exclusive by hand. `Trak.marks` is `Map<number, Mark>` because an entry
carries a gate the engine took past *or* a hold spent standing there and never both, so
the second `set` replaces the first and nothing subtracts. As `unattended` and `held` it
was `applyEvent` adding to one map while dropping from the other, and the exclusivity
held only while whoever edited that function remembered it. **The wire follows** — one
`Array(MarkDto)` on `TrakDetailDto`, because a DTO that splits the union back into two
fields hands the rule to the client to keep. Where a reader relied on the two being
separate, the collapse turns that reliance into a `_tag` test in ordinary code: find those
and cover them, since nothing fails when one goes.

**Artifacts are deliberately not in a slot.** They are keyed by artifact key rather than
by position — a spawn files one document per *child*. A stuck account is filed among them
now: what a step produced is the record, and `visibleArtifacts` is where a reader is
chosen. `inherited` is not keyed by
position at all and survives for its own reason: what a child was handed is not changed
by the child re-planning its own steps.

**A spawn produces no `AgentReturned`, so clearing on that alone is not the rule.** A
plan whose first entry is a spawn would leave `reconsult` set, and an approved artifact
that raised something composes again at the next commit boundary — forever, since
each splice drops the position's children and spawns them afresh. The route is also
keyed on the position, so both halves have to be wrong before it loops.

**Four feeders, one door, and `recordFacts` owns every predicate.** `Raised` is set by
`AgentReturned` and by `ChildrenJoined`, which is what a child's composer handed up;
`Replanned` by `HumanActed`; `Reentered` by `Reentered` — but only where it names no
agent, since one that does splices that turn into the plan and owes the
composer nothing — and `Conflicted` by `Conflicted`. `decide` only ever asks the field, and a second copy of any of these in
`decide` is two callers who can disagree. One ask stands at a time, and the one writer
that can find another already standing — a `Replanned` landing off a gate — carries it
inside rather than replacing it.

**A `Raised` names a spawn as readily as an agent step**, since a hand-up is filed at
the spawn position. Its readers — `whyView` in `domain/prompt.ts`, `raisedUnplannedWork`
in `domain/attention.ts` — have to hold for a position that filed no artifact of its own
and takes no gate. A hand-up therefore costs a `smart` parent no stop: that predicate
stops the step that raised, and a spawn has no gate to stop at. The re-cut plan takes the
ordinary plan gate, which is asked about the compose run instead.

**A fifth used to live here** — a plan running out where the composer said it would —
and it is the shape to avoid rather than to copy. It was a field on the proposal, a
predicate in `recordFacts` watching for the plan to end, a `why` carrying a copy of the
question, and a rule in `revise` that an absent question must clear the old one or no
trak converges. All four are gone: the composer proposes the compose as its last entry,
so reaching it is entering a step. **If something the composer decides needs the engine
to watch for a moment later, ask whether it is an entry.**

**`lastGate` answers "where does a reply land", never "can a human act now"** — and those
differ for the whole of `AgentWorking`. Read as the second, it appends an event `decide`
cannot route from where the trak actually is: a chat, a skip or an answer settles a
healthy trak `Failed{engine}`, an approval is absorbed as a press already taken, and a
replan stands still — so each goes somewhere other than where it was aimed.
`src/app/dto.ts` does not project it.

**Before writing a predicate over a domain type, look for the existing total function.**
`asGate(state)` is there for exactly that question. `domain/trak.ts` is short; read it.

## A goal is a second object, never a kind of trak

`workflow/domain/goal.ts` is a goal: its own `GoalEvent` union, its own log, and
`replayGoal` over `applyGoalEvent` as the whole of how its state is derived. It has no
worktree, checks, effects or projection, and a branch only where its goal file names
one — the **goal branch** — or, for a sub-goal, where its parent has one; `decide`
never sees it.

- **A goal's move is a `GoalEvent`, never a trak `Event`.** A trak carries one fact about
  its goal — `Trak.goal`, set by `TrakCreated` — and nothing in `decide` routes on it. The
  trak is its person's from birth, and the goal learns how it ended by watching the feed.
  `src/app/forge-sweep.ts` archives a finished one whose pull request merged, which ends
  it `Merged`; one that committed nothing ends itself `Closed`, which `outcomeOf` reads as
  landed. It is cut from `origin/<goal branch>` where its goal has one and
  `origin/<default>` otherwise, fetched as it opens.
- **`Trak.goalBranch` is where a goal's trak lands, and every question about a
  destination asks it.** `TrakCreated` stamps it from the goal. Such a trak merges into
  `MergeInto.Goal`, the engine's own checkout of the branch — never the person's
  checkout — and its checks and effects are handed `ORKESTRA_TARGET_BRANCH`. Its checks,
  like every trak's, are handed `ORKESTRA_BASE_COMMIT`, the commit it was cut from. A new path
  that merges a trak, predicts its merge or opens its pull request picks among the three
  destinations the way `mergeDestination` in `runtime.ts` does. Every git operation on a
  goal checkout holds that goal's permit in the git adapter, from its fetch to its push;
  one outside it races a merge running on the same checkout.
- **The composer is woken by `Wake` alone** — a trak that landed, failed, stopped stuck
  or stopped on a failing check (`WakeKind`, decided in `outcomeOf`), one that handed
  work off, or a sub-goal confirmed done, dropped or failed (`SubgoalWoke`, decided in
  `subgoalOutcome`). An approval or question gate is deliberately not on it:
  those gates are the person's, and a wake on one would hand the composer a press it may
  not make.
- **Every goal gate stops for a person** — `file`, `escalation`, `action`, `done`, and `plan`,
  which only an old log reaches: nothing appends `PlanProposed` now, and a goal opens its
  traks with nobody asked, but a log standing at that gate still replays there and is
  approved as before. A goal has
  no run mode, so nothing reads `attention.ts` for one. A new gate needs its own arm in
  `goalNotificationFor` in `src/app/push.ts`, whose last arm sends the `done` text and
  fails no type check. A sub-goal never reaches `file`: its spec is its parent's plan
  entry.
- **A goal drafted from a sentence usually stops at `escalation` or `action` before it has
  a file.** A goal with no file may call only the tools in `DRAFTING_TOOLS` in
  `src/app/goals.ts` — `draft_goal`, and the two that ask the person something — and the
  read tools, which move nothing. So drafting
  text in a turn template has to read true whether or not a draft exists, and nothing may
  assume `file` is a goal's first gate. The turn that answers such a gate has to be told,
  under `{{#drafting}}` in `goal/turn.md`, to draft or ask again: a turn that ends with
  neither leaves the goal Watching with no file.
- **A move that asks for a person is held on `Goal.pending` until the turn ends.** The gate
  opens from `GoalTurnEnded`, so nobody is asked about a move still being made.
- **`goalOffers(state)` is the one list of presses.** The act route refuses by it and the
  client draws `GoalDto.offers` from it; a second predicate is a second answer.
- **`applyGoalEvent` is total.** An event that does not apply where the goal stands
  leaves it as it was, so every writer checks before it appends.
- **The log is a goal's only copy of its spec.** Approving the drafted file appends it as
  `GoalSpec`; nothing writes it under `.orkestra/` or commits it. Keep approval off git. An older log's goal started from a file
  carries its `GoalSpec` on `GoalStarted`. A sub-goal's
  `GoalSpec` is built from its parent's plan entry by `subgoalSpec` and has no `file`, so a
  goal is drafting where `spec` is absent — never where `file` is. On the wire `GoalDto`
  has no `file` either way, and `parent` is what tells a sub-goal from a draft.
- **A logged shape that changes keeps its old shape as a decode-only union member**, after
  the current one, as `EscalatedOnce` and `AnswerOnce` do. The union encodes through its
  first member that accepts the value, so the old member's encode refuses and is never
  reached by a writer; without it, a log written before the change no longer replays.

The composer's own tools are the `TOOLS` table in `src/app/goals.ts`; beside them it is
offered every read tool of `src/app/read-tools.ts` but `snapshot_logs`, answered in any
state under no permit. A call the goal or its
limits forbid is **refused with a reason** and appends nothing, and a tool that
opens a trak goes through `limitBroken`, as `open_trak` does — which counts the traks of a
top goal and of every sub-goal it opened against the top goal's limits, and a sub-goal's
own limits against its own traks. `merge_default_branch` moves `origin`'s goal branch and
appends no event: the merge commit and the answer in the transcript are the record, so
no replay, wake or `MoveView` sees it ran. `propose_done` and Confirm are refused while a sub-goal
is still going. `message_subgoal` and `drop_subgoal` reach a live sub-goal this goal
opened, under the sub-goal's permit taken inside the parent's, and are refused on a
sub-goal. The parent's log records each as `SubgoalMessaged` or `SubgoalDropped`, the drop
before it runs: `SubgoalDropped` settles the sub-goal as dropped with no wake, and
`settleSubgoal` files nothing for a sub-goal the parent no longer holds live.

## A person's files are on the log by reference

Every event that carries what a person wrote carries the files sent with it as
`attachments: Attached` — `TrakCreated`, `MessageWaiting`, `HumanAction.Chat`, the
`Message` trigger, and the goal's `GoalAsked`, `GoalMessageWaiting` and `Chat`. An
`Attachment` is `{ name, type, size, path }` and never the bytes. `path` is relative to
the checkout root, under `ATTACHMENTS_DIR` — `.orkestra/.attachments/` — which
`IGNORED_PATHS` keeps out of every commit.

- **The checkout holds the only copy.** An upload waits in the OS temporary folder until
  a message names it, then `src/app/attachments.ts` writes it into the checkout, through
  `Sandboxes` where the checkout is in one. A new trak has no checkout yet, so its files
  are held by trak id until `Uploads.settle` places them after `SetupWorktree`. Once the
  checkout is gone, the name on the log is all that is left.
- **An upload is released only after its event is appended.** A press refused after the
  files were written keeps its uploads, so sending the same ids again works.
- **The field is optional and a constructor leaves the key off rather than writing an
  empty list** — `attachedField`. A log written before the field existed replays with
  none.
- **A new event or trigger that carries a person's words gains the field, and its
  projection in `src/app/dto.ts` maps it through.** A mapping that drops it fails
  silently: the message draws without its files and nothing errors.
- **A fresh session names the request's files as well as the message's**;
  a resumed one names only the message's, because its opening body already listed the
  request's — `turnAttachments` in `runtime.ts`, `goalAttachments` for a goal.

## Invariants that must keep holding

1. **`replayHistory` and `applyEvent` agree.** Test the whole state×event matrix, not
   hand-picked histories.
2. **No `Await` is a dead end** — every parked state has an event that moves it.

**The matrix has to be keyed by tag, not listed.** `everyState` and `everyEvent` in
`test/domain.test.ts` are `Record<TrakState["_tag"], …>` and `Record<Event["_tag"],
readonly Event[]>`, so adding a variant is a compile error until someone writes down
what it does. As plain arrays they drift, and the gaps concentrate exactly where the
bugs are. **A comment saying "every" is not a mechanism.**
