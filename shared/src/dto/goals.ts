// Goals: their state, their log, what a person sends them, and the engine's MCP tool calls. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"
import { AttachmentDto, AttachmentIdsDto } from "./attachments.js"
import { RunModeDto } from "./common.js"
import { QuestionDto, UsageDto } from "./log.js"
import { TranscriptEntryDto, WaitingMessageDto } from "./transcript.js"
import { OwnershipDto, TrakSummaryDto } from "./trak.js"

// ============================================================================
// Goals — a direction that outlasts any one trak, and the traks it opens
// ============================================================================

/** One trak a goal's composer means to open. */
export const PlannedTrakDto = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  mode: RunModeDto,
})
export type PlannedTrakDto = Schema.Schema.Type<typeof PlannedTrakDto>

/** One sub-goal a goal's composer means to open: a goal of its own, put in the plan with `replan`. */
export const PlannedSubgoalDto = Schema.Struct({
  title: Schema.String,
  line: Schema.String,
  finished: Schema.String,
})
export type PlannedSubgoalDto = Schema.Schema.Type<typeof PlannedSubgoalDto>

/**
 * Whether a goal's traks merge their own pull requests: `never`, or `always` once its
 * checks pass. Absent on a goal's limits is the composer deciding per trak.
 */
export const GoalAutoMergeDto = Schema.Literal("never", "always")
export type GoalAutoMergeDto = Schema.Schema.Type<typeof GoalAutoMergeDto>

/**
 * The goal's bounds as it runs against them now — its file's, or a person's change since;
 * each absent where none is set.
 */
export const GoalLimitsDto = Schema.Struct({
  parallel: Schema.optional(Schema.Number),
  perHour: Schema.optional(Schema.Number),
  perDay: Schema.optional(Schema.Number),
  modes: Schema.optional(Schema.Array(RunModeDto)),
  autoMerge: Schema.optional(GoalAutoMergeDto),
})
export type GoalLimitsDto = Schema.Schema.Type<typeof GoalLimitsDto>

const GoalLimit = Schema.Int.pipe(Schema.positive())

/**
 * The limits a person sets on a goal, whole: on Approve at the drafted file, and on a
 * running goal's settings route. Each absent means no limit, and `modes` absent allows
 * all three — a key left out is cleared, never kept.
 */
export const GoalSettingsDto = Schema.Struct({
  parallel: Schema.optional(GoalLimit),
  perHour: Schema.optional(GoalLimit),
  perDay: Schema.optional(GoalLimit),
  modes: Schema.optional(Schema.NonEmptyArray(RunModeDto)),
  autoMerge: Schema.optional(GoalAutoMergeDto),
})
export type GoalSettingsDto = Schema.Schema.Type<typeof GoalSettingsDto>

/** Why a trak of the goal woke its composer. Approval and question gates never do. */
export const WakeKindDto = Schema.Literal("landed", "failed", "stuck", "checks")

/** Why a sub-goal woke its parent's composer: confirmed done, dropped, or its composer failed. */
export const SubgoalWakeKindDto = Schema.Literal("done", "dropped", "stuck")

/** Every press on a goal but `Chat`, which the request and the log carry differently. */
const goalPresses = [
  /**
   * `limits` is what the person set at the drafted file; read at that gate alone. `branch`
   * is the goal branch they left there, read only beside `limits`: absent with it is cleared.
   */
  Schema.TaggedStruct("Approve", {
    limits: Schema.optional(GoalSettingsDto),
    branch: Schema.optional(Schema.NonEmptyTrimmedString),
  }),
  /** One answer per question of the escalation, by position; `note` belongs to none of them. */
  Schema.TaggedStruct("Answer", {
    answers: Schema.NonEmptyArray(Schema.String),
    note: Schema.optional(Schema.NonEmptyTrimmedString),
  }),
  Schema.TaggedStruct("Confirm", {}),
  /** The person's report on work asked of them by hand: done, or not, and what happened. */
  Schema.TaggedStruct("Reported", {
    done: Schema.Boolean,
    note: Schema.optional(Schema.NonEmptyTrimmedString),
  }),
  Schema.TaggedStruct("Retry", {}),
  /** Retry in a new session, which opens with the whole goal brief rather than resuming. */
  Schema.TaggedStruct("NewSession", {}),
] as const

/**
 * What a person may press on a goal; which are offered is `GoalDto.offers`. A chat's
 * `attachments` are upload ids from `POST /api/attachments`.
 */
export const GoalActionDto = Schema.Union(
  ...goalPresses,
  Schema.TaggedStruct("Chat", {
    message: Schema.NonEmptyTrimmedString,
    attachments: AttachmentIdsDto,
  }),
)
export type GoalActionDto = Schema.Schema.Type<typeof GoalActionDto>

/**
 * Where a goal stands. `Composing` is a composer turn owed or running — `running` on the
 * goal says which. A goal has no run mode: each gate always waits for a person.
 */
export const GoalComposingStateDto = Schema.TaggedStruct("Composing", {})
export const GoalAtGateStateDto = Schema.TaggedStruct("AtGate", {
  gate: Schema.Literal("file", "plan", "escalation", "action", "done"),
})
export const GoalWatchingStateDto = Schema.TaggedStruct("Watching", {})
export const GoalFailedStateDto = Schema.TaggedStruct("Failed", { reason: Schema.String })
export const GoalDoneStateDto = Schema.TaggedStruct("Done", {})
export const GoalDroppedStateDto = Schema.TaggedStruct("Dropped", { reason: Schema.String })
export const GoalStateDto = Schema.Union(
  GoalComposingStateDto,
  GoalAtGateStateDto,
  GoalWatchingStateDto,
  GoalFailedStateDto,
  GoalDoneStateDto,
  GoalDroppedStateDto,
)
export type GoalStateDto = Schema.Schema.Type<typeof GoalStateDto>

/** A trak the goal opened, as the goal counts it. A row draws the trak's own summary. */
export const GoalTrakDto = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  mode: RunModeDto,
  status: Schema.Literal("live", "landed", "dropped"),
})
export type GoalTrakDto = Schema.Schema.Type<typeof GoalTrakDto>

/**
 * A sub-goal the goal opened, as the goal counts it. Where it stands now is its own
 * `GoalDto`, which carries `parent`.
 */
export const GoalSubgoalDto = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.Literal("live", "done", "dropped"),
})
export type GoalSubgoalDto = Schema.Schema.Type<typeof GoalSubgoalDto>

/** A goal file as the composer drafted it, waiting on the person at the `file` gate. */
export const GoalDraftDto = Schema.Struct({
  file: Schema.String,
  title: Schema.String,
  line: Schema.String,
  finished: Schema.String,
  limits: GoalLimitsDto,
  /** The goal branch the composer proposed, where it proposed one. */
  branch: Schema.optional(Schema.String),
})
export type GoalDraftDto = Schema.Schema.Type<typeof GoalDraftDto>

/** Work only a person can do: what a row names it by, the steps in order, and what it is for. */
export const GoalActionRequestDto = Schema.Struct({
  trak: Schema.optional(Schema.String),
  title: Schema.String,
  steps: Schema.Array(Schema.String),
  why: Schema.String,
})
export type GoalActionRequestDto = Schema.Schema.Type<typeof GoalActionRequestDto>

/**
 * One goal, whole: the list's row and the head of its own screen.
 *
 * `file`, `line` and `finished` are its approved file's, absent until a goal started from
 * a sentence has one; `title` is the draft's while one waits, and absent before that.
 * `limits` is empty until there is a file. A sub-goal has no file: `line` and `finished`
 * come from its parent's plan, and `parent` is present.
 */
export const GoalDto = Schema.Struct({
  id: Schema.String,
  file: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  line: Schema.optional(Schema.String),
  finished: Schema.optional(Schema.String),
  limits: GoalLimitsDto,
  /** The goal branch its traks land on, where its file names one. */
  branch: Schema.optional(Schema.String),
  /** The sentence a goal was started from, where it was. */
  asked: Schema.optional(Schema.String),
  /** The trak whose agent opened the goal, where one did rather than a person. */
  from: Schema.optional(Schema.String),
  /**
   * The goal whose composer opened this one as a sub-goal, where one did; `branch` is its
   * goal branch, which this one's merges into at Confirm done, where it has one.
   */
  parent: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      branch: Schema.optional(Schema.String),
    }),
  ),
  /** The drafted file, while the goal has none approved. */
  draft: Schema.optional(GoalDraftDto),
  state: GoalStateDto,
  paused: Schema.Boolean,
  /** A composer turn is running now. */
  running: Schema.Boolean,
  offers: Schema.Array(
    Schema.Literal("Approve", "Answer", "Reported", "Confirm", "Chat", "Retry", "NewSession"),
  ),
  plan: Schema.Array(PlannedTrakDto),
  /** The sub-goals the plan holds beside its traks, opened or not. */
  subgoalPlan: Schema.Array(PlannedSubgoalDto),
  traks: Schema.Array(GoalTrakDto),
  /** The sub-goals it opened, oldest first. */
  subgoals: Schema.Array(GoalSubgoalDto),
  /** Progress, traks landed of planned: planned is every landed trak plus each plan entry not yet landed. */
  landed: Schema.Number,
  planned: Schema.Number,
  /** The questions being asked, while the goal stands at its escalation gate. */
  escalation: Schema.optional(
    Schema.Struct({
      trak: Schema.optional(Schema.String),
      questions: Schema.Array(QuestionDto),
    }),
  ),
  /** The work asked of the person by hand, while the goal stands at its action gate. */
  action: Schema.optional(GoalActionRequestDto),
  /** The composer's account of the finished goal, while done is proposed. */
  done: Schema.optional(Schema.String),
  /** What the person wrote that the composer has not read yet, oldest first. */
  messages: Schema.Array(WaitingMessageDto),
  startedAt: Schema.optional(Schema.Number),
  /** When it came to rest — confirmed done, or dropped. */
  endedAt: Schema.optional(Schema.Number),
  /** At rest and taken off the traks list; reached only by its address after that. */
  dismissed: Schema.Boolean,
  /** Present only where the viewer is not the owner — `OwnershipDto`. */
  ownership: Schema.optional(OwnershipDto),
})
export type GoalDto = Schema.Schema.Type<typeof GoalDto>

/**
 * One line of a goal's log. The tool events carry `call`, the id the CLI gave the tool
 * call — what a transcript's `Tool` line is joined to, to draw that call's view.
 */
export const GoalStartedDto = Schema.TaggedStruct("GoalStarted", {
  at: Schema.optional(Schema.Number),
  /** The goal that opened this one as a sub-goal, where one did. */
  parent: Schema.optional(Schema.String),
})
export const GoalAskedDto = Schema.TaggedStruct("GoalAsked", {
  at: Schema.optional(Schema.Number),
  asked: Schema.String,
  /** The files the person sent with the sentence. */
  attachments: Schema.optional(Schema.Array(AttachmentDto)),
})
export const GoalDraftedDto = Schema.TaggedStruct("GoalDrafted", {
  at: Schema.optional(Schema.Number),
  call: Schema.String,
  draft: GoalDraftDto,
})
export const GoalDismissedDto = Schema.TaggedStruct("GoalDismissed", {
  at: Schema.optional(Schema.Number),
})
export const GoalTurnEndedDto = Schema.TaggedStruct("GoalTurnEnded", {
  at: Schema.optional(Schema.Number),
  usage: Schema.optional(UsageDto),
})
export const GoalTurnFailedDto = Schema.TaggedStruct("GoalTurnFailed", {
  at: Schema.optional(Schema.Number),
  reason: Schema.String,
  usage: Schema.optional(UsageDto),
})
/** A person stopped the running composer turn. */
export const GoalTurnStoppedDto = Schema.TaggedStruct("GoalTurnStopped", {
  at: Schema.optional(Schema.Number),
})
export const GoalPlanProposedDto = Schema.TaggedStruct("PlanProposed", {
  at: Schema.optional(Schema.Number),
  call: Schema.String,
  traks: Schema.Array(PlannedTrakDto),
  note: Schema.optional(Schema.String),
  subgoals: Schema.optional(Schema.Array(PlannedSubgoalDto)),
})
export const GoalReplannedDto = Schema.TaggedStruct("Replanned", {
  at: Schema.optional(Schema.Number),
  call: Schema.String,
  traks: Schema.Array(PlannedTrakDto),
  why: Schema.String,
  subgoals: Schema.optional(Schema.Array(PlannedSubgoalDto)),
})
export const GoalTrakOpenedDto = Schema.TaggedStruct("TrakOpened", {
  at: Schema.optional(Schema.Number),
  call: Schema.String,
  trak: Schema.String,
  title: Schema.String,
  mode: RunModeDto,
})
/** The composer opened a planned sub-goal; `goal` is the sub-goal's id. */
export const GoalSubgoalOpenedDto = Schema.TaggedStruct("SubgoalOpened", {
  at: Schema.optional(Schema.Number),
  call: Schema.String,
  goal: Schema.String,
  title: Schema.String,
})
export const GoalTrakMessagedDto = Schema.TaggedStruct("TrakMessaged", {
  at: Schema.optional(Schema.Number),
  call: Schema.String,
  trak: Schema.String,
  message: Schema.String,
})
export const GoalTrakRecomposedDto = Schema.TaggedStruct("TrakRecomposed", {
  at: Schema.optional(Schema.Number),
  call: Schema.String,
  trak: Schema.String,
  why: Schema.String,
})
export const GoalTrakDroppedDto = Schema.TaggedStruct("TrakDropped", {
  at: Schema.optional(Schema.Number),
  call: Schema.optional(Schema.String),
  trak: Schema.String,
  reason: Schema.String,
})
export const GoalEscalatedDto = Schema.TaggedStruct("Escalated", {
  at: Schema.optional(Schema.Number),
  call: Schema.String,
  trak: Schema.optional(Schema.String),
  questions: Schema.Array(QuestionDto),
})
export const GoalActionRequestedDto = Schema.TaggedStruct("ActionRequested", {
  at: Schema.optional(Schema.Number),
  call: Schema.String,
  ...GoalActionRequestDto.fields,
})
export const GoalDoneProposedDto = Schema.TaggedStruct("DoneProposed", {
  at: Schema.optional(Schema.Number),
  call: Schema.String,
  summary: Schema.String,
})
export const GoalTrakWokeDto = Schema.TaggedStruct("TrakWoke", {
  at: Schema.optional(Schema.Number),
  trak: Schema.String,
  kind: WakeKindDto,
})
/** A sub-goal was done, dropped or stuck; `said` is its summary, drop reason or failure. */
export const GoalSubgoalWokeDto = Schema.TaggedStruct("SubgoalWoke", {
  at: Schema.optional(Schema.Number),
  goal: Schema.String,
  kind: SubgoalWakeKindDto,
  said: Schema.optional(Schema.String),
})
/** A trak of the goal handed work off; the descriptions are the composer's to place. */
export const GoalTrakHandedOffDto = Schema.TaggedStruct("TrakHandedOff", {
  at: Schema.optional(Schema.Number),
  trak: Schema.String,
  handOff: Schema.Array(Schema.String),
})
/** A press as the log keeps it: a chat carries the files it placed, never upload ids. */
export const GoalActedDto = Schema.TaggedStruct("GoalActed", {
  at: Schema.optional(Schema.Number),
  action: Schema.Union(
    ...goalPresses,
    Schema.TaggedStruct("Chat", {
      message: Schema.String,
      attachments: Schema.optional(Schema.Array(AttachmentDto)),
    }),
  ),
})
/** `subgoals` is the live sub-goals the pause paused, and the resume resumed. */
export const GoalPausedDto = Schema.TaggedStruct("GoalPaused", {
  at: Schema.optional(Schema.Number),
  held: Schema.Array(Schema.String),
  subgoals: Schema.optional(Schema.Array(Schema.String)),
})
export const GoalResumedDto = Schema.TaggedStruct("GoalResumed", {
  at: Schema.optional(Schema.Number),
  released: Schema.Array(Schema.String),
  subgoals: Schema.optional(Schema.Array(Schema.String)),
})
export const GoalDroppedDto = Schema.TaggedStruct("GoalDropped", {
  at: Schema.optional(Schema.Number),
  reason: Schema.String,
})
/** A person changed the running goal's limits, modes or auto-merge; `limits` is the whole. */
export const GoalSettingsChangedDto = Schema.TaggedStruct("GoalSettingsChanged", {
  at: Schema.optional(Schema.Number),
  limits: GoalLimitsDto,
})
export const GoalEventDto = Schema.Union(
  GoalStartedDto,
  GoalAskedDto,
  GoalDraftedDto,
  GoalDismissedDto,
  GoalTurnEndedDto,
  GoalTurnFailedDto,
  GoalTurnStoppedDto,
  GoalPlanProposedDto,
  GoalReplannedDto,
  GoalTrakOpenedDto,
  GoalSubgoalOpenedDto,
  GoalTrakMessagedDto,
  GoalTrakRecomposedDto,
  GoalTrakDroppedDto,
  GoalEscalatedDto,
  GoalActionRequestedDto,
  GoalDoneProposedDto,
  GoalTrakWokeDto,
  GoalSubgoalWokeDto,
  GoalTrakHandedOffDto,
  GoalActedDto,
  GoalPausedDto,
  GoalResumedDto,
  GoalDroppedDto,
  GoalSettingsChangedDto,
)
export type GoalEventDto = Schema.Schema.Type<typeof GoalEventDto>

/** `GET /api/goals`: every goal, newest first. At most one is not at rest. */
export const GoalListDto = Schema.Struct({ goals: Schema.Array(GoalDto) })
export type GoalListDto = Schema.Schema.Type<typeof GoalListDto>

/**
 * `GET /api/goals/:id`: the goal, its log, and its composer's transcript. `settled` is a
 * row for each trak of the goal that landed or was dropped, read off its own log — the
 * list sends none for one put away, and its page still opens. `subgoals` is each sub-goal
 * it opened, off its own log, oldest first.
 */
export const GoalDetailDto = Schema.Struct({
  goal: GoalDto,
  log: Schema.Array(GoalEventDto),
  settled: Schema.Array(TrakSummaryDto),
  subgoals: Schema.Array(GoalDto),
  transcript: Schema.Array(TranscriptEntryDto),
})
export type GoalDetailDto = Schema.Schema.Type<typeof GoalDetailDto>

/**
 * `POST /api/goals`: start a goal from a person's sentence — `modes` the run modes its
 * traks may open on — whose spec the composer drafts for them to approve.
 */
export const StartGoalRequestDto = Schema.Struct({
  asked: Schema.NonEmptyTrimmedString,
  modes: Schema.NonEmptyArray(RunModeDto),
  /** Upload ids from `POST /api/attachments`, placed where the composer runs. */
  attachments: AttachmentIdsDto,
})
export type StartGoalRequestDto = Schema.Schema.Type<typeof StartGoalRequestDto>

/** `POST /api/goals/:id/drop`. */
export const DropGoalRequestDto = Schema.Struct({ reason: Schema.NonEmptyTrimmedString })
export type DropGoalRequestDto = Schema.Schema.Type<typeof DropGoalRequestDto>

/**
 * One call on the engine's MCP tools, as `orkestra goal-tools` or `orkestra trak-tools`
 * forwards it: the CLI's id for the call where it gave one, and the arguments as the
 * model wrote them.
 */
export const McpToolCallDto = Schema.Struct({
  call: Schema.optional(Schema.String),
  arguments: Schema.Unknown,
})
export type McpToolCallDto = Schema.Schema.Type<typeof McpToolCallDto>

/** The tool's answer, as the model reads it: `isError` with the reason for a refused call. */
export const McpToolResultDto = Schema.Struct({ text: Schema.String, isError: Schema.Boolean })
export type McpToolResultDto = Schema.Schema.Type<typeof McpToolResultDto>

/** A server's tools as MCP lists them: name, description and input schema. */
export const McpToolListDto = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({ name: Schema.String, description: Schema.String, inputSchema: Schema.Unknown }),
  ),
})
export type McpToolListDto = Schema.Schema.Type<typeof McpToolListDto>
