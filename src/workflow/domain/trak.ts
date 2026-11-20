// Pure domain types. Imports nothing outside effect.

import type { Attachment } from "./attachment.js"
import { Data, Schema } from "effect"
import type { ApiErrorKind } from "../../agent/types/provider-event.js"
import type { RunnerFailure } from "../../agent/types/runner-failure.js"
import type { SessionId } from "../../agent/types/session.js"
import { agentNamed } from "../../library/logic/resolve.js"
import { engineCondition, WAIT_UNTIL } from "../../library/types/check.js"
import type { Library } from "../../library/types/library.js"
import type { BranchName, CommitSha, MergeMethod, Worktree } from "../../vcs/index.js"
import type { Ambiguity } from "./outputs/ambiguity.js"
import type { Document } from "./outputs/artifact.js"
import type { Decided, Recorded } from "./outputs/decided.js"
import {
  artifactKey,
  continuesFrom,
  isCompose,
  isSpawn,
  modelOf,
  type Plan,
  type ReconsultWhy,
  type Split,
  type Step,
  waitForOf,
  waitUntilOf,
} from "./outputs/proposal.js"
import { resolveWaitUntil } from "./wait-until.js"

// ============================================================================
// Ids
// ============================================================================

export const TrakId = Schema.String.pipe(Schema.brand("TrakId"))
export type TrakId = Schema.Schema.Type<typeof TrakId>

/**
 * A goal's id — its own brand, so one cannot reach a map keyed by `TrakId`. Here beside
 * `TrakId` rather than in `goal.ts` because a trak carries one and `goal.ts` reads traks:
 * either file holding both ends of that would be an import cycle.
 */
export const GoalId = Schema.String.pipe(Schema.brand("GoalId"))
export type GoalId = Schema.Schema.Type<typeof GoalId>

/**
 * A host user's id — the provider's numeric id with its prefix, `gh:1234567` — as the host
 * names the person who pressed. Its own brand, so a login cannot be passed where the id
 * that survives a rename is wanted.
 */
export const UserId = Schema.NonEmptyTrimmedString.pipe(Schema.brand("UserId"))
export type UserId = Schema.Schema.Type<typeof UserId>

/**
 * Where a child trak came from: which trak spawned it, at which position, and
 * how deep it now is.
 *
 * `depth` is carried rather than derived because replay is per-log — a child
 * replays its own events and never sees its parent's, so it has no way to count
 * its own ancestors. It is what `ComposerOutputFor` refuses a spawn on: a trak
 * at depth 1 may not spawn again.
 *
 * `step` and `child` are what let a finished child land on the right position of
 * the right parent, which is the one thing the parent's log cannot infer — two
 * spawn positions can name the same agent, and a spawn can name it twice.
 */
export const Parent = Schema.Struct({
  id: TrakId,
  step: Schema.Number,
  child: Schema.Number,
  depth: Schema.Number,
})
export type Parent = Schema.Schema.Type<typeof Parent>

/**
 * What a child came back with, as the parent records it.
 *
 * `branch` and not a path: the branch is where the work actually is, and it is
 * the half that survives the child being closed. `sha` is **where it landed on
 * this trak's branch**, and absent is the verdict: a child a human dropped keeps
 * its branch and contributes no commit.
 *
 * `artifacts` is every document the child filed, under the child's own keys —
 * `0-survey`, `1-think-through`. The join is what puts them under the piece's
 * name, so a child's key never has to know which spawn it came out of.
 *
 * `decisions` is `Decided` rather than `Recorded`, because provenance is stamped
 * by whoever files it and that is the parent, at the join — see `ChildrenJoined`.
 *
 * `handUp` is work the child's composer judged out of its piece, and the join is
 * what puts it in front of this trak's composer — see `ChildLanded`.
 */
export interface Landing {
  readonly branch: BranchName
  readonly sha: CommitSha | undefined
  readonly artifacts: readonly (readonly [string, Document])[]
  readonly decisions: readonly Decided[]
  readonly handUp: string | undefined
}

/**
 * One child of a spawn position: the trak it is, and what it came back with.
 *
 * `landing` absent means it is still going. *Have all the children landed?* is
 * then arithmetic over this list, which is what keeps the composer out of the
 * join and keeps nothing polling.
 */
export interface ChildRun {
  readonly id: TrakId
  readonly landing: Landing | undefined
}

// ============================================================================
// State
// ============================================================================

/**
 * What the human is looking at, so an interface can say so. Routing does not
 * branch on it — approve advances, anything said resumes that step's session.
 *
 * - `approval`   — a step's work. Good enough to build on?
 * - `answers`    — an agent asked something whose answer changes what it does.
 *                  Not only when it is blocked: `system/questions-shape.md` has
 *                  why the bar is that and not being stuck.
 * - `checks`     — a check keeps failing and the step has stopped fixing it.
 *                  Approving means "take it anyway", which is the same routing as
 *                  `approval` and therefore a kind rather than a state.
 * - `stuck`      — a step could not do the work and says so. **Nothing is planned
 *                  from it**: it stops here until a person reads the account and
 *                  jumps in. Like `conversation` it has nothing to approve, so
 *                  `decide` refuses one; what is offered is `Chat`, `Skip` and
 *                  `Replan`.
 * - `permission` — a step asks to run one command the CLI refused with nobody
 *                  asked. **It stops on every run mode**: consent to what the
 *                  classifier blocked is not the engine's to give. Nothing is filed,
 *                  so like `stuck` it has nothing to approve; what is offered is
 *                  `Permit` — a yes or a no, each resuming the step — `Skip` and
 *                  `Replan`.
 * - `conversation` — a step marked `conversational` replied in prose and has not
 *                  filed anything yet. **A gate with nothing to approve**, which is
 *                  what makes it a kind of its own rather than an `approval` with
 *                  an empty artifact: `Approve` would advance past work that has
 *                  not happened. What is offered is `Chat`, which is another turn
 *                  of the same conversation, `Skip` and `Replan` — and beside them
 *                  the press `FilingAsked` records, which ends the conversation by
 *                  asking the step to file.
 *
 * **One state per distinct routing; one kind per distinct thing to say about the
 * same routing.** That is the whole rule, and it is why a proposal is a state
 * rather than a fourth kind here: approving a proposal enters the resume point,
 * which cannot be told apart from advancing a step by a display hint without
 * `decide` reading one — the mistake `Reject{feedback}` was.
 *
 * Nothing routes backward. `Replan` is offered at every kind, and it does not
 * break that: it goes to the composer — keeping the work first where the step has
 * filed — and where the plan it returns joins on is arithmetic the trak does rather
 * than a gate routing backward.
 *
 * **There is no `verdict` kind**, and a reviewing step does not get one. An artifact
 * is the approval, so a review that approves routes identically to any other step's
 * work and should be indistinguishable *here*. Telling a human which one they are
 * reading would mean the engine knowing which step reviews, which is `.orkestra/`
 * policy and not something a domain type can be taught. What they read is the
 * document itself, which says so in its own words.
 *
 * Composer questions still park as `answers`, because being asked a question is
 * the same thing whoever asked it.
 */
export type HumanGate = "approval" | "answers" | "checks" | "stuck" | "conversation" | "permission"

/**
 * Why a trak stopped. A classification a human reads, not something routing
 * branches on — the same shape and the same job as `HumanGate`.
 *
 * **Nothing here decides whether a retry is allowed.** Every failure is
 * retryable, because the alternative is the engine guessing which ones are worth
 * a human's time and being wrong in the expensive direction. What the kind
 * changes is what someone expects of the retry: `provider` says the work is
 * probably fine and the world got in the way, `engine` says a retry will most
 * likely land in the same place.
 *
 * - `agent`    — the agent returned `failed`, or produced nothing usable after
 *                three attempts. A verdict it wrote about its own work.
 * - `provider` — the CLI, transport or API failed: a dropped connection, an
 *                exhausted usage limit, a non-zero exit. Nothing to do with what
 *                the agent was asked, which is why it must not be recorded as
 *                the agent giving up.
 * - `worktree` — git, or the project's `setup.sh`, preparing the checkout or keeping
 *                the work on its way through the plan.
 * - `archive`  — git, or the project's `teardown.sh`, taking the checkout away once
 *                the trak was merged, closed or abandoned. Not `worktree`, because
 *                everything a person asked for has already run: a surface that reads
 *                *could not be prepared* here sends them to the wrong script.
 * - `merge`    — git declined to merge this trak's branch into its destination: a
 *                dirty tree there, most often. The checkout is fine and the fix is
 *                in a tree this trak does not own, which is why it is not `worktree`.
 * - `project`  — a script this project wrote, declared under an agent's `effects:`,
 *                could not do what it says. An unauthenticated `gh` is none of the
 *                others: the agent did not cause it and cannot fix it, so telling a
 *                person the agent gave up would send them to the wrong file. What it
 *                printed is on `EffectFailed`, not here.
 * - `engine`   — an invariant broke: an event that cannot apply to the state, a
 *                proposal that should exist and doesn't. A bug in here.
 */
export type Failure = "agent" | "provider" | "worktree" | "archive" | "merge" | "project" | "engine"

/**
 * How much of this trak the person who started it wants to stand at.
 *
 * Set by `TrakCreated` and changed by `ModeChanged`, so it is always on the log —
 * which is what keeps it replayable: read from a setting at decide time, an old log
 * would replay against whatever that setting says today — the hazard `RunChecks`
 * being unconditional exists to avoid. A change is picked up at the trak's next gate
 * and moves nothing already decided: what a gate the engine took read is stamped
 * on `Trak.marks` at the moment it was taken.
 *
 * - `manual` — every gate. What every log written before this field replays as, and
 *              the default for a trak nobody said otherwise about.
 * - `smart`  — a gate goes past unless the turn behind it reported the work was
 *              ambiguous, or the record shows the person was already in it. See
 *              `attention.ts`, which holds the whole rule for all four of these.
 * - `auto`   — approve on the person's behalf. See `approvedInAdvance` in
 *              `attention.ts` for which gates that reaches and, more importantly,
 *              which it does not.
 * - `decider` — `auto` for the plan and every document, but a question or a
 *              conversation always waits for the person, and so does a plan that
 *              hands work off. See `warrantFor` in `attention.ts`.
 *
 * An artifact an entry planned as a conversation filed waits for the person on every
 * mode — a person's question of a trak at rest arrives as one.
 *
 * A `Schema` rather than a bare union because `TrakCreated` carries it, and a stored
 * log has to decode it.
 */
export const RunMode = Schema.Literal("manual", "smart", "auto", "decider")
export type RunMode = Schema.Schema.Type<typeof RunMode>

/**
 * `into` is the branch of the project's checkout a local auto-merge would conflict with —
 * set where the project has no `origin` and the engine merges here, absent where the forge
 * reported the conflict on a pull request.
 */
const Conflict = Schema.TaggedStruct("Conflict", { into: Schema.optional(Schema.String) })
const Checks = Schema.TaggedStruct("Checks", { failed: Schema.Array(Schema.String) })

/**
 * Why the forge would not merge an auto-merging trak's pull request, as the engine read
 * it when it sent the trak back. `Conflict` is GitHub's `conflicting` and its `behind` —
 * both are answered by merging the base in — or, with no `origin`, a local merge that
 * would conflict. `Checks` names the checks that failed on the
 * head commit, which may be none where the forge's verdict came without a list.
 */
export const ReentryCause = Schema.Union(Conflict, Checks)
export type ReentryCause = Schema.Schema.Type<typeof ReentryCause>

/**
 * Why the engine stopped merging a trak on its own: the last cause it sent the trak back
 * for, once the sends are spent — or something no send could fix. `Blocked` is a pull
 * request whose checks pass and whose merge the forge's protection still holds, a review
 * or a signature that only a person can supply. `Refused` is the forge turning the merge
 * down several ticks running, with the last reason it gave.
 */
export const StopCause = Schema.Union(
  Conflict,
  Checks,
  Schema.TaggedStruct("Blocked", {}),
  Schema.TaggedStruct("Refused", { why: Schema.String }),
)
export type StopCause = Schema.Schema.Type<typeof StopCause>

/**
 * A trak whose pull request the engine merges on its own. `sentBack` is how many times
 * the engine has re-entered it because the forge would not merge it; `stopped` is set
 * once it has given up, with why.
 */
export interface AutoMerge {
  readonly sentBack: number
  readonly stopped: StopCause | undefined
}

/**
 * What happened at one entry's gate: it went past with nobody reading it, and why — or
 * a pressed hold held this entry until a person accepted it.
 *
 * Stamped on `Trak.marks` by `applyEvent` in the same breath as the state — so what a
 * surface draws on the document is what the engine saw *then*, and a later change to
 * the trak's mode cannot move it. **Nothing routes on this** — it is what the engine
 * has to say for itself afterwards, and no gate consults it.
 */
export type Mark = Data.TaggedEnum<{
  /**
   * The person had said they would stand at no gate. `Trak.mode` was the whole of
   * the reason and there is no evidence to give.
   */
  Mode: object
  /**
   * Nothing about this position asked for a person: the turn reported what it ran
   * into, and `ambiguity` is that word — the one part of this a party with an
   * interest wrote, which is why a surface draws it as a claim rather than a fact.
   * Everything else the rule read is the absence of something in the record.
   */
  Uneventful: { readonly ambiguity: Ambiguity }
  /**
   * The engine sent the trak back to resolve a conflict on its pull request, and that
   * re-entry runs to rest with nobody at its gates, whatever the mode. See
   * `Trak.resolving`.
   */
  Resolving: object
  /**
   * A person pressed Hold, and this is the entry whose acceptance spent it. Whether the
   * mode *would* have gone past is not recorded: every gate this entry reached stood.
   */
  Held: object
}>
export const Mark = Data.taggedEnum<Mark>()

/**
 * The marks the engine's rule produces — every one but `Held`, which only a person's
 * press does. `warrantFor` in `attention.ts` returns one at the moment a gate is decided.
 */
export type Warrant = Exclude<Mark, { readonly _tag: "Held" }>

export type TrakState = Data.TaggedEnum<{
  /**
   * Making the worktree the trak will work in, and running the project's setup
   * script in it. Also the state of a trak that has not been created yet: nothing
   * has happened, and the first event is what starts it.
   *
   * Its own state rather than a prefix of `Composing`, on the same rule that
   * separates `CheckRunning` from `AgentWorking`: what is in flight is git and a
   * shell script rather than a turn, and `resume` has to know which to restart.
   */
  Preparing: object
  Composing: object
  /**
   * A plan is on the table. Approve enters it at the resume point — step 0 for a
   * first proposal, the first step a revision replaces for one the composer was
   * re-consulted about — and anything said goes back to the composer, which still
   * holds the whole request.
   */
  AwaitingProposal: object
  /**
   * The composer asked something it cannot plan without.
   *
   * Its own state rather than a fifth `HumanGate` kind, on this file's rule: the
   * answers re-run `Compose`, where every other answers-gate resumes a step.
   *
   * **`proposal === undefined` cannot stand in for it.** That is true only while the
   * composer has run once and nothing exists yet, and false the moment it is
   * re-consulted mid-flight — where it would route an answer into a step.
   */
  AwaitingComposerAnswers: object
  /**
   * The plan was taken — approved, or entered on the trak's run mode — and the traks
   * its compose entry handed off are being named before it is entered. `step` is that
   * entry.
   *
   * `Spawning`'s shape for `Spawning`'s reason: what is in flight is a mint and a read
   * of the repository's default branch, neither a turn nor a script, and a restart has
   * to know to re-issue `HandOff` rather than re-park. Entered only where the compose
   * run behind the gate carried a hand-off nothing has yet named — `handOffPending` —
   * so an ordinary plan never passes through it.
   */
  HandingOff: { readonly step: number }
  AgentWorking: { readonly step: number }
  /**
   * A person pressed Stop on the turn at `step` — absent for the composer — and the
   * engine is ending it. Entered from `StopRequested` before anything is killed, so the
   * person's intent is on the log first: a restart here issues `StopTurn` again rather
   * than rejoining the turn. Left by `Stopped`, for the step's conversation gate or the
   * plan gate, or by the turn's own ending where it raced the kill.
   *
   * Its own state on the rule that separates `CheckRunning` from `AgentWorking`: what is
   * in flight is a kill rather than a turn, and `restartFrom` has to know which to issue.
   */
  Stopping: { readonly step: number | undefined }
  /**
   * The step produced an artifact and the checks its agent declared are running.
   * Not a gate — nobody is being asked anything — and not `AgentWorking`, because
   * what is in flight is a shell script rather than a turn, and a human watching
   * should be told which.
   *
   * Every artifact passes through here, including one from an agent that declares
   * no checks — where the state is entered and left inside one command and nobody
   * ever sees it. `decide` cannot tell the two apart without reading policy; see
   * the note at `onOutput`'s `artifact` arm.
   *
   * Carries no check name. `RunChecks` is one command that runs them all
   * fail-fast, so exactly one event comes back and there is no per-check
   * bookkeeping for a state to hold.
   */
  CheckRunning: { readonly step: number }
  /**
   * The plan has reached step `step`, and the conditions its agent declares are being
   * asked before it starts. Met, the turn runs; not yet, the trak rests at `Finished`
   * holding the entry, and the daemon asks again on the script's own interval — with
   * no state of its own, because the trak really is at rest and every door a
   * finished one has stays open.
   *
   * Not `CheckRunning`, though both are a shell script in flight: a check judges the
   * work and a condition asks about the world, and a list drawing *checks running*
   * for a step that has not started would be saying the wrong thing about the work.
   *
   * Every first entry of an agent step passes through here, including one whose agent
   * declares no conditions — entered and left inside one command, exactly as
   * `CheckRunning` and `Effecting` are, because `decide` cannot read policy.
   */
  ConditionRunning: { readonly step: number }
  AwaitingHuman: { readonly step: number; readonly kind: HumanGate }
  /**
   * A spawn position's child traks are being created.
   *
   * `Preparing` one level up, and its own state for the same reason: what is in
   * flight is neither a turn nor a shell script, and a restart has to know to
   * re-issue `SpawnChildren` rather than re-park.
   */
  Spawning: { readonly step: number }
  /**
   * The children exist and owe us events. Nothing is in flight on *this* log —
   * the engine does not drive the children, the daemon forks a drive per child
   * and each of them owes this trak a `ChildLanded`.
   *
   * **Not a gate.** Nobody is being asked anything: each child gates its own
   * work, and if someone should look at the integrated result that is a review
   * step after the spawn. So `asGate` does not widen and no `HumanGate` kind is
   * added.
   */
  AwaitingChildren: { readonly step: number }
  /**
   * Every child has landed, and their work is being brought together.
   *
   * `Integrating` one level down, and it is where git will go: the merge back
   * into this trak's own branch happens here. Today it merges nothing.
   */
  Joining: { readonly step: number }
  /**
   * The work of step `step` is being kept: committed onto the trak's branch. The
   * trak enters `step + 1` when it is.
   *
   * One per completed step — approved, skipped, or a spawn position whose
   * children all joined — rather than only at the end: a step's work must
   * survive the checkout it was written in, and a child spawned later inherits
   * only what its parent's branch already holds. `Integrating` is the same
   * operation one position further along, for the step past the last one.
   */
  Committing: { readonly step: number }
  /**
   * The work of step `step` is on the branch, and the effects its agent declared
   * are running. The trak enters `step + 1` when they are done.
   *
   * **After the commit rather than after the approval**, and the order is not a
   * preference: a script that opens a pull request for a branch whose commit has not
   * landed opens one with nothing in it, and firing both off the gate would make
   * that a race rather than a bug. The checkout is still standing: `RemoveWorktree`
   * is issued only from `Closing` or `Abandoning`, and both are past this.
   *
   * Its own state on the rule that separates `CheckRunning` from `AgentWorking`:
   * what is in flight is a shell script rather than a turn, and `restartFrom` has to
   * know which to re-issue. Every step boundary passes through here, including one
   * whose agent declares no effects — where the state is entered and left inside one
   * command and nobody ever sees it. `decide` cannot tell the two apart without
   * reading policy, exactly as at `CheckRunning`.
   *
   * Carries no effect name, for `CheckRunning`'s reason: `RunEffects` is one command
   * running them all fail-fast, so exactly one event comes back.
   */
  Effecting: { readonly step: number }
  /**
   * Past the last step, keeping the work: the worktree's contents are being
   * committed to its branch.
   *
   * A state rather than something `advance` does on its way out, because it can
   * fail and a trak that could not keep its work must say so rather than
   * reporting `Finished` over the top of it.
   *
   * **It does not remove the checkout.** That half is `Closing`, and a human is
   * what triggers it: the plan running out is not a person saying they are done.
   */
  Integrating: object
  /**
   * A human said this trak is over, and its work is being kept anyway.
   *
   * `Integrating` and `Closing` in one state, and it runs both their commands in
   * turn for the reason `Integrating` runs the first: three attempts nobody is
   * going to finish are still the evidence for *tried three times, gave up* — and
   * evidence left in a checkout goes when the checkout does.
   *
   * The two commands are told apart by the event that arrives, not by a second
   * state: `WorkCommitted` here asks for the removal and `WorktreeRemoved` here
   * is the end. A `reason`-carrying twin of `Closing` would be the same machine
   * with the declaration written down twice.
   *
   * `reason` is carried through to the terminal state below rather than read back
   * out of the log, on the rule every field here follows: `decide` sees only
   * `(trak, event)`, and by the time the commit comes back the declaration is two
   * events behind.
   */
  Abandoning: { readonly reason: string }
  /**
   * The plan ran out, the work is on the branch, and **the checkout is still
   * there**. Nobody has decided what happens to it.
   *
   * Terminal in the sense every `Settle` is — the engine does nothing further on
   * its own — and *not* the end of the trak: a human merges it, re-enters it, or
   * archives it, and archiving is what takes the checkout away. Holding is what makes
   * a short plan safe, because the plan running out is then a pause rather than an
   * ending. It is also what costs disk.
   */
  Finished: object
  /**
   * A human asked for this trak's branch to go into the one they are standing on,
   * and `git merge` is running in the host repository.
   *
   * Its own state for the reason `Integrating` is one: it can fail, and it can
   * come back *conflicted*, and a trak that did not merge must not report that it
   * did. The destination is deliberately not carried — a merge goes where the
   * human is, which is a fact about their checkout rather than about this trak.
   */
  Merging: object
  /**
   * This trak has been archived, and its git footprint is being taken away — the
   * checkout, the branch, its recorded base ref, and the branch's copy on the
   * forge, whatever is on them. The confirmation on the press is the guard where a
   * person made it; for a child the trak's run mode made it in advance, and for a
   * goal's trak with nothing committed there is nothing to guard. `endsUnattended`
   * is where both are read.
   *
   * `Integrating`'s second half, one decision later. Its own state rather
   * than something the archive command does around `advance`, for the reason
   * `Integrating` is one: `git worktree remove` can fail, and a trak that still
   * has a checkout must not report that it has none.
   *
   * `merged` is where the work went, and `undefined` is a plain close — which is
   * what makes this one state rather than two: clearing up is the same operation
   * either way, and the only thing that differs is what to settle as. Carried
   * rather than read back out of the log on the rule every field here follows:
   * `decide` sees only `(trak, event)`, and by the time the removal comes back the
   * merge is two events behind.
   */
  Closing: { readonly merged: CommitSha | undefined }
  /**
   * Archived, without a merge. The checkout, the branch and the branch's copy on
   * the forge are gone — the log and its artifacts are what remain.
   *
   * **Not `Abandoned`, and folding the two would lose the distinction the record
   * exists for.** A `review` trak has nothing to merge and archiving it is
   * success; abandoning one is *tried three times, gave up*. Nor is it a failure
   * — nothing here says the engine or the agent did anything wrong.
   */
  Closed: object
  /**
   * The work landed, and `sha` is the merge commit — on the branch the human was
   * standing on for a merge made from here, or the one GitHub reported for the
   * branch's pull request, asked once as the archive ran. Two ways in, one
   * question every reader asks of it: did the work land. The archive record and a
   * parent reading a child's ending both do, which is what the state is worth.
   *
   * The one ending that says where the work *went* — a `Closed` trak was put
   * away without landing anywhere, and a merged one has been answered for.
   */
  Merged: { readonly sha: CommitSha }
  /**
   * Declared over before it finished, and archived: the checkout, the branch and
   * the branch's copy on the forge went with the declaration, whatever was on
   * them — the confirmation on the press is what stood between a person and
   * that. The log and its artifacts are what remain.
   *
   * Terminal like `Closed` and not a failure: nothing here says the engine or
   * the agent did anything wrong, and there is nothing to retry. What makes it
   * worth a state of its own is that it is a **fact about the work** — a trak
   * nobody finished is a different reading from a trak that finished, and the
   * corpus is worth less without it.
   */
  Abandoned: { readonly reason: string }
  /**
   * Where a trak stops until a human says otherwise.
   *
   * Still a `Settle` — the engine will do nothing further on its own, which is
   * all `Settle` ever claimed. It is not `Finished`: that one is genuinely the
   * end, and there is nothing to re-run. A `Failed` trak keeps its worktree for
   * exactly this reason, so the work is still there when someone comes back to
   * it.
   *
   * `kind` is carried for the same reason `error` is — `decide` sees only
   * `(trak, event)`, so by the time anything wants to display the failure the
   * event that caused it is in the log and not in the trak. Where it can be sent
   * back to is `Trak.failedFrom`, which is derived rather than carried here: a
   * `TrakState` nested inside a `TrakState` is a recursive tagged enum, and the
   * field is a fact about the trak rather than about the state.
   *
   * `apiKind` is the second axis and not a fifth `Failure`: `kind` says whose
   * fault this is, and this says what the API did. `undefined` on every failure
   * that is not the provider's, on a provider failure the CLI reported no
   * in-band error for, and on a log written before the field existed — so a
   * reader must treat it as *nobody said* rather than as `unclassified`.
   *
   * `runner` is the runner verb the failure came from, off the event — a sandbox the
   * provider's limit would not start, or a verb that exited — so a surface can lead with
   * its sentence. Absent on every failure no runner caused, and with no runner file.
   *
   * `runnersOnly` is the refusal of an engine started under `--runners-only`, in the
   * guard's words, off the event — whichever `kind` the refused spawn makes it. The fix
   * is a runner for the project, not anything about the work.
   *
   * `carried` is the ref holding the sandbox's uncommitted changes, where a remake that
   * captured them failed before they were put back — so the notice can say where they
   * are, and that a retry starts from the branch without them.
   *
   * `setup` is what the project's setup script printed, where setup is what failed — in
   * the background beside the work, or again in a checkout made again — so the notice says
   * so, rather than that the checkout could not be made, and can show what it printed.
   */
  Failed: {
    readonly error: string
    readonly kind: Failure
    readonly apiKind: ApiErrorKind | undefined
    readonly runner?: RunnerFailure
    readonly runnersOnly?: string
    readonly carried?: string
    readonly setup?: string
  }
}>
export const TrakState = Data.taggedEnum<TrakState>()

/**
 * The states a human can be standing at. A subset of `TrakState` rather than a
 * union of its own, so there is nothing to keep in sync.
 */
export type Gate = Extract<
  TrakState,
  { readonly _tag: "AwaitingProposal" | "AwaitingComposerAnswers" | "AwaitingHuman" }
>

/**
 * The states a trak is genuinely over in, as against merely stopped.
 *
 * `Failed` is not one: it is where a trak waits until a human says otherwise, and
 * `Restarted` is what moves it. These have no command left to re-run, which is
 * what makes them the set `Reentered` applies to and the set `Abandoned` refuses
 * — the two questions have one answer, so they read it from one place.
 *
 * `Finished` is at rest **and still holds its checkout**. They are two facts;
 * anything that wants the second one asks about
 * the state by name rather than widening this.
 */
export const atRest = (state: TrakState): boolean =>
  state._tag === "Finished" ||
  state._tag === "Closed" ||
  state._tag === "Merged" ||
  state._tag === "Abandoned"

/**
 * Whether a trak in `state` still has its checkout: every state but the three endings,
 * which took it away.
 */
export const holdsCheckout = (state: TrakState): boolean =>
  state._tag !== "Closed" && state._tag !== "Merged" && state._tag !== "Abandoned"

/**
 * Whether a trak in `state` does nothing until a person acts: standing at a gate, or
 * `Failed`. The runner file's `idle_minutes_waiting` keeps its sandbox up for this long,
 * so a reply does not pay a resume. `Finished` is not one: what a person does there — a
 * merge or an archive — runs on the engine's machine, not in the sandbox.
 */
export const waitsOnPerson = (state: TrakState): boolean =>
  asGate(state) !== undefined || state._tag === "Failed"

/**
 * The states a trak is put away in: the three endings, and the two on the way to them.
 *
 * What the list leaves out and the sweep skips — `Archive` holds the ids this answers
 * true for, so neither reads the log. `Closing` and `Abandoning` are in because the
 * press has been made: nobody is owed anything by the trak from that moment, and a
 * failed archive is `Failed`, which is not here and comes back out. The client files
 * exactly these five under its archived pile (`sections.ts`), and the two must agree:
 * a state here that the client draws is a row the engine never sends.
 */
export const archived = (state: TrakState): boolean =>
  state._tag === "Closing" ||
  state._tag === "Abandoning" ||
  state._tag === "Closed" ||
  state._tag === "Merged" ||
  state._tag === "Abandoned"

/** Total, so `applyEvent` can ask of any state without knowing which it has. */
export const asGate = (state: TrakState): Gate | undefined =>
  state._tag === "AwaitingProposal" ||
  state._tag === "AwaitingComposerAnswers" ||
  state._tag === "AwaitingHuman"
    ? state
    : undefined

// ============================================================================
// Trak — the replayHistory of an event log
// ============================================================================

/**
 * One background task a filing stopped: the provider's own handle for it, and what the
 * agent called it when it started it. A provider that names none leaves only the handle.
 */
export const StoppedTask = Schema.Struct({
  id: Schema.String,
  description: Schema.optional(Schema.String),
})
export type StoppedTask = Schema.Schema.Type<typeof StoppedTask>

/** One message a person sent that is still to be read. `id` is what its delivery names. */
export interface WaitingMessage {
  readonly id: string
  readonly message: string
  readonly attachments: readonly Attachment[]
}

export interface Trak {
  readonly id: TrakId
  readonly description: string
  /**
   * The files a person sent with the request, in the checkout under `ATTACHMENTS_DIR`. Set
   * once, by `TrakCreated`; empty for every other birth and every log before the field.
   */
  readonly attachments: readonly Attachment[]
  /**
   * Where this trak came from, and `undefined` for one a human asked for.
   *
   * Set once, by `TrakCreated`, and never changed: a child is born with an
   * origin the way it is born with a plan. See `Parent`.
   */
  readonly parent: Parent | undefined
  /**
   * How much of this trak its person wants to stand at. See `RunMode`.
   *
   * **Not a mechanism field.** How a piece of work is being run is part of what it
   * is — the same footing as `decisions` — so it may cross a boundary, and a record
   * of the trak can say whether it ran unattended. `manual` for every log written
   * before the field existed.
   */
  readonly mode: RunMode
  /**
   * The person asked to hold the step that is running or gated until they accept it,
   * whatever the mode would do at its gates. A spawn is not such a step — it has no
   * gate on any mode — so a hold passes over one to the first entry after it that has.
   *
   * **One-shot.** Set by `HoldChanged`, spent by `applyEvent` as that step is accepted
   * — or as the trak comes to rest, with nothing left to hold; on a child it holds the
   * ending at `Finished` first — and
   * cleared by a `ModeChanged` to `manual`, where it promises nothing the mode does
   * not. Read in `attention.ts` beside `mode`, and nowhere else. Not a mechanism field, for `mode`'s reason: a person pressed it,
   * and a surface has to show that it is pending.
   *
   * *Holding* rather than *held* because `Runs.holder` is custody, a different
   * thing under a neighbouring word.
   */
  readonly holding: boolean
  /**
   * The person asked for the next check run not to happen: whichever `RunChecks` is
   * issued next runs nothing, and the step is accepted exactly as a pass would accept
   * it — on `auto`, with nobody reading it.
   *
   * **One-shot, `holding`'s shape without its clamp.** Set by `SkipChecksChanged`, spent
   * by the `ChecksPassed` that records what it skipped — never by a run with nothing to
   * skip, so it waits past a step whose agent declares no checks for the first that
   * does. Offered on every mode, `manual` included, because every mode runs its checks.
   * Read in `runtime.ts`'s `RunChecks` and nowhere in `decide`, which cannot see the
   * check list; what the run read is on the event, so a replay never re-reads today's
   * switch against yesterday's log. Not a mechanism field, for `holding`'s reason.
   */
  readonly skippingChecks: boolean
  /**
   * The engine merges this trak's pull request on the forge, and `undefined` where it
   * does not. Set by `TrakCreated` and by a person's `AutoMergeChanged`, which starts it
   * afresh; counted by every `Reentered` that carries a cause, and stopped by
   * `AutoMergeStopped`. Read by the forge sweep, and by
   * `outcomeOf`, which hears a stopped one as `stuck`.
   */
  readonly autoMerge: AutoMerge | undefined
  /**
   * The method a person picked on the finished band, which the press and auto-merge both
   * merge with — `undefined` is the repository's default. Set by `MergeMethodPicked`.
   */
  readonly mergeMethod: MergeMethod | undefined
  /**
   * The engine re-entered this trak to resolve a conflict on its pull request, and the
   * trak has not come to rest since. Every gate is taken in advance while it is set, on
   * every mode — the fix goes straight through to the push. Cleared by `applyEvent` as
   * the trak rests. A pending hold still stands: it is read before this.
   */
  readonly resolving: boolean
  /**
   * What a person has said that no agent has read yet, oldest first — `MessageWaiting`
   * adds one and `MessageDelivered` takes it out. Whatever is here when a turn starts
   * is handed to it, and whatever is here when the trak parks at a gate that takes
   * `Chat` is sent as that chat: `heldChat` in `decide.ts`.
   */
  readonly messages: readonly WaitingMessage[]
  /**
   * Messages that waited and were never sent, for the person to have back: a stop
   * takes every waiting message, and so does the trak coming to rest. Stands until
   * they say something again, which is when it stops being theirs to take back.
   */
  readonly returned: readonly string[]
  /**
   * The background work each session's last filing stopped, by the session that filed.
   * A session with an entry has not been told: the provider reports the stop to nobody,
   * so the next prompt sent to that session names what is here. The next turn that
   * session returns replaces the entry, which is what makes it said once.
   */
  readonly stopped: ReadonlyMap<SessionId, readonly StoppedTask[]>
  /**
   * What happened at each entry's gate, keyed by the entry: taken by the engine with
   * nobody reading it, and what the rule read to take it — or held for the person by a
   * pressed hold. **One mark per entry, by construction**: an entry has more than one
   * gate, so whichever gate the entry reached last is the one recorded, and a hold is
   * written last where both would land on one entry.
   *
   * Stamped by `applyEvent` from the same decision that moved the state, which is
   * what fixes it: recomputed from the mode instead, setting a trak to `manual` would
   * erase the mark on every document already filed, and re-derived from the log a
   * commit on the way to the next turn and a stop look alike. Only the gates that are
   * behind are here — a mark says a gate went past, not that the rule would take it.
   * A hold spent at a stop with no entry — the rest a finished trak holds at — lands
   * nowhere.
   *
   * Derived state like `decisions`, not scaffolding, so it crosses the wire as
   * `TrakDetailDto.marks`.
   */
  readonly marks: ReadonlyMap<number, Mark>
  /**
   * What has happened and what is still to come, in one list.
   *
   * A `Plan` rather than a `Proposal`: a proposal is what the composer returned, and
   * this also holds the composer's own runs and every attempt that was made — see
   * `Plan` in `outputs/proposal.ts`. **Nothing in it that has run is ever moved,
   * replaced or renumbered**, which is what lets an index in the log stay true and
   * `artifactKey` stay stable without anyone being careful.
   */
  readonly plan: Plan | undefined
  /**
   * The composer's session **while it is in flight**, before its entry exists.
   *
   * A compose entry is appended when the run returns, so a turn that has not returned
   * yet has no slot to be recorded in — and `TurnFailed` with no step, and `Restarted`
   * while `Composing`, both need somewhere to put it. Once the entry lands, the slot at
   * its position is the record and this is the pointer; they hold the same value and
   * answer different questions.
   */
  readonly composerSession: SessionId | undefined
  readonly state: TrakState
  /**
   * The last gate this trak parked at, and the one a conversational reply
   * returns to.
   *
   * Carried for the reason every mechanism field here is: `decide` sees only
   * `(trak, event)`, and by the time an agent answers a human the state is
   * `AgentWorking` — the gate the human was standing at is two events back in the
   * log and nowhere else. Holding it means a reply lands exactly where the
   * conversation started, so approving still means what it meant, and a stuck
   * account survives being argued with.
   */
  readonly lastGate: Gate | undefined
  /**
   * The state a `Failed` trak can be sent back to, and `undefined` whenever it
   * is not failed.
   *
   * Carried for exactly the reason `gate` is, one state along: `decide` sees
   * only `(trak, event)`, so when a human asks to retry, the position the trak
   * failed at is one event back in the log and nowhere else. Holding it is what
   * makes `Failed` re-enterable at all — `error` says why, and nothing said
   * *where*.
   *
   * Unlike `gate` it does **not** survive: a retry's new state is the position
   * itself, so this clears by construction rather than by being cleared.
   * `undefined` on a failed trak means its log was written before this field
   * existed, which settles rather than guessing at a position.
   */
  readonly failedFrom: TrakState | undefined
  /**
   * Artifact key -> the document the agent wrote. `artifactText` renders one.
   *
   * The key is `artifactKey(step, index)` — the step's position and its agent,
   * `2-build` — assigned by the engine rather than named by the composer.
   *
   * **A `stuck` account is filed here too**, as the document it is: `tried`,
   * `happened` and `diagnosis` are three named prose fields, which is what `sections`
   * already is — the struct exists to hold an agent to three answers, not to describe a
   * shape worth storing differently. What is stored and what a given agent is shown are
   * separate questions, and the second is `visibleArtifacts`' to answer; a record that
   * threw away the account of *why a step failed* to save a later reader from it is
   * lossy at write time, which is the one place a mistake cannot be undone.
   *
   * **Last write wins**, keyed by position and name. A step that went stuck and then
   * recovered on a chat overwrites its account with the work, and nothing is lost: both
   * `AgentReturned` events are in the log, which is the record. This map is the current
   * answer to *what does this position hold*.
   */
  readonly artifacts: ReadonlyMap<string, Document>
  /**
   * What a child was born holding: its parent's artifacts, keyed as the parent
   * filed them, in plan order. Empty for every trak a human asked for.
   *
   * **A second channel rather than entries in `artifacts`**, and each of these
   * would be enough on its own. `visibleArtifacts` walks *this* trak's plan, so a
   * merged entry would be invisible. The keys collide — a child's one-step plan
   * files under `0-<agent>`, and a parent whose step 0 was `review` spawning four
   * `review` lenses collides exactly. And `landOnParent` sends the last of
   * `visibleArtifacts` home, which has to stay the child's own work.
   *
   * `decisions` gets away with one channel because a count splits it; there is no
   * such arithmetic here.
   *
   * **Not a mechanism field**, like `decisions` and `skipped`: what a piece of
   * work was handed is part of what that work is. It survives a replan for the
   * same reason — a child re-planning its own steps did not change what it was
   * born with.
   */
  readonly inherited: readonly (readonly [string, Document])[]
  /**
   * The split this trak is one piece of, and `undefined` for a trak nobody split.
   *
   * Carried rather than looked up, for the reason `base` and `decisions` are:
   * replay is per-log, so a child never sees the parent's plan the partition is
   * written in. See `Split`, which is also where *no locations, ever* is argued.
   *
   * **Not a mechanism field**, like `inherited`: what a piece of work was split out
   * of is part of what that work is. Read it through `splitWithSiblings`, which is
   * where *a spawn of one has nobody to be told about* is decided once.
   */
  readonly split: Split | undefined
  /**
   * Every requirement any step has recorded, in log order. The description plus
   * these is the trak's current intent — and that, not the original request, is
   * what the composer and every later agent read.
   *
   * **The field is `decisions` and an agent writes `requirements`.** The two are one
   * channel; the stored name cannot move without making every log written so far
   * undecodable. `outputs/decided.ts` carries the whole of it.
   *
   * A list rather than a map, because there is no key: entries accumulate,
   * nothing is withdrawn, and *latest wins* needs only the order. A re-run step
   * adds what its earlier attempts did not file and nothing twice — `accumulated`
   * — which is what keeps every entry's id, its place among its step's, fixed.
   *
   * **Not a mechanism field.** Unlike `lastGate` and `failedFrom` this is part of
   * what a trak *is*, the same way `artifacts` is, so it may cross a boundary —
   * see `app/dto.ts`.
   *
   * It deliberately outlives what the projection drops: when work routes backward
   * the superseded artifact leaves `.orkestra/.trak/` and its decisions stay here.
   * A decision is a fact about the conversation, not a property of the document
   * that happened to carry it. See `outputs/artifact.ts`.
   */
  readonly decisions: readonly Recorded[]
  /**
   * The composer is owed another turn, and `undefined` whenever it is not. See
   * `Reconsult`.
   */
  readonly reconsult: Reconsult | undefined
  /**
   * What landed children sent back have handed up since a composer last ran, in the
   * order it arrived. Empty on most traks, and always on one that is not a parent.
   *
   * **A hand-up refiled after the join has no join to ride**, and it may not splice
   * an ask: the parent is parked wherever it is parked, and an entry written at the
   * join there displaces whatever the plan holds next — the step a wait is holding
   * included, which the sweep then walks past. So it waits here for the next
   * composer turn, whatever asks for one, and `handed-up.md` puts it in front of that
   * turn — in every composer body, the resumes included, because the run that lands
   * spends it whichever body it was sent. A run prompted before it arrived spends
   * it unread, and then the child's decisions on `decisions` are what carries the
   * finding, as they do on every turn.
   *
   * Not a mechanism field: what has been handed up and not yet planned for is a fact
   * about the work, as `decisions` is.
   */
  readonly handUps: readonly string[]
  /**
   * position -> everything the trak has accumulated there. Read it with
   * `slotAt`, which is total; absent means nothing has happened at that
   * position yet.
   *
   * **One map rather than one per fact, because they share a lifetime.** A
   * revision that replaces the step at a position invalidates all of it at
   * once, and five maps to truncate is a list somebody forgets — see `replan`
   * in `replay.ts`, which is now one operation. A new per-position fact is a
   * field on `Slot` and is dropped at a splice for free.
   *
   * **Artifacts are deliberately not in here.** They are keyed by
   * `artifactKey`, not by position — a spawn files one document per *child* —
   * and they survive a splice, which nothing in a slot does.
   */
  readonly slots: ReadonlyMap<number, Slot>
  /**
   * Where this trak works: the checkout every agent turn and every check runs
   * in, and the branch that keeps the result.
   *
   * `undefined` until `WorktreeReady`, and only genuinely absent for a caller
   * that runs a command outside `advance` — `pnpm real:compose` composes with no
   * `Vcs` layer at all. After `Integrating` the branch is still where the work
   * is; the path is where it was.
   */
  readonly worktree: Worktree | undefined
  /**
   * Where the project's setup script stands, as the log last said: `running` from a
   * `SetupStarted`, then `passed` or `failed`. `undefined` for a project with no setup
   * script, and for every log written before setup ran in the background — there
   * `WorktreeReady` already means it passed.
   */
  readonly setup: "running" | "passed" | "failed" | undefined
  /**
   * The branch has gone in, and `sha` is the commit it landed as — folded from a
   * `merged` or `deployed` wait finding it so, from a merge made here while one was
   * pending, or from the `merged` asked once more as a person skips a wait. Derived,
   * never stored, and **set only while a plan is held**: a trak merged with no wait
   * ends `Merged` and is never asked to run anything on the checkout afterwards, where
   * a landed trak is exactly one whose plan carries on.
   *
   * What follows from it is one rule: the checkout is no longer a base anything may
   * write to, so a `permission: write` agent is refused in every plan or spawn from
   * here — read at decode by `ComposerOutputFor`, and on the way into a step. The one
   * turn narrowed rather than refused is the engine's own agent asked a question
   * through the re-entry door, which runs read-only. **A spawn's child is held to its
   * parent's**, read off the parent's log at the moment of refusal rather than copied
   * at birth, because the parent can land after the child was cut and after the child
   * merged back — `writesRefused` in `runtime.ts`. Crosses the wire as
   * `TrakProjectionDto.landed`, because a surface hides the merge press and draws the
   * deploy off it.
   */
  readonly landed: { readonly sha: CommitSha } | undefined
  /**
   * When the plan's unrun entries were proposed — the `at` on the newest event carrying
   * a proposal — and what every pending `wait_until` resolves against. Derived, never
   * stored, and never carried on a condition's answer: two writers of one instant
   * drift, and this one is read through `waitUntilAt` wherever it is needed.
   *
   * One field rather than one per entry, because every unrun entry comes from the
   * newest plan-carrying event: a revision truncates the unrun tail and replaces it,
   * so nothing that is still to run was proposed by an earlier turn. An entry that
   * ran may have been — its anchor is a compose turn the trak no longer names, which
   * is why nothing resolves a wait behind `firstUnrun`.
   *
   * `undefined` on a trak with no plan, and on a log written before events were
   * stamped, where a duration has nothing to count from and reads as no wait.
   */
  readonly planAt: number | undefined
  /**
   * The branch this trak's own branch starts from, recorded when it was created.
   *
   * `undefined` means the host repository's `HEAD` — a trak a human asked for
   * branches off whatever they were standing on. A child is handed its parent's
   * branch instead, so it starts from the work already done rather than beside
   * it, and comes back to it when somebody says it should.
   *
   * Carried on the trak rather than derived from `parent` at setup time, because
   * replay is per-log: this trak will never see its parent's events, and the
   * branch it was told to start from is a fact about its own creation.
   */
  readonly base: BranchName | undefined
  /**
   * The trak whose composer handed this work off, and `undefined` for one a human
   * asked for or a spawn's child. See `HandOff`.
   *
   * The link's near end: the far end is the `HandedOff` on that trak's own log. Set
   * once, by `TrakCreated`, recorded and drawn and never routed on — nothing waits
   * on this trak, joins it or merges it back, which is what separates it from a
   * child, and why this is not a `Parent`.
   */
  readonly handedOffFrom: TrakId | undefined
  /**
   * The goal whose composer opened this trak, and `undefined` for every other trak. Set
   * once, by `TrakCreated`. The trak is an ordinary one from then on — its gates are its
   * person's — and the goal hears how it ended through the daemon's watcher.
   */
  readonly goal: GoalId | undefined
  /**
   * The goal branch this trak was cut from and lands on, for a goal that has one: its
   * pull request targets it, and the Merge press merges into the engine's checkout of it.
   * Set once, by `TrakCreated`, so the trak replays to what it was opened against.
   */
  readonly goalBranch: BranchName | undefined
  /**
   * The host user this trak belongs to, and `undefined` for one opened with nobody named —
   * `pnpm serve` alone, a host with no users, and every log written before the field
   * existed. Set by `TrakCreated`: a person's press names them, a spawn's child and a
   * handed-off trak take the owner of the trak they came from, and a goal's trak its goal's.
   * Changed by `OwnerChanged`, which only an old log carries. Routed on by nothing in `decide`.
   */
  readonly owner: UserId | undefined
}

/**
 * Everything the trak has accumulated at one plan position.
 *
 * The word is this file's own: a slot is what a position *holds*, as against
 * the `Step` the composer wrote and the `number` that indexes it. Three words,
 * three things.
 *
 * Read through `slotAt` and never `slots.get`: absent is an ordinary answer —
 * a position the trak has not reached, or one a splice just cleared — and a
 * caller carrying its own default for that is a caller that can disagree with
 * the others about what an untouched position means.
 */
export interface Slot {
  /**
   * The agent session for this position, as the provider announced it: the UUID the
   * runtime minted where the CLI takes one (`claude --session-id`), the CLI's own
   * where it mints its own (`codex`). Recorded in the log, so a later iteration
   * resumes the same conversation instead of starting a new one.
   *
   * Dropping this with the slot is most of what a replan buys: a stuck
   * `3-build` replanned into `3-unblock` must not resume the five failed
   * attempts the rescuing agent was hired to arrive without.
   */
  readonly session: SessionId | undefined
  /**
   * Attempt count at this position. Derived, never stored.
   *
   * Every turn that is not prose: a round of `questions` counts, and so does the
   * filing after it. That is the count `attention.ts` bounds a step by when it is
   * answering its own questions unattended, so it is not the one a surface draws
   * as *how much was done here* — `filings` is.
   */
  readonly iterations: number
  /**
   * Documents filed at this position — an artifact or a `stuck` account, each time
   * one returned. Derived, never stored.
   *
   * Narrower than `iterations` on purpose: a step that asked three questions and then
   * filed once did one piece of work, and the questions were how it got there. A
   * spawn position never files, and a position mid-conversation has not yet, so a
   * surface that reads this floors it by `ran`.
   */
  readonly filings: number
  /**
   * A human waved this position through without it filing anything.
   *
   * **A flag and a note, rather than presence in a map.** *Was it skipped* and
   * *what did they say* are two questions, and one optional value cannot tell
   * "not skipped" from "skipped without a word" — both readers want a different
   * one of those.
   *
   * Part of what the trak is rather than scaffolding: a step nobody ran is a
   * fact about this piece of work, and the next agent is told about it. *Review
   * skipped on nine of the last twelve traks* is a finding about review that
   * nothing else in the log would produce.
   */
  readonly skipped: boolean
  readonly skipNote: string | undefined
  /**
   * The traks a spawn position created, in plan order — empty for an agent
   * turn, and for a spawn whose ids never reached the log.
   *
   * Written by `ChildrenSpawned` and filled in by each `ChildLanded`, which is
   * what makes *have they all landed?* arithmetic and durable: forty minutes of
   * children that dies at minute thirty-eight keeps every child that had already
   * come back, because each landing is a fact in this log rather than a value
   * held in a fiber.
   */
  readonly children: readonly ChildRun[]
  /**
   * What the turn at this position reported about what it ran into, and `undefined`
   * until one has. Derived, never stored.
   *
   * **One field for a step and for the composer**, written where each lands its work:
   * a step's rides its artifact, and a compose run's rides the proposal onto the slot
   * at its own entry, beside that run's session. Read through `ambiguityOf`, which is
   * what makes absent an answer rather than a gap — a stored trak whose turns predate
   * the field replays with every rung absent, and nothing about where it stops moves.
   *
   * In the slot rather than on the plan entry, for `session`'s reason: it is what this
   * position *holds*, not what the composer wrote down about the work to do.
   */
  readonly ambiguity: Ambiguity | undefined
  /**
   * How this position's checks have been failing, and `undefined` once they
   * pass. Derived, never stored.
   *
   * Here rather than computed in `decide` for the reason `lastGate` is a field:
   * `decide` sees only `(trak, event)`, so comparing this failure to the last one
   * needs the last one to already be on the trak.
   */
  readonly checkFailures: CheckFailureRun | undefined
  /**
   * Which of the two answers to *did the work happen?* this position last gave,
   * and `undefined` until it has given one. Derived, never stored.
   *
   * Here because `artifacts` cannot say: it holds a `stuck` account under the same
   * key as the document it would have filed, and the two are told apart by nothing
   * in the map. What needs to tell them is a chat — a person arguing with an
   * account is owed a whole document, where one editing an artifact is owed only
   * the sections that changed — and the gate a step is parked at is the wrong
   * witness, because a chat is offered at every gate. See `standingArtifact`.
   */
  readonly filed: "artifact" | "stuck" | undefined
  /**
   * The command this position last asked a person's permission to run, and
   * `undefined` once a later turn returned anything else. Derived, never stored.
   *
   * Here because a gate carries no payload and `decide` sees only the press: the yes
   * it writes quotes this, so the command a person allowed is the one the step named,
   * never one a surface sent back.
   */
  readonly permission: string | undefined
  /**
   * The condition this position is held behind, and `undefined` once it is met or
   * where none was ever asked. Derived, never stored.
   *
   * The one per-position fact that lands on a position **before** it runs, which is
   * why it is read through `pendingWait` rather than off the map: the plan can be
   * re-cut at this very index while the fact stands — a person sending the trak
   * back — and the entry the index then names is not the one that was waiting.
   * `Reentered` clears it for that reason, and every reader asks `firstUnrun` first.
   *
   * `stopped` is the condition having given up — an exit that is neither `0` nor
   * `1` — so the daemon asks no more. The trak is still at rest and still holds the entry; what changes is that
   * nothing is coming to run it.
   */
  readonly waiting: Waiting | undefined
  /**
   * The condition a person skipped the wait on, to start this position without it —
   * `WaitSkipped`'s `name` — and `undefined` where nothing was skipped. Derived, never
   * stored.
   *
   * Read by the step's first prompt and by nothing that routes: the turn is told
   * what it was waiting on and that it was not met, which is the one thing a forced
   * step must not assume. Left on the slot afterwards as `skipped` is, and for the
   * same reason — a fact about what happened at this position.
   */
  readonly skippedWait: string | undefined
  /**
   * What the compose run at this position handed off — each description a trak to
   * open on the default branch — and empty for an agent turn, a spawn, and a compose
   * run that handed off nothing. Derived, never stored.
   *
   * **The latest run's, whole.** A composer chatted with at the plan gate answers
   * again under the same session and at the same entry, and what it says then is the
   * hand-off: a run that drops the field has withdrawn it, which is how a hand-off is
   * refused through the chat bar. Read by `handOffPending` against `handedOff` below.
   */
  readonly handOffs: readonly string[]
  /**
   * The traks those hand-offs were opened as, once the plan gate went past — the
   * base they are cut from, and one id per description in `handOffs`' order. Written
   * by `HandedOff`, and `undefined` until it lands.
   *
   * The ids live here rather than in `children`, because these are not this trak's
   * to wait on: nothing here is a landing, and a reader that found them among the
   * children would hold the plan for traks that never come back.
   */
  readonly handedOff: HandedOff | undefined
  /**
   * The goal the compose run at this position proposed on its finish, in its markdown,
   * and `undefined` for every other run. Derived, never stored, and the latest run's whole,
   * as `handOffs` is: a run that drops it has withdrawn it. Read by `goalOwed`.
   */
  readonly goal: string | undefined
  /** The goal that proposal opened as, once it started. Written by `GoalOpened`. */
  readonly goalOpened: GoalId | undefined
}

/**
 * The traks a compose entry's hand-offs opened as. See `Slot.handedOff`. A goal's trak's
 * names none and no base: its hand-off went to the goal, which opens what it decides to.
 */
export interface HandedOff {
  readonly base: BranchName | undefined
  readonly ids: readonly TrakId[]
}

/** What a position waits on: the condition by name, and whether it has given up. */
export interface Waiting {
  readonly name: string
  readonly stopped: boolean
}

/** A wait, with the position that holds it. */
export interface Wait extends Waiting {
  readonly step: number
}

/**
 * A position nothing has happened at.
 *
 * Every field is stated rather than left off, so `slotAt` can be total and a
 * field added without a default is a compile error here rather than an
 * `undefined` at nine call sites.
 */
export const noSlot: Slot = {
  session: undefined,
  iterations: 0,
  filings: 0,
  skipped: false,
  skipNote: undefined,
  children: [],
  ambiguity: undefined,
  checkFailures: undefined,
  filed: undefined,
  permission: undefined,
  waiting: undefined,
  skippedWait: undefined,
  handOffs: [],
  handedOff: undefined,
  goal: undefined,
  goalOpened: undefined,
}

/**
 * The first position that has not run — where a revision is appended.
 *
 * **Arithmetic, not a judgment.** One question, asked of every kind of entry: did a
 * session ever exist at this position? A turn's arrives with its output, a compose's is
 * written when its run lands, and a person skipping or a spawn's children standing in
 * for one are the two ways a position counts without a turn. Entries run in order, so
 * the first that answers no is the end of the record and the start of the guesswork.
 *
 * **A compose entry the composer proposed is unrun like anything else**, which is what
 * makes it enterable: the plan reaches it, `decide` issues a `Compose` for it, and
 * `landCompose` fills the entry in rather than appending beside it.
 *
 * This replaced `joinAfter`, which asked the same question through
 * `artifacts.has(artifactKey(...))` — *did this step file anything?* — and would have
 * inverted the moment a stuck account started filing. It also asked something subtly
 * different: it **replaced** a step that filed nothing, so a stuck attempt vanished
 * from the plan. Now nothing that ran is replaced, and re-doing that work is a new
 * entry at a new index.
 */
export const ran = (t: Trak, i: number, entry: Step | undefined): boolean => {
  if (entry === undefined) return true
  const slot = slotAt(t, i)
  // A session means a turn happened here, whatever it returned — which is the
  // question, and a narrower one than `iterations`: a conversational step that has
  // only replied in prose never bumps that counter, and a spawn position never
  // returns at all. Both ran; both stay.
  return slot.session !== undefined || slot.skipped || slot.children.length > 0
}

/**
 * The artifact a chat at this step would amend, or nothing where none stands.
 *
 * Read off `Slot.filed` rather than off `artifacts` alone, because that map also
 * holds a `stuck` account under the same key — and a person arguing with one is
 * owed a whole document, not a set of edits laid over *tried / happened /
 * diagnosis*. Not read off the gate either: the contract promises the relaxation
 * on every chat, and a chat is offered at every gate — a step that filed and then
 * asked a question is chatted at from the `answers` gate, and owes the same
 * envelope there as it would at `approval`.
 */
export const standingArtifact = (t: Trak, i: number): Document | undefined => {
  const entry = t.plan?.steps[i]
  if (entry === undefined || slotAt(t, i).filed !== "artifact") return undefined
  return t.artifacts.get(artifactKey(entry, i))
}

export const firstUnrun = (t: Trak): number => {
  const steps = t.plan?.steps ?? []
  let i = 0
  while (i < steps.length && ran(t, i, steps[i])) i += 1
  return i
}

/**
 * The condition the plan is held behind, whatever state the trak is in — the entry
 * `firstUnrun` names, where a condition was asked and not met.
 *
 * Asked of the first unrun position and never of the map, for `Slot.waiting`'s
 * reason: a fact left at an index the plan has since re-cut belongs to nothing.
 * `decide` reads this on the way *into* rest, to hold a trak there that its run mode
 * would otherwise end; every surface reads `waitingAt`.
 */
export const pendingWait = (t: Trak): Wait | undefined => {
  const step = firstUnrun(t)
  const waiting = slotAt(t, step).waiting
  return waiting === undefined ? undefined : { step, ...waiting }
}

/**
 * What a **resting** trak is waiting on, and `undefined` for one that is not — at
 * rest for any other reason, or not at rest at all.
 *
 * `Finished` alone, because that is the only rest a wait produces and the only one
 * it survives: a merge or an archive ends the trak with the entry still unrun, which
 * is the pending step being dropped, and a re-entry clears the fact before anything
 * else. Between the answer and the commit that rests the trak the fact is already
 * on the slot and the state is `Integrating`, which is a moment nobody draws.
 */
export const waitingAt = (t: Trak): Wait | undefined =>
  t.state._tag === "Finished" ? pendingWait(t) : undefined

/**
 * The step whose effect failed, where a failed effect is what stopped the trak, and
 * `undefined` everywhere else — the one position a skip of the effects applies at.
 *
 * `project` as well as `Effecting`, because an engine failure can also settle from
 * `Effecting`, and skipping past that would advance a step whose effects nobody saw fail.
 */
export const effectFailedAt = (t: Trak): number | undefined =>
  t.state._tag === "Failed" && t.state.kind === "project" && t.failedFrom?._tag === "Effecting"
    ? t.failedFrom.step
    : undefined

/**
 * The pending wait where it is one the engine answers itself — `merged` or
 * `deployed` — and nothing where the plan is held on a project's own script or on
 * nothing at all.
 *
 * Read where the answer is the engine's to give without a script: a merge made from
 * this machine passes `merged` and is the first half of `deployed`, so a trak held
 * on either keeps its checkout and asks again, where one held on a project script
 * ends as any merge ends — the script, not the engine, says what it waits for.
 */
export const engineWait = (t: Trak): Wait | undefined => {
  const wait = pendingWait(t)
  return wait !== undefined && engineCondition(wait.name) !== undefined ? wait : undefined
}

/**
 * Whether the merge itself is what `wait` waits for: an engine condition by name, or
 * the entry's own time on an entry that also waits for `merged` or `deployed` — the
 * time is asked first and the merge after it, so the step runs at that time once the
 * branch is in. A project's script, and a time on an entry with no `wait_for`, are
 * not: either may be a reason not to merge yet, such as a review still running.
 *
 * Reads the entry's `wait_for` and never the agent's `conditions:`, so a time wait is
 * read the same on every replay whatever the agent file says today.
 */
const mergeAnswers = (t: Trak, wait: Wait): boolean => {
  if (engineCondition(wait.name) !== undefined) return true
  const entry = t.plan?.steps[wait.step]
  return wait.name === WAIT_UNTIL && entry !== undefined && waitForOf(entry) !== undefined
}

/**
 * Whether auto-merge may go ahead past what a resting trak waits on: nothing, or a wait
 * that has not given up and that the merge answers — see `mergeAnswers`. A wait on
 * `merged` that held the merge would never end, since nothing else merges the trak.
 */
export const mergesPastWait = (t: Trak): boolean => {
  const wait = waitingAt(t)
  return wait === undefined || (!wait.stopped && mergeAnswers(t, wait))
}

/**
 * The instant the entry at `step` waits for, epoch milliseconds, or nothing: the entry
 * names no time, or names a duration on a log with no anchor to count it from.
 *
 * Resolved on every read against `planAt` rather than stored, which is what keeps the
 * runtime asking it, the sweep waking on it and the wire drawing it from one number.
 */
export const waitUntilAt = (t: Trak, step: number): number | undefined => {
  const entry = t.plan?.steps[step]
  const text = entry === undefined ? undefined : waitUntilOf(entry)
  return text === undefined ? undefined : resolveWaitUntil(text, t.planAt)
}

/**
 * The instant a wait is on, where the wait is the clock — the position's `waiting`
 * names `wait_until` — and nothing where it is on a condition by name.
 *
 * Read off the wait's name and the entry, never off the log's last not-yet: a step
 * holding a time *and* a condition writes more than one, and the one that rested the
 * trak is the clock's while the one that moved it on is the condition's.
 */
export const timeWaitOf = (t: Trak, wait: Wait): number | undefined =>
  wait.name === WAIT_UNTIL ? waitUntilAt(t, wait.step) : undefined

/**
 * The first entry at or after `i` whose checks this trak would run, or nothing.
 *
 * A spawn is stepped over: its children run their own checks on their own logs, and
 * this trak's next `RunChecks` is for the entry after it. A compose entry stops the
 * walk, because the plan past it is the composer's to write — and so does the end of
 * the plan, where `Finished` runs nothing.
 */
const checkedFrom = (p: Plan, i: number): number | undefined => {
  let at = i
  while (at < p.steps.length) {
    const entry = p.steps[at]
    if (entry === undefined || isCompose(entry)) return undefined
    if (!isSpawn(entry)) return at
    at += 1
  }
  return undefined
}

/**
 * The position whose checks the engine runs next, or nothing while there is none.
 *
 * **The forward path, at every state.** `RunChecks` is issued as a step's artifact
 * arrives, so the answer is the running step's own at `AgentWorking`, and the entry
 * after it everywhere the step has already filed: a run under way, a gate its
 * artifact or its failing checks stand at, and every state between the accept and the
 * next turn. A gate the step has not filed at — questions, a conversation, a stuck
 * account — resumes the step, so the answer is the step itself. Approving a plan
 * enters at `firstUnrun`, so that is the answer at the proposal gate; the composer's
 * own gates and turns answer nothing, since the plan is theirs to rewrite.
 *
 * `ConditionRunning` answers its own step, with `AgentWorking`: the entry has not
 * filed, so the checks that run next are its. A trak *held* on an unmet condition
 * rests at `Finished` and answers nothing until the condition resolves.
 *
 * **A gate has a backward exit this ignores.** Chat at an approval gate sends the
 * step round again and its checks run once more; the answer here is the entry after,
 * because that is where an approval goes. Read for what a one-shot armed now will
 * land on, not for what a person might choose instead.
 *
 * `undefined` past the last stop and at rest, where nothing runs again. `Failed` is
 * among them: a retry re-issues from `failedFrom`, which is scaffolding a projection
 * does not read.
 */
export const nextCheckedPosition = (t: Trak): number | undefined => {
  const p = t.plan
  if (p === undefined) return undefined
  const s = t.state
  switch (s._tag) {
    case "AwaitingProposal":
    case "HandingOff":
      return checkedFrom(p, firstUnrun(t))
    case "AgentWorking":
    case "ConditionRunning":
      return checkedFrom(p, s.step)
    // A stopped step parks at its conversation gate, which resumes it.
    case "Stopping":
      return s.step === undefined ? undefined : checkedFrom(p, s.step)
    case "AwaitingHuman":
      return s.kind === "approval" || s.kind === "checks"
        ? checkedFrom(p, s.step + 1)
        : checkedFrom(p, s.step)
    case "CheckRunning":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
      return checkedFrom(p, s.step + 1)
    case "Preparing":
    case "Composing":
    case "AwaitingComposerAnswers":
    case "Integrating":
    case "Finished":
    case "Merging":
    case "Closing":
    case "Merged":
    case "Closed":
    case "Abandoning":
    case "Abandoned":
    case "Failed":
      return undefined
  }
}

/**
 * Which entry, if any, is the compose run holding this session.
 *
 * `-1` means this run has not been written down yet — its first return. A run can
 * return more than once under one session, and this is what tells that from a new run:
 * the session is in the slot at the entry `landCompose` wrote for it.
 */
export const composeAt = (t: Trak, session: SessionId): number =>
  (t.plan?.steps ?? []).findLastIndex((s, i) => isCompose(s) && slotAt(t, i).session === session)

/** What the trak holds at `position`. Total — see `Slot`. */
export const slotAt = (t: Trak, position: number): Slot => t.slots.get(position) ?? noSlot

/**
 * The last compose entry before `i` — the run that wrote the plan `i` is in — and
 * `-1` before the first compose of a trak, which is every entry of a plan nothing
 * has asked about yet.
 */
export const composeBefore = (p: Plan, i: number): number =>
  p.steps.findLastIndex((s, j) => j < i && isCompose(s))

/**
 * The compose entry whose plan is on the table — the one behind the plan gate, and
 * the one a hand-off rides on. `undefined` where there is no plan or no compose run
 * behind it.
 *
 * `composeBefore` asked of the trak alone: the entry approving enters is `firstUnrun`,
 * and the run that proposed it sits last before that.
 */
export const planEntryOf = (t: Trak): number | undefined => {
  const p = t.plan
  if (p === undefined) return undefined
  const at = composeBefore(p, firstUnrun(t))
  return at < 0 ? undefined : at
}

/**
 * Does the plan on the table carry a hand-off nothing has yet named?
 *
 * The one question `decide` asks before entering a plan, and it is idempotent by
 * construction: `HandedOff` fills `Slot.handedOff` at the same entry, so the second
 * time through — a restart, a plan re-entered from its gate — the answer is no and
 * the traks already opened are not opened again.
 */
export const handOffPending = (t: Trak): boolean => {
  const at = planEntryOf(t)
  if (at === undefined) return false
  const slot = slotAt(t, at)
  return slot.handOffs.length > 0 && slot.handedOff === undefined
}

/**
 * Does the plan on the table carry a proposed goal nothing has yet opened?
 *
 * `handOffPending`'s question for a goal, and what makes a finish proposing one take the
 * plan gate. Never true of a child or a goal's trak, whose proposals are refused at decode.
 */
export const goalProposalPending = (t: Trak): boolean => {
  const at = planEntryOf(t)
  if (at === undefined) return false
  const slot = slotAt(t, at)
  return slot.goal !== undefined && slot.goalOpened === undefined
}

/**
 * The split, but only where there is somebody else in it.
 *
 * **A spawn of one renders neither the roster nor the rule** — a list naming nobody
 * and a rule about work that falls to nobody are where boilerplate blindness starts.
 * One function so `trak.md` and the two prompts cannot disagree about which traks
 * are told; asking `trak.split` directly is the drift this exists to stop.
 */
export const splitWithSiblings = (t: Trak): Split | undefined =>
  t.split !== undefined && t.split.pieces.length > 1 ? t.split : undefined

/**
 * The session that produced the document filed under `key` — `2-build`.
 *
 * `undefined` for three cases a caller must not tell apart: no entry has that key, the
 * entry has it but never ran, and the key names a spawn, whose position holds no
 * conversation at all. All three mean *there is nothing to continue*, and a step told
 * to continue one of them starts fresh, which is what it would have done anyway.
 *
 * The key is rebuilt from the plan rather than looked up in `artifacts`, because the
 * question is which conversation to resume rather than which document exists: a
 * position that filed nothing may still have a session worth continuing.
 *
 * Not exported: `borrowedSession` is the question the runtime actually has, and it
 * carries a fourth way the answer is nothing.
 */
const sessionOf = (t: Trak, key: string): SessionId | undefined => {
  const at = (t.plan?.steps ?? []).findIndex((s, i) => artifactKey(s, i) === key)
  return at < 0 ? undefined : slotAt(t, at).session
}

/**
 * The entry that minted the session the step at `index` runs in — `index` itself for a
 * step whose conversation is its own.
 *
 * A step carrying `continues` borrows a conversation, and the entry it names may have
 * borrowed in turn: `continues` is forward in the plan and a fix can be fixed. So this
 * walks the names back, one hop at a time, to the entry that started fresh. Each hop
 * is `sessionOf`'s question — a name resolving to nothing means *that entry started
 * fresh*, so the walk ends there — and the hop is only ever to an earlier position,
 * which is the one direction a conversation can be borrowed from. By name rather than
 * by session id, because a CLI that mints its own id may announce a different one on
 * resume, and a chain keyed on ids would break at the hop where it did.
 *
 * What it is for: `modelAt`. A session is never resumed under a different model, and so
 * never under a different CLI, and the model a session was minted with is on the entry
 * that minted it — its own pick, else its agent file's.
 */
export const mintedAt = (t: Trak, index: number): number => {
  const steps = t.plan?.steps ?? []
  let at = index
  for (;;) {
    const step = steps[at]
    const key = step === undefined ? undefined : continuesFrom(step)
    if (key === undefined) return at
    const from = steps.findIndex((s, i) => artifactKey(s, i) === key)
    if (from < 0 || from >= at || slotAt(t, from).session === undefined) return at
    at = from
  }
}

/**
 * The model the entry at `index` itself runs on: its own pick where a person made one,
 * else its agent file's `model:`, and the composer's for a compose entry.
 *
 * `undefined` for a position that holds no turn — a spawn — and for an agent the
 * library cannot name, which is a file renamed or deleted while the trak ran. Both are
 * *there is no model here*, which is `modelAt`'s question rather than a caller's.
 */
const modelOfEntry = (t: Trak, index: number, lib: Library): string | undefined => {
  const step = t.plan?.steps[index]
  if (step === undefined || isSpawn(step)) return undefined
  if (isCompose(step)) return lib.models.composer
  return modelOf(step) ?? agentNamed(lib, step.agent)?.model
}

/**
 * The entry the step at `index` takes its parameters from: the one that minted its
 * session — see `mintedAt` — or itself where that entry can no longer say anything.
 *
 * **The fallback and `borrowedSession`'s fourth way are one rule said twice.** An entry
 * whose agent file was renamed or deleted while the trak ran can no longer say what
 * model its session was minted with, so that session is not resumed at all and this step
 * starts fresh on its own — which is the entry this hands back. Falling back while still
 * resuming is the thing neither may do: it is Codex resuming a Claude uuid, which
 * fails the turn every retry.
 *
 * Resolved once and read for both the model and the effort, so the two cannot come off
 * different entries: an effort read with its own `??` would pick up *this* step's where
 * the conversation simply declared none — the rule inverted, with nothing failing.
 */
const parametersAt = (t: Trak, index: number, lib: Library): number => {
  const minted = mintedAt(t, index)
  return modelOfEntry(t, minted, lib) === undefined ? index : minted
}

/**
 * The model the step at `index` runs on: the model of the entry that minted its
 * session, falling back to its own where that entry has none — see `parametersAt`.
 *
 * The one place an entry's model and its agent's are resolved against each other. The
 * spawn site and the detail projection both read it, so what the header says a step runs
 * on is what the CLI was handed. `undefined` only where this step's own agent cannot be
 * found either, which is the entry the spawn will refuse too.
 */
export const modelAt = (t: Trak, index: number, lib: Library): string | undefined =>
  modelOfEntry(t, parametersAt(t, index, lib), lib)

/**
 * The reasoning effort the entry at `index` itself runs at, `undefined` where nothing
 * declared one — the CLI's own default, which is the ordinary case.
 *
 * The agent file's `effort:` beats the model's default in `models.yaml`, on the turns
 * that run on that file's model. Where a person picked a model, the pick carries its
 * own default and the file's level is not read: it was checked against the file's
 * CLI, and the pick may be on the other one. The composer runs at its model's default.
 */
const effortOfEntry = (t: Trak, index: number, lib: Library): string | undefined => {
  const step = t.plan?.steps[index]
  if (step === undefined || isSpawn(step)) return undefined
  if (isCompose(step)) return lib.models.efforts.get(lib.models.composer)
  const picked = modelOf(step)
  if (picked !== undefined) return lib.models.efforts.get(picked)
  const agent = agentNamed(lib, step.agent)
  return agent === undefined ? undefined : (agent.effort ?? lib.models.efforts.get(agent.model))
}

/**
 * The reasoning effort the step at `index` runs at: read off the same entry `modelAt`
 * reads the model off, so a step continuing another's conversation runs at that
 * conversation's effort and not at its own agent file's. The spawn site and the detail
 * projection both read it, for `modelAt`'s reason.
 */
export const effortAt = (t: Trak, index: number, lib: Library): string | undefined =>
  effortOfEntry(t, parametersAt(t, index, lib), lib)

/**
 * The conversation the step at `index` picks up, and `undefined` for one that starts
 * fresh — which is every step naming nothing, and the ways a name reaches nothing.
 *
 * `sessionOf` has three of those, all of them *there is nothing to continue*. This is
 * the fourth, and it is the opposite shape — there is a conversation, and it may not be
 * had: the entry that minted it names an agent the library can no longer find, so the
 * model it was minted with is unknowable, and a resume under this step's own model
 * would hand a `claude` id to `codex`, or the reverse. Dropping the borrow keeps the
 * rule whole — a session is never resumed under a different model, and so never under a
 * different CLI — at the price of a fresh conversation, which is what the other three
 * ways cost too.
 */
export const borrowedSession = (t: Trak, index: number, lib: Library): SessionId | undefined => {
  const step = t.plan?.steps[index]
  const key = step === undefined ? undefined : continuesFrom(step)
  if (key === undefined) return undefined
  return modelOfEntry(t, mintedAt(t, index), lib) === undefined ? undefined : sessionOf(t, key)
}

/** How a step's checks have been going. See domain/check-progress.ts. */
export interface CheckFailureRun {
  readonly count: number
  readonly signature: string
  /** The same check failed the same way twice running — nothing is being fixed. */
  readonly repeated: boolean
}

/**
 * The composer is owed a turn, and what it is being asked about.
 *
 * **One door with four feeders.** A step raising something, a person replanning, the
 * world coming back and a merge that conflicted are all *what should the rest of this
 * plan be?*, asked from somewhere. A fifth used to live here — a plan running out where
 * the composer said it would — and it is now an entry in the plan instead, so nothing
 * has to be carried for it.
 *
 * A **mechanism field**, like `lastGate` and `failedFrom`, and it never crosses a
 * boundary. It exists because `decide` sees only `(trak, event)`, and two moments need
 * it after the event that carried it has passed: the `Compose`, and the composer's own
 * prompt.
 *
 * **What it is answering is on the entry, which does cross.** `withAsk` writes that
 * entry into the plan at the same moment this field is set, so a surface asking what the
 * composer is doing has a row to point at for the whole of the turn rather than from the
 * moment it lands.
 *
 * **It no longer carries `from`.** Where a revision joined on used to be arithmetic
 * computed here and read in three places that had to agree; now nothing that ran is
 * ever replaced, so the join is simply the end of what ran and `firstUnrun` reads it off
 * the plan at the moment it is needed.
 *
 * Cleared by whatever **begins** the plan that answers it: the next `AgentReturned`, or
 * `ChildrenSpawned` when that plan opens on a spawn. Left set, the next compose would
 * record the wrong reason on its entry — and a spawn produces no `AgentReturned` at all,
 * so `AgentReturned` alone is not the rule.
 *
 * The entry goes with it where the turn never happened, which is a person arguing with
 * the artifact that raised it instead of approving it. See `withoutAsk`.
 */
export interface Reconsult {
  readonly why: ReconsultWhy
}

export const emptyTrak = (id: TrakId): Trak => ({
  id,
  description: "",
  attachments: [],
  parent: undefined,
  mode: "manual",
  holding: false,
  skippingChecks: false,
  autoMerge: undefined,
  mergeMethod: undefined,
  resolving: false,
  messages: [],
  returned: [],
  stopped: new Map(),
  marks: new Map(),
  plan: undefined,
  composerSession: undefined,
  state: TrakState.Preparing(),
  lastGate: undefined,
  failedFrom: undefined,
  artifacts: new Map(),
  inherited: [],
  split: undefined,
  decisions: [],
  reconsult: undefined,
  handUps: [],
  slots: new Map(),
  worktree: undefined,
  setup: undefined,
  landed: undefined,
  planAt: undefined,
  base: undefined,
  handedOffFrom: undefined,
  goal: undefined,
  goalBranch: undefined,
  owner: undefined,
})

/**
 * What the prompt about to be sent has to say was stopped — `Trak.stopped` for the
 * session it resumes. A turn that opens a session has nothing to be told.
 */
export const stoppedOn = (t: Trak, resumed: SessionId | undefined): readonly StoppedTask[] =>
  resumed === undefined ? [] : (t.stopped.get(resumed) ?? [])
