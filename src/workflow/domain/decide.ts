// The heart of the system: a pure, total state transition.
// No Effect in the signature — it cannot fail, await, or perform I/O.

import { Data } from "effect"
import type { ApiErrorKind } from "../../agent/types/provider-event.js"
import type { CommitSha } from "../../vcs/index.js"
import {
  approvedInAdvance,
  endsUnattended,
  planRunsUnattended,
  runsUnattended,
  unanswered,
} from "./attention.js"
import { CHECK_FAILURE_LIMIT } from "./check-progress.js"
import type { ComposerOutput } from "./outputs/composer-output.js"
import { recommendations } from "./outputs/questions.js"
import type { StepOutput } from "./outputs/step-output.js"
import { besideOf, type Event, Events, type FailedBeside } from "./event.js"
import { Actions, type HumanAction } from "./human-action.js"
import type { Attachment } from "./attachment.js"
import {
  artifactKey,
  isConversational,
  isFinished,
  isSpawn,
  isCompose,
  type Plan,
} from "./outputs/proposal.js"
import {
  asGate,
  atRest,
  holdsCheckout,
  effectFailedAt,
  engineWait,
  firstUnrun,
  goalProposalPending,
  handOffPending,
  pendingWait,
  planEntryOf,
  slotAt,
  type Failure,
  type Gate,
  type HumanGate,
  type Trak,
  type TrakId,
  TrakState,
} from "./trak.js"
import { type Trigger, Triggers } from "./trigger.js"

// ============================================================================
// Commands — descriptions of work. decide asks; runtime does.
// ============================================================================

export type Command = Data.TaggedEnum<{
  /**
   * Make the worktree this trak works in and run the project's setup script in
   * it. Everything after it — the composer's turn included — runs there.
   *
   * It is its own command with its own event rather than the first half of
   * `Compose`, so the ordering is an edge in the state machine instead of the
   * order two commands happen to sit in an array.
   */
  SetupWorktree: object
  /**
   * Commit the worktree's contents to its branch. The checkout stays.
   *
   * Issued at every step boundary — `step` names which one — and once more with
   * `step: undefined` for whatever is left when the trak stops moving on its own:
   * past the last step (`Integrating`) and when a human declares it over
   * (`Abandoning`). **Not only the last thing a trak does**: a step's work must
   * survive the checkout it was written in, and a child spawned after it inherits
   * only what the parent's branch already holds by then.
   */
  CommitWork: { readonly step: number | undefined }
  /**
   * Take the checkout away, and the branch with it if nothing was committed.
   *
   * **Only a human triggers it.** Issued from `Closing` and from `Abandoning`,
   * which is to say from the two places somebody has said they are done — never
   * where the plan merely ran out. Keeping the work (`CommitWork`) is the other
   * half, and that half is unattended.
   */
  RemoveWorktree: object
  /**
   * Bring this trak's branch into the branch the host repository is on.
   *
   * **It carries no destination**, and that is the merge rule in the type: a merge goes
   * where the human is
   * standing, so naming a target here would be the domain holding an opinion
   * about somebody's working copy. The runner asks git where that is.
   */
  MergeWork: object
  /**
   * Ask the composer for a plan.
   *
   * `trigger` says which turn this is: `Initial` up front, `Answers` when a human
   * has replied to its questions, `Message` when they typed at the plan gate, and
   * `Reconsulted` when it is being asked what the rest of the plan should be — the
   * one that joins onto work already done, and the one that starts a fresh session.
   */
  Compose: { readonly description: string; readonly trigger: Trigger }
  SpawnStep: { readonly step: number; readonly trigger: Trigger }
  /**
   * Run every check this step declared, fail-fast, and report the first failure
   * or the fact that they all passed.
   *
   * Carries only the index: the checks are on the step, and the runner has the
   * library. One command for all of them rather than one per check, because a
   * command produces exactly one event and the loop has nothing a human or the
   * domain can usefully interrupt in the middle of.
   */
  RunChecks: { readonly step: number }
  /**
   * Run every effect this step declared, fail-fast, once its work is on the branch.
   *
   * `RunChecks` one hook along, and it carries only the index for the same reason.
   * What differs is what it may read and what a failure means: the runner rebuilds
   * the trak's paperwork first, so a script sending the document this step filed can
   * open it, and a non-zero exit is *could not do it* rather than *wrong*.
   *
   * **Re-issued by a restart**, which is safe only because an effect is written to be
   * idempotent — *open one for this branch if it has not got one*. `Merging` and
   * `Closing` carry the same sentence.
   */
  RunEffects: { readonly step: number }
  /**
   * Ask whether the step at `step` may start: every condition its agent declares,
   * fail-fast, and report that they are all met or which one is not.
   *
   * `RunChecks` one hook *before*, and it carries only the index for the same reason.
   * What differs is that its second answer is nobody's failure: a condition not yet
   * met rests the trak at `Finished` through the door a plan running out takes, and
   * the daemon asks again on the script's own interval — see `askConditions` in
   * `runtime.ts`, which the sweep shares.
   *
   * **Re-issued by a restart**, which is safe because asking is idempotent by nature:
   * a script that reads whether a pull request merged has nothing to do twice.
   */
  AskConditions: { readonly step: number }
  /**
   * Mint an id for every child this spawn position names, and report them.
   *
   * It creates the children and returns; it does **not** drive them. Driving N
   * traks is a surface's job — the engine says *these owe you events* and parks.
   *
   * Idempotent for the reason `createWorktree` is: a restart re-issues it, and
   * a child that already exists is one whose id is already on this log.
   */
  SpawnChildren: { readonly step: number }
  /**
   * Name a trak for every description the compose entry at `step` handed off, on the
   * repository's default branch, and report them.
   *
   * `SpawnChildren`'s sentence one door over: it names the traks and returns, and
   * opening them is the daemon's — `driveHandOff` in `runtime.ts`, forked by
   * `app/drive.ts` once the drive that took the gate ends. Nothing parks on them: a
   * hand-off never comes back, so no `Await` names them and the plan is entered as
   * soon as they are named.
   *
   * Idempotent for `SpawnChildren`'s reason — a restart re-issues it, and traks
   * already named are on this log. Where the repository has no default branch to cut
   * from it reports `WorktreeFailed` with the reason, retryable once `origin/HEAD`
   * is set.
   */
  HandOff: { readonly step: number }
  /**
   * Bring back what the children made: the one moment their artifacts and
   * decisions enter this trak. The git already happened — a child's branch goes
   * into this checkout when a human closes that child as *merge*.
   */
  JoinChildren: { readonly step: number }
  /**
   * End the turn a person pressed Stop on, through the seam operation: locally the turn's
   * process group, remotely `runner.sh kill` for the exec its run record names. Its
   * ending is `Stopped`, which a kill that found nothing running also earns, or a
   * `TurnFailed` carrying the runner's failure once the window is spent. `step` is
   * `Stopping`'s, absent for the composer.
   */
  StopTurn: { readonly step: number | undefined }
}>
export const Command = Data.taggedEnum<Command>()

// ============================================================================
// Decision — three cases, and there is no fourth.
// "New state, no commands, no reason" is unrepresentable.
// ============================================================================

/**
 * Names exactly who owes us an event.
 *
 * The invariant is **an Await names a party** — not *an Await lists human actions*,
 * which holds only while `Human` is the sole member. Read it through `party` below
 * rather than reaching for `.actions`; both members answer it with a non-empty list.
 */
export type AwaitReason = Data.TaggedEnum<{
  Human: { readonly actions: readonly HumanAction["_tag"][] }
  Children: { readonly ids: readonly [TrakId, ...TrakId[]] }
}>
export const AwaitReason = Data.taggedEnum<AwaitReason>()

/** Who owes us an event, named — actions at a gate, trak ids at a spawn. */
export const party = (reason: AwaitReason): readonly string[] =>
  AwaitReason.$match(reason, {
    Human: (h) => h.actions,
    Children: (c) => c.ids,
  })

export type Decision = Data.TaggedEnum<{
  Advance: { readonly next: TrakState; readonly commands: readonly [Command, ...Command[]] }
  Await: { readonly next: TrakState; readonly awaiting: AwaitReason }
  Settle: { readonly next: TrakState }
}>
export const Decision = Data.taggedEnum<Decision>()

// -- Local shorthands --------------------------------------------------------

const awaitHuman = (next: TrakState, ...actions: readonly HumanAction["_tag"][]): Decision =>
  Decision.Await({ next, awaiting: AwaitReason.Human({ actions }) })

/** `apiKind` is the provider's own classification, and absent everywhere else. */
const fail = (
  error: string,
  kind: Failure,
  apiKind?: ApiErrorKind,
  beside?: FailedBeside,
  setup?: string,
): Decision =>
  Decision.Settle({
    next: TrakState.Failed({
      error,
      kind,
      apiKind,
      ...besideOf(beside),
      ...(setup === undefined ? {} : { setup }),
    }),
  })

/**
 * An event that cannot apply to the current state is a bug, not a no-op.
 * Failing loudly and deterministically is the honest outcome — a silent
 * "stay put" is precisely the stall the Decision union exists to prevent.
 *
 * `detail` is for an event that carries a message of its own worth keeping. The
 * tags say the invariant broke; only the event can say what the outside world
 * was reporting when it did.
 */
/**
 * The states with git in flight, and therefore the ones `WorktreeFailed` applies
 * in.
 *
 * **The rule, rather than the list, because the list is what goes stale:** every
 * state a command runs in, where that command can raise `GitFailed`, has to be
 * here. `runtime.ts` absorbs a `GitFailed` into a `WorktreeFailed` at the command
 * that produced it — the only way a command can always produce its event — so a
 * state left out turns git declining to answer into `Failed{engine}`, *an
 * invariant broke*, with git's own reason discarded by `unexpected`. Naming a
 * spawn's children is the case that proved it: the mint asks git whether it
 * already holds the branch, so `Spawning` joined the set when it started asking.
 *
 * The asymmetry is what makes this cheap to keep right. A state in here that
 * nothing currently raises from costs nothing, and two are: `Joining`, because a
 * child's branch goes in when a human closes it, so the git of a join happens in
 * `Merging`; and `Merging` itself, whose git now reports as `MergeFailed` and
 * which stays here for every log written while it reported as `WorktreeFailed`.
 * A state *missing* is a false accusation against the engine, found by reading
 * the message rather than by any check.
 *
 * A set rather than a chain of comparisons, exhaustively typed: the key is
 * `TrakState["_tag"]`, so a renamed state is a compile error here.
 */
const GIT_IN_FLIGHT: ReadonlySet<TrakState["_tag"]> = new Set<TrakState["_tag"]>([
  "Preparing",
  "Committing",
  "Integrating",
  "Abandoning",
  "Closing",
  "Merging",
  "Joining",
  "Spawning",
  // The mint asks git for the default branch and whether each name is free.
  "HandingOff",
  // Every command run in the checkout first makes it again where it went missing.
  "Composing",
  "AgentWorking",
  "CheckRunning",
  "ConditionRunning",
  "Effecting",
])

/** The two states that take a checkout away — after a merge or a close, and abandoning. */
const archiving = (s: TrakState): boolean => s._tag === "Closing" || s._tag === "Abandoning"

const unexpected = (e: Event, s: TrakState, detail?: string): Decision =>
  fail(
    `unexpected event ${e._tag} in state ${s._tag}${detail === undefined ? "" : `: ${detail}`}`,
    "engine",
  )

/**
 * Stand the human back where they were.
 *
 * The whole of what a conversational reply does: the agent answered a question,
 * so what is in front of the human is the same thing, with the same options,
 * routing the same way. One state per distinct routing therefore says a reply
 * needs neither a new state nor a new gate kind — it needs the old one back.
 *
 * `undefined` is unreachable: a reply is only produced on a turn a human
 * started, and a human can only speak at a gate. Loud rather than invented,
 * because the invented answer is a gate somebody is not standing at.
 */
const reenter = (gate: Gate | undefined): Decision => {
  if (gate === undefined) return fail("a reply arrived with no gate to return to", "engine")
  if (gate._tag === "AwaitingComposerAnswers") return awaitHuman(gate, "AnswerQuestions")
  if (gate._tag === "AwaitingProposal") return awaitHuman(gate, "Approve", "Chat")
  return stepGate(gate.step, gate.kind)
}

/**
 * Is this reply another turn of a conversation, rather than an answer to a
 * question somebody asked at a gate?
 *
 * Both halves are load-bearing. A `conversational` entry is what makes prose an
 * ordinary output at all — and the artifact being **unfiled** is what keeps this
 * from swallowing an ordinary chat: once the document exists, a human talking to
 * the step is standing at its approval gate and must get that gate back, with
 * the artifact still on the table. Conversational says the artifact is not owed
 * *yet*, never that this step has no ordinary gate.
 *
 * The alternative — `reenter(lastGate)` for every reply — is wrong for exactly
 * the first turn, which is the whole of what this flag buys: `lastGate` is then
 * the plan gate, or the *previous* step's approval gate, where `Chat` talks to
 * the composer and `Approve` advances past work nobody has done.
 */
const conversing = (t: Trak, p: Plan, i: number): boolean => {
  const step = p.steps[i]
  return step !== undefined && isConversational(step) && !t.artifacts.has(artifactKey(step, i))
}

// ============================================================================
// Entering a step — the one place a trak runs out of them
// ============================================================================

const enterStep = (t: Trak, p: Plan, i: number, trigger: Trigger): Decision => {
  const step = p.steps[i]
  if (step === undefined || isFinished(i, p)) {
    // Past the last proposed step, with nothing left to ask — `onCommitted` is
    // what intercepts a plan that ran out where the composer said it would.
    // Nothing declared this; it's just where we are — but the work is still only
    // in a checkout, so keeping it is the one thing left to do and `Finished`
    // waits on it.
    //
    // The checkout is **not** taken away here: the plan running out is not
    // somebody saying they are done with the trak, and reading it as both loses
    // the work a human has not looked at yet.
    return holdAtRest()
  }
  // The composer scheduled its own next turn, and the plan has reached it. Nothing
  // is inferred here: it is a step, so entering it is what running it means, and
  // `landCompose` fills this entry in rather than appending beside it.
  //
  // It ignores the incoming trigger for the reason a spawn does — that trigger is
  // for whatever runs at this position, and what runs here is the composer. Always
  // `Reconsulted`, which is what mints a fresh session: a resumed composer would
  // defend the plan it wrote and could not be handed the decisions filed since.
  //
  // A compose entry the *engine* appended is never reached, because it is appended
  // at the end of what ran and approving the plan it wrote starts after it. There is
  // nothing to tell the two apart here, and nothing that needs to: asking the
  // composer what happens from here is the right answer either way.
  if (isCompose(step)) return compose(t, Triggers.reconsulted())
  // A spawn ignores the trigger, and that is what it means for it not to be a
  // turn: there is no session for a human's words to reach, and each child holds
  // its own conversation.
  if (isSpawn(step)) {
    return Decision.Advance({
      next: TrakState.Spawning({ step: i }),
      commands: [Command.SpawnChildren({ step: i })],
    })
  }
  // **The first entry asks first, and only the first.** `Initial` is the one trigger
  // that reaches a position nothing has run at; every other resumes a session at a
  // position already entered, whose conditions were met when it was. Read off the
  // trigger rather than off the slot, because the trigger is what says why this
  // iteration is happening — see `trigger.ts`.
  //
  // Unconditional, as `verify` and `runEffects` are and for their reason: which
  // conditions an agent declares is `.orkestra/` policy, and `ConditionsMet` with
  // no names is the honest record that nothing held the step.
  return trigger._tag === "Initial" ? askConditions(i) : work(i, trigger)
}

/**
 * The position whose turn is in flight, or `undefined` where none is.
 *
 * `AgentWorking`, and **`ConditionRunning` as well, for the logs written before a
 * condition was ever asked.** Those record the turn straight after the approval —
 * nothing wrote a `ConditionsMet`, because nothing asked — so replay reaches the
 * turn's ending standing here. A log records the route the trak took, and refusing
 * it would settle every stored trak `Failed{engine}` at its first step. A log written
 * since always carries the answer between the two, so on one of those a turn's
 * ending never arrives here at all.
 */
const turnAt = (s: TrakState): number | undefined =>
  s._tag === "AgentWorking" || s._tag === "ConditionRunning" ? s.step : undefined

/** The step's turn. Where `ConditionsMet` lands, and where every resume goes directly. */
const work = (i: number, trigger: Trigger): Decision =>
  Decision.Advance({
    next: TrakState.AgentWorking({ step: i }),
    commands: [Command.SpawnStep({ step: i, trigger })],
  })

/** Ask whether the step at `i` may start. See `Command.AskConditions`. */
const askConditions = (i: number): Decision =>
  Decision.Advance({
    next: TrakState.ConditionRunning({ step: i }),
    commands: [Command.AskConditions({ step: i })],
  })

/**
 * Rest, holding whatever is on the checkout and the entry that is waiting.
 *
 * **The same door a plan running out takes** — `CommitWork` with no step into
 * `Integrating`, settled by `onCommitted` — and that sameness is the whole design:
 * there is one route to `Finished`, merge and archive are built on the checkout it
 * leaves, and a second route would leave one the two ending presses do not expect.
 */
const holdAtRest = (): Decision =>
  Decision.Advance({
    next: TrakState.Integrating(),
    commands: [Command.CommitWork({ step: undefined })],
  })

/**
 * On the way in, the step runs. At rest, the sweep found the world had moved — one
 * of the two events that move a resting trak into the step that was waiting rather
 * than through the composer, `WaitSkipped` being the other.
 *
 * **Anywhere else it re-parks, never `unexpected`.** The sweep's answer races a
 * person exactly as a stop does: the script ran holding nothing, and a press can
 * have archived, merged or sent the trak back before the answer landed. The daemon
 * drops such an answer before it reaches here — `landingTurn` re-reads under the
 * permit — so this is the second line, and `unexpected` at it would settle a healthy
 * `Closed` trak `Failed{engine}` for a poll that finished late.
 */
const onConditionsMet = (
  t: Trak,
  e: Extract<Event, { readonly _tag: "ConditionsMet" }>,
): Decision => {
  if (t.state._tag === "ConditionRunning") return work(t.state.step, Triggers.initial())
  return t.state._tag === "Finished" && heldAt(t, e.step)
    ? work(e.step, Triggers.initial())
    : reparked(t)
}

/**
 * On the way in, the trak rests holding the entry. Anywhere else it is the sweep
 * saying the condition gave up — a fact `recordFacts` has put on the slot, and nothing
 * to do about it: the trak stays exactly where it is, not failed, with every door
 * open. Re-parked rather than settled by name, on `onConditionsMet`'s terms: a late
 * answer can land on a trak a press has moved.
 */
const onConditionsUnmet = (t: Trak): Decision =>
  t.state._tag === "ConditionRunning" ? holdAtRest() : reparked(t)

/**
 * A person ran the held step now. Into the step on the first entry's own trigger,
 * exactly as a met answer at rest goes — and nothing is asked on the way, which is
 * the point of the press.
 *
 * **Re-parked anywhere else, on `onConditionsMet`'s terms.** The press races a person
 * as the sweep's answer does: it asks the forge for `merged` holding nothing, and an
 * archive or a merge can land in that gap — the route's refusal was made before it,
 * and the busy check sees only a drive still running. The daemon's `runNow` re-reads
 * under the permit and appends nothing if the trak moved, so this is the second line,
 * and `unexpected` at it would settle a healthy `Closed` trak `Failed{engine}`.
 */
const onWaitSkipped = (t: Trak, e: Extract<Event, { readonly _tag: "WaitSkipped" }>): Decision =>
  t.state._tag === "Finished" && heldAt(t, e.step) ? work(e.step, Triggers.initial()) : reparked(t)

/** The three things that can be said about a wait: met, not yet or given up, and skipped. */
const onWaitAnswer = (
  t: Trak,
  e: Extract<Event, { readonly _tag: "ConditionsMet" | "ConditionsUnmet" | "WaitSkipped" }>,
): Decision =>
  e._tag === "ConditionsMet"
    ? onConditionsMet(t, e)
    : e._tag === "ConditionsUnmet"
      ? onConditionsUnmet(t)
      : onWaitSkipped(t, e)

/**
 * Is the plan held at `step`, waiting on an agent turn there?
 *
 * Checked against the plan rather than trusted from the event: the position has to be
 * the one the plan is held at, and an agent turn. `recordFacts` has already lifted the
 * wait by the time `decide` sees `ConditionsMet`, so the slot cannot be asked —
 * `firstUnrun` still names the position, because nothing has run there.
 */
const heldAt = (t: Trak, step: number): boolean => {
  const entry = t.plan?.steps[step]
  return entry !== undefined && !isSpawn(entry) && !isCompose(entry) && firstUnrun(t) === step
}

/**
 * Keep a completed step's work before moving past it. Every route that advances
 * a trak beyond a step it has just finished — approving, skipping, or a spawn's
 * children all landing — goes through here rather than straight to the next
 * position, so a commit lands on the branch at every step boundary and not only
 * at the end.
 */
const keepStep = (i: number): Decision =>
  Decision.Advance({
    next: TrakState.Committing({ step: i }),
    commands: [Command.CommitWork({ step: i })],
  })

/**
 * An artifact gates, unless nothing about this position asked for a person.
 *
 * **The whole rule is `attention.ts`**, which is the only file that reads `Trak.mode`
 * — so *what does this mode skip* is one list to read rather than a walk through the
 * state machine. What is decided here is only where the two answers go.
 *
 * Composition quality stays measurable, which was half the objection to a field that
 * opens a gate: the mode and the rung are both in the record, so whether documents
 * nobody read get sent back more than the ones a person read is a question the log can
 * answer.
 */
const acceptStep = (t: Trak, i: number): Decision =>
  runsUnattended(t, i) ? keepStep(i) : stepGate(i, "approval")

/**
 * A step's gate, with what it offers — written once, derived from the kind.
 *
 * **Every site that parks a step calls this**, whether the gate is being reached for
 * the first time or handed back after a reply, so one gate cannot advertise two
 * sets depending on the route that reached it. The set is three rules and not a
 * list per kind: `Replan` at every step gate; `Approve` only where something is
 * filed and `Skip` only where nothing is — one fact, read off `skippable`, so the
 * offer and `onHumanAction`'s refusals cannot drift; and a way to speak, which is
 * `AnswerQuestions` where the step asked and `Chat` everywhere else.
 *
 * A `stuck` gate is one of these and routes nowhere on its own: what is on the
 * table is an account of why there is no artifact, and the only thing that answers
 * it is a person reading it. `Chat` there is another turn of the same conversation,
 * which is the cheap fix.
 *
 * A `permission` gate speaks with `Permit` rather than `Chat`: the step asked one
 * thing, and a yes or a no to it is the answer — written by the engine, so the yes
 * names the command.
 */
const stepGate = (i: number, kind: HumanGate): Decision => {
  const speak: HumanAction["_tag"] =
    kind === "answers" ? "AnswerQuestions" : kind === "permission" ? "Permit" : "Chat"
  return skippable(kind)
    ? awaitHuman(TrakState.AwaitingHuman({ step: i, kind }), speak, "Skip", "Replan")
    : awaitHuman(TrakState.AwaitingHuman({ step: i, kind }), "Approve", speak, "Replan")
}

/**
 * What a person says at a gate, with everything still waiting said first — the
 * waiting messages are older, and one chat is one turn. Their files go with it, in
 * the same order.
 */
export const chatWith = (
  t: Trak,
  message?: string,
  attachments: readonly Attachment[] = [],
): HumanAction =>
  Actions.chat(
    [...t.messages.map((m) => m.message), ...(message === undefined ? [] : [message])].join("\n\n"),
    [...t.messages.flatMap((m) => m.attachments), ...attachments],
  )

/**
 * The chat a parked trak owes itself: the messages nobody read, sent at the gate it
 * stands at with no further press. `undefined` where nothing waits or the gate does
 * not take `Chat`.
 *
 * **Both question gates are the exception** — the composer's and a step's `answers`
 * gate take `AnswerQuestions` and settle a `Chat` as `Failed{engine}`, so a message
 * keeps waiting there for the turn the answers start. A `permission` gate is the third:
 * a chat sent there would resume the step with no answer to what it asked. The set is `stepGate`'s and
 * `reenter`'s, read the other way up.
 *
 * Asked by `advance` after every decision that parks, rather than made part of one:
 * the chat is an ordinary `HumanActed` on the log, so replay needs no rule of its own
 * and a restart that re-parks the trak asks again.
 */
export const heldChat = (t: Trak): Event | undefined => {
  if (t.messages.length === 0) return undefined
  const at = t.state
  if (at._tag === "AwaitingProposal") return Events.humanActed(0, chatWith(t))
  if (at._tag === "AwaitingHuman" && at.kind !== "answers" && at.kind !== "permission") {
    return Events.humanActed(at.step, chatWith(t))
  }
  return undefined
}

/** Verify an artifact before anyone is asked to read it. */
const verify = (i: number): Decision =>
  Decision.Advance({
    next: TrakState.CheckRunning({ step: i }),
    commands: [Command.RunChecks({ step: i })],
  })

/**
 * Act on the step's work, now that it is on the branch for a script to act on.
 *
 * **Unconditional, exactly as `verify` is**, and for the same reason: which effects a
 * step has are its agent's, an agent is `.orkestra/` policy, and a `decide` that
 * branched on them would either import `library/` or replay an old log against
 * whatever policy says today. `EffectsRan` with no names is the honest record that
 * nothing was declared and nothing acted.
 */
const runEffects = (i: number): Decision =>
  Decision.Advance({
    next: TrakState.Effecting({ step: i }),
    commands: [Command.RunEffects({ step: i })],
  })

/**
 * The events that change what the trak knows and never where it stands.
 *
 * Three are read later — the mode and a hold at the next gate, see `attention.ts`; a
 * skip by the next `RunChecks`. A landed child coming back again is folded by
 * `recordFacts` and ends on its own schedule. A message waiting or heard changes
 * `Trak.messages` alone. A stop of auto-merge changes `Trak.autoMerge` alone, and is read
 * by the forge sweep and the goal's watcher; a person turning it on or off changes it too,
 * and turning it off clears `Trak.resolving`, which the next gate reads. Setup starting
 * or passing changes `Trak.setup` alone: the work already went on beside it. Never `unexpected`: each may arrive in any state a person can
 * see, and a healthy trak settled `Failed{engine}` for being told to slow down is
 * `onStopped`'s failure again. A gate re-offers itself with the same press on it, which
 * is what makes a change of mode at a gate leave the person standing where they were.
 */
type Inert = Extract<
  Event,
  {
    readonly _tag:
      | "ModeChanged"
      | "HoldChanged"
      | "SkipChecksChanged"
      | "AutoMergeChanged"
      | "MergeMethodPicked"
      | "OwnerChanged"
      | "ChildRefiled"
      | "MessageWaiting"
      | "MessageDelivered"
      | "AutoMergeStopped"
      | "SetupStarted"
      | "SetupPassed"
      | "GoalOpened"
  }
>

const movesNothing = (e: Event): e is Inert =>
  e._tag === "ModeChanged" ||
  e._tag === "HoldChanged" ||
  e._tag === "SkipChecksChanged" ||
  e._tag === "AutoMergeChanged" ||
  e._tag === "MergeMethodPicked" ||
  e._tag === "OwnerChanged" ||
  e._tag === "ChildRefiled" ||
  e._tag === "MessageWaiting" ||
  e._tag === "MessageDelivered" ||
  e._tag === "AutoMergeStopped" ||
  e._tag === "SetupStarted" ||
  e._tag === "SetupPassed" ||
  e._tag === "GoalOpened"

// ============================================================================
// decide
// ============================================================================

export const decide = (t: Trak, e: Event): Decision => {
  if (movesNothing(e)) return reparked(t)
  if (t.state._tag === "Stopping" && endsTurn(e)) return decide(stoppedTurn(t, t.state), e)
  switch (e._tag) {
    case "TrakCreated":
      // Nothing to compose against yet: the composer reads the repository, so it
      // reads the trak's own checkout like every step after it.
      return t.state._tag === "Preparing"
        ? Decision.Advance({
            next: TrakState.Preparing(),
            commands: [Command.SetupWorktree()],
          })
        : unexpected(e, t.state)

    case "ComposerReturned":
      return t.state._tag === "Composing" ? onComposerOutput(t, e.output) : unexpected(e, t.state)

    case "AgentReturned": {
      const at = turnAt(t.state)
      if (at === undefined) return unexpected(e, t.state)
      const p = t.plan
      if (p === undefined) return fail("agent returned with no proposal", "engine")
      return onOutput(t, p, at, e.output)
    }

    case "ChecksPassed":
      // Nothing else to say about the artifact — this is where it would have
      // arrived directly if the step had declared no checks. Only an artifact ever
      // gets here, so there is one gate it can land at.
      return t.state._tag !== "CheckRunning" ? unexpected(e, t.state) : acceptStep(t, t.state.step)

    case "CheckFailed":
      return t.state._tag === "CheckRunning"
        ? onCheckFailed(t, t.state.step, e)
        : unexpected(e, t.state)

    case "ChecksCancelled":
      return onChecksCancelled(t)

    case "EffectsRan":
      return onEffectsRanEvent(t, e)

    case "ConditionsMet":
    case "ConditionsUnmet":
    case "WaitSkipped":
      return onWaitAnswer(t, e)

    case "EffectFailed":
      // **Not `onCheckFailed`'s bounded re-entry, and not the `agent` kind.** The
      // agent did not cause an unauthenticated `gh` and cannot fix it, so sending the
      // step back would spend turns rewriting a document that was never the problem,
      // and blaming it would send a person to the wrong file. Every failure is
      // retryable — `failedFrom` holds `Effecting`, and `Restarted` re-issues the
      // command — which is why *stop and say so* costs nothing here.
      //
      // What the script printed stays on the event. `error` names the script, because
      // that is the one thing a reader with no drawer in front of them needs.
      return t.state._tag === "Effecting" ? onEffectFailed(e) : unexpected(e, t.state)

    case "HumanActed":
      return onPress(t, e)

    case "WorktreeReady":
      return t.state._tag === "Preparing" ? onWorktreeReady(t) : unexpected(e, t.state)

    case "ChildrenSpawned":
      // Parked, and nothing polls. `advance` never forks: the daemon starts one
      // drive per child (`app/drive.ts`), and each of them owes this trak a
      // `ChildLanded`.
      return t.state._tag === "Spawning"
        ? Decision.Await({
            next: TrakState.AwaitingChildren({ step: t.state.step }),
            awaiting: AwaitReason.Children({ ids: e.ids }),
          })
        : unexpected(e, t.state)

    // Named, and nothing to wait for: the daemon opens them off this log, and the
    // plan is entered exactly as it would have been with no hand-off on it —
    // `recordFacts` has already filled the slot, so `enterPlan` finds none pending.
    case "HandedOff":
      return t.state._tag === "HandingOff" ? enterPlan(t) : unexpected(e, t.state)

    case "ChildLanded":
      return t.state._tag === "AwaitingChildren"
        ? onChildLanded(t, t.state.step)
        : unexpected(e, t.state)

    case "ChildrenJoined":
      // The spawn position's own work is kept exactly as a turn's would be —
      // see `keepStep`. The proposal guard belongs in `onCommitted`, which is
      // where the proposal is actually read.
      return t.state._tag === "Joining" ? keepStep(t.state.step) : unexpected(e, t.state)

    case "WorktreeFailed":
    case "MergeFailed":
    case "Conflicted":
      return onGitReported(t, e)

    case "SetupFailed":
      return onSetupFailed(t, e)

    case "StepRefused":
      return onStepRefused(t, e)

    case "WorkCommitted":
      return onCommitted(t, e)

    case "WorktreeRemoved":
      return onRemoved(t, e)

    case "Reentered":
      // The one event that moves a trak that had genuinely stopped, and it starts
      // where a trak starts: somewhere to work. `createWorktree` hands back the
      // checkout a `Finished` trak still has. An archived trak's branch went with
      // its checkout, so re-entry there starts a fresh one from wherever the host
      // is standing — a branch that survives anyway (a log from before archiving
      // deleted them, a wipe that spared git) is adopted with its recorded base
      // intact. Built for a restart, and a re-entry is the same shape one rest
      // later.
      //
      // At rest only. A failed or interrupted trak is `Restarted`; a trak at a gate
      // has a human who owes it an answer, and something arriving while they are
      // still deciding is a thing to tell them, not a thing to schedule.
      return atRest(t.state)
        ? Decision.Advance({ next: TrakState.Preparing(), commands: [Command.SetupWorktree()] })
        : unexpected(e, t.state)

    case "Abandoned":
      // Reachable from everywhere a trak can be sitting, because what reaches one
      // is a human, and a human reaches a trak nobody is driving — parked, failed,
      // or left mid-flight by a crash. Custody is what enforces that, not this.
      //
      // The three at-rest states refuse it: there is nothing left to declare over,
      // and a `Finished` trak someone wants to disown has the archive for it — a
      // command a human runs, with the checkout still there to look at first.
      return atRest(t.state)
        ? unexpected(e, t.state)
        : Decision.Advance({
            next: TrakState.Abandoning({ reason: e.reason }),
            commands: [Command.CommitWork({ step: undefined })],
          })

    case "Closed":
    case "Merged":
      return onDoneWith(t, e)

    case "WorkMerged":
      return onWorkMerged(t, e)

    case "ChangesDropped":
      return onChangesDropped(t, e)

    case "TurnFailed":
      // Only the states that have a turn in flight — `turnAt`'s, and the composer's.
      // The trak stops, keeping its worktree and — via `failedFrom` — the position a
      // retry re-enters.
      //
      // Anywhere else is an engine bug, but `e.reason` still goes into the
      // message: this is the one event whose whole job is to carry what the
      // provider said, and dropping it in exactly the case this event exists for
      // leaves a human reading "unexpected event" with no idea what broke.
      return t.state._tag === "Composing" || turnAt(t.state) !== undefined
        ? fail(e.reason, "provider", e.apiKind, e)
        : unexpected(e, t.state, e.reason)

    case "Restarted":
      return onRestarted(t, e)

    case "StopRequested":
      return onStopRequested(t)

    case "Stopped":
      return onStopped(t, e)

    case "FilingAsked":
      return onFilingAsked(t, e)
  }
}

/** The trak where it is: a gate re-offered, anything else left alone. */
const reparked = (t: Trak): Decision => {
  const gate = asGate(t.state)
  return gate === undefined ? Decision.Settle({ next: t.state }) : reenter(gate)
}

/**
 * A person ended the check that was running.
 *
 * **The `checks` gate, at once.** `onCheckFailed` opens it only after a repeated or a
 * fourth failure, because a failure is the agent's to fix first; a person ending the run
 * has already decided not to wait for a verdict, and what is in front of them is the
 * same choice that gate offers — take the work anyway, or say something. It costs no
 * agent turn and no strike: `recordFacts` writes nothing for this event.
 *
 * **Anywhere else re-parks or stands still**, for `onStopped`'s reason: the press and
 * the run finishing race, and a cancel that finds the check already settled is harmless.
 */
const onChecksCancelled = (t: Trak): Decision =>
  t.state._tag === "CheckRunning" ? stepGate(t.state.step, "checks") : reparked(t)

/**
 * There is somewhere to work. Four trak shapes arrive here and each wants a
 * different first move, and **the order is the point**.
 *
 * A **re-entered** trak that owes the composer a turn has a plan — the one that
 * already ran — so it must be asked first, or it would take the path below and enter
 * an entry nobody has proposed yet. What it needs is the composer, holding what came
 * back.
 *
 * **Anything holding a plan enters it, at the first entry that has not run.** That
 * branch asks about the plan and never about the parent, which is what lets three
 * arrivals share it:
 *
 * - A **child** carries the plan its parent's approved proposal named, so there is
 *   nothing to compose and nothing to approve — asking a second time is not a gate,
 *   it is a tax on the same decision. A one-step child is the degenerate case rather
 *   than a special one.
 * - A trak **opened with a named agent** carries the one entry the person picked on
 *   New Trak. No parent, and no prior approval behind it: choosing the agent is the
 *   decision a composer turn and its gate would otherwise be reaching for.
 * - A trak **re-entered with a named agent** carries the same entry, spliced into the
 *   plan that already ran rather than born as the whole of one — the same decision made
 *   at the second door, and the same absence of anything to approve.
 *
 * **`firstUnrun` rather than `0`, and that is the whole of what the third case costs.**
 * A trak arriving with a plan nothing has run reads it as `0`, so the two births are
 * unchanged; a re-entered one reads the entry `spliced` just put at the join. A second
 * arm here would be the same fork written twice.
 *
 * Anything else composes, and that is the third machine-caused Advance for the
 * reason the opening `Compose` is one: there is nothing to approve yet. The human
 * asked for the trak; making somewhere to do it is not a decision.
 */
const onWorktreeReady = (t: Trak): Decision => {
  if (t.reconsult !== undefined) return compose(t, Triggers.reconsulted())
  if (t.plan !== undefined) return enterStep(t, t.plan, firstUnrun(t), Triggers.initial())
  return compose(t, Triggers.initial())
}

const compose = (t: Trak, trigger: Trigger): Decision =>
  Decision.Advance({
    next: TrakState.Composing(),
    commands: [Command.Compose({ description: t.description, trigger })],
  })

/**
 * A human chose to pick the trak back up. Never `unexpected` — a restart is not
 * an out-of-order event, it is a human doing again what never finished.
 *
 * Two ways a trak needs this, and they differ only in where the position is
 * read from. A **crash** wrote no terminal event, so the state replayed to the
 * in-flight one and it is right there. A **failure** wrote one, so the state is
 * `Failed` and the position it failed at is on `failedFrom` — which is the whole
 * reason that field exists. Either way the answer is the same command.
 *
 * `failedFrom` absent means a trak whose log predates the field: nothing says
 * where to go, and inventing a position is worse than saying so, so it settles
 * as it did before.
 */
const onRestarted = (t: Trak, e: Extract<Event, { readonly _tag: "Restarted" }>): Decision => {
  const position = t.state._tag === "Failed" ? t.failedFrom : t.state
  if (position === undefined) return Decision.Settle({ next: t.state })
  // A restart carrying a session into `ConditionRunning` is a log written before
  // conditions were asked: no ask mints a session, so the one it names belongs to
  // the turn that stood here then — see `turnAt`. It resumes that turn, as it did.
  if (position._tag === "ConditionRunning" && e.sessionId !== undefined) {
    return work(position.step, Triggers.interrupted())
  }
  return restartFrom(t, position)
}

/**
 * A human interrupted the turn in flight, to say something else. Never `unexpected`,
 * for `onRestarted`'s reason and one of its own.
 *
 * **A gate a person opened by pressing a button, which is the one thing nothing else
 * here does.** Every other gate is an agent finishing something. So the two arms below
 * are new rather than a reuse, even though both gates they land on already exist:
 *
 *   · a **step** waits at its own conversation gate. Whatever is typed there resumes
 *     that step's session with `Triggers.message`, which is the whole of the guidance
 *     half — see `onHumanAction`, and `SpawnStep`'s `resumes` list for why a `Message`
 *     carries on the conversation rather than minting a fresh one. `Skip` and `Replan`
 *     ride along because they are what this gate offers everywhere else.
 *   · a **composer** waits at the plan gate, holding the plan it already had. `Chat`
 *     there re-runs it on its own session, and `Approve` takes the standing plan.
 *
 * **Neither arm reads the run mode, and that is the requirement rather than an
 * omission.** A trak set to run unattended approves gates on its person's behalf; it
 * must not approve past the one that person opened by interrupting it.
 *
 * **A composer with no plan behind it has nowhere to wait**, which is why the route
 * refuses it — the plan gate's whole meaning is *a plan is on the table*. Reached
 * anyway it falls through to the re-park below, leaving the trak where it was with
 * nothing driving it: the interrupted shape, which offers a resume.
 *
 * **Anything else re-parks or stands still**, because the press and the turn finishing
 * race: a stop can arrive at a trak that has already reached a gate, or moved on to its
 * checks. `unexpected` there would settle a healthy trak `Failed{engine}` — the failure
 * `actRoute`'s docblock records having shipped once — so this treats a stop that finds
 * nothing in flight as the harmless thing it is.
 */
const onStopped = (t: Trak, e: Extract<Event, { readonly _tag: "Stopped" }>): Decision => {
  const at = t.state
  // `StopTurn`'s ending: the gate the press asked for, opened once nothing runs.
  if (at._tag === "Stopping") {
    return at.step === undefined
      ? awaitHuman(TrakState.AwaitingProposal(), "Approve", "Chat")
      : stepGate(at.step, "conversation")
  }
  if (at._tag === "AgentWorking") {
    return stepGate(at.step, "conversation")
  }
  // A stop while the condition is being asked kills the ask and nothing else, and
  // the trak stands where it was for a resume to ask again. Unless the stop names a
  // step: no ask has a turn to name, so that is a log written before conditions
  // existed, ending the turn it recorded here — see `turnAt`.
  if (at._tag === "ConditionRunning" && e.step !== undefined) {
    return stepGate(at.step, "conversation")
  }
  if (at._tag === "Composing" && t.plan !== undefined) {
    return awaitHuman(TrakState.AwaitingProposal(), "Approve", "Chat")
  }
  return reparked(t)
}

/** End the turn at `step` — absent for the composer — and stand in `Stopping` while it ends. */
const stopTurn = (step: number | undefined): Decision =>
  Decision.Advance({ next: TrakState.Stopping({ step }), commands: [Command.StopTurn({ step })] })

/**
 * A person pressed Stop, and this is the intent written before anything is killed.
 *
 * **The positions `onStopped` opens a gate from, and no others**: a step's turn, and a
 * composer revising a plan that stands. `StopTurn` kills what runs, and its `Stopped`
 * opens the gate. Anywhere else re-parks or stands still, for `onStopped`'s reason —
 * the press raced the turn's own ending — and a second press in `Stopping` is the same
 * press again.
 */
const onStopRequested = (t: Trak): Decision => {
  const at = t.state
  if (at._tag === "AgentWorking") return stopTurn(at.step)
  if (at._tag === "Composing" && t.plan !== undefined) return stopTurn(undefined)
  return reparked(t)
}

/**
 * The events a turn's own process writes as it ends. One that lands in `Stopping`
 * raced the kill: the turn finished first, and what it said stands.
 */
const endsTurn = (e: Event): boolean =>
  e._tag === "AgentReturned" || e._tag === "ComposerReturned" || e._tag === "TurnFailed"

/**
 * The trak as the turn `Stopping` is ending saw it, so that turn's ending is decided as it
 * would have been there.
 *
 * **The gate it opens stands whatever the mode**, and that is not decided here:
 * `applyEvent` holds the step first — see `stopHeld` in `replay.ts`. A `TurnFailed` is
 * also the kill's own failure, once its window is spent, and fails the trak the same way;
 * `failedFrom` is `Stopping` either way, so a retry finishes the kill.
 */
const stoppedTurn = (t: Trak, s: Extract<TrakState, { readonly _tag: "Stopping" }>): Trak => ({
  ...t,
  state: s.step === undefined ? TrakState.Composing() : TrakState.AgentWorking({ step: s.step }),
})

/**
 * A person asked the step to file what it has, without saying anything to it.
 *
 * **`onStopped`'s twin with the opposite ending**: a stop opens a gate for the person
 * to speak at, this re-enters the step at once under `Trigger.Filing`, which asks for
 * the document and lets nobody type. Two shapes of position and both re-enter the same
 * way:
 *
 *   · a **turn still running** — the route has killed it, and the turn this issues
 *     resumes the session that turn was holding, which `applyEvent` has just filed
 *     into the slot from this event;
 *   · a **step gate where nothing has been filed** — a conversation it parked in, a
 *     question it asked, or an account of why it is stuck. Nothing was killed, the slot
 *     already holds the session, and this is the press that ends the wait without a
 *     person having to talk the step into filing. `skippable` is the same set `Skip`
 *     takes, read the other way up: exactly the gates with no document to take.
 *
 * The **approval and checks** gates are not among them, for the reason `Skip` is refused
 * there: a document is already on the table, and *file what you have* has nothing to add.
 * The composer is not either — a plan is filed by proposing it, and a person wanting one
 * sooner stops the revision and takes the plan they had. The route refuses both, and
 * reaching here anyway re-parks.
 *
 * **It asks for the document and promises nothing about getting one.** The turn's
 * output routes as any other's does — `onOutput` — so a step that cannot file still
 * has `questions` and `stuck` to say so with. What it cannot do is answer in prose:
 * `runCommand` puts a `Filing` turn through `elicit`, on a conversational step too.
 *
 * Neither arm reads the run mode, for `onStopped`'s reason, and anything else
 * re-parks or stands still for its reason too: the press and the turn finishing
 * race, and a press that finds the step already filed is harmless.
 */
const onFilingAsked = (t: Trak, e: Extract<Event, { readonly _tag: "FilingAsked" }>): Decision => {
  const at = t.state
  // `ConditionRunning` on `onStopped`'s terms: only a press that names a step was a
  // turn's ending, and only a log from before the ask has one to name here.
  const step =
    at._tag === "AgentWorking" || (at._tag === "ConditionRunning" && e.step !== undefined)
      ? at.step
      : at._tag === "AwaitingHuman" && skippable(at.kind)
        ? at.step
        : undefined
  if (step === undefined) return reparked(t)
  const p = t.plan
  // Unreachable: a step cannot be running, or parked at a gate with nothing filed,
  // without the plan that named it.
  if (p === undefined) return fail("a filing asked with no proposal", "engine")
  return enterStep(t, p, step, Triggers.filing())
}

/**
 * Re-issue the command a position implies.
 *
 * A parked state re-parks unchanged: `reenter` on the state itself, because a
 * gate a human is standing at owes nothing to a restart — the interrupted turn
 * was the one that produced this park, and it already happened. Guards against
 * the dead end a `Restarted` at a gate would otherwise be: nothing in the log
 * moves it, so it must return the same Await it already carries.
 *
 * Terminal settles rather than recurses. `Failed` is unreachable through
 * `onRestarted`, which handles a failed *state* itself and only ever passes a
 * `failedFrom` — and `applyEvent` keeps that field off `Failed` on purpose, so a
 * second failure preserves the first one's position instead of pointing back at
 * it. The case is here because the switch is exhaustive, not because anything
 * reaches it; settling is the honest answer if something ever does.
 */
const restartFrom = (t: Trak, position: TrakState): Decision => {
  switch (position._tag) {
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AwaitingHuman":
      return reenter(position)

    case "Preparing":
      return Decision.Advance({ next: TrakState.Preparing(), commands: [Command.SetupWorktree()] })

    case "Composing":
      return Decision.Advance({
        next: TrakState.Composing(),
        commands: [
          Command.Compose({ description: t.description, trigger: Triggers.interrupted() }),
        ],
      })

    case "AgentWorking":
      return Decision.Advance({
        next: TrakState.AgentWorking({ step: position.step }),
        commands: [Command.SpawnStep({ step: position.step, trigger: Triggers.interrupted() })],
      })

    // The kill, never the turn: a person asked for it to stop, and that is on the log.
    case "Stopping":
      return stopTurn(position.step)

    case "CheckRunning":
      return Decision.Advance({
        next: TrakState.CheckRunning({ step: position.step }),
        commands: [Command.RunChecks({ step: position.step })],
      })

    // Asked again, which is what a condition is for.
    case "ConditionRunning":
      return askConditions(position.step)

    case "Committing":
      return keepStep(position.step)

    // Re-issued rather than stepped over, which is only safe because an effect is
    // idempotent by construction — the same argument `Merging` and `Closing` make.
    // Stepping over it would be worse than a second run: an interrupted boundary
    // would silently never send what the step approved.
    case "Effecting":
      return runEffects(position.step)

    case "Integrating":
      return Decision.Advance({
        next: TrakState.Integrating(),
        commands: [Command.CommitWork({ step: undefined })],
      })

    // Both re-issue their own command, and both are re-runnable: `git merge`
    // reports the same tip for a branch already in, and `worktree remove` is a
    // no-op against a directory that has gone.
    case "Merging":
      return Decision.Advance({ next: TrakState.Merging(), commands: [Command.MergeWork()] })

    case "Closing":
      return Decision.Advance({
        next: TrakState.Closing({ merged: position.merged }),
        commands: [Command.RemoveWorktree()],
      })

    // Back to the commit, and the declaration survives the restart with it: a
    // human who abandoned a trak does not have to say so twice because something
    // went wrong on the way out. Re-committing is free when it already happened —
    // `commitWork` reports the same sha — and the removal follows from the event
    // as it did the first time, so restarting the earlier half re-runs both.
    case "Abandoning":
      return Decision.Advance({
        next: TrakState.Abandoning({ reason: position.reason }),
        commands: [Command.CommitWork({ step: undefined })],
      })

    // Both re-issue their command, which is safe for the reason `Preparing`'s is:
    // `SpawnChildren` finds the ids it already minted on this log, and
    // `JoinChildren` re-does bookkeeping it has already done.
    case "Spawning":
      return Decision.Advance({
        next: TrakState.Spawning({ step: position.step }),
        commands: [Command.SpawnChildren({ step: position.step })],
      })

    case "Joining":
      return Decision.Advance({
        next: TrakState.Joining({ step: position.step }),
        commands: [Command.JoinChildren({ step: position.step })],
      })

    // `Spawning`'s sentence: `HandOff` finds on this log whatever it already named.
    case "HandingOff":
      return Decision.Advance({
        next: TrakState.HandingOff({ step: position.step }),
        commands: [Command.HandOff({ step: position.step })],
      })

    // The one interrupted position that re-parks rather than re-running: nothing
    // was in flight here, and what picks it back up is a surface re-driving the
    // children — which is exactly what `Await{Children}` names.
    case "AwaitingChildren":
      return onChildLanded(t, position.step)

    case "Finished":
    case "Closed":
    case "Merged":
    case "Failed":
    case "Abandoned":
      return Decision.Settle({ next: position })
  }
}

// -- Helpers -----------------------------------------------------------------

/**
 * A human is done with a finished trak, one way or the other.
 *
 * **From `Finished` alone**, both of them: the work is already on the branch —
 * `Integrating` is what put it there — so what is left is the checkout, and
 * `Finished` is the only resting state that still holds one. Merging is closing with
 * a destination, which is why it runs the git first and then joins the path a plain
 * close takes.
 */
const onDoneWith = (t: Trak, e: Extract<Event, { _tag: "Closed" | "Merged" }>): Decision => {
  if (t.state._tag !== "Finished") return unexpected(e, t.state)
  return e._tag === "Merged" ? ending(t, true) : ending(t, false, e.sha)
}

/**
 * The two endings a finished trak can take: its branch into its destination, or
 * straight to the teardown. Shared by the press a person makes and the one a child
 * makes for itself — see `onCommitted`.
 *
 * A plain close of a trak that has **landed** ends `Merged` rather than `Closed`: the
 * branch went in while a wait was pending, and `Closing` carries that sha exactly as
 * it carries one a merge made here — so `onRemoved` names where the work went, and
 * the forge is not asked again about a merge the log already holds. A close that
 * carries the forge's merge commit — the forge sweep's — is carried the same way.
 */
const ending = (t: Trak, merge: boolean, merged?: CommitSha): Decision =>
  merge
    ? Decision.Advance({ next: TrakState.Merging(), commands: [Command.MergeWork()] })
    : Decision.Advance({
        next: TrakState.Closing({ merged: t.landed?.sha ?? merged }),
        commands: [Command.RemoveWorktree()],
      })

/**
 * The branch is in. What is left is the checkout, which is what `Closing` does —
 * it carries the merge commit so `onRemoved` knows this trak was answered for
 * rather than merely put down.
 *
 * **Unless the plan is held on `merged` or `deployed`**, where the merge is the
 * wait passing rather than the trak ending: the checkout stays, because the held
 * step runs in it, and the condition is asked again at once — `merged` is met by
 * the sha `recordFacts` has just folded onto the trak, and `deployed` goes on to
 * ask the deploy script with it. A trak held on a project's own script ends as any
 * merge ends: what that script waits for is the script's to say, not the engine's,
 * and the pending step goes with the trak as it always did.
 */
/**
 * The step's turn never began, and what answers a plan the world has moved under is
 * a plan: the composer, from the refused position, told why. Only from the turn that
 * was about to run — `SpawnStep` is the one writer of this event.
 */
const onStepRefused = (t: Trak, e: Extract<Event, { _tag: "StepRefused" }>): Decision => {
  // The turn a stop raced never began, so there is nothing to recompose for: the kill
  // finds nothing running and opens the gate the person asked for.
  if (t.state._tag === "Stopping" && t.state.step === e.step) return reparked(t)
  return t.state._tag === "AgentWorking" && t.state.step === e.step
    ? compose(t, Triggers.reconsulted())
    : unexpected(e, t.state)
}

/**
 * The branch stays out and the child is put away as a plain close is: the teardown,
 * with no merge commit to carry. `Merging` alone, as `WorkMerged`, and for its reason.
 * What the child filed reaches the parent through the landing, which reads the log
 * rather than the branch.
 */
const onChangesDropped = (t: Trak, e: Extract<Event, { _tag: "ChangesDropped" }>): Decision =>
  t.state._tag === "Merging"
    ? Decision.Advance({
        next: TrakState.Closing({ merged: undefined }),
        commands: [Command.RemoveWorktree()],
      })
    : unexpected(e, t.state)

const onWorkMerged = (t: Trak, e: Extract<Event, { _tag: "WorkMerged" }>): Decision => {
  if (t.state._tag !== "Merging") return unexpected(e, t.state)
  const held = engineWait(t)
  return held === undefined
    ? Decision.Advance({
        next: TrakState.Closing({ merged: e.sha }),
        commands: [Command.RemoveWorktree()],
      })
    : askConditions(held.step)
}

/**
 * Is the composer owed a turn at *this* boundary, rather than at some other one?
 *
 * Two feeders open the door at a commit, and both are **keyed on the position** —
 * which is the difference between a route and a loop: the field survives until the
 * plan answering it begins, so an unguarded read would fire again at the *next* step
 * boundary, splice again, and — where that next position is a spawn — drop the
 * children and spawn them again, forever.
 *
 * `Raised` is a step that filed and sent the plan back with it. `Replanned` reaches a
 * commit at every gate — `onHumanAction` keeps the work first, as every forward move
 * past a step does, and the composer runs here after it. The other two feeders, the
 * world coming back and a merge that conflicted, go straight to the composer and never
 * come through.
 *
 * A plan that stops short does not come through here at all any more. It is an entry
 * now, so the commit runs out into it the way it runs into any other step.
 */
const reconsultHere = (t: Trak, step: number): boolean => {
  const why = t.reconsult?.why
  return (why?._tag === "Raised" || why?._tag === "Replanned") && why.step === step
}

/**
 * What git had to say, from any command that asked it something.
 *
 * `WorktreeFailed` is every command declining — no somewhere to work, no name free
 * to give a spawn's children, nowhere to keep what was made, and the teardown at the
 * far end. None has a state worth parking in: git declining to answer is not a plan
 * problem, and a composer handed *a branch named trak/… already exists* would propose
 * work against a machine rather than a codebase. What is useful about the message is
 * that it names something a person can fix, which is why it is carried through rather
 * than replaced — see `GIT_IN_FLIGHT` for what being absent costs.
 *
 * A `WorktreeFailed` while the checkout is being taken away is `archive`, not
 * `worktree`: the work has all run and the person has already chosen how it ends, so
 * reading it as a checkout that was never prepared sends them to the wrong script.
 * `Abandoning` is in it although its
 * `CommitWork` can fail too — that commit is the first half of the archive.
 *
 * `MergeFailed` is git declining to merge — not `Conflicted`, which is git answering.
 * Its own kind because the checkout is fine and the fix is in a tree this trak does
 * not own; the reason is carried for the same reason, and `Merging` alone because
 * `MergeWork` is issued from nowhere else.
 *
 * `Conflicted` is the one git outcome that is about the *work*, so it is the one that
 * recomposes: two branches disagreeing is what a pipeline is for, and every ingredient
 * for resolving it is already here — a checkout, a branch, an agent index and a
 * composer. `Merging` alone, as above. The trak leaves the merge un-issued: what
 * answers this is a plan, and when that plan runs out the trak is back at `Finished`
 * with the merge on offer again. Re-issuing it here would merge a tree nobody
 * authorized.
 *
 * **A `WorktreeFailed` carrying `carried` is the one accepted outside `GIT_IN_FLIGHT`.** It
 * is a remake of the sandbox that left its uncommitted changes behind, met by something
 * that is not a step — a process start, or a Rebuild pressed with nothing running — and
 * appended for it so the trak stops naming the ref, rather than going on from the branch
 * without them. Any state that still holds a checkout takes it, `Finished` and `Failed`
 * included; `failedFrom` keeps the position a restart goes back to.
 */
const onGitReported = (
  t: Trak,
  e: Extract<Event, { _tag: "WorktreeFailed" | "MergeFailed" | "Conflicted" }>,
): Decision => {
  switch (e._tag) {
    case "WorktreeFailed":
      if (!GIT_IN_FLIGHT.has(t.state._tag) && !(e.carried !== undefined && holdsCheckout(t.state)))
        return unexpected(e, t.state)
      return fail(e.reason, archiving(t.state) ? "archive" : "worktree", undefined, e, e.setup)
    case "MergeFailed":
      return t.state._tag === "Merging" ? fail(e.reason, "merge") : unexpected(e, t.state)
    case "Conflicted":
      return t.state._tag === "Merging"
        ? compose(t, Triggers.reconsulted())
        : unexpected(e, t.state)
  }
}

/** The states taking a trak to rest, where `onSetupFailed` lets the ending run on. */
const SETUP_IGNORED_WHILE: ReadonlySet<TrakState["_tag"]> = new Set<TrakState["_tag"]>([
  "Merging",
  "Closing",
  "Abandoning",
])

/**
 * The setup running beside the work failed, so the work stops: `Failed{worktree}`, with
 * the script's output as the error — what a setup failing before `WorktreeReady` ended
 * in. A turn it ran beside was killed before this was written, and a retry runs the
 * setup again before the work it re-issues.
 *
 * **Anywhere the trak already stopped or is ending re-parks instead.** A `Failed` trak
 * keeps the failure it had and the position on `failedFrom`; at rest, or on the way there
 * through a merge or an archive, there is no more work for a missing install to spoil.
 * Never `unexpected`: setup ends on its own schedule, and a second report of one failure
 * is ordinary.
 */
const onSetupFailed = (t: Trak, e: Extract<Event, { _tag: "SetupFailed" }>): Decision =>
  t.state._tag === "Failed" || atRest(t.state) || SETUP_IGNORED_WHILE.has(t.state._tag)
    ? reparked(t)
    : fail(e.reason, "worktree", undefined, e, e.output)

/**
 * The work is on the branch. Where that leaves the trak depends on who asked.
 *
 * A step's own work being kept (`Committing`) runs that step's effects — the
 * ordinary case, and where a plan's one outward-facing act happens. It is the
 * commit's *completion* that sends them, rather than the approval that caused it:
 * both follow the gate, and a script acting on a branch whose commit has not landed
 * sees nothing to act on.
 *
 * A plan that ran out with nothing left to ask is **finished and holding**: the
 * checkout stays, because nothing has said anybody is done with it. A human who
 * declared the trak over has said exactly that, so the removal follows — and
 * `Abandoning` re-enters itself rather than handing off to a `Closing` that would
 * carry the reason a second time. The event is what says which half is running.
 *
 * **A child running unattended does not hold.** Its run mode is the person saying in
 * advance what they would press, and `endsUnattended` is where that is read — it
 * merges a branch something was committed on and archives one nothing was. A goal's
 * trak that committed nothing does not hold either, on any mode. The
 * catch-all commit's `sha` is the fact: absent means nothing was ever kept on this
 * branch. Nothing is recorded as pressed, as at every gate the mode takes.
 */
const onCommitted = (t: Trak, e: Extract<Event, { _tag: "WorkCommitted" }>): Decision => {
  if (t.state._tag === "Committing") return runEffects(t.state.step)
  if (t.state._tag === "Abandoning") {
    return Decision.Advance({
      next: TrakState.Abandoning({ reason: t.state.reason }),
      commands: [Command.RemoveWorktree()],
    })
  }
  if (t.state._tag !== "Integrating") return unexpected(e, t.state)
  const moved = e.sha !== undefined
  // A plan held behind a condition rests here on every mode, a child's included.
  // The ending a mode takes is a decision about work that is over, and an entry
  // still waiting to run says it is not — a child that merged itself here would
  // drop the step it was waiting to take, with nothing on the log saying so.
  if (pendingWait(t) !== undefined) return Decision.Settle({ next: TrakState.Finished() })
  return endsUnattended(t, moved)
    ? ending(t, moved)
    : Decision.Settle({ next: TrakState.Finished() })
}

const onEffectsRanEvent = (
  t: Trak,
  e: Extract<Event, { readonly _tag: "EffectsRan" }>,
): Decision => {
  if (t.state._tag === "Effecting") return onEffectsRan(t, t.state.step)
  // A person's skip, from the failure an effect left: the step is entered as a run that
  // passed enters it, with none of its effects run — see `EffectsRan.skipped`.
  return e.skipped !== undefined && effectFailedAt(t) === e.step
    ? onEffectsRan(t, e.step)
    : unexpected(e, t.state)
}

/**
 * The step's work is kept and acted on, so the trak enters the step after it.
 *
 * This is where the proposal is read, and `enterStep` is what runs out of it into
 * `Integrating` when there is nothing left.
 *
 * Unless the composer is owed a turn from this boundary — the step raised a
 * requirement the plan has to hold to, or named a document that is not good enough
 * to work from. **Here, and not at the gate**: the work is kept first, exactly as at
 * every other step boundary, and an artifact a person sent back with `Chat` never
 * gets this far.
 *
 * **Nothing reads what the effects printed**, and that is the rule rather than an
 * omission: an effect acts on a world that changes without events, so a route
 * keyed on what a script saw goes stale with nothing failing. See `EffectsRan`.
 */
const onEffectsRan = (t: Trak, i: number): Decision => {
  const p = t.plan
  // Unreachable: nothing reaches `Effecting` without a plan holding the step whose
  // work it just acted on.
  if (p === undefined) return fail("effects ran with no proposal", "engine")
  return reconsultHere(t, i)
    ? compose(t, Triggers.reconsulted())
    : enterStep(t, p, i + 1, Triggers.initial())
}

/**
 * The checkout is gone, which is the last thing every declaration does — and the
 * two states that ever ask for it.
 *
 * `Closing` settles as `Merged` or `Closed` on whether this trak's branch went
 * anywhere — the sha a local merge put on the state, or the one the runtime got
 * from the forge and put on the event. The state's wins because it is the
 * earlier, closer fact: a branch merged here and *also* holding a merged pull
 * request is one trak, and its ending should name the merge a person made from
 * this machine. Both endings are archives and neither is a failure; what
 * separates them is that a merged trak says where the work went.
 */
const onRemoved = (t: Trak, e: Extract<Event, { _tag: "WorktreeRemoved" }>): Decision => {
  if (t.state._tag === "Abandoning") {
    return Decision.Settle({ next: TrakState.Abandoned({ reason: t.state.reason }) })
  }
  if (t.state._tag !== "Closing") return unexpected(e, t.state)
  const merged = t.state.merged ?? e.sha
  return Decision.Settle({
    next: merged === undefined ? TrakState.Closed() : TrakState.Merged({ sha: merged }),
  })
}

/**
 * Are they all back?
 *
 * Arithmetic over the position's slot, which is what keeps the composer out of the
 * join and keeps anything from polling. The Await names only the children still
 * outstanding, so a resumed parent re-drives what is actually missing rather than
 * everything the position ever spawned.
 *
 * Shared with `restartFrom`, because *where does a parked spawn go next* has one
 * answer however it is asked.
 */
const onChildLanded = (t: Trak, i: number): Decision => {
  const runs = slotAt(t, i).children
  const [first, ...rest] = runs.filter((r) => r.landing === undefined).map((r) => r.id)
  if (first !== undefined) {
    return Decision.Await({
      next: TrakState.AwaitingChildren({ step: i }),
      awaiting: AwaitReason.Children({ ids: [first, ...rest] }),
    })
  }
  // Nothing outstanding, which is two different things. Every child is back —
  // the ordinary case, and the join. Or this position has no record of any,
  // which is a trak sent back to an `AwaitingChildren` its `ChildrenSpawned`
  // never reached the log from: what that needs is the children, and
  // `SpawnChildren` is idempotent, so saying so costs nothing and keeps *no
  // failure is a dead end* true of the one state that owes traks rather than a
  // person.
  return runs.length === 0
    ? Decision.Advance({
        next: TrakState.Spawning({ step: i }),
        commands: [Command.SpawnChildren({ step: i })],
      })
    : Decision.Advance({
        next: TrakState.Joining({ step: i }),
        commands: [Command.JoinChildren({ step: i })],
      })
}

/**
 * The composer may plan, say the work is already done, ask, or give up. Asking is the
 * valuable case: ambiguity costs one turn here and a whole pipeline if discovered
 * mid-implementation.
 */
const onComposerOutput = (t: Trak, out: ComposerOutput): Decision => {
  switch (out.type) {
    case "message":
      // Same rule as a step, and no special case for the composer: the gate it
      // returns to is the plan gate, because that is where the human was.
      return reenter(t.lastGate)

    case "proposal": {
      // A plan is the one output that commits every step after it, so it waits.
      // Entering step 0 directly would make the first thing a human sees work
      // already in progress against a sequence they have not read.
      //
      // A revision waits for the same reason and at the same gate: what is on the
      // table is a sequence nobody has read, and the fact that some of it has
      // already run does not change what approving commits to.
      //
      // Unless nothing about the run that just wrote it asked for a person — which on
      // `auto` is the press taken in advance, and on `smart` is a composer that
      // reported an unambiguous turn, asked nothing on the way, and is not inside a
      // round of fixing that has stopped landing. See `planRunsUnattended`, which is
      // asked about the compose position rather than about the entry approving would
      // enter: that entry has not run, so its record is empty and would read as clean.
      // A hand-off on the plan is one of the things that asks for a person on `smart`
      // — `handedOff` in `attention.ts`'s list — so it needs no clause here.
      return planRunsUnattended(t)
        ? enterPlan(t)
        : awaitHuman(TrakState.AwaitingProposal(), "Approve", "Chat")
    }

    case "finished": {
      // The work this trak was asked for is done, so there is no step to enter —
      // `recordFacts` has already cut the plan back to what ran, which puts `enterAt`
      // past its last entry. That is the door a plan running out of its own accord
      // goes through, and reusing it is what keeps one route to `Finished`: the
      // checkout is committed as it stands and `onCommitted` settles there.
      //
      // **No gate, on every mode, unless it hands work off or proposes a goal.**
      // Approving has only ever meant committing to work that has not happened, and
      // there is none; `Finished` parks holding its branch with `Send it back` on offer,
      // so a person who disagrees already has the press. A finish carrying a hand-off or
      // a goal is the exception, because there *is* work to commit to — traks on the
      // main line that never come back, or a goal that spends from its first turn — and
      // it takes the plan gate a proposal takes: `manual` and `smart` stop, `auto` goes
      // past unread. One gate rather than one of its own, because Approve there already
      // routes a plan with nothing left to run to rest. The goal itself starts once the
      // trak is at rest — the goal's watcher, off `goalOwed`.
      if (!handOffPending(t) && !goalProposalPending(t)) return enterPlan(t)
      return planRunsUnattended(t)
        ? enterPlan(t)
        : awaitHuman(TrakState.AwaitingProposal(), "Approve", "Chat")
    }

    case "questions":
      // Being asked a question is the same thing whoever asked it, but the answers
      // are not: these re-run `Compose`, where a step's resume its session. That is
      // one state per distinct routing, and the reason this is not `AwaitingHuman`
      // with `kind: "answers"` and a nominal step index.
      //
      // Unattended it is answered the same way a step's is, and it has to be: a trak
      // whose person said they would not be at its gates and that stopped dead
      // before it had a plan is the one shape the mode cannot leave standing.
      return unanswered(t, firstUnrun(t))
        ? compose(t, Triggers.unanswered(recommendations(out)))
        : awaitHuman(TrakState.AwaitingComposerAnswers(), "AnswerQuestions")

    case "failed":
      return fail(out.error, "agent")
  }
}

/**
 * Where approving a plan enters it: the first entry that has not run.
 *
 * **Read off the plan rather than carried on the trak.** It used to be
 * `reconsult.from`, an integer computed at the splice and interpreted by three
 * callers who had to agree about it. The plan is now the same fact in a place it
 * cannot drift from — the compose entry that just landed has a session, so it has
 * run, and the steps it proposed are by construction the ones immediately after it.
 *
 * `firstUnrun` and not *after the last compose*: the plan on the table may end in a
 * compose the composer scheduled for later, and approving must enter the work rather
 * than jump past it to a turn nothing has asked for yet.
 *
 * `0` for a trak born holding a plan it never composed — a spawn's child, or one
 * opened with a named agent — which is exactly where such a trak should start.
 */
const enterAt = (t: Trak): number => firstUnrun(t)

/**
 * Enter the plan on the table — the one door every taking of the plan gate goes
 * through, whoever took it.
 *
 * **The hand-off first, where there is one nothing has named.** The traks a compose
 * run handed off are opened by the gate going past, and naming them is a command with
 * git in it, so it has a state of its own to be restarted from; `HandedOff` comes back
 * here with the slot filled and the plan is entered as it would have been. Where the
 * plan hands nothing off — every plan until now — this is `enterStep` at the resume
 * point and nothing else.
 *
 * `recordFacts` landed the plan before `decide` saw the event, so the plan being
 * entered is the one that just arrived. Absent is unreachable and loud rather than
 * invented: entering the wrong plan is worse than stopping.
 */
const enterPlan = (t: Trak): Decision => {
  const p = t.plan
  if (p === undefined) return fail("a plan was taken with nothing to enter", "engine")
  const at = planEntryOf(t)
  if (at !== undefined && handOffPending(t)) {
    return Decision.Advance({
      next: TrakState.HandingOff({ step: at }),
      commands: [Command.HandOff({ step: at })],
    })
  }
  return enterStep(t, p, enterAt(t), Triggers.initial())
}

/**
 * Approve the plan, or send it back.
 *
 * `Chat` re-runs `Compose` on the composer's own session — which is the same rule
 * as every other gate, "you are talking to whoever just spoke", and the reason the
 * proposal gate is a state rather than a `HumanGate` kind. `AnswerQuestions` has
 * nothing to answer: no questions were asked, so it is a bug rather than a no-op.
 *
 * Approving enters the plan at the **join**: 0 for a first proposal, and otherwise
 * the position `reconsult` recorded when the composer was asked. The field is still
 * on the trak here — it is cleared by the plan that answers it beginning, not by
 * this gate — which is what lets one line serve every case. A plan carrying a
 * hand-off names its traks on the way in; `enterPlan` is the one door.
 *
 * **Refusing a hand-off is `Chat`.** A composer told what to change answers again on
 * its own session, and what that answer carries is the hand-off from then on — one
 * that says nothing has withdrawn it. So no press here drops one, and a `Replan` is
 * refused as it always was.
 */
const onProposalAction = (t: Trak, action: HumanAction): Decision => {
  switch (action._tag) {
    case "Approve":
      return enterPlan(t)

    case "Chat":
      return Decision.Advance({
        next: TrakState.Composing(),
        commands: [
          Command.Compose({
            description: t.description,
            trigger: Triggers.message(action.message, action.attachments),
          }),
        ],
      })

    case "AnswerQuestions":
      return fail("answers at a proposal gate — nothing asked a question", "engine")

    case "Replan":
      // The composer is who just spoke, and re-asking it for a plan it has already
      // given is `Chat` with nothing said. Saying what to change is the action.
      return fail("a replan at the plan gate — say what to change instead", "engine")

    case "Skip":
      // Nothing has run, so there is no step in flight to skip — and skipping the
      // *first* step of a plan nobody has approved is a change to the plan, which
      // is what `Chat` here is for.
      return fail("a skip at the plan gate — nothing is running yet", "engine")

    case "Permit":
      return fail("a permission answer at the plan gate — no step asked for one", "engine")
  }
}

/**
 * A check failed. Send the step back to fix its own work — unless it has stopped
 * fixing anything, in which case a human decides what to do about it.
 *
 * **This is the only thing that advances a trak without a human once the work is
 * under way.** The other two run before there is anything to approve — setting
 * up the worktree, and the opening `Compose` that follows it. This one runs
 * because a human already approved it: they wrote
 * the check, and the composer attached it to the step in a plan someone read and
 * said yes to. What is unattended is the retry, not the decision — so the only
 * question is when to stop, which is what `checkFailures` answers.
 *
 * `repeated` catches the honest case (the same complaint, unchanged) and the
 * count catches the dishonest one (output that churns without improving). Either
 * way the human lands at a gate that routes forward, because the choice in front
 * of them is "take this artifact anyway or say something", which is what an
 * approval gate already is.
 *
 * **A trak running unattended still lands here**, and this is the one gate that does
 * not read the mode: taking work a script already knows is wrong is a different
 * decision from taking work nobody has read. `approvedInAdvance` carries why.
 */
/** A failed effect, or one the runners-only guard refused — the project's either way. */
const onEffectFailed = (e: Extract<Event, { readonly _tag: "EffectFailed" }>): Decision =>
  fail(`\`${e.name}\` could not do what it says`, "project", undefined, e)

const onCheckFailed = (
  t: Trak,
  i: number,
  e: Extract<Event, { readonly _tag: "CheckFailed" }>,
): Decision => {
  // A check the runners-only guard refused never ran, so it says nothing about the work:
  // sending the step back would spend a turn on a document that was never the problem. It
  // settles as the project's, as a failed effect does, and a retry once the project has a
  // runner re-runs the checks. So does one whose sandbox's remake left the uncommitted
  // changes behind, which is the checkout and not the work.
  if (e.runnersOnly !== undefined || e.carried !== undefined)
    return fail(`\`${e.name}\` could not be run`, "project", undefined, e)
  // Already includes this failure: `recordFacts` runs before `decide`, which is
  // what lets it compare against the one before without decide holding history.
  const run = slotAt(t, i).checkFailures
  if (run === undefined) {
    // Unreachable — recordFacts writes this entry from the very event we are
    // deciding on. Loud rather than defaulted, because both defaults are wrong:
    // retry forever, or gate on the first failure.
    return fail("a check failed with no record of the run", "engine")
  }
  return run.repeated || run.count >= CHECK_FAILURE_LIMIT
    ? stepGate(i, "checks")
    : Decision.Advance({
        next: TrakState.AgentWorking({ step: i }),
        commands: [
          Command.SpawnStep({ step: i, trigger: Triggers.checkFailure(e.name, e.output) }),
        ],
      })
}

/** A human answering the composer's own questions — re-compose with the answers. */
const onComposerAnswers = (t: Trak, action: HumanAction): Decision =>
  action._tag === "AnswerQuestions"
    ? Decision.Advance({
        next: TrakState.Composing(),
        commands: [
          Command.Compose({
            description: t.description,
            trigger: Triggers.answers(action.answers, action.note),
          }),
        ],
      })
    : fail(`${action._tag} at a composer question — only answers apply here`, "engine")

const onOutput = (t: Trak, p: Plan, i: number, out: StepOutput): Decision => {
  switch (out.type) {
    case "message":
      // A conversational step that has not filed yet is mid-conversation, and
      // the human is standing in it rather than at a gate they came from. See
      // `conversing`, which is where the two cases are told apart.
      //
      // Otherwise the agent answered the human rather than producing work:
      // nothing about the trak changed, so nothing about where they are standing
      // does either.
      //
      // Unattended, the conversation has no other side, so the step is told so and
      // told to file — see `Trigger.Unread`, which is also where the bound is: that
      // turn goes through `elicit`, whose union has no prose in it, so there is one
      // of these per conversation and no counter to keep.
      //
      // The other branch needs no such arm: a step that is not conversational only
      // answers in prose on a `Message` trigger, which is a person having typed —
      // and a person who typed is standing at the gate this returns them to.
      if (!conversing(t, p, i)) return reenter(t.lastGate)
      return approvedInAdvance(t)
        ? enterStep(t, p, i, Triggers.unread())
        : stepGate(i, "conversation")

    case "artifact":
      // An artifact is verified before it waits for a human, because there is no
      // point asking someone to read work a script already knows is wrong.
      //
      // See `verify`.
      //
      // This is also how a reviewer approves: an artifact is work the step is
      // content to send forward, and a review that found nothing blocking is
      // exactly that. There is no separate verdict to read.
      //
      // **Unconditional, including for a step whose agent declares no checks.**
      // Checks belong to the agent, and an agent is `.orkestra/` policy — so a
      // `decide` that branched on them would either import `library/` or replay an
      // old log against whatever policy says today. Running an empty set is the
      // degenerate case rather than a special one: `ChecksPassed` with no names is
      // the honest record that nothing was required and nothing failed.
      return verify(i)

    case "stuck":
      // Straight to a person, and no further. There is nothing to verify — the
      // account is filed nowhere, so no script has anything to inspect — and
      // nothing to plan from, which is the whole of what this envelope means.
      //
      // Work the plan is merely missing does not come through here, and neither
      // does a document that is not good enough to work from: those are
      // `requirements` and `corrections` on an artifact, claims a step that
      // *succeeded* makes, and they route at the commit boundary after a person has
      // approved the work they rode in on. An account filed here may still carry
      // requirements — they land on the intent, and nothing plans from them.
      return stepGate(i, "stuck")

    case "permission":
      // Straight to a person, on every run mode and under a hold or not — asked
      // before anything reads the mode, so neither `unanswered` nor
      // `approvedInAdvance` ever sees one. The classifier refused the call with
      // nobody asked, and what clears it is a person's consent; an engine that said
      // yes on the trak's behalf would be consenting for somebody who never read the
      // command.
      return stepGate(i, "permission")

    case "questions":
      // Unattended, the questions are answered by saying so: the step is resumed on
      // its own session with the option it recommended taken on each question that
      // had one, and its own judgement asked for on the rest — the only answers
      // available when there is nobody to give one. It is bounded, because an agent
      // that asks again has not been helped — see `unanswered`.
      return unanswered(t, i)
        ? enterStep(t, p, i, Triggers.unanswered(recommendations(out)))
        : stepGate(i, "answers")

    case "failed":
      // `orGiveUp`'s, never an agent's: `AgentStepOutput` does not carry this
      // shape, so the only way here is an `elicit` that got nothing usable.
      return fail(out.error, "agent")
  }
}

/**
 * A human pressed something. Which gate they were standing at is read from `state`
 * and never from `Trak.lastGate`, which outlives the gate it names.
 *
 * **A press that finds no gate at all has already been taken, and only `Approve`
 * has.** It is the one action the engine also makes on somebody's behalf, so a gate
 * that went past unattended *is* this press made in advance — see
 * `approvedInAdvance` — and it went past by making the same call this would:
 * `keepStep` at a step gate, `enterStep` at the plan gate. A trak with no gate to
 * stand at is therefore already where the press would have put it, and applying it
 * again is doing one thing twice.
 *
 * What arrives that way is a log written before a gate rule moved. The rule that
 * opened the gate goes past it now, so the recorded `HumanActed` lands in the commit
 * or in the step the plan entered instead. `unexpected` there settles a healthy trak
 * `Failed{engine}`, and `Failed` is absorbing — every event after the press replays
 * as a failure too, so a finished trak holding an open pull request comes back from
 * a restart errored with nothing wrong with the work. `onStopped` refuses that same
 * outcome for the same reason, one race over.
 *
 * **`Replan` is the second press that lands off a gate, because a route sends it
 * there.** `actRoute` takes the drive over for a recompose pressed mid-turn, and a
 * take-over forks its event after interrupting a fiber that may already have finished
 * the turn and moved on — to `CheckRunning`, to `Committing`, anywhere the log takes
 * a step next. `unexpected` there would be the outcome `onStopped` refuses: a healthy
 * trak settled `Failed{engine}` for racing its own turn.
 *
 * **Standing still leaves `onStopped`'s interrupted shape, and the words are kept
 * rather than spent.** The interruption killed the command that position was running
 * and nothing here re-issues it, so what the press leaves is the position on the log
 * with nothing driving it and a resume on offer. The reason is not dropped — it is
 * waiting: `applyEvent` files the `Replanned` fact before this rules, `restartFrom`
 * re-issues the position, and `reconsultHere` runs the composer at the step's own
 * boundary once the resume reaches it. A replan at a gate drives to that boundary
 * itself; this one waits for a person to pick the trak back up.
 *
 * **The other three stay loud, and refusing them is what makes naming two honest.**
 * `Chat` carries a person's words, `Skip` says the step should not run,
 * `AnswerQuestions` carries answers. No route sends any of those off a gate, so
 * absorbing one would claim a route the trak never took and drop what was said with
 * it. A wrong gate *kind* is loud for every action including `Approve` — there is a
 * gate there, and it is the one that refuses.
 */
const onPress = (t: Trak, e: Extract<Event, { readonly _tag: "HumanActed" }>): Decision => {
  if (e.action._tag === "Approve" && asGate(t.state) === undefined) {
    return Decision.Settle({ next: t.state })
  }
  const p = t.plan
  // Parked on the plan itself: the composer is who just spoke, so this routes
  // to it, not into a step.
  if (t.state._tag === "AwaitingProposal") {
    return p === undefined
      ? fail("AwaitingProposal with no proposal", "engine")
      : onProposalAction(t, e.action)
  }
  // Answers the COMPOSER asked for: re-run Compose with them. Its own state
  // rather than a `proposal === undefined` test, which stopped meaning "the
  // composer asked" the moment a plan could be revised mid-flight.
  if (t.state._tag === "AwaitingComposerAnswers") return onComposerAnswers(t, e.action)
  // A recompose pressed while a step's turn runs. The route has killed the turn by
  // taking the drive over — the shape `fileRoute` uses — so what is left is the same
  // move a replan at a gate makes: keep whatever the turn edited, and let the boundary
  // after it be the composer's. `keepStep` commits, `applyEvent` files the `Replanned`
  // fact, and `reconsultHere` reads it off the position.
  if (t.state._tag === "AgentWorking" && e.action._tag === "Replan") {
    return p === undefined
      ? fail("a replan mid-turn with no proposal", "engine")
      : keepStep(t.state.step)
  }
  // The same press landing after the turn had already ended — the take-over forks
  // its event whether or not the fiber it interrupted was still mid-turn. The fact
  // is on the trak already; standing still is what leaves it there for the resume to
  // carry to the step's boundary, rather than settling the trak. `reparked`, for
  // `onStopped`'s reason. Only `Replan`: a mid-turn `Approve` has no filed work to take, and no
  // route sends one — or a `Chat` — off a gate.
  if (t.state._tag !== "AwaitingHuman" && e.action._tag === "Replan") return reparked(t)
  if (t.state._tag !== "AwaitingHuman") return unexpected(e, t.state)
  return p === undefined
    ? fail("a human acted at a step gate with no proposal", "engine")
    : onHumanAction(t, p, t.state.step, t.state.kind, e.action)
}

/**
 * Approve, or say something. Anything the human says resumes *this* step's own
 * session, because that is the agent they are talking to — including where the
 * step was a review, and the reviewer is what just spoke. Told it let something
 * through, a reviewer runs again, and what it raises this time is what puts the plan
 * back in front of the composer.
 *
 * Which is why almost nothing here branches on the gate kind: one rule, and the
 * agent decides what its own output means. What `Approve` and `Skip` branch on is
 * the same fact from the same predicate — whether this step has filed anything —
 * so the pair cannot drift into disagreeing about it.
 */
const onHumanAction = (
  t: Trak,
  p: Plan,
  i: number,
  gate: HumanGate,
  action: HumanAction,
): Decision => {
  switch (action._tag) {
    case "Approve":
      // The two gates that offer no approval, and the refusal has to be here
      // rather than left to the surfaces: `AwaitReason` is what a gate offers, not
      // something `decide` re-reads, so approving one of them would otherwise
      // advance the plan past a step that has produced nothing and been asked for
      // nothing. Everywhere else there is a filed artifact to take.
      //
      // Carrying on past a step that produced nothing is still a real answer; it
      // is `Skip`, which records that it happened.
      return skippable(gate)
        ? fail(`an approval at a ${gate} gate — nothing has been filed to take`, "engine")
        : keepStep(i)

    case "Chat":
      return enterStep(t, p, i, Triggers.message(action.message, action.attachments))

    case "AnswerQuestions":
      return enterStep(t, p, i, Triggers.answers(action.answers, action.note))

    case "Replan":
      // Offered at every step gate and refused at none, because the reason is
      // always here: it is the action's payload rather than something the trak has
      // to be carrying already. Where the plan joins on is `recordFacts`', and it
      // is read off what this step filed rather than off what anyone said.
      //
      // **The work is kept before the composer runs, at every gate** — the same
      // `keepStep` an approval and a skip take, and `reconsultHere` is what turns
      // the boundary after it into the composer's turn. A gate where nothing is
      // filed is not a checkout where nothing was edited: a conversational step
      // runs tools and writes files before it says a word, and a replan that went
      // straight to the composer left those edits uncommitted — so a spawn planned
      // from the conversation handed its children a branch without them, and every
      // child's merge back collided with the parent's own uncommitted copy.
      return keepStep(i)

    case "Skip":
      // Routes exactly as `Approve` does, and that is not an argument against it:
      // what differs is the fact recorded, and therefore what the next step is
      // handed and what a record of this trak can later say. The gate check is
      // what keeps them apart — a skip is only a thing you can do to a step that
      // has filed nothing, and everywhere else the artifact on the table is what
      // a human is being asked about.
      //
      // It advances rather than replanning on purpose: a skip asserts the plan is
      // right minus one step, which is not breakage. Wanting the plan revised is
      // the other thing a gate offers.
      return skippable(gate)
        ? keepStep(i)
        : fail(`a skip at a ${gate} gate — this step has already filed its work`, "engine")

    case "Permit":
      return onPermit(t, p, i, gate, action.granted)
  }
}

/**
 * A person's yes or no to the command a step asked to run. Both resume the step's
 * session; the yes quotes the command the step named — off the slot, never off the
 * press — so the classifier reads consent to exactly the call it refused.
 */
const onPermit = (t: Trak, p: Plan, i: number, gate: HumanGate, granted: boolean): Decision => {
  if (gate !== "permission") {
    return fail(`a permission answer at a ${gate} gate — nothing asked for one`, "engine")
  }
  const command = slotAt(t, i).permission
  if (command === undefined) return fail("a permission gate with no command asked", "engine")
  return enterStep(t, p, i, granted ? Triggers.permitted(command) : Triggers.refused(command))
}

/**
 * The gates where the step has filed nothing — which is one fact answering two
 * questions, deliberately read from one place so the two cannot drift.
 *
 * A step that produced nothing can be **skipped**, and cannot be **approved**:
 * there is no document to take, and advancing anyway would step past work that has
 * not happened. `approval` and `checks` are the other way round for the same
 * reason — an artifact is on the table, taking it is the thing to do, and a skip
 * there would be an approval under another name.
 *
 * A `stuck` account is not an artifact and does not make this false: it is filed
 * nowhere and read once, and the slot is still owed its work. Nor is a `permission`
 * request, which files nothing at all.
 */
export const skippable = (gate: HumanGate): boolean =>
  gate === "answers" || gate === "conversation" || gate === "stuck" || gate === "permission"
