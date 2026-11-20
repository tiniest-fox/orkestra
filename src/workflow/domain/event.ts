// The persisted log: state-affecting facts only, in one place.
//
// Everything else about a trak is derived by replayHistory, so a shape added
// here is a shape every stored trak must keep round-tripping.

import { Array as Arr, Schema } from "effect"
import { ApiErrorKind } from "../../agent/types/provider-event.js"
import { Place } from "../../agent/types/place.js"
import { RunnerFailure } from "../../agent/types/runner-failure.js"
import { SessionId } from "../../agent/types/session.js"
import { Usage } from "../../agent/types/usage.js"
import { BranchName, CommitSha, MERGE_METHOD, type MergeMethod, Worktree } from "../../vcs/index.js"
import { Document } from "./outputs/artifact.js"
import { Decided, Recorded } from "./outputs/decided.js"
import { Proposal, Split } from "./outputs/proposal.js"
import { StepOutput } from "./outputs/step-output.js"
import { HumanAction } from "./human-action.js"
import { type Attachment, Attached, attachedField } from "./attachment.js"
import { ComposerOutput } from "./outputs/composer-output.js"
import {
  GoalId,
  Parent,
  ReentryCause,
  RunMode,
  StopCause,
  StoppedTask,
  TrakId,
  UserId,
} from "./trak.js"

/**
 * When this was written down — epoch milliseconds — on every event there is.
 *
 * **Stamped on the way into the log, never by a constructor.** `advance` stamps the
 * event before it applies it, so the trak it hands on and the trak the log replays
 * agree — `Trak.planAt` is read off this field, and on `auto` the plan that just
 * landed enters its first step in that same call; `Store.append` fills it for
 * anything appended around a drive and keeps a stamp it is handed. `decide` stays a
 * pure function of `(trak, event)` with no clock anywhere near it, none of the
 * constructors below grows a parameter, and every event added later gets a time
 * for free. The time an event was recorded is a fact about recording it.
 *
 * Optional because a log written before it existed has none, and *unmeasured* is
 * the honest answer there rather than a zero. `stamped` is what fills it.
 *
 * One field, and what it buys is two numbers: the gap between the event that
 * parked a trak and the one that unparked it is a human's attention, and the gap
 * between the rest of them is the work. Four hours is not a finding until you know
 * which of the two it was.
 */
const recorded = { at: Schema.optional(Schema.Number) }

/**
 * Where the work an event ends or begins ran — this machine, or a sandbox with the runner
 * that made it, its id and the command's exec id. Optional, so a log written before it was
 * recorded replays unchanged, and that work is drawn as nowhere in particular. Never read
 * by `decide`: it is an audit trail for a person.
 */
const ranAt = { place: Schema.optional(Place) }

/**
 * What the turn this event ends spent, on every event that ends one.
 *
 * **Not an event of its own.** A metering event would be one `decide` had to
 * treat as a no-op, and this engine's rule is that an event which cannot apply to
 * the state is a bug rather than something to ignore. A turn's cost is a fact
 * about that turn, and the event that ends the turn already names it.
 *
 * `TurnFailed` carries it too, and that is half the value: a turn that died forty
 * minutes in spent everything it spent, and those are exactly the turns nothing
 * was counting. **Every take-over that kills a live turn carries it for the same
 * reason from the other side** — `Stopped`, `FilingAsked`, the `HumanActed` a
 * `Replan` writes off a gate, and `Abandoned`: the person killed the turn, and what it
 * had spent by then is read off the run record before the kill — see `RunsShape.spent`.
 * A rule rather than a list of two, because the list is what shipped a third kill that
 * carried nothing.
 *
 * Optional on the same terms as `at` — absent means unmeasured, which is what
 * every log written before this says and what an event built by hand says.
 */
const spent = { usage: Schema.optional(Usage) }

/**
 * The text the agent wrote this output as — the exact slice `extractJson` took,
 * fence delimiters included.
 *
 * Spread into the two events that carry an output, so a surface can subtract it from
 * the words it draws and stop showing the same object twice: once as raw JSON in the
 * turn's log and once as the card beneath it. Recorded rather than re-derived at the
 * surface, because the scan that found it is the only thing that knows where it was.
 *
 * **It rides here and not on the transcript entry**: the entry is appended and
 * published while the stream is still flowing, and extraction only happens once the
 * turn is over.
 *
 * Absent when nothing was taken — a turn that answered in prose, one whose JSON did
 * not decode, and every log written before this.
 */
const wrote = { envelope: Schema.optional(Schema.String) }

/**
 * The background tasks that were still running when this turn filed, which filing
 * stopped. On the two events that carry an output, because an envelope is what ends a
 * turn with work outstanding.
 *
 * **Recorded here because the agent is never told.** The provider stops the work after
 * the turn's last word, so the session learns of it only from the next prompt it is
 * sent, and a prompt is built from the replayed log and nothing else.
 *
 * Absent when nothing was stopped, which is nearly every turn and every log written
 * before this.
 */
const halted = { stopped: Schema.optional(Schema.NonEmptyArray(StoppedTask)) }

/**
 * The engine version the turn this event ends ran under, on the three events that end one.
 *
 * **Per turn rather than once on `TrakCreated`**: the roles an agent runs under ship
 * with the engine and are read at boot, so an upgrade in the middle of a trak changes
 * the brief every later step runs under. With the brief out of the repo's diff, this is
 * what ties a turn to the words it was sent.
 *
 * Optional on the same terms as `at` — absent on every log written before this, and on
 * an event built by hand. `versioned` fills it at the append.
 */
const ranUnder = { engineVersion: Schema.optional(Schema.String) }

/**
 * A trak exists, and what it was born with.
 *
 * One event rather than a sibling per kind of birth, because *what this trak was born
 * with* is one fact: a request, an origin, a plan, a branch to start from, how much of
 * it a person wants to stand at, the intent it inherited, the documents behind it and
 * the split it is one piece of. Every field but the first is optional here, so a log
 * written before spawn existed replays unchanged.
 *
 * **Which combinations are legal is the constructors' business, not this schema's** —
 * `trakCreated` and `trakOpenedWith` are what say a child carries all six and a trak
 * opened with an agent carries a plan alone. A schema loose enough to decode every log
 * ever written cannot also be the place that rule lives.
 *
 * `plan` is what makes a trak not run a composer — `decide`'s `WorktreeReady`
 * arm enters it directly. A child's plan is deliberately **not** gated again: a
 * human approved the parent's plan, and that plan named these children.
 *
 * **A plan without a parent is the other way in.** A trak started from New Trak
 * with an agent named is born holding a one-entry plan and no origin — nothing to
 * inherit, nothing to gate, and the same `WorktreeReady` arm carries it, because
 * that arm asks about the plan and has never asked about the parent.
 *
 * `decisions` carries the parent's accumulated intent down, so the child's
 * `trak.md` opens with the same request-plus-decisions every other turn reads.
 *
 * `artifacts` carries the documents that intent was reached through, keyed as
 * the parent filed them. Values rather than a reference for the reason
 * `decisions` are values: replay is per-log, and this trak will never see its
 * parent's events. The projection is gitignored and a child branches rather than
 * shares a checkout, so without this a child cannot read the spec it is a piece
 * of — which every spawn whose subject is a document needs.
 *
 * `base` is a fact rather than a lookup: recorded here, a restart branches from
 * what the spawn said and not from wherever the parent has got to since.
 *
 * `mode` rides here for the same reason and a sharper one: read from a setting at
 * decide time, an old log would replay against whatever that setting says today. The
 * constructors always write it, so absent means a log from before the field existed —
 * which is `manual`, what all of them ran as.
 *
 * `split` is the partition this child is one piece of, written by the parent that
 * knew it: the pieces are entries of the *parent's* plan, and replay is per-log, so
 * nothing downstream can go and look. Absent means nobody split this — an ordinary
 * trak, and every child born before the field existed. See `Split`.
 */
const TrakCreated = Schema.TaggedStruct("TrakCreated", {
  ...recorded,
  description: Schema.String,
  parent: Schema.optional(Parent),
  plan: Schema.optional(Proposal),
  base: Schema.optional(BranchName),
  /**
   * The trak whose composer handed this work off — the third birth, `trakHandedOff`.
   * Beside `base` and never with `parent`: a handed-off trak is cut from the default
   * branch and comes back to nothing, where a child is cut from its parent's branch
   * and lands on it. See `Trak.handedOffFrom`.
   */
  handedOffFrom: Schema.optional(TrakId),
  /**
   * The goal whose composer opened this trak — the fourth birth, `trakForGoal`. Set on
   * nothing else, and routed on by nothing in `decide`: what the trak does is its
   * person's, and the goal learns how it ended by watching the feed. See `Trak.goal`.
   */
  goal: Schema.optional(GoalId),
  /**
   * The goal branch of that goal, where it has one — beside `goal` and only with it. `base`
   * is the remote-tracking ref this trak was cut from; this is the branch it lands on.
   */
  goalBranch: Schema.optional(BranchName),
  mode: Schema.optional(RunMode),
  /**
   * The host user the trak belongs to: who pressed, from the host's `x-orkestra-user`, or
   * the owner of the trak or goal it came from. Absent where nobody was named — a press with
   * no host user, and every log written before the field existed. See `Trak.owner`.
   */
  owner: Schema.optional(UserId),
  /**
   * The engine merges this trak's pull request on the forge once it merges cleanly and
   * its checks pass, and sends the trak back to its own composer when they do not. Set at
   * birth, and changed later only by `AutoMergeChanged`; absent is off. See `Trak.autoMerge`.
   */
  autoMerge: Schema.optional(Schema.Literal(true)),
  split: Schema.optional(Split),
  /**
   * The files a person sent with the request, placed in the checkout once it is made.
   * Only on a trak a person opened. See `Trak.attachments`.
   */
  attachments: Attached,
  decisions: Schema.optional(Schema.Array(Recorded)),
  // Pairs rather than a record, because order is the whole of what makes a
  // listing read as the plan that produced it — and it is the shape
  // `visibleArtifacts` already returns, so nothing converts at either boundary.
  artifacts: Schema.optional(Schema.Array(Schema.Tuple(Schema.String, Document))),
})
/**
 * The composer's turn came back. Not `ProposalAccepted`, because a composer may
 * also ask questions or give up — and each of those has to be a recorded fact,
 * not an error escaping mid-command. `sessionId` is what lets the answers resume
 * the same conversation instead of re-composing from scratch.
 */
const ComposerReturned = Schema.TaggedStruct("ComposerReturned", {
  ...recorded,
  ...spent,
  ...ranUnder,
  ...wrote,
  ...halted,
  sessionId: SessionId,
  output: ComposerOutput,
})
const AgentReturned = Schema.TaggedStruct("AgentReturned", {
  ...recorded,
  ...spent,
  ...ranUnder,
  ...wrote,
  ...halted,
  step: Schema.Number,
  sessionId: SessionId,
  output: StepOutput,
})
/**
 * `sessionId` is present on exactly one press: a `Replan` that landed off a gate, where
 * the route killed a step's turn to fork it. It is the session that turn was holding,
 * read before the kill for `Stopped`'s reason — the record's release destroys the only
 * note of it — and recorded so the position **reads as having run**. Without it the slot
 * holds no session, `firstUnrun` names the interrupted entry, and `withAsk` writes the
 * ask over that entry rather than after it: the entry vanished, and with it the model a
 * person picked on New Chat. Absent on every press made at a gate, where nothing was
 * killed and the position's own return already filed the session.
 *
 * `usage` rides that one press too, read off the same record and for `Stopped`'s
 * reason: the kill destroys the turn's own count. Absent on a press at a gate.
 */
const HumanActed = Schema.TaggedStruct("HumanActed", {
  ...recorded,
  step: Schema.Number,
  action: HumanAction,
  sessionId: Schema.optional(SessionId),
  ...spent,
})
/**
 * Every check the step declared exited zero. `ran` names them in the order they
 * ran, which is what makes "no checks were declared" (`[]`) legible in the log
 * rather than indistinguishable from "they all passed".
 *
 * Two events rather than one `CheckFinished` carrying an exit code: `decide`
 * routes on pass-or-fail and nothing else, and an optional failure payload would
 * have to be narrowed at every read. Which checks passed on the way to a failure
 * is not a state-affecting fact and stays in the transcript.
 *
 * **`skipped` names the checks a person's `SkipChecksChanged` kept from running**, and
 * is absent where they ran. The same passing event rather than one of its own, because
 * the step is then accepted exactly as a pass accepts it — `gateTaken` stamps a warrant
 * on `ChecksPassed` in `CheckRunning` and on nothing else, so any other ending would
 * leave an `auto` trak's step unmarked. `ran` is `[]` beside it. Recorded on the event
 * because the switch it read is spent by it: a replay that read today's switch against
 * yesterday's log would run or skip differently from what happened.
 *
 * **`reused` names the checks accepted on an earlier pass over exactly these files**, and
 * is absent where none was. Not under `ran`, because the log would then claim a run that
 * did not happen. A reused check passed; nothing in `decide` or `replay` tells it from one
 * in `ran`.
 */
const ChecksPassed = Schema.TaggedStruct("ChecksPassed", {
  ...recorded,
  step: Schema.Number,
  ran: Schema.Array(Schema.String),
  skipped: Schema.optional(Schema.Array(Schema.String)),
  reused: Schema.optional(Schema.Array(Schema.String)),
  /** Where each check in `ran` ran, by its name — see `ranAt`. */
  places: Schema.optional(Schema.Record({ key: Schema.String, value: Place })),
})
/**
 * A person ended the check that was running, before it finished.
 *
 * **The interrupted run's only ending**, for `Stopped`'s reason: the process that would
 * have written `ChecksPassed` or `CheckFailed` is the one that was killed. Not a
 * `CheckFailed` — that counts against the step's failure budget and sends it back for a
 * paid turn, and nothing failed here — and not a `Stopped`, which carries a session a
 * check does not have. It parks the trak at the `checks` gate a failing run already
 * opens, offering the same three presses.
 *
 * `name` is the check that was running, read off the daemon's memory of the run before
 * the interruption destroys it, and absent where the press raced the run starting.
 */
const ChecksCancelled = Schema.TaggedStruct("ChecksCancelled", {
  ...recorded,
  step: Schema.Number,
  name: Schema.optional(Schema.String),
})
/**
 * The first check to exit non-zero. `output` is stderr then stdout as the script
 * printed it — terminal escapes intact, cut only at the adapter's backstop.
 *
 * `command` and `exitCode` are what makes this readable as a run rather than as a
 * string: a failure parks the trak, possibly across a restart, and the daemon's own
 * memory of the run does not survive one. Both optional, because a log written before
 * they existed decodes unchanged — and `exitCode` is absent on this build too for the
 * two failures that are not an exit, a timeout and a check that could not be spawned.
 */
const CheckFailed = Schema.TaggedStruct("CheckFailed", {
  ...recorded,
  step: Schema.Number,
  name: Schema.String,
  output: Schema.String,
  command: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  ...ranAt,
  /** The runners-only guard's refusal, where it refused the spawn — see `ProcessFailed`. */
  runnersOnly: Schema.optional(Schema.String),
  /**
   * Where the sandbox's uncommitted changes were kept, where a remake that captured them
   * failed before they were put back — `refs/orkestra/carried/<trak>` in the project.
   */
  carried: Schema.optional(Schema.String),
})
/** One effect that ran, and what it printed. See `EffectsRan`. */
const RanEffect = Schema.Struct({ name: Schema.String, output: Schema.String, ...ranAt })
export type RanEffect = Schema.Schema.Type<typeof RanEffect>
/**
 * Every effect the step declared exited zero, once its work was on the branch.
 * `ran` names them in the order they ran, `[]` for an agent that declares none.
 *
 * **It carries each one's captured output, where `ChecksPassed` deliberately carries
 * none, and the difference is what the two kinds of script are.** A check *verifies*,
 * so *it passed* says everything there is to say. An effect *acts*, outside this
 * checkout, where nothing in the log can be re-derived by looking again — so what it
 * printed is the only record that it happened at all, and the only place a pull
 * request's URL exists.
 *
 * **`decide` may not read it.** It is a fact about a world that changes without
 * events, so anything routing on it goes stale silently. A surface may render it, and
 * must render `at` beside it: what a script saw when it ran is not a claim about now.
 *
 * **`skipped` names the effects a person's skip kept from running**, and is absent where
 * they ran: the one that failed and every one declared after it, since one failed effect
 * stops every effect after it. `ran` is `[]` beside it. Written from `Failed`, where the
 * effect failure left the trak, and the same passing event rather than one of its own
 * for `ChecksPassed.skipped`'s reason — the step is then entered exactly as a run that
 * passed enters it. Whether the event carries the field is the one thing `decide` reads,
 * because only a skip may arrive outside `Effecting`.
 */
const EffectsRan = Schema.TaggedStruct("EffectsRan", {
  ...recorded,
  step: Schema.Number,
  ran: Schema.Array(RanEffect),
  skipped: Schema.optional(Schema.NonEmptyArray(Schema.String)),
})
/**
 * The first effect to exit non-zero. `output` is stderr then stdout as the script
 * printed it, on `CheckFailed`'s terms exactly.
 *
 * **Two events rather than one, for `ChecksPassed`'s reason and a second one**: what
 * a non-zero exit *means* is the whole difference between the two lists. A check that
 * fails says the work is wrong and re-enters the agent; an effect that fails says it
 * could not do it, which is nobody's mistake and settles `Failed{project}` — so the
 * two outcomes route to different places and neither is a payload on the other.
 */
const EffectFailed = Schema.TaggedStruct("EffectFailed", {
  ...recorded,
  step: Schema.Number,
  name: Schema.String,
  output: Schema.String,
  ...ranAt,
  /** The runners-only guard's refusal, where it refused the spawn — see `ProcessFailed`. */
  runnersOnly: Schema.optional(Schema.String),
  /**
   * Where the sandbox's uncommitted changes were kept, where a remake that captured them
   * failed before they were put back — `refs/orkestra/carried/<trak>` in the project.
   */
  carried: Schema.optional(Schema.String),
})
/**
 * The commit a `merged` or `deployed` wait found the branch had landed as — the
 * pull request's merge commit, or the tip a merge made from this machine left. On
 * both condition answers, because a `deployed` wait learns the branch merged before
 * the deploy is live, and that fact is worth writing down the moment it is known:
 * `Trak.landed` is folded from it, and it is what refuses a write agent from then on.
 * Absent on every answer about a project's own script.
 */
const landed = { merged: Schema.optional(CommitSha) }
/**
 * Every condition the step's agent declares exited zero, so the step may start.
 * `ran` names them in order, `[]` for an agent that declares none — which is
 * nearly every step, and the honest record that nothing held it, on
 * `ChecksPassed`'s terms exactly.
 *
 * Two ways it is written. The runtime writes one from `ConditionRunning`, on the
 * way into the step; the daemon's sweep writes one at `Finished`, when a condition
 * that rested the trak is asked again and found met — so this is an event that
 * moves a resting trak. `WaitSkipped` is the other that moves it into the step, on a
 * person's press rather than the world's; `Reentered` is the third, and re-plans.
 */
const ConditionsMet = Schema.TaggedStruct("ConditionsMet", {
  ...recorded,
  ...landed,
  step: Schema.Number,
  ran: Schema.Array(Schema.String),
})
/**
 * The first condition that is not met, and what it printed — on `CheckFailed`'s
 * terms — and whether it has given up.
 *
 * `stopped` is the script exiting with anything but `0` or `1`: the thing it waits
 * for is never going to happen, or it cannot tell, so the daemon asks no more. **One
 * event for both answers rather than two**, because both say *not entering this
 * step*; they differ only on whether anything asks again, and a third tag would be
 * read by every switch as a fourth outcome.
 *
 * **Written only when something changes.** The runtime writes one from
 * `ConditionRunning` for the first not-yet, which is what rests the trak. Every
 * later not-yet is the sweep's memory and nothing else — the log carries no *asked,
 * still not* lines — so the ones this event is written for after that are the sweep
 * finding the condition has given up, and a `deployed` wait first finding the branch
 * merged, both at `Finished`.
 */
const ConditionsUnmet = Schema.TaggedStruct("ConditionsUnmet", {
  ...recorded,
  ...landed,
  step: Schema.Number,
  name: Schema.String,
  output: Schema.String,
  stopped: Schema.Boolean,
})
/**
 * A person started the step a resting trak was held at, without its condition being
 * met — every kind of wait, the one that has given up included, since that is the
 * wait with no other way out. `name` is the condition the entry was waiting on, and
 * the step's first turn is told it: the forced step is the one turn that may not take
 * what its agent waits for as having happened.
 *
 * **Its own event rather than a `ConditionsMet`**, because a met written for a
 * condition nobody found met is a false claim on the log, and it would leave the
 * step nothing to be told.
 *
 * `merged` is the one answer asked once more before the step runs — the cheap forge
 * question, and the one whose answer refuses a write agent from a branch that has
 * gone in. Carried on `ConditionsMet`'s terms and folded onto `Trak.landed` the same
 * way; absent where the branch has not merged, or the forge could not say.
 *
 * Only from `Finished`, holding the entry it names. The route refuses anything else,
 * and there is no late answer here to race a press — a person pressed this one.
 */
const WaitSkipped = Schema.TaggedStruct("WaitSkipped", {
  ...recorded,
  ...landed,
  step: Schema.Number,
  name: Schema.String,
})
/**
 * The trak has somewhere to work: the checkout exists. Carries both halves of the
 * `Worktree` because both are facts about this trak that nothing else records — the
 * branch outlives the directory, and re-deriving either would mean the log depending on
 * how `vcs/` happens to name things today.
 *
 * **Whether the project's setup script has run is `SetupStarted`'s to say.** On a log
 * where none comes before it, this event was written only after setup passed, so a
 * restart reading that log runs nothing again.
 */
const WorktreeReady = Schema.TaggedStruct("WorktreeReady", {
  ...recorded,
  worktree: Worktree,
  /** Where the checkout is: `Remote` with no exec for one in a sandbox. See `ranAt`. */
  ...ranAt,
})
/**
 * The project's setup script began in the background, beside the trak's first work: a
 * turn starts at once, a Bash command in it waits for setup's result, and every script
 * the engine runs in the checkout waits for it too. Written again when a failed setup is
 * retried. **Moves nothing.** A log with this and no result after it is a setup the
 * engine was running when it went, and the next work in the checkout runs it again.
 */
const SetupStarted = Schema.TaggedStruct("SetupStarted", {
  ...recorded,
  /** Where setup runs: the checkout's place, written before its command has an exec id. */
  ...ranAt,
})
/** The setup `SetupStarted` began passed. Moves nothing: the work went on beside it. */
const SetupPassed = Schema.TaggedStruct("SetupPassed", { ...recorded })
/**
 * The setup `SetupStarted` began failed, and the trak stops `Failed{worktree}` from
 * wherever it was. `reason` names the checkout and holds what the script printed;
 * `output` is what it printed alone, for a surface to draw. `runnersOnly` and `carried`
 * are from its outcome.
 *
 * **Accepted in any state after `WorktreeReady`**, unlike `WorktreeFailed`, which is
 * accepted only while git is in flight: setup ends on its own schedule, at a gate as
 * readily as mid-turn. A turn it was running beside is killed first, and `sessionId`,
 * `step` and `usage` are `Stopped`'s three for that turn — read off the run record before
 * the kill, filed so a retry resumes the conversation, and absent where no turn ran.
 */
const SetupFailed = Schema.TaggedStruct("SetupFailed", {
  ...recorded,
  reason: Schema.String,
  output: Schema.String,
  runnersOnly: Schema.optional(Schema.String),
  carried: Schema.optional(Schema.String),
  sessionId: Schema.optional(SessionId),
  step: Schema.optional(Schema.Number),
  ...spent,
})
/**
 * Preparing or integrating went wrong. One event for both, because the trak
 * ends the same way either time and the reason is the only thing that differs.
 *
 * A recorded fact rather than an error escaping the command, for the reason
 * `orGiveUp` exists: a failure that leaves through `advance`'s error channel
 * strands the trak in the state it had already moved to, with nothing able to
 * move it.
 */
const WorktreeFailed = Schema.TaggedStruct("WorktreeFailed", {
  ...recorded,
  reason: Schema.String,
  /** Where the script that failed ran — the teardown, or setup — where one did. See `ranAt`. */
  ...ranAt,
  /** The runner verb that failed, where git was talking to a sandbox through one. */
  runner: Schema.optional(RunnerFailure),
  /** The runners-only guard's refusal, where it refused the spawn — see `ProcessFailed`. */
  runnersOnly: Schema.optional(Schema.String),
  /**
   * Where the sandbox's uncommitted changes were kept, where a remake that captured them
   * failed before they were put back — `refs/orkestra/carried/<trak>` in the project.
   */
  carried: Schema.optional(Schema.String),
  /**
   * What the project's setup script printed, where it was setup that failed — run again
   * in a checkout made again, before the work that needed it.
   */
  setup: Schema.optional(Schema.String),
})
/**
 * Git declined to merge this trak's branch into its destination — a dirty tree
 * there, a checkout that has wandered off its branch, or no checkout at all.
 *
 * **Its own event and not a `WorktreeFailed`**, because the two say different
 * things to a person: a checkout failure is about this trak's own checkout, and a
 * merge refusal is about a tree this trak does not own. `reason` is git's own
 * sentence where git spoke, since it names the files in the way.
 */
const MergeFailed = Schema.TaggedStruct("MergeFailed", {
  ...recorded,
  reason: Schema.String,
})
/**
 * The engine refused to start the step at `step`: its agent writes, and the branch —
 * this trak's, or its parent's — merged after the plan holding it was accepted.
 * `ComposerOutputFor` refuses the shape at decode, but a spawn child's parent lands
 * on its own schedule, so a plan accepted before the landing can hold a writer that
 * is refused at the step. Routes to the composer with `reason`, which is the decode's
 * own sentence — see `Refused` in `ReconsultWhy`.
 */
const StepRefused = Schema.TaggedStruct("StepRefused", {
  ...recorded,
  step: Schema.Number,
  reason: Schema.String,
})
/**
 * The merge did not go in, because the two branches disagree.
 *
 * **Its own event and not a `WorktreeFailed`**, on the distinction `Vcs` already
 * draws one layer down: a branch that is not there or a dirty tree is git
 * *declining to answer*, and unmerged paths are git's *answer*. Only the second
 * is a fact about the work, and only the second is something an agent editing
 * files could plausibly close — which is why this one routes to the composer and
 * the rest still end the trak.
 *
 * `paths` as a list rather than flattened into a sentence, because the composer
 * is what reads it and a composer cannot recover a list out of prose. Non-empty
 * for the reason `MergeOutcome.Conflicted`'s is.
 *
 * `into` is what the conflict was **against** — the branch the merge was aimed
 * at — and it is the one fact the resolving checkout cannot recover for itself: a
 * host trak's worktree and a spawn's child's are indistinguishable from inside. It
 * reaches the composer, which writes it onto the resolving step's instruction. What
 * moves in between is the branch's tip and not its name, and the tip is what that
 * step reads live. Absent when the host is on a detached `HEAD`, which has no name
 * to record.
 */
const Conflicted = Schema.TaggedStruct("Conflicted", {
  ...recorded,
  paths: Schema.NonEmptyArray(Schema.String),
  into: Schema.optional(Schema.String),
})
/**
 * The work is on the branch. **The checkout is still there** — removing it is
 * `WorktreeRemoved`, one human decision later.
 *
 * `sha` is the branch tip after this commit, not necessarily a commit this call
 * created: `Vcs.commitWork` is re-runnable and reads its answer off the branch,
 * so absent means nothing has been committed on this branch yet — not that this
 * particular step changed no files. Two consecutive steps where the second
 * changed nothing report the same sha.
 *
 * `step` names which step's boundary this is, and is absent for the catch-all
 * commit issued past the last step and when a trak is abandoned — the same
 * convention `TurnFailed.step` uses for the composer.
 *
 * **Not decoration.** A boundary with a step is where a plan can run out, which is
 * what `recordFacts` reads to decide whether the composer is owed another turn —
 * see `onWorkCommitted` in `replay.ts`. The catch-all is past that point already.
 */
const WorkCommitted = Schema.TaggedStruct("WorkCommitted", {
  ...recorded,
  sha: Schema.optional(CommitSha),
  step: Schema.optional(Schema.Number),
})
/**
 * The archive is done: the checkout, the branch and the branch's copy on the
 * forge are gone, and the log is what the trak leaves behind.
 *
 * Its own event rather than a field on `WorkCommitted`, because the two are no
 * longer one moment: a trak sits at `Finished` holding its worktree for as long
 * as it takes somebody to decide, and this is the fact that the deciding
 * happened.
 *
 * `sha` is the merge commit GitHub reports for this branch's pull request, put
 * here by the runtime asking the forge once as it handles the removal — the one
 * way a trak whose work went in *over there* still ends `Merged`. Absent when
 * there is no merged pull request, when the forge could not be asked, and on
 * every log written before the field existed; a local merge's sha is already on
 * `Closing` and wins (`decide` reads `state.merged ?? e.sha`).
 *
 * The last event of three lives: `Closed`, `Abandoned`, and every trak whose
 * branch was merged back.
 */
const WorktreeRemoved = Schema.TaggedStruct("WorktreeRemoved", {
  ...recorded,
  sha: Schema.optional(CommitSha),
  /** Where the project's teardown ran, where one ran. See `ranAt`. */
  ...ranAt,
})
/**
 * The provider failed mid-turn: a dropped connection, an exhausted usage limit,
 * a non-zero exit. Not the agent's verdict on its own work — nothing about what
 * it was asked went wrong, and recording it as `StepOutput.failed` said the
 * opposite.
 *
 * A recorded fact rather than an error escaping the command, on `WorktreeFailed`'s
 * reasoning exactly: a failure that leaves through `advance`'s error channel
 * strands the trak in the state it had already moved to.
 *
 * `step` absent means the composer, which has no index — the same convention
 * `run.json`'s `turn.step` uses. `sessionId` is what makes the retry worth
 * having: the conversation this turn was mid-way through is precisely the
 * context worth keeping, and after this event it exists nowhere else, since a
 * cleanly-settled trak releases its `Runs` custody scope.
 *
 * `sessionId` is absent when the CLI never got as far as making one — a missing
 * binary, expired auth, a usage limit rejected before the first line. The id the
 * runtime minted names nothing in that case, and filing it would make every
 * retry resume a conversation that does not exist. `runtime.ts`'s
 * `orRecordFailure` is where the distinction is drawn, off
 * `ProviderEvent.SessionStarted`.
 *
 * `apiKind` is what the provider called it, beside `reason`, which is what it said.
 * Two axes rather than one: `Failure` says whose fault a stopped trak is and this says
 * what the API did, so a surface can name a dropped connection without matching English
 * against the sentence. Absent when the provider reported no in-band error to classify —
 * a non-zero exit, a projection that could not be written — and on every log written
 * before the field existed.
 *
 * `unfetched` says the turn answered and its sandbox then could not be reached for the
 * fetch of its branch, for the whole reattach window: the answer is dropped, since no trak
 * moves on without its turn's commits, and a restart fetches them before it starts anything.
 */
const TurnFailed = Schema.TaggedStruct("TurnFailed", {
  ...recorded,
  ...spent,
  ...ranUnder,
  step: Schema.optional(Schema.Number),
  sessionId: Schema.optional(SessionId),
  reason: Schema.String,
  apiKind: Schema.optional(ApiErrorKind),
  /** The runner verb that failed under the turn's spawn — a sandbox that would not start. */
  runner: Schema.optional(RunnerFailure),
  /** The runners-only guard's refusal, where it refused the spawn — see `ProcessFailed`. */
  runnersOnly: Schema.optional(Schema.String),
  unfetched: Schema.optional(Schema.Literal(true)),
  /**
   * Where the sandbox's uncommitted changes were kept, where a remake that captured them
   * failed before they were put back — `refs/orkestra/carried/<trak>` in the project.
   */
  carried: Schema.optional(Schema.String),
})
/**
 * A spawn position's children exist, and these are their ids.
 *
 * The one fact the parent's log could not derive: ids are minted, so without
 * this a restart would have no way to find the traks it already created and
 * would make a second set. It is also where `Await{Children}` gets the list it
 * names.
 *
 * No plan and no description ride along, because both are already here: the
 * spawn entry on this trak's own proposal says what each child is, and
 * `childPlan` turns one into the plan that child is born with.
 */
const ChildrenSpawned = Schema.TaggedStruct("ChildrenSpawned", {
  ...recorded,
  step: Schema.Number,
  ids: Schema.NonEmptyArray(TrakId),
})
/**
 * The traks a compose entry's hand-offs were named as, and the branch they are cut
 * from — written as the plan gate goes past, before any of them exists.
 *
 * **A goal's trak names nothing**: `base` and `ids` are both absent, and the hand-off
 * goes to the goal's composer as a wake, which opens what it decides to. The event is
 * still written, because it is what says the gate went past with the hand-off on it.
 *
 * `ChildrenSpawned`'s reason, one door over: ids are minted, so without this a
 * restart would have no way to find the traks it already opened and would open a
 * second set. `step` is the compose entry whose run handed them off, and the ids are
 * in the order its `handOff` listed them, so each description finds its trak. The
 * daemon reads both back to birth each trak once, and nothing else — no `Await`
 * follows this, because nothing here owes this trak an event.
 *
 * `base` is recorded rather than re-read at the birth, for `TrakCreated.base`'s
 * reason: what was resolved at the moment the plan was taken is the fact, and a
 * remote's head moving between then and the birth must not move it.
 */
const HandedOff = Schema.TaggedStruct("HandedOff", {
  ...recorded,
  step: Schema.Number,
  base: Schema.optional(BranchName),
  ids: Schema.optional(Schema.NonEmptyArray(TrakId)),
})
/**
 * The goal a finish's proposal started as, written once it has started.
 *
 * What makes the start happen once: the goal's watcher opens a goal for a slot whose
 * proposal has none of these, on a trak at rest. `step` is the compose entry whose finish
 * proposed it. It moves nothing — the trak is at rest when it lands — so `decide` takes it
 * as it takes a change of mode.
 */
const GoalOpened = Schema.TaggedStruct("GoalOpened", {
  ...recorded,
  step: Schema.Number,
  goal: GoalId,
})
/**
 * One child came back, on the parent's log.
 *
 * One event per child rather than one for the group, which is what makes the
 * question *have they all landed?* arithmetic and the answer durable. It records
 * facts and nothing else: neither `Trak.decisions` nor `Trak.artifacts` moves
 * here — see `ChildrenJoined`.
 *
 * `artifacts` is every document the child filed, keyed as the child filed them —
 * `visibleArtifacts` of the child's own plan, so a piece of two steps lands both.
 * `artifact` is the shape of a log written before that: the child's last document
 * alone, with no key. Replay gives it the key the child's plan as spawned implies,
 * so one layout serves every log.
 *
 * `decisions` is `Decided` rather than `Recorded`, because provenance is derived
 * by whoever files it. Here that is the parent, at the join.
 *
 * `handUp` is what the child's composer said belongs to none of its split — its
 * `finished` answer's field, lifted off the child's log by `landOnParent`. Absent when
 * it handed nothing up, which is most children. The join turns every one present into
 * a `Raised` at the spawn position, so the parent re-composes.
 */
const ChildLanded = Schema.TaggedStruct("ChildLanded", {
  ...recorded,
  step: Schema.Number,
  child: Schema.Number,
  id: TrakId,
  branch: BranchName,
  sha: Schema.optional(CommitSha),
  artifacts: Schema.optional(Schema.Array(Schema.Tuple(Schema.String, Document))),
  artifact: Schema.optional(Document),
  decisions: Schema.Array(Decided),
  handUp: Schema.optional(Schema.String),
})
/**
 * A child that had already landed came back again, on the parent's log.
 *
 * A landed child can be sent back — re-entered from `Merged` or `Closed` — and end
 * again, and what it files the second time is owed to the parent as much as the
 * first. Its slot already holds a landing, so a second `ChildLanded` would be one
 * more for a join that has already counted it; this is the other shape, carrying
 * **only what the parent does not yet hold** — the documents, keyed as the child
 * filed them, the decisions and the hand-up — read against that landing, which the
 * fold keeps whole. `landOnParent` files nothing when there is nothing new, so a
 * child re-driven by a resume writes no event here.
 *
 * It moves the parent nowhere: `decide` re-offers a gate and leaves any other state
 * alone, and `recordFacts` is what folds it — onto the slot's landing while the
 * position still waits on its siblings, so the join carries it, and straight onto
 * the trak once the join has passed. Whether the child's code merged or was dropped
 * makes no difference to it; the child's own log holds that.
 */
const ChildRefiled = Schema.TaggedStruct("ChildRefiled", {
  ...recorded,
  step: Schema.Number,
  child: Schema.Number,
  id: TrakId,
  artifacts: Schema.Array(Schema.Tuple(Schema.String, Document)),
  decisions: Schema.Array(Decided),
  handUp: Schema.optional(Schema.String),
})
/**
 * The spawn is done, and this is where the whole batch enters the trak.
 *
 * **The fold has exactly one moment, and this is it.** Folding per landing would
 * order siblings by when they finished, which is a fiction dressed as a rule: the
 * children ran at the same time, so *latest wins* has nothing to rank them by.
 * Two children that decided contradictory things is a fact a human should see at
 * the join, not one the engine should quietly resolve — so the batch arrives at
 * one position, provenance names which child said which, and a human's correction
 * still wins the way every correction wins, by being later.
 *
 * `merged` is the tips brought onto this trak's branch — read off the landings
 * rather than done here, because each one went in when a human said so. A dropped
 * child contributes none, which is the whole of what dropping it recorded.
 */
const ChildrenJoined = Schema.TaggedStruct("ChildrenJoined", {
  ...recorded,
  step: Schema.Number,
  merged: Schema.Array(CommitSha),
})
/**
 * A human chose to pick this trak back up.
 *
 * Covers both ways a trak stops mid-flight, because the answer to each is the
 * same — re-issue the command for the position it stopped at. The process died,
 * in which case no terminal event was ever written and the log replays to an
 * in-flight state; or the trak *failed*, in which case the failure is recorded
 * and `Trak.failedFrom` holds the position. One event, because "a human said
 * carry on" is one fact however the trak came to need it.
 *
 * `sessionId` is what the log genuinely could not have: `runtime.ts` mints one
 * before spawning and only writes it via `ComposerReturned`/`AgentReturned` on
 * completion, so an interrupted turn's session exists only in `run.json` — and
 * once this event fires, only here. Absent when no session was ever recorded
 * (the process died before the spawn that would have minted one), in which case
 * the re-run starts a fresh session same as any other first attempt.
 *
 * `step` is the position that turn was at, and it exists because **this event is
 * the interrupted turn's ending**. A turn that dies with its engine writes no
 * `TurnFailed` — the process that would have written one is the process that
 * died — so the log holds a turn with a beginning and no end, and any reader
 * pairing outputs to turns by counting endings is off by one per interruption.
 * That is not hypothetical: it put every filed document two turns above the turn
 * that filed it and left a gate with no document to hang its press on.
 *
 * Absent, exactly like `TurnFailed`'s, when there was nothing at a position to
 * end: a restart that re-parks a gate starts no turn, and one that interrupts a
 * compose has no index to name. Read off `InFlightTurn`, which is the only thing
 * that knows — the same record `sessionId` comes from, for the same reason.
 */
const Restarted = Schema.TaggedStruct("Restarted", {
  ...recorded,
  sessionId: Schema.optional(SessionId),
  step: Schema.optional(Schema.Number),
})

/**
 * A human interrupted the turn that was running, to say something else.
 *
 * **Two meanings, by where it lands.** In `Stopping` it is `StopTurn`'s ending — the kill
 * succeeded, or found nothing running — and carries nothing: `StopRequested` already
 * carried the turn's ending. Everywhere else it is the event a stop wrote before
 * `StopRequested` existed, killing first and appending after, and every log holding one
 * is replayed forever; the rest of this note is that meaning.
 *
 * **Field for field the shape of `Restarted`, and the opposite event.** A restart is a
 * person saying *carry on*; this is a person saying *stop* — so it ends the turn where
 * `Restarted` re-issues it, and what it leaves behind is a gate rather than a command.
 * Two events rather than a flag, because they route to opposite places and a log is
 * replayed forever.
 *
 * `sessionId` is the conversation the killed turn was holding, and it is the whole point
 * of the event: the guidance a person types at the gate this opens resumes it, so the
 * agent picks up what it had already worked out. It lives only in `run.json` while the
 * turn runs and is destroyed by the unwinding that kills the process — so unlike a
 * `Restarted`'s, it is read **before** the interruption and carried here. Absent when the
 * turn had not minted one, in which case the resumed turn starts fresh.
 *
 * `step` is the position that turn was at, and it is here for `Restarted.step`'s reason:
 * **this event is the interrupted turn's ending.** Nothing else writes one — the process
 * that would have is the one that was killed — so a reader pairing filed documents to
 * turns is off by one per stop without it. Absent means the composer, which has no index,
 * and means *nothing was in flight* where the press and the turn finishing raced.
 *
 * `usage` is what that turn had spent at the provider's last report, read off the same
 * record as the session and for the same reason: the kill destroys the turn's own count.
 */
const Stopped = Schema.TaggedStruct("Stopped", {
  ...recorded,
  sessionId: Schema.optional(SessionId),
  step: Schema.optional(Schema.Number),
  ...spent,
})

/**
 * A person pressed Stop on the turn in flight, and nothing has been killed yet.
 *
 * **The intent, written before the work**: `decide` moves the trak to `Stopping` and
 * issues `StopTurn`, whose kill ends in `Stopped`. An engine that dies between the two
 * replays to `Stopping`, and its restart finishes the kill rather than rejoining a turn
 * nobody wants. `Stopped` alone was written after the kill, so a death in between left a
 * detached sandbox turn to be rejoined as if nobody had pressed anything.
 *
 * `sessionId`, `step` and `usage` are what `Stopped` carried before this event existed,
 * for its reasons: this is the interrupted turn's ending, and the session is the one the
 * person's next message resumes. Read off the run record where one exists, and off the
 * slot where the press came before the turn spawned — the session that turn was about
 * to resume. Absent on a first turn stopped before it spawned, which has none.
 */
const StopRequested = Schema.TaggedStruct("StopRequested", {
  ...recorded,
  sessionId: Schema.optional(SessionId),
  step: Schema.optional(Schema.Number),
  ...spent,
})

/**
 * A person asked the step to file what it has.
 *
 * `Stopped`'s shape and the opposite ending: a stop opens a gate for the person to
 * say something at, this re-enters the step at once under `Trigger.Filing`, which
 * asks for the document and lets nobody type. **One event for both places it can be
 * pressed** — a turn still running, or a conversation the step has parked in — for
 * the reason `Stopped` covers the in-flight case and the raced-gate case in one: the
 * two have one ending, and an event is on every log for good.
 *
 * `sessionId` is the conversation the killed turn was holding, read before the kill
 * for `Stopped`'s reason, and absent where nothing was killed: at a parked
 * conversation the slot already holds the session the turn resumes. `step` is the
 * position, and it is the turn's ending where a turn was killed — a stop is the
 * only other ending an interrupted turn gets, and a reader pairing documents to
 * turns needs this one too. Both absent means the press raced a turn that had
 * already finished, and `decide` re-parks. `usage` is the killed turn's spend, on
 * `Stopped`'s terms, and absent wherever nothing was killed.
 */
const FilingAsked = Schema.TaggedStruct("FilingAsked", {
  ...recorded,
  sessionId: Schema.optional(SessionId),
  step: Schema.optional(Schema.Number),
  ...spent,
})

/**
 * A person changed how much of this trak they want to stand at, part-way through.
 *
 * **Moves nothing.** It is picked up at the trak's next gate, because `advance`
 * re-reads the log before every decision — so a turn in flight finishes on its own
 * session, and the gate after it is the first one the new mode decides. What a gate
 * already taken read is stamped on `Trak.marks` at the moment it was taken, so a
 * change to `manual` erases no mark on a document already filed.
 *
 * A change to `manual` also clears a pending `HoldChanged`: on `manual` a hold
 * promises nothing the mode does not, and a person coming back to `smart` decides
 * afresh whether they want one.
 *
 * An event rather than a setting, for `TrakCreated.mode`'s reason: the log is the
 * only thing a replay may read.
 */
const ModeChanged = Schema.TaggedStruct("ModeChanged", {
  ...recorded,
  mode: RunMode,
})

/**
 * A person asked to hold this trak's current step until they accept it, or took that
 * back. A spawn cannot be held — see `Trak.holding`.
 *
 * `holding: true` is the press; `false` is the switch turned off again before it
 * fired. **One-shot** — `applyEvent` spends it as the held step is accepted, or as the
 * trak comes to rest, so nothing writes a `false` for a hold that did its
 * job, and the log carries only what a person did. Moves nothing, for `ModeChanged`'s reason.
 */
const HoldChanged = Schema.TaggedStruct("HoldChanged", {
  ...recorded,
  holding: Schema.Boolean,
})

/**
 * A person asked for the next check run on this trak not to happen, or took that back.
 *
 * `HoldChanged`'s shape and the opposite promise: a hold adds a stop, this removes the
 * one a script would have made. **One-shot** — spent by the `ChecksPassed` that records
 * what it skipped, so nothing writes a `false` for a switch that did its job. Offered on
 * every mode, `manual` included: every mode runs its checks, so unlike a hold it promises
 * something the mode does not. Moves nothing, for `ModeChanged`'s reason.
 */
const SkipChecksChanged = Schema.TaggedStruct("SkipChecksChanged", {
  ...recorded,
  skipping: Schema.Boolean,
})

/**
 * A person turned auto-merge on or off for this trak — at any point before it is archived,
 * `Finished` included, where the forge sweep reads it on its next tick.
 *
 * **A setting, not a one-shot**: the engine never spends it, so it stands until the next
 * press. `on: true` is a fresh start whatever came before — the send count goes back to
 * 0 and a stop clears, because a person turning it back on has dealt with what stopped it.
 * `on: false` also ends a conflict resolve's claim on every gate, so the resolve's next
 * gate is the run mode's. Moves nothing, for `ModeChanged`'s reason.
 */
const AutoMergeChanged = Schema.TaggedStruct("AutoMergeChanged", {
  ...recorded,
  on: Schema.Boolean,
})

/**
 * A person picked the method this trak's pull request merges by, on the finished band. **A
 * setting, not a one-shot**: it stands until the next pick, and the person's press and
 * auto-merge both merge with it. Absent from a log, the repository's default. Moves
 * nothing, for `ModeChanged`'s reason.
 */
const MergeMethodPicked = Schema.TaggedStruct("MergeMethodPicked", {
  ...recorded,
  method: MERGE_METHOD,
})

/**
 * This trak's owner changed: every turn after it runs on `to`'s credential, and only `to` may
 * press what starts one. `from` is the owner before, absent where the trak had none. A turn
 * already running when it lands keeps the credential it was spawned with. Take ownership
 * appended it, and is gone; nothing appends one now, and it is kept so the logs that carry one
 * still replay. Moves nothing, for `ModeChanged`'s reason. See `Trak.owner`.
 */
const OwnerChanged = Schema.TaggedStruct("OwnerChanged", {
  ...recorded,
  from: Schema.optional(UserId),
  to: UserId,
})

/**
 * A human declared this trak over, without it having worked out.
 *
 * The second way a trak comes to rest, and the one that has to be *said* — a
 * merge-only trigger for *"came to rest"* silently drops every trak that did not
 * work out, and a corpus of nothing but successes answers no question worth
 * asking. **An abandoned trak is among the most informative things here**: *tried
 * three times, gave up, did it by hand* is a finding, and a trak quietly rotting
 * in a directory is not.
 *
 * It commits before it stops, on the ordinary `CommitWork` path, so the attempts
 * stay on the branch for whoever wants to know what was tried, and it takes the
 * checkout with it the way closing does.
 *
 * Not a `HumanAction`, though a human does it: those apply at a gate, and this
 * applies to a trak that failed, crashed, or is parked — anything a person can
 * reach, which is everything nobody is driving.
 *
 * `sessionId`, `step` and `usage` are `Stopped`'s three, present where the archive
 * killed a turn and absent where it found nothing running: this is that turn's only
 * ending, so a reader pairing turns to what they filed needs the position, and a
 * total folding spend needs what the turn had spent by the kill. All three are read
 * off the run record before the interruption clears it. A record a dead process
 * left behind counts the same way — the turn it names has no other ending.
 */
const Abandoned = Schema.TaggedStruct("Abandoned", {
  ...recorded,
  reason: Schema.String,
  sessionId: Schema.optional(SessionId),
  step: Schema.optional(Schema.Number),
  ...spent,
})

/**
 * A human is done with this trak: take the checkout away.
 *
 * The third way a trak comes to rest, and — unlike the other two — it says
 * nothing went wrong and nothing was given up on. A `review` trak has nothing to
 * merge and closing it is success. **`Closed` and `Abandoned` must stay
 * distinguishable** or the corpus loses the reading the record exists for.
 *
 * Only from `Finished`. Anything still moving has `Abandoned`, which is the
 * declaration that carries a reason, and a trak that already closed has nothing
 * left to take away. *Done with it* is the whole of what a person's press says,
 * and what it was is already the log.
 *
 * `sha` is the merge commit the forge sweep already read off the listing when it
 * archives a goal's trak whose pull request merged. It goes onto `Closing`, so the
 * removal does not ask the forge a second time, and a second call that fails cannot
 * end merged work `Closed`. Absent on a person's press, which asks the forge once as
 * the removal runs.
 *
 * Not a `HumanAction`, for the reason `Abandoned` is not: those apply at a gate,
 * and this applies to a trak.
 */
const Closed = Schema.TaggedStruct("Closed", { ...recorded, sha: Schema.optional(CommitSha) })

/**
 * A human asked for this trak's branch to go into the one they are standing on.
 *
 * **It carries no destination, and that is the merge rule written into the log.** A
 * merge goes where the human
 * currently is; recording a target here would be recording a fact about somebody
 * else's checkout, and honouring it later would mean Orkestra checking out a
 * branch on their behalf. Where it actually landed comes back as `WorkMerged`.
 *
 * Only from `Finished`, for `Closed`'s reason: the other resting states have
 * already been answered for.
 */
const Merged = Schema.TaggedStruct("Merged", { ...recorded })

/**
 * The branch went in, and `sha` is the merge commit on the host's branch.
 *
 * The tip afterwards rather than the commit this run created, so a re-run over a
 * branch already merged reports the same value — the same re-runnability
 * `WorkCommitted` has, one step along. A merge that **conflicted** does not
 * arrive here at all: it is a `Conflicted` carrying the paths, which routes to
 * the composer rather than ending the trak, because nothing was merged and both
 * branches are intact.
 */
const WorkMerged = Schema.TaggedStruct("WorkMerged", { ...recorded, sha: CommitSha })

/**
 * A spawn child's branch was **not** merged, on purpose: its parent had landed, and
 * the parent's branch did not already hold the child's tip. Nothing on a merged
 * branch may be written to after the merge, and by the time Merge is pressed the
 * branch holds whatever every turn since left, under whichever commit carried it —
 * so the changes are dropped whole rather than attributed. What the child filed
 * still reaches the parent: its documents, requirements and hand-up ride the
 * landing, or the refiling for a child that had landed before — `ChildRefiled` —
 * and neither needs the branch. `reason` says so in a sentence; the child ends
 * `Closed`.
 */
const ChangesDropped = Schema.TaggedStruct("ChangesDropped", { ...recorded, reason: Schema.String })

/**
 * Something arrived from outside about a trak that had already come to rest.
 *
 * **The door.** A CI failure, a PR comment, *"actually, more"* — the outside world
 * reaching a finished piece of work, without a standing condition or anything
 * watching for one. Nothing polls; something happens, a person re-enters, the
 * composer schedules.
 *
 * `what` is that sentence. It carries no position: where the new work joins on is the
 * end of what already ran, which is arithmetic rather than a judgment — see
 * `Trak.reconsult`.
 *
 * **`agent` is the second door, and which of the two this is.** Absent, the sentence
 * goes to the composer, which plans what to do about it — every re-entry there has ever
 * been. Named, it becomes the instruction of one conversational entry running that
 * agent, spliced in at the join: no composer turn and no plan to approve, which is what
 * *ask this finished trak a question* needs and what a planner is far too much of.
 *
 * **A name rather than a flag**, though `generic` is the only one the HTTP door accepts:
 * a log is permanent, a boolean could only ever mean one door, and what a reader wants
 * to know from a re-entry is which agent actually ran. It is also the shape the birth
 * route already has — `TrakCreated` carries the name and the route narrows it.
 *
 * Only from a trak at rest — `Finished`, `Closed`, `Merged` or `Abandoned`. A
 * failed or interrupted trak has `Restarted`, and a trak parked at a gate has a
 * human who owes it an answer.
 *
 * From `Finished` it is the **cheap** path, and that is most of what holding buys:
 * the checkout is still there, so `createWorktree` hands back the one the trak has
 * been using rather than making a second one. From the others it re-creates, on
 * the adopt-an-orphaned-branch path.
 */
const Reentered = Schema.TaggedStruct("Reentered", {
  ...recorded,
  what: Schema.String,
  /** Optional, so every re-entry written before this field replays as the composer's. */
  agent: Schema.optional(Schema.String),
  /**
   * The engine sent an auto-merging trak back because its pull request would not merge,
   * and this is what the forge said. Absent on every re-entry a person or a goal made.
   * `what` is then the pull request's address. Counted against `AUTO_MERGE_SENDS`, and a
   * `Conflict` takes every gate in advance until the trak rests — see `Trak.resolving`.
   */
  cause: Schema.optional(ReentryCause),
  /**
   * The pull request's base branch as the forge names it, where the re-entry answers the
   * forge refusing a merge: the engine's send-back for a conflict, or a person's press with
   * that refusal ticked. **Never read as a `cause`** — set alone it counts no send and takes
   * no gate. The composer is told to merge it as the remote has it and to plan the push.
   */
  base: Schema.optional(Schema.String),
  /**
   * The trak's pull request had merged, so its branch was moved before this re-entry ran
   * anything: the commits after `merged`, that pull request's head, replayed onto `onto`,
   * the tip of `origin/<base>` then, and pushed. The one record that the branch's history
   * was rewritten. Absent where nothing had merged or nothing was moved.
   */
  moved: Schema.optional(
    Schema.Struct({ merged: CommitSha, base: Schema.String, onto: CommitSha }),
  ),
})

/** What `Reentered.moved` records. */
export type BranchMoved = NonNullable<Schema.Schema.Type<typeof Reentered>["moved"]>

/**
 * The engine stopped merging this trak on its own: it sent it back `AUTO_MERGE_SENDS`
 * times and the pull request still would not merge, or the forge holds a merge nothing
 * the trak can push will release. `cause` says which. Moves nothing, for `ModeChanged`'s reason — the trak stays `Finished` for
 * its person, and its goal hears it as `stuck`.
 */
const AutoMergeStopped = Schema.TaggedStruct("AutoMergeStopped", {
  ...recorded,
  cause: StopCause,
})

/**
 * A person said something while the trak was being driven, and nobody has read it yet.
 *
 * **Every message sent off a gate is recorded here first, whatever happens to it
 * next** — a running turn reads it, the next turn that starts reads it, or it is the
 * chat at the gate the trak parks at. On the log rather than in the daemon's memory
 * because the last of those is `decide`'s to see, and all three have to survive a
 * restart. `id` is the handle its delivery is reported by. Moves nothing, for
 * `ModeChanged`'s reason.
 */
const MessageWaiting = Schema.TaggedStruct("MessageWaiting", {
  ...recorded,
  id: Schema.String,
  message: Schema.String,
  attachments: Attached,
})

/**
 * The model received a waiting message — the provider's own report of it, which lags
 * the write by whatever the model was doing. Written by the turn that heard it, never
 * by the write succeeding: a crash between the two leaves the message waiting, and a
 * message delivered twice is the cheap failure of the two. Moves nothing.
 */
const MessageDelivered = Schema.TaggedStruct("MessageDelivered", {
  ...recorded,
  id: Schema.String,
})

export const Event = Schema.Union(
  TrakCreated,
  ComposerReturned,
  AgentReturned,
  HumanActed,
  ChecksPassed,
  CheckFailed,
  ChecksCancelled,
  EffectsRan,
  EffectFailed,
  ConditionsMet,
  ConditionsUnmet,
  WaitSkipped,
  WorktreeReady,
  WorktreeFailed,
  SetupStarted,
  SetupPassed,
  SetupFailed,
  MergeFailed,
  Conflicted,
  StepRefused,
  WorkCommitted,
  WorktreeRemoved,
  TurnFailed,
  Restarted,
  StopRequested,
  Stopped,
  FilingAsked,
  ModeChanged,
  HoldChanged,
  SkipChecksChanged,
  AutoMergeChanged,
  MergeMethodPicked,
  OwnerChanged,
  MessageWaiting,
  MessageDelivered,
  ChildrenSpawned,
  HandedOff,
  GoalOpened,
  ChildLanded,
  ChildRefiled,
  ChildrenJoined,
  Abandoned,
  Closed,
  Merged,
  WorkMerged,
  ChangesDropped,
  Reentered,
  AutoMergeStopped,
)
export type Event = Schema.Schema.Type<typeof Event>

/** The three events that say where the project's setup script stands. */
export type SetupEvent = Extract<Event, { _tag: "SetupStarted" | "SetupPassed" | "SetupFailed" }>

export const isSetupEvent = (e: Event): e is SetupEvent =>
  e._tag === "SetupStarted" || e._tag === "SetupPassed" || e._tag === "SetupFailed"

/**
 * What a **child** trak is born with, beside its request. See `TrakCreated`.
 *
 * **Every field is required, because a child has every one.** Being spawned is
 * exactly what supplies them: an origin, the plan the parent's approved proposal
 * named, the branch to start from, the intent accumulated to that point, the
 * documents that intent was reached through, and the partition it is one piece of. A
 * child missing any of these is a bug at the call site rather than a trak with less
 * to go on, and this shape is what says so.
 *
 * `base` is the one that may be `undefined`, and it is a required *key* all the same —
 * a parent with no checkout has nowhere for a child to branch from, which is the
 * offline demos. Saying nothing about it is not one of the options.
 */
export interface Born {
  readonly parent: Parent
  readonly plan: Proposal
  /**
   * Where this child's branch starts — its parent's branch, always. `undefined`
   * only for a parent that has no checkout, which is the offline demos.
   */
  readonly base: BranchName | undefined
  /**
   * With provenance, unlike everything else an agent writes: an inherited entry
   * that says which of the parent's steps decided it is legible in the child's
   * `trak.md`, and one that does not is an assertion from nowhere.
   */
  readonly decisions: readonly Recorded[]
  /**
   * The parent's artifacts, keyed as it filed them — `visibleArtifacts` passed
   * straight through, so which ones cross is the caller's position rather than a
   * rule here.
   */
  readonly artifacts: readonly (readonly [string, Document])[]
  /**
   * The whole spawn this child came out of, its own piece included — the same value
   * for every child of one spawn. A required key even for a spawn of one, which
   * holds a list of one: *nobody else is in this* is a fact, and a piece that could
   * omit it would be indistinguishable from a piece that forgot.
   */
  readonly split: Split
}

/** What a child came back with. See `ChildLanded`. */
export interface Landed {
  readonly step: number
  readonly child: number
  readonly id: TrakId
  readonly branch: BranchName
  readonly sha: CommitSha | undefined
  readonly artifacts: readonly (readonly [string, Document])[]
  readonly decisions: readonly Decided[]
  readonly handUp: string | undefined
}

/** What a landed child came back with the next time. See `ChildRefiled`. */
export interface Refiled {
  readonly step: number
  readonly child: number
  readonly id: TrakId
  readonly artifacts: readonly (readonly [string, Document])[]
  readonly decisions: readonly Decided[]
  readonly handUp: string | undefined
}

/**
 * What a failure carries beside its reason, off the error that caused it: the runner verb
 * that failed, the runners-only guard's refusal, and the ref holding a sandbox's
 * uncommitted changes that a remake did not put back. Every field is the error's own.
 */
export interface FailedBeside {
  readonly runner?: RunnerFailure | undefined
  readonly runnersOnly?: string | undefined
  readonly carried?: string | undefined
}

/** A script's ending as an event keeps it: what `FailedBeside` keeps, and where it ran. */
export type Ended = Omit<FailedBeside, "runner"> & { readonly place?: Place | undefined }

const placeOf = (place: Place | undefined) => (place === undefined ? {} : { place })

/**
 * `beside`'s fields that hold something, and no key for one that does not — each is an
 * exact optional on the events and the state, where a key holding `undefined` is a
 * different shape.
 */
export const besideOf = (beside: FailedBeside | undefined) => ({
  ...(beside?.runner === undefined ? {} : { runner: beside.runner }),
  ...(beside?.runnersOnly === undefined ? {} : { runnersOnly: beside.runnersOnly }),
  ...(beside?.carried === undefined ? {} : { carried: beside.carried }),
})

export const Events = {
  // `born` is absent for a trak a human asked for, and its fields are exact
  // optionals — built by hand for the reason `workCommitted` is, so an ordinary
  // trak's log carries no keys at all rather than several undefined ones.
  // `mode` is a parameter rather than a field of `Born`, and the default is what
  // every caller with nothing to say about it takes. A child's is its parent's,
  // passed by `driveChild` — inheritance is a sentence at the one call site that
  // knows both traks, rather than a field a spawn could forget to fill.
  // `owner` is a parameter of every birth for `mode`'s reason: a child's and a
  // handed-off trak's is the trak it came from, passed at the call site that knows both.
  // `attachments` follows it on the two births a person asks for, and on no other.
  trakCreated: (
    description: string,
    born?: Born,
    mode: RunMode = "manual",
    autoMerge = false,
    owner?: UserId,
    attachments?: readonly Attachment[],
  ): Event =>
    TrakCreated.make({
      description,
      mode,
      ...(autoMerge ? { autoMerge } : {}),
      ...(owner === undefined ? {} : { owner }),
      ...attachedField(attachments),
      ...(born === undefined
        ? {}
        : {
            parent: born.parent,
            plan: born.plan,
            decisions: born.decisions,
            artifacts: born.artifacts,
            split: born.split,
            // Spread rather than assigned, because absent and `undefined` are
            // the same answer here and only one of them is a legal optional.
            ...(born.base === undefined ? {} : { base: born.base }),
          }),
    }),
  /**
   * The same event, for a trak **opened with one named agent** — New Trak's *start a
   * conversation with `ui-prototype`* rather than *describe it and wait for the
   * composer*. Born holding the one entry, and holding nothing else.
   *
   * **A second constructor rather than a looser `Born`, and the function name is the
   * discriminator.** A shape of *plan, and the rest optional* would have to accept a
   * child that forgot its `decisions`, because every field a child fills would be
   * optional in it — and a union of the two is worse than useless here: `{plan}` is a
   * subset of `Born`'s fields, so a half-built child satisfies the narrow member and
   * type-checks. Two doors keep `Born`'s six required fields meaning what they say.
   *
   * There is no `Opened` interface to go with it: one parameter is the whole of what
   * this birth carries, and a named type holding a single field would be the same
   * differentiation said twice.
   */
  trakOpenedWith: (
    description: string,
    plan: Proposal,
    mode: RunMode = "manual",
    autoMerge = false,
    owner?: UserId,
    attachments?: readonly Attachment[],
  ): Event =>
    TrakCreated.make({
      description,
      plan,
      mode,
      ...(autoMerge ? { autoMerge } : {}),
      ...(owner === undefined ? {} : { owner }),
      ...attachedField(attachments),
    }),
  /**
   * The same event, for a trak **another trak's composer handed off** — its description
   * is the hand-off's own words, it is cut from the default branch, and it knows which
   * trak sent it. Born holding nothing else: no plan, no documents, no decisions, no
   * split, because it works from a different base and reads what it needs fresh. Its
   * composer runs as a trak a person opened.
   *
   * A third door rather than a wider `Born`, for `trakOpenedWith`'s reason — and a
   * required `base`, where the other two births leave it optional: a hand-off with no
   * base would be cut from wherever the person is standing, which is the one thing it
   * exists not to do.
   */
  trakHandedOff: (
    description: string,
    base: BranchName,
    handedOffFrom: TrakId,
    mode: RunMode,
    owner?: UserId,
  ): Event =>
    TrakCreated.make({
      description,
      base,
      handedOffFrom,
      mode,
      ...(owner === undefined ? {} : { owner }),
    }),
  /**
   * The same event, for a trak **a goal's composer opened**. Born holding its request,
   * its mode and its goal, and composed like a trak a person opened — the goal chose
   * the work, not the plan for it.
   */
  trakForGoal: (
    description: string,
    mode: RunMode,
    goal: GoalId,
    base?: BranchName,
    autoMerge = false,
    goalBranch?: BranchName,
    owner?: UserId,
  ): Event =>
    TrakCreated.make({
      description,
      mode,
      goal,
      ...(base === undefined ? {} : { base }),
      ...(goalBranch === undefined ? {} : { goalBranch }),
      ...(autoMerge ? { autoMerge } : {}),
      ...(owner === undefined ? {} : { owner }),
    }),
  // `usage` is an exact optional on all three turn events, so it is spread rather
  // than assigned — the same hand-building `workCommitted` does, and for the same
  // reason: a turn nobody metered has no key at all. `envelope` follows it for the
  // same reason: a turn that answered in prose wrote none. `stopped` is the third,
  // and an empty list is the same absence.
  composerReturned: (
    sessionId: SessionId,
    output: ComposerOutput,
    usage?: Usage,
    envelope?: string,
    stopped: readonly StoppedTask[] = [],
  ): Event =>
    ComposerReturned.make({
      sessionId,
      output,
      ...(usage === undefined ? {} : { usage }),
      ...(envelope === undefined ? {} : { envelope }),
      ...(Arr.isNonEmptyReadonlyArray(stopped) ? { stopped } : {}),
    }),
  agentReturned: (
    step: number,
    sessionId: SessionId,
    output: StepOutput,
    usage?: Usage,
    envelope?: string,
    stopped: readonly StoppedTask[] = [],
  ): Event =>
    AgentReturned.make({
      step,
      sessionId,
      output,
      ...(usage === undefined ? {} : { usage }),
      ...(envelope === undefined ? {} : { envelope }),
      ...(Arr.isNonEmptyReadonlyArray(stopped) ? { stopped } : {}),
    }),
  /** `sessionId` and `usage` only for a press that killed a turn — see `HumanActed`. */
  humanActed: (step: number, action: HumanAction, sessionId?: SessionId, usage?: Usage): Event =>
    HumanActed.make({
      step,
      action,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(usage === undefined ? {} : { usage }),
    }),
  // `skipped` is an exact optional, absent where the checks ran — `workCommitted`'s
  // hand-building, for its reason.
  checksPassed: (
    step: number,
    ran: readonly string[],
    skipped?: readonly string[],
    reused?: readonly string[],
    places?: Readonly<Record<string, Place>>,
  ): Event =>
    ChecksPassed.make({
      step,
      ran,
      ...(skipped === undefined ? {} : { skipped }),
      ...(reused === undefined ? {} : { reused }),
      ...(places === undefined || Object.keys(places).length === 0 ? {} : { places }),
    }),
  checksCancelled: (step: number, name?: string): Event =>
    ChecksCancelled.make({ step, ...(name === undefined ? {} : { name }) }),
  // `command` and `exitCode` are exact optionals, so each key is absent rather than
  // present and undefined — the same hand-building `workCommitted` does.
  checkFailed: (
    step: number,
    name: string,
    output: string,
    command?: string,
    exitCode?: number,
    beside?: Ended,
  ): Event =>
    CheckFailed.make({
      step,
      name,
      output,
      ...(command === undefined ? {} : { command }),
      ...(exitCode === undefined ? {} : { exitCode }),
      ...besideOf(beside),
      ...placeOf(beside?.place),
    }),
  // `skipped` is an exact optional, absent where the effects ran — `checksPassed`'s shape.
  effectsRan: (
    step: number,
    ran: readonly RanEffect[],
    skipped?: readonly [string, ...string[]],
  ): Event => EffectsRan.make({ step, ran, ...(skipped === undefined ? {} : { skipped }) }),
  effectFailed: (step: number, name: string, output: string, beside?: Ended): Event =>
    EffectFailed.make({ step, name, output, ...besideOf(beside), ...placeOf(beside?.place) }),
  conditionsMet: (step: number, ran: readonly string[], merged?: CommitSha): Event =>
    ConditionsMet.make({ step, ran, ...(merged === undefined ? {} : { merged }) }),
  conditionsUnmet: (
    step: number,
    name: string,
    output: string,
    stopped: boolean,
    merged?: CommitSha,
  ): Event =>
    ConditionsUnmet.make({
      step,
      name,
      output,
      stopped,
      ...(merged === undefined ? {} : { merged }),
    }),
  waitSkipped: (step: number, name: string, merged?: CommitSha): Event =>
    WaitSkipped.make({ step, name, ...(merged === undefined ? {} : { merged }) }),
  worktreeReady: (worktree: Worktree, place?: Place): Event =>
    WorktreeReady.make({ worktree, ...placeOf(place) }),
  // `place` where a script failed — the teardown, or setup run in a checkout made again.
  worktreeFailed: (
    reason: string,
    beside?: FailedBeside & { readonly place?: Place | undefined },
    setup?: string,
  ): Event =>
    WorktreeFailed.make({
      reason,
      ...besideOf(beside),
      ...placeOf(beside?.place),
      ...(setup === undefined ? {} : { setup }),
    }),
  setupStarted: (place?: Place): Event => SetupStarted.make(placeOf(place)),
  setupPassed: (): Event => SetupPassed.make({}),
  // The killed turn's three are `stopped`'s, read off the run record before the kill.
  // `outcome` is the script's: what it printed, and what readying its spawn left beside it.
  setupFailed: (
    reason: string,
    outcome: Omit<FailedBeside, "runner"> & { readonly output: string },
    turn?: {
      readonly sessionId: SessionId
      readonly step?: number | undefined
      readonly usage?: Usage | undefined
    },
  ): Event =>
    SetupFailed.make({
      reason,
      output: outcome.output,
      ...besideOf(outcome),
      ...(turn === undefined ? {} : { sessionId: turn.sessionId }),
      ...(turn?.step === undefined ? {} : { step: turn.step }),
      ...(turn?.usage === undefined ? {} : { usage: turn.usage }),
    }),
  mergeFailed: (reason: string): Event => MergeFailed.make({ reason }),
  stepRefused: (step: number, reason: string): Event => StepRefused.make({ step, reason }),
  // `into` is an exact optional, so it is spread rather than assigned — the same
  // hand-building `workCommitted` does, and for the same reason: a detached host
  // has no branch name, and a key present and undefined is not the same shape.
  conflicted: (paths: readonly [string, ...string[]], into: string | undefined): Event =>
    Conflicted.make({ paths, ...(into === undefined ? {} : { into }) }),
  // Built by hand rather than passed straight through: both `sha` and `step` are
  // exact optionals, so each key is absent when there is nothing to say rather
  // than present and undefined.
  workCommitted: (sha: CommitSha | undefined, step?: number): Event =>
    WorkCommitted.make({
      ...(sha === undefined ? {} : { sha }),
      ...(step === undefined ? {} : { step }),
    }),
  // `sha` is an exact optional, spread for `workCommitted`'s reason.
  worktreeRemoved: (sha?: CommitSha, place?: Place): Event =>
    WorktreeRemoved.make({ ...(sha === undefined ? {} : { sha }), ...placeOf(place) }),
  // Every optional here is exact, so each key is absent rather than present and
  // undefined — built by hand for the same reason `workCommitted` is.
  turnFailed: (
    step: number | undefined,
    sessionId: SessionId | undefined,
    reason: string,
    usage?: Usage,
    apiKind?: ApiErrorKind,
    beside?: FailedBeside,
  ): Event =>
    TurnFailed.make({
      ...(step === undefined ? {} : { step }),
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(usage === undefined ? {} : { usage }),
      ...(apiKind === undefined ? {} : { apiKind }),
      ...besideOf(beside),
      reason,
    }),
  // A turn whose answer is dropped because its commits never reached this machine — see
  // `TurnFailed`'s `unfetched`. Exact optionals, built by hand for `turnFailed`'s reason.
  turnUnfetched: (
    step: number | undefined,
    sessionId: SessionId | undefined,
    reason: string,
    usage: Usage | undefined,
    runner: RunnerFailure | undefined,
  ): Event =>
    TurnFailed.make({
      ...(step === undefined ? {} : { step }),
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(usage === undefined ? {} : { usage }),
      ...(runner === undefined ? {} : { runner }),
      reason,
      unfetched: true,
    }),
  // Same reason: both are exact optionals, absent rather than undefined. `step` is
  // trailing because `advance` is its only caller — which turn a restart ends comes
  // off the run record at the append, so nothing that asks for one supplies it.
  restarted: (sessionId: SessionId | undefined, step?: number): Event =>
    Restarted.make({
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(step === undefined ? {} : { step }),
    }),
  // All exact optionals again, and **the first two required parameters**, which is the
  // one way this differs from `restarted`. A stop reads the turn it is ending off the run
  // record *before* the interruption clears it, so the caller is the only thing that can
  // know any of them — there is nothing left at the append for `advance` to stamp from.
  stopped: (sessionId: SessionId | undefined, step: number | undefined, usage?: Usage): Event =>
    Stopped.make({
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(step === undefined ? {} : { step }),
      ...(usage === undefined ? {} : { usage }),
    }),
  stopRequested: (
    sessionId: SessionId | undefined,
    step: number | undefined,
    usage?: Usage,
  ): Event =>
    StopRequested.make({
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(step === undefined ? {} : { step }),
      ...(usage === undefined ? {} : { usage }),
    }),
  filingAsked: (sessionId: SessionId | undefined, step: number | undefined, usage?: Usage): Event =>
    FilingAsked.make({
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(step === undefined ? {} : { step }),
      ...(usage === undefined ? {} : { usage }),
    }),
  modeChanged: (mode: RunMode): Event => ModeChanged.make({ mode }),
  holdChanged: (holding: boolean): Event => HoldChanged.make({ holding }),
  skipChecksChanged: (skipping: boolean): Event => SkipChecksChanged.make({ skipping }),
  autoMergeChanged: (on: boolean): Event => AutoMergeChanged.make({ on }),
  mergeMethodPicked: (method: MergeMethod): Event => MergeMethodPicked.make({ method }),
  ownerChanged: (from: UserId | undefined, to: UserId): Event =>
    OwnerChanged.make({ to, ...(from === undefined ? {} : { from }) }),
  messageWaiting: (id: string, message: string, attachments?: readonly Attachment[]): Event =>
    MessageWaiting.make({ id, message, ...attachedField(attachments) }),
  messageDelivered: (id: string): Event => MessageDelivered.make({ id }),
  childrenSpawned: (step: number, ids: readonly [TrakId, ...TrakId[]]): Event =>
    ChildrenSpawned.make({ step, ids }),
  handedOff: (step: number, base: BranchName, ids: readonly [TrakId, ...TrakId[]]): Event =>
    HandedOff.make({ step, base, ids }),
  /** A goal's trak's hand-off: nothing named, the descriptions are the goal's. See `HandedOff`. */
  handedToGoal: (step: number): Event => HandedOff.make({ step }),
  goalOpened: (step: number, goal: GoalId): Event => GoalOpened.make({ step, goal }),
  // `sha`, `artifact` and `handUp` are exact optionals — absent when the child
  // changed no files, when it filed nothing, and when it handed nothing up.
  childLanded: (l: Landed): Event =>
    ChildLanded.make({
      step: l.step,
      child: l.child,
      id: l.id,
      branch: l.branch,
      ...(l.sha === undefined ? {} : { sha: l.sha }),
      artifacts: l.artifacts,
      decisions: l.decisions,
      ...(l.handUp === undefined ? {} : { handUp: l.handUp }),
    }),
  childRefiled: (r: Refiled): Event =>
    ChildRefiled.make({
      step: r.step,
      child: r.child,
      id: r.id,
      artifacts: r.artifacts,
      decisions: r.decisions,
      ...(r.handUp === undefined ? {} : { handUp: r.handUp }),
    }),
  childrenJoined: (step: number, merged: readonly CommitSha[]): Event =>
    ChildrenJoined.make({ step, merged }),
  // `stopped`'s three, after the reason, and optional as `stopped`'s are not: an
  // archive reaches a parked trak with nothing to kill.
  abandoned: (reason: string, sessionId?: SessionId, step?: number, usage?: Usage): Event =>
    Abandoned.make({
      reason,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(step === undefined ? {} : { step }),
      ...(usage === undefined ? {} : { usage }),
    }),
  closed: (sha?: CommitSha): Event => Closed.make(sha === undefined ? {} : { sha }),
  merged: (): Event => Merged.make({}),
  workMerged: (sha: CommitSha): Event => WorkMerged.make({ sha }),
  changesDropped: (reason: string): Event => ChangesDropped.make({ reason }),
  reentered: (what: string, agent?: string, base?: string, moved?: BranchMoved): Event =>
    Reentered.make({
      what,
      ...(agent === undefined ? {} : { agent }),
      ...(base === undefined ? {} : { base }),
      ...(moved === undefined ? {} : { moved }),
    }),
  /** The engine's re-entry of an auto-merging trak: the pull request, and why it would not merge. */
  sentBack: (pull: string, cause: ReentryCause, base?: string): Event =>
    Reentered.make({ what: pull, cause, ...(base === undefined ? {} : { base }) }),
  autoMergeStopped: (cause: StopCause): Event => AutoMergeStopped.make({ cause }),
}

/**
 * The same event, with the time it was written down — its own where it already carries
 * one, else `at`.
 *
 * A spread rather than a constructor because there is no constructor to reach for:
 * the tag is already on the value and re-making it would mean fourteen arms that
 * exist only to copy their own fields. It preserves `_tag` rather than writing
 * one, which is the whole of what "never hand-write a tag" is protecting.
 *
 * **First stamp wins**, because two callers now reach here: `advance` stamps an event
 * before it applies it, so the trak it hands on and the trak the log replays agree
 * about the time, and every `Store` implementation stamps whatever arrives without
 * one. Overwriting would move a time the trak was already derived from.
 */
export const stamped = (e: Event, at: number): Event => (e.at === undefined ? { ...e, at } : e)

/**
 * The same event, naming the engine version it was written under where it ends a turn
 * and names none yet. Every other event comes back as it was.
 *
 * A spread for `stamped`'s reason, and first stamp wins for the same one.
 */
export const versioned = (e: Event, engineVersion: string): Event =>
  (e._tag === "ComposerReturned" || e._tag === "AgentReturned" || e._tag === "TurnFailed") &&
  e.engineVersion === undefined
    ? { ...e, engineVersion }
    : e

export const decodeEvent = Schema.decodeUnknown(Event)
export const encodeEvent = Schema.encode(Event)
