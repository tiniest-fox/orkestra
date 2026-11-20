// A goal: a direction a person sets that outlasts any one trak, and the composer that
// turns it into traks.
//
// **Started from a sentence.** A sentence starts a goal with no spec: its composer's first
// turn drafts the goal file, and the person approving that draft is the goal's one gate
// before work starts — what gives it a spec. A sub-goal starts with its spec already on its
// first event, as a goal started from a file did on an older log. A goal with a spec opens its
// traks with nobody asked: the composer opens what it is confident in, keeps the likely
// next few as its plan with `replan`, and adds traks as earlier ones land.
//
// **A second object beside the trak, not a kind of one.** It has its own event union,
// its own log under `.database/goals/<id>/`, and nothing a trak's first command needs: no
// worktree, no branch, no checks, no effects, no projection. What it shares with a trak
// is infrastructure — a file-append log replayed into state, a resumable agent session,
// gates a person answers, push. `replayGoal` is the whole of how its state is derived.
//
// **Every move the composer makes is a tool call that lands here as an event**, appended
// while its turn is still running — the turn itself ends in prose. A move that asks for a
// person (`Escalated`, `ActionRequested`, `DoneProposed`, and `PlanProposed` on an old log) is
// held on `Goal.pending` until the turn ends, so nobody is asked about a move the composer
// is still making.

import { Data, ParseResult, Schema } from "effect"
import { SessionId } from "../../agent/types/session.js"
import { Usage } from "../../agent/types/usage.js"
import { render, type Templates } from "../../prompts/index.js"
import { applyEvent } from "./replay.js"
import { emptyTrak, GoalId, RunMode, type Trak, TrakId, type TrakState, UserId } from "./trak.js"
import type { Event } from "./event.js"
import { type Attachment, Attached, attachedField, attachedView } from "./attachment.js"
import { Document } from "./outputs/artifact.js"
import { Question } from "./outputs/question.js"
import { visibleArtifacts } from "./projection.js"

const recorded = { at: Schema.optional(Schema.Number) }

const Limit = Schema.Int.pipe(Schema.positive())

/** Whether the goal's traks merge their own pull requests; absent leaves it to the composer. */
export const GoalAutoMerge = Schema.Literal("never", "always")
export type GoalAutoMerge = Schema.Schema.Type<typeof GoalAutoMerge>

const bounds = {
  parallel: Schema.optional(Limit),
  perHour: Schema.optional(Limit),
  perDay: Schema.optional(Limit),
  modes: Schema.optional(Schema.NonEmptyArray(RunMode)),
}

const CurrentLimits = Schema.Struct({ ...bounds, autoMerge: Schema.optional(GoalAutoMerge) })

/**
 * The goal file's bounds, as `GoalStarted` keeps them and a person's change replaces them.
 * See `GoalLimits` in `library/`.
 *
 * **A log written while auto-merge was a switch still replays**: a logged `false` refused
 * a trak merging itself, which is `never`, and a logged `true` allowed it, which is the
 * composer deciding. Written only in the current shape.
 */
export const GoalLimits = Schema.transform(
  Schema.Struct({
    ...bounds,
    autoMerge: Schema.optional(Schema.Union(GoalAutoMerge, Schema.Boolean)),
  }),
  Schema.typeSchema(CurrentLimits),
  {
    strict: true,
    decode: ({ autoMerge, ...rest }) =>
      autoMerge === false
        ? { ...rest, autoMerge: "never" as const }
        : autoMerge === true || autoMerge === undefined
          ? rest
          : { ...rest, autoMerge },
    encode: (limits) => limits,
  },
)
export type GoalLimits = Schema.Schema.Type<typeof GoalLimits>

/**
 * What the goal is run against: the approved draft, a sub-goal's plan entry, or the file
 * an older log's goal started from. The log is the only copy, so a goal replays to what
 * it was run against.
 */
export const GoalSpec = Schema.Struct({
  /** The goal's kebab name. Absent on a sub-goal, whose spec its parent's plan carried. */
  file: Schema.optional(Schema.String),
  title: Schema.String,
  line: Schema.String,
  finished: Schema.String,
  limits: GoalLimits,
  /**
   * The goal branch every trak of the goal is cut from and lands on, and the one pull
   * request into the default branch carries once it is done. Absent, the traks land on the
   * default branch. Never changed once the goal starts: its traks are already cut from it.
   */
  branch: Schema.optional(Schema.String),
})
export type GoalSpec = Schema.Schema.Type<typeof GoalSpec>

/** One trak the composer means to open: what a row shows, what it is asked, and its mode. */
export const PlannedTrak = Schema.Struct({
  title: Schema.NonEmptyTrimmedString,
  description: Schema.NonEmptyTrimmedString,
  mode: RunMode,
})
export type PlannedTrak = Schema.Schema.Type<typeof PlannedTrak>

/**
 * One sub-goal the composer means to open: a goal of its own, with its own composer and
 * log. Approving the plan that lists it approves this as the sub-goal's spec.
 */
export const PlannedSubgoal = Schema.Struct({
  title: Schema.NonEmptyTrimmedString,
  line: Schema.NonEmptyTrimmedString,
  finished: Schema.NonEmptyTrimmedString,
})
export type PlannedSubgoal = Schema.Schema.Type<typeof PlannedSubgoal>

/**
 * Why a sub-goal woke its parent's composer: confirmed done, dropped, or its own composer
 * turn failed (`stuck`). Its gates are its person's, and wake nothing.
 */
export const SubgoalWakeKind = Schema.Literal("done", "dropped", "stuck")
export type SubgoalWakeKind = Schema.Schema.Type<typeof SubgoalWakeKind>

/** Why a trak of the goal woke its composer. Approval and question gates are not here. */
export const WakeKind = Schema.Literal("landed", "failed", "stuck", "checks")
export type WakeKind = Schema.Schema.Type<typeof WakeKind>

/**
 * One answer per question of the escalation, by position, and `note`, which belongs to none
 * of them — a trak's `AnswerQuestions`, for the same card.
 */
const Answer = Schema.TaggedStruct("Answer", {
  answers: Schema.NonEmptyArray(Schema.String),
  note: Schema.optional(Schema.NonEmptyTrimmedString),
})
/**
 * The older shapes are read and never written: `GoalEvent`'s union encodes through the
 * current member first, so this refusal is reached by nothing a writer appends.
 */
const writtenAsCurrent = (ast: Schema.Schema.Any["ast"], actual: unknown) =>
  ParseResult.fail(new ParseResult.Forbidden(ast, actual, "an older shape is never written"))

/** An `Answer` on a log written while an escalation asked one question: its one answer. */
const AnswerOnce = Schema.transformOrFail(
  Schema.TaggedStruct("Answer", { answer: Schema.NonEmptyTrimmedString }),
  Schema.typeSchema(Answer),
  {
    strict: true,
    decode: ({ answer }) => ParseResult.succeed(Answer.make({ answers: [answer] })),
    encode: (actual, _, ast) => writtenAsCurrent(ast, actual),
  },
)

/** A person writing to the composer. `attachments` are the files sent with it, already in the checkout the composer runs in. */
const GoalChat = Schema.TaggedStruct("Chat", {
  message: Schema.NonEmptyTrimmedString,
  attachments: Attached,
})

/** What a person may press on a goal. Which are offered where is `goalOffers`. */
export const GoalAction = Schema.Union(
  /**
   * `limits`, at the file gate, is what the person set the drafted file's limits to: the
   * file is written with them and the goal is run against them. Read nowhere else.
   * `branch` rides beside it and is read only where `limits` is sent: the card's settings
   * whole, so a branch left out there is one the person cleared.
   */
  Schema.TaggedStruct("Approve", {
    limits: Schema.optional(GoalLimits),
    branch: Schema.optional(Schema.String),
  }),
  Answer,
  AnswerOnce,
  Schema.TaggedStruct("Confirm", {}),
  /**
   * The person's report on what the composer asked them to do by hand: `done`, or not, with
   * `note` saying what happened — what the composer's next turn is told.
   */
  Schema.TaggedStruct("Reported", {
    done: Schema.Boolean,
    note: Schema.optional(Schema.NonEmptyTrimmedString),
  }),
  GoalChat,
  Schema.TaggedStruct("Retry", {}),
  /**
   * Retry in a new session: the composer's session is let go, so the turn opens with the
   * whole goal brief and no resume — what a person presses where the session cannot be
   * resumed. The engine never presses it: a new session drops what the old one held.
   */
  Schema.TaggedStruct("NewSession", {}),
  /**
   * Read off logs written while the file gate had a Redraft press, and never written: no
   * gate offers it, so `acted` replays it as nothing, and the page's log leaves it out.
   */
  Schema.TaggedStruct("Redraft", {}),
)
export type GoalAction = Schema.Schema.Type<typeof GoalAction>

/** `call` is the id the CLI gave the tool call, which is what a surface joins a view on. */
const called = { call: Schema.String }

/**
 * `owner` is the host user who started the goal, on this event and on `GoalAsked`: who
 * pressed, or for a goal a trak's agent opened, that trak's owner. Absent where nobody was
 * named, and on every log written before the field existed. See `Goal.owner`.
 */
const owned = { owner: Schema.optional(UserId) }

/**
 * `parent` is the goal whose composer opened this one as a sub-goal through `open_subgoal`,
 * and `call` the id of that call — what a retried call is matched on. Both absent on an
 * older log's goal started from a file.
 */
const GoalStarted = Schema.TaggedStruct("GoalStarted", {
  ...recorded,
  ...owned,
  spec: GoalSpec,
  parent: Schema.optional(GoalId),
  call: Schema.optional(Schema.String),
})
/** One document a trak filed, under the key it filed it as. See `GoalAsked.documents`. */
const FiledDocument = Schema.Struct({ name: Schema.String, document: Document })
export type FiledDocument = Schema.Schema.Type<typeof FiledDocument>

/**
 * A goal started from a person's sentence. `modes` is what they chose
 * its traks may open on, which the drafted file carries whatever the composer writes.
 *
 * `from` is the trak whose agent opened it through `open_goal`, or whose composer proposed
 * it on its finish, and `call` the id the CLI gave that call, or `proposalCall`'s — what a
 * retried start is matched on, so it finds this goal rather than opening a second. Both
 * absent for a goal a person started.
 *
 * `documents` is every document a proposing trak filed, as it stood when the trak
 * finished, for the drafting turn to read beside `asked`. Absent on every other start.
 */
const GoalAsked = Schema.TaggedStruct("GoalAsked", {
  ...recorded,
  ...owned,
  asked: Schema.NonEmptyTrimmedString,
  modes: Schema.NonEmptyArray(RunMode),
  from: Schema.optional(TrakId),
  call: Schema.optional(Schema.String),
  documents: Schema.optional(Schema.NonEmptyArray(FiledDocument)),
  /** The files the person sent with the sentence. See `Goal.attachments`. */
  attachments: Attached,
})
/** The composer's draft of the goal file, waiting on the person at the `file` gate. */
const GoalDrafted = Schema.TaggedStruct("GoalDrafted", { ...recorded, ...called, draft: GoalSpec })
/** The person took a goal at rest off the traks list. It moves nothing else. */
const GoalDismissed = Schema.TaggedStruct("GoalDismissed", { ...recorded })
/**
 * A composer turn ended. `read` is how many wakes the turn was shown — what it answered,
 * so a wake that landed while it ran is still owed a turn.
 */
const GoalTurnEnded = Schema.TaggedStruct("GoalTurnEnded", {
  ...recorded,
  sessionId: SessionId,
  read: Schema.Number,
  usage: Schema.optional(Usage),
})
/**
 * A person stopped the running composer turn. `read` is not here: the turn answered none
 * of the wakes it was shown, so they wait for the next turn a chat or a press starts.
 * `sessionId` is the one the turn announced, absent where it announced none.
 */
const GoalTurnStopped = Schema.TaggedStruct("GoalTurnStopped", {
  ...recorded,
  sessionId: Schema.optional(SessionId),
})
const GoalTurnFailed = Schema.TaggedStruct("GoalTurnFailed", {
  ...recorded,
  sessionId: Schema.optional(SessionId),
  read: Schema.Number,
  reason: Schema.String,
  usage: Schema.optional(Usage),
})
/**
 * A plan put to the person at the plan gate. **Read only so an old log replays**: nothing
 * appends one now, and a goal standing at that gate is approved as it always was.
 * `subgoals` are the sub-goals the plan proposes beside its traks; absent is none, as on
 * every log written before sub-goals.
 */
const PlanProposed = Schema.TaggedStruct("PlanProposed", {
  ...recorded,
  ...called,
  traks: Schema.Array(PlannedTrak),
  note: Schema.optional(Schema.String),
  subgoals: Schema.optional(Schema.Array(PlannedSubgoal)),
})
const Replanned = Schema.TaggedStruct("Replanned", {
  ...recorded,
  ...called,
  traks: Schema.Array(PlannedTrak),
  why: Schema.String,
  subgoals: Schema.optional(Schema.Array(PlannedSubgoal)),
})
const TrakOpened = Schema.TaggedStruct("TrakOpened", {
  ...recorded,
  ...called,
  trak: TrakId,
  title: Schema.String,
  mode: RunMode,
})
/** The composer opened a planned sub-goal: `goal` is the sub-goal's own id. */
const SubgoalOpened = Schema.TaggedStruct("SubgoalOpened", {
  ...recorded,
  ...called,
  goal: GoalId,
  title: Schema.String,
})
/** The composer sent one of its live sub-goals a message, which wakes that sub-goal's composer. */
const SubgoalMessaged = Schema.TaggedStruct("SubgoalMessaged", {
  ...recorded,
  ...called,
  goal: GoalId,
  message: Schema.String,
})
/**
 * The composer dropped one of its live sub-goals. Recorded before the drop itself, so the
 * sub-goal settling as dropped finds it already no longer live and wakes nobody.
 */
const SubgoalDropped = Schema.TaggedStruct("SubgoalDropped", {
  ...recorded,
  ...called,
  goal: GoalId,
  reason: Schema.String,
})
const TrakMessaged = Schema.TaggedStruct("TrakMessaged", {
  ...recorded,
  ...called,
  trak: TrakId,
  message: Schema.String,
})
const TrakRecomposed = Schema.TaggedStruct("TrakRecomposed", {
  ...recorded,
  ...called,
  trak: TrakId,
  why: Schema.String,
})
/**
 * The trak is no longer the goal's to wait on. `call` is absent where the composer did
 * not drop it — a person archived it — and that wakes nothing.
 */
const TrakDropped = Schema.TaggedStruct("TrakDropped", {
  ...recorded,
  call: Schema.optional(Schema.String),
  trak: TrakId,
  reason: Schema.String,
})
/** Questions in a trak step's shape, so one card asks both. `trak` is the one it is about. */
const Escalated = Schema.TaggedStruct("Escalated", {
  ...recorded,
  ...called,
  trak: Schema.optional(TrakId),
  questions: Schema.NonEmptyArray(Question),
})
/**
 * An `Escalated` on a log written while the composer asked one question with bare answers:
 * that question, its answers as options with a label alone.
 */
const EscalatedOnce = Schema.transformOrFail(
  Schema.TaggedStruct("Escalated", {
    ...recorded,
    ...called,
    trak: Schema.optional(TrakId),
    question: Schema.String,
    answers: Schema.NonEmptyArray(Schema.String),
  }),
  Schema.typeSchema(Escalated),
  {
    strict: true,
    decode: ({ question, answers, ...rest }) =>
      ParseResult.succeed(
        Escalated.make({
          ...rest,
          questions: [{ question, options: answers.map((label) => ({ label })) }],
        }),
      ),
    encode: (actual, _, ast) => writtenAsCurrent(ast, actual),
  },
)
/**
 * Work only a person can do, asked of them: `title` is what a row names it by, `steps` what
 * they do, in order, and `why` what the goal needs it for. `trak` is the one it is about.
 * A decision is `Escalated`; this is a to-do the person reports back on.
 */
const ActionRequested = Schema.TaggedStruct("ActionRequested", {
  ...recorded,
  ...called,
  trak: Schema.optional(TrakId),
  title: Schema.NonEmptyTrimmedString,
  steps: Schema.NonEmptyArray(Schema.NonEmptyTrimmedString),
  why: Schema.NonEmptyTrimmedString,
})
const DoneProposed = Schema.TaggedStruct("DoneProposed", {
  ...recorded,
  ...called,
  summary: Schema.String,
})
/**
 * A trak of the goal ended or stopped in a way the composer is owed a turn about.
 *
 * `since` is the line of the trak's own log at which it reached this outcome — what tells
 * a wake already filed from the same outcome reached again after a fix. Kept on the goal's
 * log, so neither a restart nor a lost feed frame can make the two look alike.
 */
const TrakWoke = Schema.TaggedStruct("TrakWoke", {
  ...recorded,
  trak: TrakId,
  kind: WakeKind,
  since: Schema.optional(Schema.Number),
})
/**
 * A sub-goal of this goal was confirmed done, was dropped, or stopped `stuck` — its own
 * composer turn failed. `said` is its done summary, its drop reason or its failure.
 *
 * `since` is the line of the sub-goal's own log at which it reached this outcome, for
 * `TrakWoke.since`'s reason: a failure retried and reached again is a second wake.
 */
const SubgoalWoke = Schema.TaggedStruct("SubgoalWoke", {
  ...recorded,
  goal: GoalId,
  kind: SubgoalWakeKind,
  since: Schema.Number,
  said: Schema.optional(Schema.String),
})
/**
 * A trak of the goal handed work off, and nothing was opened for it: the descriptions are
 * the goal composer's to place.
 *
 * `step` is the compose entry on the trak's log that handed them off — what tells a hand-off
 * already filed from the next one, since a trak hands off at most once per entry. Apart from
 * `TrakWoke` and its `filed` line, because a hand-off is not a state the trak rests in: one
 * line per trak would let a landing filed after it hide it on reconcile.
 */
const TrakHandedOff = Schema.TaggedStruct("TrakHandedOff", {
  ...recorded,
  trak: TrakId,
  step: Schema.Number,
  handOff: Schema.NonEmptyArray(Schema.String),
})
const GoalActed = Schema.TaggedStruct("GoalActed", { ...recorded, action: GoalAction })
/**
 * A person wrote to the composer while a turn ran or was owed — a trak's `MessageWaiting`.
 * The running turn reads it, the next turn to start reads it, or it is the chat the goal
 * owes itself once a turn ends: `heldGoalChat`. `id` is what its delivery is reported by.
 */
const GoalMessageWaiting = Schema.TaggedStruct("GoalMessageWaiting", {
  ...recorded,
  id: Schema.String,
  message: Schema.String,
  attachments: Attached,
})
/** The composer read a waiting message, by the provider's own report of it. */
const GoalMessageHeard = Schema.TaggedStruct("GoalMessageHeard", {
  ...recorded,
  id: Schema.String,
})
/**
 * `held` is the traks the pause put a hold on — what resuming takes it off again — and
 * `subgoals` the live sub-goals it paused, which resuming resumes. Absent is none.
 */
const GoalPaused = Schema.TaggedStruct("GoalPaused", {
  ...recorded,
  held: Schema.Array(TrakId),
  subgoals: Schema.optional(Schema.Array(GoalId)),
})
const GoalResumed = Schema.TaggedStruct("GoalResumed", {
  ...recorded,
  released: Schema.Array(TrakId),
  subgoals: Schema.optional(Schema.Array(GoalId)),
})
/**
 * A person changed a running goal's limits, modes or auto-merge: `limits` replaces the
 * spec's whole. The goal file is not rewritten — the log is what the goal runs against.
 */
const GoalSettingsChanged = Schema.TaggedStruct("GoalSettingsChanged", {
  ...recorded,
  limits: GoalLimits,
})
const GoalDropped = Schema.TaggedStruct("GoalDropped", { ...recorded, reason: Schema.String })
/**
 * The goal's owner changed: every composer turn after it runs on `to`'s credential, and only
 * `to` may press what starts one. `from` is the owner before, absent where the goal had none.
 * Take ownership appended it, and is gone; nothing appends one now, and it is kept so the logs
 * that carry one still replay. See `Goal.owner`.
 */
const GoalOwnerChanged = Schema.TaggedStruct("GoalOwnerChanged", {
  ...recorded,
  from: Schema.optional(UserId),
  to: UserId,
})

export const GoalEvent = Schema.Union(
  GoalStarted,
  GoalAsked,
  GoalDrafted,
  GoalDismissed,
  GoalTurnEnded,
  GoalTurnFailed,
  GoalTurnStopped,
  PlanProposed,
  Replanned,
  TrakOpened,
  SubgoalOpened,
  SubgoalMessaged,
  SubgoalDropped,
  TrakMessaged,
  TrakRecomposed,
  TrakDropped,
  Escalated,
  EscalatedOnce,
  ActionRequested,
  DoneProposed,
  TrakWoke,
  SubgoalWoke,
  TrakHandedOff,
  GoalActed,
  GoalMessageWaiting,
  GoalMessageHeard,
  GoalPaused,
  GoalResumed,
  GoalDropped,
  GoalSettingsChanged,
  GoalOwnerChanged,
)
export type GoalEvent = Schema.Schema.Type<typeof GoalEvent>

export const GoalEvents = {
  ownerChanged: (from: UserId | undefined, to: UserId): GoalEvent =>
    GoalOwnerChanged.make({ to, ...(from === undefined ? {} : { from }) }),
  started: (
    spec: GoalSpec,
    owner?: UserId,
    opener?: { readonly parent: GoalId; readonly call: string },
  ): GoalEvent => GoalStarted.make({ spec, ...opener, ...(owner === undefined ? {} : { owner }) }),
  asked: (
    asked: string,
    modes: readonly [RunMode, ...RunMode[]],
    opener?: { readonly from: TrakId; readonly call: string },
    owner?: UserId,
    documents?: readonly FiledDocument[],
    attachments?: readonly Attachment[],
  ): GoalEvent => {
    const [first, ...rest] = documents ?? []
    return GoalAsked.make({
      asked,
      modes,
      ...opener,
      ...(owner === undefined ? {} : { owner }),
      ...(first === undefined ? {} : { documents: [first, ...rest] }),
      ...attachedField(attachments),
    })
  },
  drafted: (call: string, draft: GoalSpec): GoalEvent => GoalDrafted.make({ call, draft }),
  dismissed: (): GoalEvent => GoalDismissed.make({}),
  turnEnded: (sessionId: SessionId, read: number, usage: Usage | undefined): GoalEvent =>
    GoalTurnEnded.make({ sessionId, read, ...(usage === undefined ? {} : { usage }) }),
  turnFailed: (
    sessionId: SessionId | undefined,
    read: number,
    reason: string,
    usage: Usage | undefined,
  ): GoalEvent =>
    GoalTurnFailed.make({
      read,
      reason,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(usage === undefined ? {} : { usage }),
    }),
  turnStopped: (sessionId: SessionId | undefined): GoalEvent =>
    GoalTurnStopped.make(sessionId === undefined ? {} : { sessionId }),
  planProposed: (
    call: string,
    traks: readonly PlannedTrak[],
    note: string | undefined,
    subgoals: readonly PlannedSubgoal[] = [],
  ): GoalEvent =>
    PlanProposed.make({
      call,
      traks,
      ...(note === undefined ? {} : { note }),
      ...(subgoals.length === 0 ? {} : { subgoals }),
    }),
  replanned: (
    call: string,
    traks: readonly PlannedTrak[],
    why: string,
    subgoals: readonly PlannedSubgoal[] = [],
  ): GoalEvent =>
    Replanned.make({ call, traks, why, ...(subgoals.length === 0 ? {} : { subgoals }) }),
  trakOpened: (call: string, trak: TrakId, title: string, mode: RunMode): GoalEvent =>
    TrakOpened.make({ call, trak, title, mode }),
  subgoalOpened: (call: string, goal: GoalId, title: string): GoalEvent =>
    SubgoalOpened.make({ call, goal, title }),
  subgoalMessaged: (call: string, goal: GoalId, message: string): GoalEvent =>
    SubgoalMessaged.make({ call, goal, message }),
  subgoalDropped: (call: string, goal: GoalId, reason: string): GoalEvent =>
    SubgoalDropped.make({ call, goal, reason }),
  subgoalWoke: (
    goal: GoalId,
    kind: SubgoalWakeKind,
    since: number,
    said: string | undefined,
  ): GoalEvent => SubgoalWoke.make({ goal, kind, since, ...(said === undefined ? {} : { said }) }),
  trakMessaged: (call: string, trak: TrakId, message: string): GoalEvent =>
    TrakMessaged.make({ call, trak, message }),
  trakRecomposed: (call: string, trak: TrakId, why: string): GoalEvent =>
    TrakRecomposed.make({ call, trak, why }),
  trakDropped: (call: string | undefined, trak: TrakId, reason: string): GoalEvent =>
    TrakDropped.make({ trak, reason, ...(call === undefined ? {} : { call }) }),
  escalated: (
    call: string,
    trak: TrakId | undefined,
    questions: readonly [Question, ...Question[]],
  ): GoalEvent => Escalated.make({ call, questions, ...(trak === undefined ? {} : { trak }) }),
  actionRequested: (call: string, request: ActionRequest): GoalEvent =>
    ActionRequested.make({
      call,
      title: request.title,
      steps: request.steps,
      why: request.why,
      ...(request.trak === undefined ? {} : { trak: request.trak }),
    }),
  doneProposed: (call: string, summary: string): GoalEvent => DoneProposed.make({ call, summary }),
  trakWoke: (trak: TrakId, kind: WakeKind, since: number): GoalEvent =>
    TrakWoke.make({ trak, kind, since }),
  trakHandedOff: (trak: TrakId, step: number, handOff: readonly [string, ...string[]]): GoalEvent =>
    TrakHandedOff.make({ trak, step, handOff }),
  acted: (action: GoalAction): GoalEvent => GoalActed.make({ action }),
  messageWaiting: (id: string, message: string, attachments?: readonly Attachment[]): GoalEvent =>
    GoalMessageWaiting.make({ id, message, ...attachedField(attachments) }),
  messageHeard: (id: string): GoalEvent => GoalMessageHeard.make({ id }),
  paused: (held: readonly TrakId[], subgoals: readonly GoalId[] = []): GoalEvent =>
    GoalPaused.make({ held, ...(subgoals.length === 0 ? {} : { subgoals }) }),
  resumed: (released: readonly TrakId[], subgoals: readonly GoalId[] = []): GoalEvent =>
    GoalResumed.make({ released, ...(subgoals.length === 0 ? {} : { subgoals }) }),
  dropped: (reason: string): GoalEvent => GoalDropped.make({ reason }),
  settingsChanged: (limits: GoalLimits): GoalEvent => GoalSettingsChanged.make({ limits }),
}

/**
 * What a goal stops for a person about: its drafted file, an escalation, work asked of
 * them by hand, and its proposed done — and its plan, reached only on an old log, since
 * nothing proposes one now. Each always stops: a goal has no run mode.
 */
export type GoalGate = "file" | "plan" | "escalation" | "action" | "done"

/**
 * Where a goal stands.
 *
 * `Composing` is a composer turn owed or running — whether one runs now is `owesTurn`,
 * because a paused goal owes one and takes none. `Watching` is its traks running with
 * nothing owed. `Failed` is a turn the provider lost, which only a person retries.
 * `Done` and `Dropped` are at rest.
 */
export type GoalState = Data.TaggedEnum<{
  Composing: {}
  AtGate: { readonly gate: GoalGate }
  Watching: {}
  Failed: { readonly reason: string }
  Done: {}
  Dropped: { readonly reason: string }
}>
export const GoalState = Data.taggedEnum<GoalState>()

/** What the next composer turn is answering. Read by the prompt; set by what owed the turn. */
export type GoalTrigger = Data.TaggedEnum<{
  /** The first turn, or a retry of one: drafting where the goal has no spec, planning where it has. */
  Started: {}
  /** The person approved the drafted file, which is now the goal's spec. */
  Filed: {}
  /** The person approved a plan an old log proposed. */
  Approved: {}
  Said: { readonly message: string; readonly attachments?: readonly Attachment[] | undefined }
  /** The person's answers, each beside the question it answers, where the escalation is known. */
  Answered: {
    readonly questions: readonly Question[]
    readonly answers: readonly [string, ...string[]]
    readonly note: string | undefined
  }
  /** The person's report on the work asked of them, beside what was asked where it is known. */
  Reported: {
    readonly request: ActionRequest | undefined
    readonly done: boolean
    readonly note: string | undefined
  }
  Woken: {}
  Resumed: {}
}>
export const GoalTrigger = Data.taggedEnum<GoalTrigger>()

export type GoalTrakStatus = "live" | "landed" | "dropped"

/** A trak the goal opened, as the goal counts it. The trak's own log says the rest. */
export interface GoalTrak {
  readonly id: TrakId
  readonly title: string
  readonly mode: RunMode
  readonly status: GoalTrakStatus
  /** When it was opened — what the hourly and daily limits count. */
  readonly openedAt: number | undefined
  /** The trak-log line the last wake filed for it began at — `TrakWoke.since`. */
  readonly filed: number | undefined
  /** The compose entries of its log whose hand-offs are filed — `TrakHandedOff.step`. */
  readonly handedOff: readonly number[]
}

export type GoalSubgoalStatus = "live" | "done" | "dropped"

/** A sub-goal the goal opened, as the goal counts it. The sub-goal's own log says the rest. */
export interface GoalSubgoal {
  readonly id: GoalId
  readonly title: string
  readonly status: GoalSubgoalStatus
  /** The sub-goal-log line the last wake filed for it began at — `SubgoalWoke.since`. */
  readonly filed: number | undefined
}

/**
 * What woke the composer: an outcome a trak's log reached, work a trak handed off, or a
 * sub-goal done, dropped or stuck.
 */
export type Wake =
  | { readonly trak: TrakId; readonly kind: WakeKind }
  | {
      readonly trak: TrakId
      readonly kind: "handedOff"
      readonly handOff: readonly [string, ...string[]]
    }
  | {
      readonly subgoal: GoalId
      readonly kind: SubgoalWakeKind
      readonly said: string | undefined
    }

export interface Escalation {
  readonly trak: TrakId | undefined
  readonly questions: readonly [Question, ...Question[]]
}

/** What the composer asked a person to do by hand, while the goal waits on their report. */
export interface ActionRequest {
  readonly trak: TrakId | undefined
  readonly title: string
  readonly steps: readonly [string, ...string[]]
  readonly why: string
}

/** A message waiting for the composer: `id` is the key its delivery is reported by. */
export interface GoalMessage {
  readonly id: string
  readonly message: string
  readonly attachments: readonly Attachment[]
}

export interface Goal {
  readonly id: GoalId
  /** What the goal is run against. Absent until a goal started from a sentence has its file approved. */
  readonly spec: GoalSpec | undefined
  /** The person's sentence, for a goal started from one. */
  readonly asked: string | undefined
  /**
   * The files the person sent with that sentence, in the checkout the composer runs in.
   * Empty for any other goal and every log before the field existed.
   */
  readonly attachments: readonly Attachment[]
  /** The modes the person chose at a sentence start; the draft carries them. */
  readonly askedModes: readonly [RunMode, ...RunMode[]] | undefined
  /** What the trak that proposed this goal filed, for the drafting turn. Empty on any other. */
  readonly documents: readonly FiledDocument[]
  /** The trak whose agent opened this goal, and the id of the call it did it with. */
  readonly openedBy: { readonly from: TrakId; readonly call: string | undefined } | undefined
  /**
   * The goal whose composer opened this one as a sub-goal, and the id of that call. A goal
   * with a parent opens traks and never sub-goals.
   */
  readonly parent: { readonly goal: GoalId; readonly call: string | undefined } | undefined
  /** The composer's newest draft of the file, while the goal has none approved. */
  readonly draft: GoalSpec | undefined
  readonly state: GoalState
  readonly paused: boolean
  /** The traks the standing pause put a hold on. Empty when not paused. */
  readonly held: readonly TrakId[]
  /** The composer's one session, resumed by every turn after the first. */
  readonly session: SessionId | undefined
  /** The traks the composer expects the goal to take next, opened or not — what progress is of. */
  readonly plan: readonly PlannedTrak[]
  /** The sub-goals the plan holds beside its traks, opened or not. */
  readonly subgoalPlan: readonly PlannedSubgoal[]
  readonly traks: readonly GoalTrak[]
  readonly subgoals: readonly GoalSubgoal[]
  /** The sub-goals the standing pause paused. Empty when not paused. */
  readonly heldSubgoals: readonly GoalId[]
  /** Every wake, oldest first. A turn is shown `wakes.slice(read)`. */
  readonly wakes: readonly Wake[]
  readonly read: number
  /** A gate the running turn asked for, opened when the turn ends. */
  readonly pending: GoalGate | undefined
  readonly escalation: Escalation | undefined
  readonly action: ActionRequest | undefined
  /** The composer's account of the finished goal, while it is proposed. */
  readonly done: string | undefined
  /**
   * What the person wrote that the composer has not read, oldest first — `GoalMessageWaiting`
   * adds one, and `GoalMessageHeard` and a `Chat` take them out.
   */
  readonly messages: readonly GoalMessage[]
  /** Why the owed turn is owed; `undefined` when none is. */
  readonly owed: GoalTrigger | undefined
  readonly startedAt: number | undefined
  /** When it came to rest — the confirm or the drop. */
  readonly endedAt: number | undefined
  /** At rest and taken off the traks list by the person. */
  readonly dismissed: boolean
  /**
   * How many events the log held when this was replayed: the `after` an append decided
   * from this goal passes. Set by `replayGoal` alone, so a goal applied forward from one
   * holds the count it was read at.
   */
  readonly logged: number
  /**
   * The host user the goal belongs to, and every trak it opens with it. `undefined` where
   * nobody was named — no host user, and every log written before the field existed. Set by
   * the goal's first event, and changed by `GoalOwnerChanged`.
   */
  readonly owner: UserId | undefined
}

type Opening = Extract<GoalEvent, { readonly _tag: "GoalStarted" | "GoalAsked" }>

const fresh = (id: GoalId, first: Opening): Goal => ({
  id,
  spec: first._tag === "GoalStarted" ? first.spec : undefined,
  asked: first._tag === "GoalAsked" ? first.asked : undefined,
  attachments: first._tag === "GoalAsked" ? (first.attachments ?? []) : [],
  askedModes: first._tag === "GoalAsked" ? first.modes : undefined,
  documents: first._tag === "GoalAsked" ? (first.documents ?? []) : [],
  openedBy:
    first._tag === "GoalAsked" && first.from !== undefined
      ? { from: first.from, call: first.call }
      : undefined,
  parent:
    first._tag === "GoalStarted" && first.parent !== undefined
      ? { goal: first.parent, call: first.call }
      : undefined,
  draft: undefined,
  state: GoalState.Composing(),
  paused: false,
  held: [],
  session: undefined,
  plan: [],
  subgoalPlan: [],
  traks: [],
  subgoals: [],
  heldSubgoals: [],
  wakes: [],
  read: 0,
  pending: undefined,
  escalation: undefined,
  action: undefined,
  done: undefined,
  messages: [],
  owed: GoalTrigger.Started(),
  startedAt: first.at,
  endedAt: undefined,
  dismissed: false,
  logged: 1,
  owner: first.owner,
})

/**
 * What a person knows the goal by: its file's title, the draft's while one waits, and the
 * sentence it was asked for in before either exists.
 */
export const goalName = (goal: Goal): string =>
  goal.spec?.title ?? goal.draft?.title ?? goal.asked ?? goal.id

/** Done or dropped: nothing moves the goal again, and another may be started. */
export const goalAtRest = (state: GoalState): boolean =>
  state._tag === "Done" || state._tag === "Dropped"

/** Whether a composer turn should run now. A paused goal owes one and takes none. */
export const owesTurn = (goal: Goal): boolean => goal.state._tag === "Composing" && !goal.paused

/** The traks still running for the goal — what `parallel:` counts. */
export const liveTraks = (goal: Goal): readonly GoalTrak[] =>
  goal.traks.filter((t) => t.status === "live")

/** The sub-goals still going for the goal — what pause and drop reach. */
export const liveSubgoals = (goal: Goal): readonly GoalSubgoal[] =>
  goal.subgoals.filter((s) => s.status === "live")

/** The wakes no finished turn has answered yet. */
export const unread = (goal: Goal): readonly Wake[] => goal.wakes.slice(goal.read)

/**
 * What a person may press, where they stand. One function, so the act route's refusal
 * and a surface's buttons cannot disagree. `Retry` at `Composing` is for a turn a dead
 * engine left owed — the route offers it only where nothing is running. `Chat` at
 * `Composing` is written as a waiting message rather than acted on: the turn owed or
 * running is for something else, which a chat must not replace.
 */
export const goalOffers = (state: GoalState): readonly Exclude<GoalAction["_tag"], "Redraft">[] => {
  switch (state._tag) {
    case "AtGate":
      switch (state.gate) {
        case "file":
          return ["Approve", "Chat"]
        case "plan":
          return ["Approve", "Chat"]
        case "escalation":
          return ["Answer", "Chat"]
        case "action":
          return ["Reported", "Chat"]
        case "done":
          return ["Confirm", "Chat"]
      }
    case "Watching":
      return ["Chat"]
    case "Failed":
      return ["Retry", "NewSession", "Chat"]
    case "Composing":
      return ["Retry", "Chat"]
    case "Done":
    case "Dropped":
      return []
  }
}

/**
 * What a person says to the composer, with everything still waiting said first — the
 * waiting messages are older, and one chat is one turn. A trak's `chatWith`.
 */
export const goalChatWith = (
  goal: Goal,
  message?: string,
  attachments: readonly Attachment[] = [],
): GoalAction =>
  GoalChat.make({
    message: [
      ...goal.messages.map((m) => m.message),
      ...(message === undefined ? [] : [message]),
    ].join("\n\n"),
    ...attachedField([...goal.messages.flatMap((m) => m.attachments), ...attachments]),
  })

/** A `GoalMessageWaiting` as the goal holds it, with no files where it was sent none. */
const waitingOf = (
  e: Extract<GoalEvent, { readonly _tag: "GoalMessageWaiting" }>,
): GoalMessage => ({
  id: e.id,
  message: e.message,
  attachments: e.attachments ?? [],
})

/**
 * The files the composer's next turn names: what the chat it answers was sent with, and —
 * on the session's first turn, while the goal is still a sentence — what that sentence
 * was sent with.
 */
export const goalAttachments = (goal: Goal): readonly Attachment[] => [
  ...(goal.session === undefined && goal.spec === undefined ? goal.attachments : []),
  ...(goal.owed?._tag === "Said" ? (goal.owed.attachments ?? []) : []),
]

/**
 * The chat a goal owes itself once a composer turn has ended: the messages that turn never
 * read, joined oldest first. `undefined` where none waits, or where the goal does not take
 * `Chat`. Asked by the driver after each ending it appends and never of a stop, which owes
 * no turn: what waits through a stop goes with the next chat, or to the next turn's pipe.
 */
export const heldGoalChat = (goal: Goal): GoalEvent | undefined =>
  goal.messages.length === 0 || !goalOffers(goal.state).includes("Chat")
    ? undefined
    : GoalActed.make({ action: goalChatWith(goal) })

/** A turn is owed for `why`, unless one already is — the older reason is not lost to a wake. */
const owe = (goal: Goal, why: GoalTrigger): Goal => ({
  ...goal,
  state: GoalState.Composing(),
  owed: goal.owed ?? why,
})

const withTrak = (goal: Goal, id: TrakId, status: GoalTrakStatus): Goal => ({
  ...goal,
  traks: goal.traks.map((t) => (t.id === id ? { ...t, status } : t)),
})

/** A wake wakes a goal that is watching; anywhere else it waits to be read by the next turn. */
const woken = (goal: Goal, wake: Wake): Goal => {
  const next = { ...goal, wakes: [...goal.wakes, wake] }
  return goal.state._tag === "Watching" ? owe(next, GoalTrigger.Woken()) : next
}

/**
 * Where a turn's ending leaves the goal: the gate it asked for, the file gate while a draft
 * waits, or watching. A stopped turn owes nothing and settles here alone; an ended one
 * adds the turn its unread wakes are owed — `afterTurn`.
 */
const settledAfter = (goal: Goal): Goal => {
  const settled = { ...goal, pending: undefined, owed: undefined }
  if (goal.pending !== undefined)
    return { ...settled, state: GoalState.AtGate({ gate: goal.pending }) }
  // A draft with no file approved is still waiting on the person: a turn that answered a
  // question about it, or was told something and did not redraft, leaves the same draft.
  if (goal.spec === undefined && goal.draft !== undefined)
    return { ...settled, state: GoalState.AtGate({ gate: "file" }) }
  return { ...settled, state: GoalState.Watching() }
}

/** `settledAfter`, owing another turn where it would watch with wakes the turn never read. */
const afterTurn = (goal: Goal, read: number): Goal => {
  const settled = settledAfter({ ...goal, read })
  return settled.state._tag === "Watching" && read < goal.wakes.length
    ? owe(settled, GoalTrigger.Woken())
    : settled
}

/**
 * The drafted file as approved: the person's settings over the composer's, where the card
 * sent them — the limits, and the goal branch, which they kept, changed or cleared.
 */
export const approvedDraft = (
  draft: GoalSpec | undefined,
  limits: GoalLimits | undefined,
  branch?: string,
): GoalSpec | undefined => {
  if (draft === undefined || limits === undefined) return draft
  const { file, title, line, finished } = draft
  return { file, title, line, finished, limits, ...(branch === undefined ? {} : { branch }) }
}

const acted = (goal: Goal, action: GoalAction, at: number | undefined): Goal => {
  // Offered nowhere, and read only so an old log replays: see `GoalAction`.
  if (action._tag === "Redraft") return goal
  if (!goalOffers(goal.state).includes(action._tag)) return goal
  const filing = goal.state._tag === "AtGate" && goal.state.gate === "file"
  switch (action._tag) {
    case "Approve":
      // The file gate's approval makes the draft the spec, under the limits the person set
      // on it.
      return filing
        ? owe(
            {
              ...goal,
              owed: undefined,
              spec: approvedDraft(goal.draft, action.limits, action.branch),
              draft: undefined,
            },
            GoalTrigger.Filed(),
          )
        : owe({ ...goal, owed: undefined }, GoalTrigger.Approved())
    case "Answer":
      return owe(
        { ...goal, owed: undefined, escalation: undefined },
        GoalTrigger.Answered({
          questions: goal.escalation?.questions ?? [],
          answers: action.answers,
          note: action.note,
        }),
      )
    case "Reported":
      return owe(
        { ...goal, owed: undefined, action: undefined },
        GoalTrigger.Reported({ request: goal.action, done: action.done, note: action.note }),
      )
    case "Confirm":
      return { ...goal, state: GoalState.Done(), owed: undefined, endedAt: at }
    case "Chat":
      // The message already holds every waiting one — `goalChatWith` — so they go with it.
      return owe(
        { ...goal, owed: undefined, done: undefined, messages: [] },
        GoalTrigger.Said(action),
      )
    case "Retry":
      return owe(goal, GoalTrigger.Started())
    case "NewSession":
      return owe({ ...goal, session: undefined }, GoalTrigger.Started())
  }
}

const openedTrak = ({ trak, title, mode, at }: typeof TrakOpened.Type): GoalTrak => ({
  id: trak,
  title,
  mode,
  status: "live",
  openedAt: at,
  filed: undefined,
  handedOff: [],
})

const openedSubgoal = ({ goal, title }: typeof SubgoalOpened.Type): GoalSubgoal => ({
  id: goal,
  title,
  status: "live",
  filed: undefined,
})

/** A sub-goal's wake filed: done and dropped settle it, and `stuck` leaves it live. */
const subgoalWoke = (goal: Goal, event: typeof SubgoalWoke.Type): Goal => {
  const status: GoalSubgoalStatus =
    event.kind === "done" ? "done" : event.kind === "dropped" ? "dropped" : "live"
  const filed = {
    ...goal,
    subgoals: goal.subgoals.map((s) =>
      s.id === event.goal ? { ...s, status, filed: event.since } : s,
    ),
  }
  return woken(filed, { subgoal: event.goal, kind: event.kind, said: event.said })
}

/**
 * A sub-goal the composer dropped: settled with no wake, and off the plan as `drop_trak`
 * takes a trak off it, so opening a better one is a `replan` first.
 */
const subgoalDropped = (goal: Goal, id: GoalId): Goal => {
  const title = goal.subgoals.find((s) => s.id === id)?.title
  return {
    ...goal,
    subgoals: goal.subgoals.map((s) => (s.id === id ? { ...s, status: "dropped" as const } : s)),
    subgoalPlan: goal.subgoalPlan.filter((p) => p.title !== title),
  }
}

const requestOf = ({ trak, title, steps, why }: typeof ActionRequested.Type): ActionRequest => ({
  trak,
  title,
  steps,
  why,
})

/**
 * One event applied. Total: an event that does not apply where the goal stands leaves it
 * as it was — every writer checks before it appends, and a log is never refused on replay.
 */
export const applyGoalEvent = (goal: Goal, event: GoalEvent): Goal => {
  // Dismissing is the one thing a goal at rest takes, and only at rest.
  if (event._tag === "GoalDismissed")
    return goalAtRest(goal.state) ? { ...goal, dismissed: true } : goal
  if (goalAtRest(goal.state)) return goal
  switch (event._tag) {
    case "GoalStarted":
    case "GoalAsked":
      return fresh(goal.id, event)
    case "GoalDrafted":
      return goal.spec === undefined ? { ...goal, draft: event.draft, pending: "file" } : goal
    case "GoalTurnEnded":
      return afterTurn({ ...goal, session: event.sessionId }, event.read)
    case "GoalTurnStopped":
      return settledAfter({ ...goal, session: event.sessionId ?? goal.session })
    case "GoalTurnFailed": {
      const kept = { ...goal, session: event.sessionId ?? goal.session }
      // A gate the turn asked for before the provider went is still asked: the call was
      // answered, and what it asked for is on the log.
      return kept.pending === undefined
        ? { ...kept, read: event.read, state: GoalState.Failed({ reason: event.reason }) }
        : afterTurn(kept, event.read)
    }
    case "PlanProposed":
      return { ...goal, plan: event.traks, subgoalPlan: event.subgoals ?? [], pending: "plan" }
    case "Replanned":
      return { ...goal, plan: event.traks, subgoalPlan: event.subgoals ?? [] }
    case "TrakOpened":
      return { ...goal, traks: [...goal.traks, openedTrak(event)] }
    case "SubgoalOpened":
      return { ...goal, subgoals: [...goal.subgoals, openedSubgoal(event)] }
    case "SubgoalWoke":
      return subgoalWoke(goal, event)
    case "SubgoalDropped":
      return subgoalDropped(goal, event.goal)
    case "SubgoalMessaged":
    case "TrakMessaged":
    case "TrakRecomposed":
      return goal
    case "TrakDropped": {
      // The composer's own drop takes the trak off the plan, so progress is of what it
      // still means to land. A person's archive leaves the plan for the composer to redo.
      const title = goal.traks.find((t) => t.id === event.trak)?.title
      const dropped = withTrak(goal, event.trak, "dropped")
      return event.call === undefined || title === undefined
        ? dropped
        : { ...dropped, plan: dropped.plan.filter((p) => p.title !== title) }
    }
    case "Escalated":
      return {
        ...goal,
        pending: "escalation",
        escalation: { trak: event.trak, questions: event.questions },
      }
    case "ActionRequested":
      return { ...goal, pending: "action", action: requestOf(event) }
    case "DoneProposed":
      return { ...goal, pending: "done", done: event.summary }
    case "TrakWoke": {
      const filed = {
        ...goal,
        traks: goal.traks.map((t) => (t.id === event.trak ? { ...t, filed: event.since } : t)),
      }
      const marked = event.kind === "landed" ? withTrak(filed, event.trak, "landed") : filed
      return woken(marked, { trak: event.trak, kind: event.kind })
    }
    case "TrakHandedOff": {
      const filed = {
        ...goal,
        traks: goal.traks.map((t) =>
          t.id === event.trak ? { ...t, handedOff: [...t.handedOff, event.step] } : t,
        ),
      }
      return woken(filed, { trak: event.trak, kind: "handedOff", handOff: event.handOff })
    }
    case "GoalActed":
      return acted(goal, event.action, event.at)
    case "GoalMessageWaiting":
      return { ...goal, messages: [...goal.messages, waitingOf(event)] }
    case "GoalMessageHeard":
      return { ...goal, messages: goal.messages.filter((m) => m.id !== event.id) }
    case "GoalPaused":
      return { ...goal, paused: true, held: event.held, heldSubgoals: event.subgoals ?? [] }
    case "GoalResumed": {
      // A turn owed only for its wakes is told it was paused: the wakes are listed either
      // way, and the pause is the news. A person's words owed a turn keep theirs.
      const resumed = { ...goal, paused: false, held: [], heldSubgoals: [] }
      if (goal.state._tag === "Watching") return owe(resumed, GoalTrigger.Resumed())
      return goal.owed?._tag === "Woken" ? { ...resumed, owed: GoalTrigger.Resumed() } : resumed
    }
    case "GoalDropped":
      return {
        ...goal,
        state: GoalState.Dropped({ reason: event.reason }),
        owed: undefined,
        endedAt: event.at,
      }
    case "GoalSettingsChanged":
      return goal.spec === undefined
        ? goal
        : { ...goal, spec: { ...goal.spec, limits: event.limits } }
    case "GoalOwnerChanged":
      return { ...goal, owner: event.to }
  }
}

/**
 * The goal a log adds up to. `undefined` for a log that does not open with `GoalStarted`
 * or `GoalAsked`, which no writer produces: the start route appends one first, alone.
 */
export const replayGoal = (id: GoalId, history: readonly GoalEvent[]): Goal | undefined => {
  const [first, ...rest] = history
  if (first?._tag !== "GoalStarted" && first?._tag !== "GoalAsked") return undefined
  return { ...rest.reduce(applyGoalEvent, fresh(id, first)), logged: history.length }
}

export const decodeGoalEvent = Schema.decodeUnknown(GoalEvent)
export const encodeGoalEvent = Schema.encode(GoalEvent)

/** The event with a time, keeping one it already has — `stamped`'s rule for a trak's log. */
export const stampedGoal = (event: GoalEvent, now: number): GoalEvent =>
  event.at === undefined ? { ...event, at: now } : event

/** Where one of the goal's traks stands as its turn is built: its state's tag, and a gate's kind. */
export interface TrakStanding {
  readonly id: TrakId
  readonly title: string
  readonly mode: RunMode
  readonly state: string
}

/** Each answer beside the question it answers, by position, and the note. */
const answeredPairs = (owed: Extract<GoalTrigger, { readonly _tag: "Answered" }>) => ({
  pairs: owed.answers.map((answer, i) => ({
    number: i + 1,
    question: owed.questions[i]?.question,
    answer,
  })),
  note: owed.note,
})

/** What was asked of the person and what they reported, for the turn that hears it. */
const reportedWork = (owed: Extract<GoalTrigger, { readonly _tag: "Reported" }>) => ({
  request: owed.request?.title,
  steps: owed.request?.steps.map((step, i) => ({ number: i + 1, step })),
  done: owed.done,
  note: owed.note,
})

/**
 * Each other goal still going, as its composer is pointed at it — a pointer to read rather
 * than a channel, so it plans nothing another goal already covers. Its finished state is
 * its spec's, indented to sit under its list item; a goal still drafting has no spec yet,
 * and is named by its sentence. Its own sub-goals and its parent are listed under their
 * own headings instead.
 */
const othersGoing = (goal: Goal, goals: readonly Goal[]) =>
  goals
    .filter(
      (g) =>
        g.id !== goal.id &&
        !goalAtRest(g.state) &&
        g.parent?.goal !== goal.id &&
        g.id !== goal.parent?.goal,
    )
    .map((g) => ({
      title: goalName(g),
      line: g.spec?.line ?? g.draft?.line,
      finished: g.spec?.finished
        .trim()
        .split("\n")
        .map((l) => (l === "" ? "" : `    ${l}`))
        .join("\n"),
      traks: g.traks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    }))

/**
 * One composer turn's body. `traks` is each of the goal's traks as its own log says now,
 * read by the caller — the goal's log knows only what it opened. `goals` is every goal the
 * caller could read, this one among them; the others still going are listed. `rules` is the
 * project's `GOALS.md`, handed to the turn that opens the session and to no other: a
 * resumed session already holds it.
 */
export const buildGoalPrompt = (
  templates: Templates,
  goal: Goal,
  traks: readonly TrakStanding[],
  goals: readonly Goal[],
  rules = "",
): string => {
  const owed = goal.owed ?? GoalTrigger.Woken()
  const { spec } = goal
  const parent = goals.find((g) => g.id === goal.parent?.goal)
  const limits = sharedBudget(spec?.limits ?? {}, parent?.spec?.limits)
  const subgoal = (id: GoalId) => goals.find((g) => g.id === id)
  return render(templates, "goal/turn", {
    fresh: goal.session === undefined && spec !== undefined,
    parent:
      goal.parent === undefined
        ? undefined
        : parent === undefined
          ? goal.parent.goal
          : goalName(parent),
    rules: goal.session === undefined && rules !== "" ? rules : undefined,
    branch: spec?.branch,
    // A goal with no approved file is drafting it, from the sentence it was started with.
    drafting: spec === undefined,
    asked: goal.asked,
    askedModes: goal.askedModes?.join(", "),
    // Every key set on each, for `wakes`' reason below: Mustache reads a missing one off
    // the turn's own context.
    documents: goal.documents.map((d) => ({
      name: d.name,
      sections: Object.entries(d.document.sections).map(([heading, body]) => ({
        heading,
        body: body.trim(),
      })),
    })),
    draftFirst: spec === undefined && owed._tag === "Started",
    filed: owed._tag === "Filed",
    title: spec?.title,
    line: spec?.line,
    finished: spec?.finished,
    limited: limitedBy(limits),
    parallel: limits.parallel,
    perHour: limits.perHour,
    perDay: limits.perDay,
    modes: limits.modes?.join(", "),
    noAutoMerge: limits.autoMerge === "never",
    alwaysAutoMerge: limits.autoMerge === "always",
    started: owed._tag === "Started" && spec !== undefined,
    approved: owed._tag === "Approved",
    said: owed._tag === "Said" ? owed.message : undefined,
    // Each list in an object of its own, so the one `attached` partial reads whichever
    // section it is rendered inside.
    askedFiles: attachedView(goal.attachments),
    saidFiles: owed._tag === "Said" ? attachedView(owed.attachments ?? []) : undefined,
    answered: owed._tag === "Answered" ? answeredPairs(owed) : undefined,
    reported: owed._tag === "Reported" ? reportedWork(owed) : undefined,
    resumed: owed._tag === "Resumed",
    woken: owed._tag === "Woken",
    wakes: unread(goal).map((w) =>
      "subgoal" in w
        ? {
            // Every key set, `summary` to an empty string at the least: Mustache reads a
            // missing one off the turn's own context, where `title` and `said` both exist.
            subgoal: {
              id: w.subgoal,
              title: goal.subgoals.find((s) => s.id === w.subgoal)?.title ?? w.subgoal,
              what: w.kind,
              summary: w.said ?? "",
            },
          }
        : w.kind === "handedOff"
          ? { trak: w.trak, handOff: w.handOff }
          : { trak: w.trak, what: w.kind },
    ),
    traks: traks.map((t) => ({ id: t.id, title: t.title, mode: t.mode, where: t.state })),
    plan: goal.plan,
    subgoalPlan: goal.subgoalPlan,
    subgoals: goal.subgoals.map((s) => ({
      id: s.id,
      title: s.title,
      where: subgoalWhere(subgoal(s.id), s.status),
      ...subgoalProgress(subgoal(s.id)),
    })),
    others: othersGoing(goal, goals),
  })
}

/**
 * How far a sub-goal's own traks have got, as its parent's composer is told: how many it
 * opened, how many landed and how many still run. A sub-goal whose log is unread counts none.
 */
const subgoalProgress = (sub: Goal | undefined) => {
  const traks = sub?.traks ?? []
  return {
    opened: traks.length,
    landed: traks.filter((t) => t.status === "landed").length,
    running: traks.filter((t) => t.status === "live").length,
  }
}

/** Where a sub-goal stands, as its parent's composer is told: its state, and a gate's kind. */
const subgoalWhere = (sub: Goal | undefined, status: GoalSubgoalStatus): string => {
  if (sub === undefined) return status
  const { state } = sub
  const where = state._tag === "AtGate" ? `AtGate (${state.gate})` : state._tag
  return sub.paused ? `${where}, paused` : where
}

/** Whether the goal limits anything — auto-merge included, which either way takes the choice away. */
const limitedBy = (limits: GoalBudget): boolean =>
  limits.parallel !== undefined ||
  limits.perHour !== undefined ||
  limits.perDay !== undefined ||
  limits.modes !== undefined ||
  limits.autoMerge !== undefined

/**
 * The limits a goal's traks are opened under: its own, and for a sub-goal its parent's as
 * they stand now, whichever is tighter. A sub-goal may tighten a limit and never loosen
 * one: each count is the smaller, the run modes are those both allow — none, where they
 * share none — and the parent's `never` on auto-merge holds whatever the sub-goal says.
 */
export interface GoalBudget {
  readonly parallel?: number | undefined
  readonly perHour?: number | undefined
  readonly perDay?: number | undefined
  readonly modes?: readonly RunMode[] | undefined
  readonly autoMerge?: GoalAutoMerge | undefined
}

const tighter = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined ? b : b === undefined ? a : Math.min(a, b)

export const sharedBudget = (own: GoalLimits, parent: GoalLimits | undefined): GoalBudget => {
  if (parent === undefined) return own
  const modes =
    own.modes === undefined
      ? parent.modes
      : parent.modes === undefined
        ? own.modes
        : own.modes.filter((m) => parent.modes?.includes(m) === true)
  const autoMerge = parent.autoMerge === "never" ? "never" : (own.autoMerge ?? parent.autoMerge)
  return {
    parallel: tighter(own.parallel, parent.parallel),
    perHour: tighter(own.perHour, parent.perHour),
    perDay: tighter(own.perDay, parent.perDay),
    modes,
    autoMerge,
  }
}

/**
 * A sub-goal's branch: its parent's goal branch, a hyphen, and the sub-goal's id. Derived
 * rather than chosen, because git cannot hold both `a` and `a/b` as branches, and a name
 * built from a unique id cannot collide with another sub-goal's.
 */
export const subgoalBranch = (parentBranch: string, id: GoalId): string => `${parentBranch}-${id}`

/** A sub-goal's spec, from its parent's plan entry: no file, no limits of its own yet. */
export const subgoalSpec = (planned: PlannedSubgoal, branch: string | undefined): GoalSpec => ({
  title: planned.title,
  line: planned.line,
  finished: planned.finished,
  limits: {},
  ...(branch === undefined ? {} : { branch }),
})

/**
 * Where a sub-goal's log leaves it, to its parent: the wake it stands at — done, dropped,
 * or `stuck` on a failed composer turn — what goes with it, and the line of its log at
 * which it reached that, 1-based. `outcomeSince`'s rule: leaving the outcome and reaching
 * it again moves the line, which is what makes a second failure a second wake.
 */
export const subgoalOutcome = (
  id: GoalId,
  history: readonly GoalEvent[],
): {
  readonly kind: SubgoalWakeKind | undefined
  readonly said: string | undefined
  readonly since: number
} => {
  const [first, ...rest] = history
  if (first?._tag !== "GoalStarted" && first?._tag !== "GoalAsked") {
    return { kind: undefined, said: undefined, since: 0 }
  }
  let goal = fresh(id, first)
  let kind: SubgoalWakeKind | undefined
  let since = 0
  for (const [i, event] of rest.entries()) {
    goal = applyGoalEvent(goal, event)
    const now = subgoalWakeOf(goal.state)
    if (now !== kind) since = i + 2
    kind = now
  }
  const { state } = goal
  const said =
    state._tag === "Done"
      ? goal.done
      : state._tag === "Dropped" || state._tag === "Failed"
        ? state.reason
        : undefined
  return { kind, said, since }
}

const subgoalWakeOf = (state: GoalState): SubgoalWakeKind | undefined => {
  switch (state._tag) {
    case "Done":
      return "done"
    case "Dropped":
      return "dropped"
    case "Failed":
      return "stuck"
    case "AtGate":
    case "Composing":
    case "Watching":
      return undefined
  }
}

/**
 * What a trak's state is to its goal: one of the four ways it wakes the composer, `ended`
 * for an archive a person made, or `undefined` for everything else — a trak waiting on its
 * person's approval or answer included, which is that person's and never the composer's.
 *
 * `committed` is whether anything was ever committed on the trak's branch, and it decides
 * one case: a `Closed` trak that committed nothing is `landed`, whoever archived it. Its
 * work was its documents, and there was never a branch to merge — so the archive is the
 * trak finishing rather than a person putting it down. It changes which wake a `Closed`
 * is and never whether there is one.
 *
 * `autoMergeStopped` is whether the engine gave up merging the trak's pull request on its
 * own. A `Finished` trak it gave up on is `stuck`: nothing more happens to it unless
 * somebody acts, and the composer is the first who may.
 */
export const outcomeOf = (
  state: TrakState,
  committed: boolean,
  autoMergeStopped = false,
): WakeKind | "ended" | undefined => {
  if (state._tag === "Finished" && autoMergeStopped) return "stuck"
  if (state._tag === "Merged") return "landed"
  if (state._tag === "Failed") return "failed"
  if (state._tag === "Closed") return committed ? "ended" : "landed"
  if (state._tag === "Abandoned") return "ended"
  if (state._tag === "AwaitingHuman" && state.kind === "stuck") return "stuck"
  if (state._tag === "AwaitingHuman" && state.kind === "checks") return "checks"
  return undefined
}

/**
 * Whether a trak of this goal hands off to it: only while the goal is going. A goal done or
 * dropped leaves its traks ordinary, so their hand-offs open traks as any other trak's do —
 * its watcher would file nothing for them. `undefined` is a goal with no log, read the same.
 */
export const handsOffToGoal = (goal: Goal | undefined): boolean =>
  goal !== undefined && !goalAtRest(goal.state)

/** One compose entry's hand-off that went to the goal: the entry, and what it handed off. */
export interface GoalHandOff {
  readonly step: number
  readonly handOff: readonly [string, ...string[]]
}

/**
 * Every hand-off of a goal's trak whose gate went past, oldest entry first — what the
 * goal's watcher files as `TrakHandedOff`, once per entry.
 *
 * A slot whose `HandedOff` named no traks, beside the descriptions the run gave: the
 * runtime names none on a goal's trak, so this is the hand-off the goal owes a place.
 */
export const goalHandOffs = (t: Trak): readonly GoalHandOff[] =>
  [...t.slots]
    .toSorted(([a], [b]) => a - b)
    .flatMap(([step, slot]) => {
      const [first, ...rest] = slot.handOffs
      return slot.handedOff?.ids.length === 0 && first !== undefined
        ? [{ step, handOff: [first, ...rest] }]
        : []
    })

/** The goal a trak's finish proposed and nothing has opened: the entry, its words, the documents. */
export interface OwedGoal {
  readonly step: number
  readonly asked: string
  readonly documents: readonly FiledDocument[]
}

/**
 * The call a proposed goal's start is matched on — `GoalAsked.call` — so a start retried
 * after a restart finds the goal the first one opened.
 */
export const proposalCall = (step: number): string => `finish-${String(step)}`

/**
 * Every goal this trak's finish proposed that has not started, oldest entry first — what
 * the goal's watcher starts, once each, and records as `GoalOpened`.
 *
 * **Only once the trak has finished**: `Finished`, or closed or merged from there. A trak
 * still at its plan gate has a proposal nobody has approved, and one abandoned there
 * never will. A child or a goal's trak owes none — its proposal is refused at decode, and
 * this says so again rather than trusting a log written before that refusal.
 */
export const goalOwed = (t: Trak): readonly OwedGoal[] => {
  const finished =
    t.state._tag === "Finished" || t.state._tag === "Closed" || t.state._tag === "Merged"
  if (!finished || t.parent !== undefined || t.goal !== undefined) return []
  return [...t.slots]
    .toSorted(([a], [b]) => a - b)
    .flatMap(([step, slot]) =>
      slot.goal === undefined || slot.goalOpened !== undefined
        ? []
        : [
            {
              step,
              // `GoalAsked.asked` is trimmed; the composer's markdown may end in a newline.
              asked: slot.goal.trim(),
              documents: visibleArtifacts(t, undefined).map(([name, document]) => ({
                name,
                document,
              })),
            },
          ],
    )
}

/**
 * Where a trak's log leaves it, to its goal: the outcome it stands at, and the line of its
 * log at which it reached that outcome — 1-based, as a feed frame's `seq` counts. A
 * re-park at the same gate keeps the line; leaving the outcome and reaching it again
 * moves it, which is what makes a second failure after a fix a second wake.
 */
export const outcomeSince = (
  id: TrakId,
  history: readonly Event[],
): { readonly outcome: WakeKind | "ended" | undefined; readonly since: number } => {
  let trak = emptyTrak(id)
  let outcome: WakeKind | "ended" | undefined
  let since = 0
  // The catch-all commit's `sha` is absent exactly where nothing was ever kept on the
  // branch, and a step's commit carries the tip — so any sha at all is the answer.
  let committed = false
  for (const [i, event] of history.entries()) {
    trak = applyEvent(trak, event).trak
    committed ||= event._tag === "WorkCommitted" && event.sha !== undefined
    const now = outcomeOf(trak.state, committed, trak.autoMerge?.stopped !== undefined)
    if (now !== outcome) since = i + 1
    outcome = now
  }
  return { outcome, since }
}
