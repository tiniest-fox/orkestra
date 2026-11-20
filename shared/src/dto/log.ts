// The log format: an agent's outputs, a person's actions, the worktree and every `Event`. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"
import { AttachmentDto } from "./attachments.js"
import { RunModeDto } from "./common.js"

// ============================================================================
// Output unions — type-discriminated, matching the engine's agent boundary
// (`type`, not `_tag`, because an agent writes these by hand)
// ============================================================================

export const QuestionOptionDto = Schema.Struct({
  label: Schema.String,
  description: Schema.optional(Schema.String),
  /** The one the asking agent would pick. Absent means not recommended, as the engine reads it. */
  recommended: Schema.optional(Schema.Boolean),
})
export type QuestionOptionDto = Schema.Schema.Type<typeof QuestionOptionDto>

export const QuestionDto = Schema.Struct({
  question: Schema.String,
  context: Schema.optional(Schema.String),
  options: Schema.Array(QuestionOptionDto),
})
export type QuestionDto = Schema.Schema.Type<typeof QuestionDto>

export const QuestionsDto = Schema.Struct({
  type: Schema.tag("questions"),
  questions: Schema.Array(QuestionDto),
})
export type QuestionsDto = Schema.Schema.Type<typeof QuestionsDto>

export const FailedDto = Schema.Struct({
  type: Schema.tag("failed"),
  error: Schema.String,
})
export type FailedDto = Schema.Schema.Type<typeof FailedDto>

/**
 * The composer's alone: the work this trak was asked for is done, so there is nothing
 * left to plan. `FailedDto`'s opposite — that one ends a trak in front of a person, this
 * one brings it to rest holding its branch.
 */
export const FinishedDto = Schema.Struct({
  type: Schema.tag("finished"),
  reason: Schema.String,
  /** A child's alone: work it found that belongs to none of its split, for the parent. */
  handUp: Schema.optional(Schema.String),
  /**
   * A trak with no parent's alone: work that belongs on the default branch, one
   * description per trak it opens. See `ProposalDto.handOff`, which carries the same
   * thing on the other answer — a finish carrying one takes the plan gate as a plan does.
   */
  handOff: Schema.optional(Schema.Array(Schema.String)),
  /**
   * A top-level trak's alone, outside any goal: a goal this trak proposes, in markdown,
   * which starts once the trak has finished. It takes the plan gate as a hand-off does.
   */
  goal: Schema.optional(Schema.String),
})
export type FinishedDto = Schema.Schema.Type<typeof FinishedDto>

export const MessageDto = Schema.Struct({
  type: Schema.tag("message"),
  text: Schema.String,
})
export type MessageDto = Schema.Schema.Type<typeof MessageDto>

/**
 * One decision as an agent wrote it. `source` marks the ones nobody agreed to, and
 * `kind` says which of the four it is.
 *
 * Only `unplanned_work` sends the plan back to the composer; the other three are
 * recorded and nothing else happens. Optional, because the engine's own field is —
 * an entry filed before the kinds existed carries none.
 *
 * `supersedes` is what the entry replaces, and is present only when it replaces
 * something: a document key, which the engine annotates by writing the entry's text
 * above that document's first section rather than editing it, or a requirement id
 * as `RecordedDto.id` gives one, which the entry folds out of every list.
 */
export const DecidedDto = Schema.Struct({
  text: Schema.String,
  source: Schema.Literal("stated", "assumed"),
  kind: Schema.optional(
    Schema.Literal("out_of_scope", "unplanned_work", "constraint", "ruled_out"),
  ),
  supersedes: Schema.optional(Schema.NonEmptyArray(Schema.String)),
})
export type DecidedDto = Schema.Schema.Type<typeof DecidedDto>

/**
 * The same, plus the stage that filed it and the id every later entry names it by —
 * both derived by the engine, never written by an agent, which is why it is a
 * second shape rather than an optional field. `id` is `at` plus the entry's ordinal
 * among that stage's, `3-scope.2`.
 *
 * **No `kind`**, and the fields are named rather than spread to say so: the trak's
 * accumulated list carries none, because the kind is spent the moment it routes.
 * `supersedes` stays, because it is read on every turn — and an entry whose id
 * another names is one the engine's own lists leave out.
 */
export const RecordedDto = Schema.Struct({
  text: DecidedDto.fields.text,
  source: DecidedDto.fields.source,
  at: Schema.String,
  id: Schema.String,
  supersedes: DecidedDto.fields.supersedes,
})
export type RecordedDto = Schema.Schema.Type<typeof RecordedDto>

/** One complaint against a document already filed. `at` is that document's key. */
export const CorrectionDto = Schema.Struct({
  at: Schema.String,
  text: Schema.String,
})
export type CorrectionDto = Schema.Schema.Type<typeof CorrectionDto>

export const ArtifactDto = Schema.Struct({
  type: Schema.tag("artifact"),
  sections: Schema.Record({ key: Schema.String, value: Schema.String }),
  /**
   * What this step settled about the work, and half the reason approving is not
   * simply *run the next step*: an artifact carrying these goes to the composer, and
   * a person approves the plan it hands back.
   *
   * **Normalized on the way out**, so nothing downstream carries the engine's
   * backward-compatible pair: an envelope that wrote the old `decisions` key arrives
   * here as `requirements` like any other. See `requirementsIn`.
   */
  requirements: Schema.optional(Schema.Array(DecidedDto)),
  /** Documents this step says are not good enough to work from. The other half. */
  corrections: Schema.optional(Schema.Array(CorrectionDto)),
  /**
   * What `requirements` replaced on envelopes filed before the two channels merged.
   * Passed through rather than folded in, because it never landed on the intent and
   * a card that showed it as a requirement would say a stored trak decided something
   * it did not.
   */
  uncovered_work: Schema.optional(Schema.NonEmptyArray(Schema.String)),
})
export type ArtifactDto = Schema.Schema.Type<typeof ArtifactDto>

/**
 * A step saying it could not do the work.
 *
 * Four named fields and no `sections`, mirroring the engine: this is the shape the
 * agent was held to, not the shape it was stored in. Filed as an ordinary document —
 * its three fields are its sections — so the engine keeps one under the step's key as
 * well as the log holding this.
 */
export const StuckDto = Schema.Struct({
  type: Schema.tag("stuck"),
  tried: Schema.String,
  happened: Schema.String,
  diagnosis: Schema.String,
  /** What it settled on the way to the wall. Normalized, as on an artifact. */
  requirements: Schema.optional(Schema.Array(DecidedDto)),
})
export type StuckDto = Schema.Schema.Type<typeof StuckDto>

/**
 * A step asking a person to let it run one command the CLI refused. `command` is what
 * a yes quotes back to the step, byte for byte; `reason` is why the step needs it.
 */
export const PermissionDto = Schema.Struct({
  type: Schema.tag("permission"),
  command: Schema.String,
  reason: Schema.String,
})
export type PermissionDto = Schema.Schema.Type<typeof PermissionDto>

/**
 * A document as the engine keeps it — `sections` and nothing else — on the events
 * that hand one down or file one.
 *
 * It carries no `requirements`, and the difference is the point: what a turn
 * settled is a fact about the conversation rather than a property of the
 * document that carried it, so it accumulates onto the trak instead of
 * travelling with the file. Read them from `TrakProjectionDto.decisions`, or off
 * the envelope in the log.
 */
export const DocumentDto = Schema.Struct({
  sections: Schema.Record({ key: Schema.String, value: Schema.String }),
})
export type DocumentDto = Schema.Schema.Type<typeof DocumentDto>

/**
 * One step of one piece of a spawn — what runs it, and what it is told to do.
 *
 * A *step*, not a piece: a piece is a plan, and it arrives as a list of these. The
 * engine's two ways of writing a piece — a list of steps, or the bare pair it used
 * to be — are one shape by the time they reach here, which is the wire doing its
 * job, the way `type` and `conversational` being required below is.
 */
export const ChildDto = Schema.Struct({
  agent: Schema.String,
  instruction: Schema.String,
  /**
   * The model a person picked for this step at the parent's plan gate, and absent for the
   * step nobody picked for — which runs on its agent file's own. Unresolved, unlike
   * `AgentStepDto.model`: the step belongs to a trak that may not exist yet, and its own
   * plan is where its resolved model is drawn.
   */
  model: Schema.optional(Schema.String),
})
export type ChildDto = Schema.Schema.Type<typeof ChildDto>

/**
 * A plan entry: an agent turn, or a spawn.
 *
 * `type` is required here where the engine's is optional, and that is the wire
 * doing its job: absent-means-agent is a decoding rule for logs written before
 * spawn existed, and a client should never have to know it. `conversational` is
 * required for the same reason: a plan rendered without it reads as an ordinary
 * sequence of steps whichever it is.
 */
export const AgentStepDto = Schema.Struct({
  type: Schema.tag("agent"),
  agent: Schema.String,
  instruction: Schema.String,
  /** Whether the artifact is owed on the first turn, or when the talking settles. */
  conversational: Schema.Boolean,
  /**
   * The document whose conversation this step picks up, and **absent wherever it
   * starts a fresh one** — which is most steps.
   *
   * Optional here where `conversational` is required, for the reason `rationale` is:
   * absent-means-false is a decoding rule a client should not have to know, where
   * absent-means-no-conversation-named is the fact itself.
   *
   * Drawn, because nothing in the engine stops a reviewing agent being handed the
   * conversation that wrote what it is judging and clearing its own finding — that
   * rule is prose to the composer. So the person at the plan gate is the only place it
   * can be caught, and a card that hid the field left them nothing to catch it with.
   *
   * The key is the composer's own, and one naming no entry is not an error at either
   * end — the turn simply starts fresh. So the plan gate draws the key bare — nothing
   * has run to resolve it against — and the running trak's marker resolves it against
   * the transcript, which is the record of what the engine actually did with it.
   */
  continues: Schema.optional(Schema.String),
  /**
   * The instant this step waits for, epoch milliseconds, and **absent wherever it
   * starts as soon as the step before it is done** — which is most steps.
   *
   * Resolved, not the composer's spelling: `wait_until` is written as an hour or as a
   * duration, and both count from when the plan carrying the step was proposed, which
   * only the engine holds. A proposal carries it on every step it names. A trak's own
   * plan carries it on the unrun tail only — a ran entry's anchor is a compose turn
   * the trak no longer names, and a number nothing can stand behind is left off.
   */
  waitUntil: Schema.optional(Schema.Number),
  /**
   * The engine condition this step waits on itself, beside any its agent file declares —
   * the composer's `wait_for` — and absent on every step that carries none. The plan
   * gate draws it as a wait of the step's own, which clearing the wait removes.
   */
  waitFor: Schema.optional(Schema.Literal("merged", "deployed")),
  /**
   * The model this step runs on — the pick a person made on New Chat where there was
   * one, and the agent file's `model:` otherwise. **Resolved, for `waitUntil`'s reason**:
   * that fallback is the engine's rule at the spawn site, and a client handed the agent's
   * model beside the entry's would be a second copy of it, free to drift.
   *
   * On a trak's plan entries only. A proposal's steps carry none — nothing has resolved
   * them yet, and the gate draws no model — and a plan entry naming an agent the library
   * cannot find carries none either, which is the same fact the spawn will report.
   */
  model: Schema.optional(Schema.String),
  /**
   * How many tokens `model`'s context holds, as `models.yaml` states it for that model.
   *
   * Beside `model` rather than a map a surface keeps, because a surface may hold no
   * table keyed by model name: a screen drawing how full a step's context is divides
   * by the window the turn's own `UsageDto.contextWindow` reports, by this where it
   * reports none, and by nothing it knows itself. Absent wherever `model` is, and
   * wherever the project's `models.yaml` states no window for the model — with no
   * figure from either side a surface draws no ceiling.
   */
  contextWindow: Schema.optional(Schema.Number),
  /**
   * The reasoning effort the step runs at, resolved beside `model` and off the same
   * entry — the agent file's `effort:` on that file's model, else the model's default in
   * `models.yaml`. **Absent is the ordinary case**: nothing declared one, and the CLI runs
   * at its own default, which the engine cannot know and so does not guess at. Present
   * only where `model` is.
   *
   * A word from the CLI's own vocabulary, carried whole: a client may draw it and may
   * not shorten it or place it on a scale, since it holds no list of levels and no
   * ordering — `minimal` and `medium` are one letter apart, and nothing here says which
   * of `xhigh` and `ultra` is more.
   */
  effort: Schema.optional(Schema.String),
})
/** `children` is one entry per piece, holding that piece's plan in order. */
export const SpawnStepDto = Schema.Struct({
  type: Schema.tag("spawn"),
  instruction: Schema.String,
  children: Schema.Array(Schema.Array(ChildDto)),
})
export const ProposedComposeDto = Schema.Struct({
  type: Schema.tag("compose"),
  instruction: Schema.String,
})
export const StepDto = Schema.Union(AgentStepDto, SpawnStepDto, ProposedComposeDto)
export type StepDto = Schema.Schema.Type<typeof StepDto>

/**
 * Why the composer was asked again — one of exactly five, and absent on the first.
 *
 * `Refused` is the engine declining to start the step at `step`: its agent writes and
 * the branch — this trak's, or its parent's — merged after the plan was accepted.
 *
 * `Raised` is a step that filed its work and sent the plan back with it, carrying
 * both of the channels that do so; at least one of the two lists has something in it.
 * `Conflicted` is the one that comes from git: a merge a person asked for did not go
 * in, and the plan grows a resolution. `paths` is what disagreed; `into` is what the
 * merge was aimed at, and it is absent when the host is on a detached `HEAD`.
 *
 * **`Replanned` may carry the ask it `displaced`** — a recompose pressed mid-turn that
 * landed after the turn ended, on a step that had already sent the plan back. One ask
 * stands and the other rides inside it, so a surface drawing the entry says both were
 * asked. The type is written out because the schema refers to itself: `Schema.suspend`
 * needs the answer before it can be derived.
 */
export type ReconsultWhyDto =
  | {
      readonly _tag: "Raised"
      readonly step: number
      readonly requirements: readonly string[]
      readonly corrections: readonly CorrectionDto[]
    }
  | {
      readonly _tag: "Replanned"
      readonly step: number
      readonly reason: string
      readonly displaced?: ReconsultWhyDto | undefined
    }
  | {
      readonly _tag: "Reentered"
      readonly what: string
      readonly cause?: ReentryCauseDto | undefined
      readonly base?: string | undefined
    }
  | { readonly _tag: "Refused"; readonly step: number; readonly reason: string }
  | {
      readonly _tag: "Conflicted"
      readonly paths: readonly [string, ...string[]]
      readonly into?: string | undefined
    }
export const ReconsultWhyDto: Schema.Schema<ReconsultWhyDto> = Schema.Union(
  Schema.TaggedStruct("Raised", {
    step: Schema.Number,
    requirements: Schema.Array(Schema.String),
    corrections: Schema.Array(CorrectionDto),
  }),
  Schema.TaggedStruct("Replanned", {
    step: Schema.Number,
    reason: Schema.String,
    displaced: Schema.optional(
      Schema.suspend((): Schema.Schema<ReconsultWhyDto> => ReconsultWhyDto),
    ),
  }),
  Schema.TaggedStruct("Reentered", {
    what: Schema.String,
    cause: Schema.optional(Schema.suspend((): Schema.Schema<ReentryCauseDto> => ReentryCauseDto)),
    base: Schema.optional(Schema.String),
  }),
  Schema.TaggedStruct("Refused", { step: Schema.Number, reason: Schema.String }),
  Schema.TaggedStruct("Conflicted", {
    paths: Schema.NonEmptyArray(Schema.String),
    into: Schema.optional(Schema.String),
  }),
)

/**
 * One run of the composer, as an entry in the plan it wrote.
 *
 * **The composer is a step.** It has a position, a session and an outcome like any
 * other entry — and a plan that could not say where its own re-cuts happened was a
 * record with the most interesting thing missing.
 *
 * Exactly one of the two fields is ever present, and which one says where the entry
 * came from: `why` is the engine writing down a run something asked for, `instruction` is
 * the composer scheduling its own next turn as the last entry of a plan that stops
 * short. The first compose of a trak has neither — nothing asked for it, and nobody
 * planned it.
 *
 * **An entry arrives before its run does**, so one with no turns behind it is ordinary
 * rather than a gap: `why` means the turn is owed now, `instruction` means the plan has
 * not reached it yet.
 */
export const ComposeEntryDto = Schema.Struct({
  type: Schema.tag("compose"),
  why: Schema.optional(ReconsultWhyDto),
  instruction: Schema.optional(Schema.String),
})
export type ComposeEntryDto = Schema.Schema.Type<typeof ComposeEntryDto>

/** One plan entry: a compose, an agent turn, or a spawn. */
export const EntryDto = Schema.Union(ComposeEntryDto, AgentStepDto, SpawnStepDto)
export type EntryDto = Schema.Schema.Type<typeof EntryDto>

export const ProposalDto = Schema.Struct({
  type: Schema.tag("proposal"),
  title: Schema.String,
  /**
   * What the composer found that shaped the sequence, and **absent on most
   * plans** — which is the point. It is news, not a justification: a field that
   * were always filled is one a reader skims past, and its absence says the plan
   * was composed from the request alone.
   *
   * Optional here where `conversational` is required, and the difference is real:
   * absent-means-false is a decoding rule a client should not have to know, where
   * absent-means-nothing-to-say is the fact itself.
   */
  rationale: Schema.optional(Schema.String),
  steps: Schema.Array(StepDto),
  /**
   * Work this plan hands off to traks of its own, cut from the repository's default
   * branch and never coming back — each entry one trak, opened as the plan gate goes
   * past. Absent on most plans. **Not a step**: nothing here runs in this checkout, and
   * a surface that drew it inside the numbered list would be drawing a spawn.
   */
  handOff: Schema.optional(Schema.Array(Schema.String)),
})
export type ProposalDto = Schema.Schema.Type<typeof ProposalDto>

/**
 * What the trak holds: what has happened and what is still to come, in one list.
 *
 * A `ProposalDto` is what the composer returned; this is the record. **Nothing in it
 * that has run is ever moved, replaced or renumbered**, so an index is a permanent
 * name — which is what lets `AgentReturned.step` join onto an entry and lets a surface
 * draw the sequence without reconstructing anything.
 */
export const PlanDto = Schema.Struct({
  title: Schema.String,
  rationale: Schema.optional(Schema.String),
  steps: Schema.Array(EntryDto),
})
export type PlanDto = Schema.Schema.Type<typeof PlanDto>

export const ComposerOutputDto = Schema.Union(
  ProposalDto,
  QuestionsDto,
  FailedDto,
  FinishedDto,
  MessageDto,
)
export type ComposerOutputDto = Schema.Schema.Type<typeof ComposerOutputDto>

export const StepOutputDto = Schema.Union(
  ArtifactDto,
  StuckDto,
  QuestionsDto,
  PermissionDto,
  FailedDto,
  MessageDto,
)
export type StepOutputDto = Schema.Schema.Type<typeof StepOutputDto>

// ============================================================================
// HumanAction — _tag-discriminated (engine-internal, not agent-written)
// ============================================================================

export const ApproveActionDto = Schema.TaggedStruct("Approve", {})
export type ApproveActionDto = Schema.Schema.Type<typeof ApproveActionDto>

export const ChatActionDto = Schema.TaggedStruct("Chat", {
  message: Schema.String,
  attachments: Schema.optional(Schema.Array(AttachmentDto)),
})
export type ChatActionDto = Schema.Schema.Type<typeof ChatActionDto>

/**
 * `note` is what a person sent alongside their answers and belongs to none of them,
 * which is what a surface drawing this back has to get right: it is neither the last
 * answer nor an answer to the last question.
 */
export const AnswerQuestionsActionDto = Schema.TaggedStruct("AnswerQuestions", {
  answers: Schema.Array(Schema.String),
  note: Schema.optional(Schema.String),
})
export type AnswerQuestionsActionDto = Schema.Schema.Type<typeof AnswerQuestionsActionDto>

/**
 * The rest of the plan should be something else, and here is why — offered at
 * every step gate, and refused at the plan gate where `Chat` already talks to the
 * composer.
 */
export const ReplanActionDto = Schema.TaggedStruct("Replan", { reason: Schema.String })
export type ReplanActionDto = Schema.Schema.Type<typeof ReplanActionDto>

/**
 * This step is not going to produce anything — offered where it has filed
 * nothing, which is an answers gate, a conversation gate and a stuck gate.
 *
 * `message` is optional here as it is in the domain, and both ends mean the same
 * thing by its absence: skipped, with nothing said about it.
 */
export const SkipActionDto = Schema.TaggedStruct("Skip", {
  message: Schema.optional(Schema.String),
})
export type SkipActionDto = Schema.Schema.Type<typeof SkipActionDto>

/**
 * A person's yes or no to a step's permission request — offered at a permission gate
 * alone. The command is not on it: the engine quotes the one the step named.
 */
export const PermitActionDto = Schema.TaggedStruct("Permit", { granted: Schema.Boolean })
export type PermitActionDto = Schema.Schema.Type<typeof PermitActionDto>

export const HumanActionDto = Schema.Union(
  ApproveActionDto,
  ChatActionDto,
  AnswerQuestionsActionDto,
  ReplanActionDto,
  SkipActionDto,
  PermitActionDto,
)
export type HumanActionDto = Schema.Schema.Type<typeof HumanActionDto>

// ============================================================================
// Worktree — branded strings → plain strings on the wire
// ============================================================================

export const WorktreeDto = Schema.Struct({
  path: Schema.String,
  branch: Schema.String,
  base: Schema.String,
})
export type WorktreeDto = Schema.Schema.Type<typeof WorktreeDto>

// ============================================================================
// Event — one per variant of the engine's own union, _tag-discriminated
// ============================================================================

/**
 * Why the forge would not merge an auto-merging trak's pull request when the engine sent
 * it back. `Conflict` covers GitHub's `behind` as well; `Checks` names what failed, which
 * may be nothing where the forge gave a verdict without a list.
 */
/** `into` is the local branch a merge with no `origin` would conflict with. */
const ConflictCauseDto = Schema.TaggedStruct("Conflict", { into: Schema.optional(Schema.String) })
const ChecksCauseDto = Schema.TaggedStruct("Checks", { failed: Schema.Array(Schema.String) })
export const ReentryCauseDto = Schema.Union(ConflictCauseDto, ChecksCauseDto)
export type ReentryCauseDto = Schema.Schema.Type<typeof ReentryCauseDto>

/**
 * Why the engine stopped merging a trak on its own: a cause it sent the trak back for, once
 * the sends are spent; `Blocked`, a merge the forge's protection holds with the checks
 * passing; or `Refused`, the forge turning the merge down several times running.
 */
export const StopCauseDto = Schema.Union(
  ConflictCauseDto,
  ChecksCauseDto,
  Schema.TaggedStruct("Blocked", {}),
  Schema.TaggedStruct("Refused", { why: Schema.String }),
)
export type StopCauseDto = Schema.Schema.Type<typeof StopCauseDto>

/**
 * A trak whose pull request the engine merges on its own: how many times it has sent the
 * trak back, out of `limit`, and why it stopped where it has.
 */
export const AutoMergeDto = Schema.Struct({
  sentBack: Schema.Number,
  limit: Schema.Number,
  stopped: Schema.optional(StopCauseDto),
})
export type AutoMergeDto = Schema.Schema.Type<typeof AutoMergeDto>

export const ParentDto = Schema.Struct({
  id: Schema.String,
  step: Schema.Number,
  child: Schema.Number,
  depth: Schema.Number,
})
export type ParentDto = Schema.Schema.Type<typeof ParentDto>

/**
 * When the store wrote this event down — epoch milliseconds.
 *
 * Absent on a log written before `Store.append` stamped one. A time the engine
 * did not measure is not one to invent, so the DTO reports nothing rather than
 * a zero a surface would render as 1970.
 */
const recorded = { at: Schema.optional(Schema.Number) }

/** The four counts of one model call — `UsageDto.context`. */
export const ContextDto = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
})
export type ContextDto = Schema.Schema.Type<typeof ContextDto>

/**
 * What the turn this event ended spent. Absent means unmeasured, which is a
 * different fact from free — and so is a present zero: `codex` publishes token
 * counts and no dollar figure, so every Codex turn reports `costUsd: 0` over real
 * tokens. A surface that draws money reads the token fields to tell the two apart.
 */
export const UsageDto = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
  costUsd: Schema.Number,
  /** By tool name rather than a call count: the name is the finding. */
  tools: Schema.Record({ key: Schema.String, value: Schema.Number }),
  /**
   * What the model's context window held at the turn's last call — the input side,
   * cache included, and that call's output — where the provider reported one per
   * call. **A reading, not a share of the four counts above**: those are the turn's
   * spend added over every call, and a conversation re-read at each call sums to
   * several windows' worth. A surface drawing how full the window is reads this and
   * nothing it could compute from the rest. Absent means no reading, which is a log
   * written before one was kept, or a turn cut short before it was.
   *
   * `outputTokens` here is short by the rest of the last reply where the provider
   * reports the call as it starts, which Claude does; the input side is whole.
   */
  context: Schema.optional(ContextDto),
  /**
   * How many tokens the model's context holds, as the provider itself said for this
   * turn. Wins over `AgentStepDto.contextWindow`, which is the project's own table
   * and the fallback where this is absent.
   */
  contextWindow: Schema.optional(Schema.Number),
})
export type UsageDto = Schema.Schema.Type<typeof UsageDto>

/**
 * One context reading over the window it is measured against — the list ring's whole
 * input.
 *
 * `held` is `UsageDto.context` as the engine keeps it. `window` is resolved the way a
 * meter resolves it, in the engine rather than on the screen: the window the turn's
 * own provider reported, else the project's `models.yaml` figure for the step's model,
 * and absent where neither says — a surface draws no ring against no window, never a
 * guessed one.
 */
export const ReadingDto = Schema.Struct({
  held: ContextDto,
  window: Schema.optional(Schema.Number),
})
export type ReadingDto = Schema.Schema.Type<typeof ReadingDto>

/**
 * The engine reaching for a running turn's sandbox again: `kind` is `unreachable` where the
 * sandbox provider's own API did not answer and `lost` where the sandbox did not, `said`
 * the runner's own words, and `since` when the outage began, in epoch milliseconds.
 */
export const ReattachingDto = Schema.Struct({
  kind: Schema.Literal("unreachable", "lost"),
  said: Schema.String,
  since: Schema.Number,
})
export type ReattachingDto = Schema.Schema.Type<typeof ReattachingDto>

/**
 * What the turn in flight has spent so far — the daemon's memory of a turn that has
 * not ended, off the run record and on no log.
 *
 * `usage` is the provider's own figure as of its last report, `UsageDto` whole so the
 * reading it carries is the one the meter draws. `estimate` is what the readings since
 * that report add up to, each model call once: Claude reports its spend only on the
 * line that ends the turn, so until then this is the only figure that grows, and a
 * surface adds it to `usage`'s four counters. It never reaches the log — its output
 * count is short the way the reading's is — and the next report replaces it. `step`
 * absent is the composer's turn. `usage` and `estimate` are absent together, on a turn
 * that has reported nothing yet and is here only for `reattaching`.
 *
 * `reattaching` is there while the engine cannot reach the turn's sandbox and is trying
 * again, and gone once it answers.
 */
export const TurnInFlightDto = Schema.Struct({
  step: Schema.optional(Schema.Number),
  usage: Schema.optional(UsageDto),
  estimate: Schema.optional(ContextDto),
  reattaching: Schema.optional(ReattachingDto),
})
export type TurnInFlightDto = Schema.Schema.Type<typeof TurnInFlightDto>

/**
 * Spread into every ending that can carry one: the three a turn writes for itself —
 * `ComposerReturned`, `AgentReturned`, `TurnFailed` — and the four a person's press
 * writes by killing it — `Stopped`, `FilingAsked`, a `HumanActed` whose `Replan` landed
 * off a gate, and `Abandoned`. On the four it is what the killed turn had spent at the
 * provider's last report, and absent where nothing was killed or nothing had been
 * reported yet. Onto no other event.
 *
 * **`Restarted` is the one ending that carries none**, because the process that would
 * have measured the turn is the one that died: a surface folding spend reads `usage`
 * where it is and counts that turn as unmeasured rather than as free.
 */
const spent = { usage: Schema.optional(UsageDto) }

/**
 * The exact text the agent wrote this output as, fence delimiters included.
 *
 * What a surface subtracts from the `Text` entry it draws, so the same object is not
 * on screen twice — once as raw JSON in the turn's log and once as the card below it.
 * The engine's extractor reports the slice it took; nothing here re-derives it, which
 * is what keeps one parser rather than two that must agree about fences.
 *
 * Absent when nothing was taken: a turn that answered in prose, one whose JSON did
 * not decode, and every log written before this — where the JSON stays on screen.
 */
const wrote = { envelope: Schema.optional(Schema.String) }

/**
 * `parent`, `plan` and `decisions` are what a *child* trak was born with, and
 * are absent on one a human asked for.
 */
export const TrakCreatedDto = Schema.TaggedStruct("TrakCreated", {
  description: Schema.String,
  parent: Schema.optional(ParentDto),
  plan: Schema.optional(ProposalDto),
  decisions: Schema.optional(Schema.Array(RecordedDto)),
  /** The trak whose composer handed this one off, on a trak born that way. */
  handedOffFrom: Schema.optional(Schema.String),
  /** The files a person sent with the request, on a trak a person opened. */
  attachments: Schema.optional(Schema.Array(AttachmentDto)),
  ...recorded,
})
export const ComposerReturnedDto = Schema.TaggedStruct("ComposerReturned", {
  sessionId: Schema.String,
  output: ComposerOutputDto,
  ...spent,
  ...wrote,
  ...recorded,
})
export const AgentReturnedDto = Schema.TaggedStruct("AgentReturned", {
  step: Schema.Number,
  sessionId: Schema.String,
  output: StepOutputDto,
  ...spent,
  ...wrote,
  ...recorded,
})
/**
 * `sessionId` is present on exactly one press: a `Replan` that landed off a gate, where
 * the route killed the step's running turn to fork the replan in its place. It is the
 * conversation that turn was holding, and its presence is what says a turn was killed —
 * a surface pairing turns to endings counts that press as one and a press at a gate as
 * nothing. `usage` is the killed turn's spend, on `Stopped`'s terms, and absent with it.
 */
export const HumanActedDto = Schema.TaggedStruct("HumanActed", {
  step: Schema.Number,
  action: HumanActionDto,
  sessionId: Schema.optional(Schema.String),
  ...recorded,
  ...spent,
})
/**
 * Where a turn, a check or a process ran. `Local` is the engine's own machine, and a
 * surface draws nothing for it. `Remote` is a sandbox: `runner` is the runner file's own
 * description of itself when the work ran, `sandbox` the provider's id for the sandbox —
 * absent where the runner reports none — and `exec` the runner's id for the command.
 *
 * Optional wherever it is carried: work recorded before the engine kept it has none, and
 * is drawn as `Local` is.
 */
export const LocalPlaceDto = Schema.TaggedStruct("Local", {})
export const RemotePlaceDto = Schema.TaggedStruct("Remote", {
  runner: Schema.String,
  sandbox: Schema.optional(Schema.String),
  exec: Schema.String,
})
export const PlaceDto = Schema.Union(LocalPlaceDto, RemotePlaceDto)
export type PlaceDto = Schema.Schema.Type<typeof PlaceDto>

/**
 * `skipped` names the checks a person's *skip checks* kept from running, and is absent
 * where they ran. The same event as a pass because the step is then accepted as a pass
 * accepts it; a surface says the checks did not run off this field, and `ran` is `[]`
 * beside it.
 */
export const ChecksPassedDto = Schema.TaggedStruct("ChecksPassed", {
  step: Schema.Number,
  ran: Schema.Array(Schema.String),
  skipped: Schema.optional(Schema.Array(Schema.String)),
  /** The checks accepted on an earlier pass over exactly these files, which did not run. */
  reused: Schema.optional(Schema.Array(Schema.String)),
  /** Where each check in `ran` ran, by its name — absent for one with no place recorded. */
  places: Schema.optional(Schema.Record({ key: Schema.String, value: PlaceDto })),
  ...recorded,
})
/**
 * A person ended the check that was running. The run's only ending, as `Stopped` is a
 * turn's: no `CheckFailed` follows, nothing counts against the step, and the trak parks
 * at the `checks` gate. `name` is the check that was running, absent where the press
 * raced the run starting.
 */
export const ChecksCancelledDto = Schema.TaggedStruct("ChecksCancelled", {
  step: Schema.Number,
  name: Schema.optional(Schema.String),
  ...recorded,
})
/**
 * `command` and `exitCode` are optional here where most wire fields are made required,
 * and the difference is that these two are genuinely absent rather than defaulted: a log
 * written before they existed carries neither, and no exit code exists for the failures
 * that are not an exit — a timeout, and a check that could not be spawned at all.
 *
 * They are the only account of a failed run that survives a restart. `TrakDetailDto.check`
 * says more and says it about the run that is live; this says it about the one the trak
 * is parked on.
 */
export const CheckFailedDto = Schema.TaggedStruct("CheckFailed", {
  step: Schema.Number,
  name: Schema.String,
  output: Schema.String,
  command: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  /** Where the check ran. */
  place: Schema.optional(PlaceDto),
  ...recorded,
})
/** One effect that ran, and what it printed. See `EffectsRanDto`. */
const RanEffectDto = Schema.Struct({ name: Schema.String, output: Schema.String })
/**
 * Every effect this step declared ran once its work was on the branch, and this is
 * what each of them printed. `[]` for a step whose agent declares none, which is
 * almost all of them.
 *
 * **The output is here where `ChecksPassedDto` carries none, and it is the difference
 * between the two script kinds.** A check verifies, so *it passed* is the whole fact.
 * An effect acts outside the checkout, where nothing can be re-derived by looking
 * again — so what it printed is the only record that it happened, and a link it
 * printed is the only place that link exists.
 *
 * **Render it with `at` and never on its own.** It is what a script saw when it ran,
 * not a claim about now: nothing here polls, and the world it acted on changes
 * without telling anybody.
 */
export const EffectsRanDto = Schema.TaggedStruct("EffectsRan", {
  step: Schema.Number,
  ran: Schema.Array(RanEffectDto),
  /**
   * The effects a person's skip kept from running — the one that failed and every one
   * after it — and absent where they ran. `ran` is `[]` beside it.
   */
  skipped: Schema.optional(Schema.NonEmptyArray(Schema.String)),
  ...recorded,
})
/**
 * The first effect to exit non-zero, and what it printed.
 *
 * Its own event rather than a flag on the one above, because the two route to
 * opposite places: an effect that could not do it stops the trak at
 * `Failed{project}`, where every other one carries on into the next step.
 */
export const EffectFailedDto = Schema.TaggedStruct("EffectFailed", {
  step: Schema.Number,
  name: Schema.String,
  output: Schema.String,
  ...recorded,
})
/**
 * Every condition the step's agent declares is met, so the step starts. `ran` names
 * them, `[]` for an agent declaring none — which is nearly every step. Written on the
 * way into a step, and again at `Finished` when the daemon's re-ask finds a wait over —
 * which moves the resting trak into the step, as `WaitSkipped` does on a press.
 */
export const ConditionsMetDto = Schema.TaggedStruct("ConditionsMet", {
  step: Schema.Number,
  ran: Schema.Array(Schema.String),
  /**
   * The commit the branch landed as, where a `merged` or `deployed` wait found it had
   * — the pull request's merge commit, or the tip a merge made here left. Absent on an
   * answer about a project's own script. `TrakProjectionDto.landed` is this, folded.
   */
  merged: Schema.optional(Schema.String),
  ...recorded,
})
/**
 * The first condition that is not met, and what it printed. `stopped` is the script
 * exiting with anything but `0` or `1` — the thing it waits for never will be, or it
 * cannot tell — so the daemon stops asking. Written once for the not-yet that rests
 * the trak, once more if the condition gives up, and once where a `deployed` wait
 * first finds the branch merged; every ask in between is the daemon's memory and
 * reaches no log.
 */
export const ConditionsUnmetDto = Schema.TaggedStruct("ConditionsUnmet", {
  step: Schema.Number,
  name: Schema.String,
  output: Schema.String,
  stopped: Schema.Boolean,
  /** As on `ConditionsMetDto`: a `deployed` wait learns the merge before the deploy is live. */
  merged: Schema.optional(Schema.String),
  ...recorded,
})
/**
 * A person started the step a resting trak was held at, without the condition it
 * names being met — the one event besides a met answer that moves a resting trak
 * into its step. `merged` is the commit the branch has landed as, where the `merged`
 * the engine asks once more before the step runs found one; folded onto
 * `TrakProjectionDto.landed` as a condition's answer is.
 */
export const WaitSkippedDto = Schema.TaggedStruct("WaitSkipped", {
  step: Schema.Number,
  name: Schema.String,
  merged: Schema.optional(Schema.String),
  ...recorded,
})
export const WorktreeReadyDto = Schema.TaggedStruct("WorktreeReady", {
  worktree: WorktreeDto,
  ...recorded,
})
/** The project's setup script began in the background, beside the trak's first work. */
export const SetupStartedDto = Schema.TaggedStruct("SetupStarted", { ...recorded })
/** The setup that `SetupStarted` began passed. */
export const SetupPassedDto = Schema.TaggedStruct("SetupPassed", { ...recorded })
/**
 * The setup that `SetupStarted` began failed, and the trak stopped. `reason` names the
 * checkout and holds what the script printed. `sessionId`, `step` and `usage` are
 * `Stopped`'s, for the turn the failure killed — absent where none was running.
 */
export const SetupFailedDto = Schema.TaggedStruct("SetupFailed", {
  reason: Schema.String,
  sessionId: Schema.optional(Schema.String),
  step: Schema.optional(Schema.Number),
  ...recorded,
  ...spent,
})
/**
 * A runner verb that failed, in the parts a person reads: `kind` is the script's word —
 * `limited` for the sandbox provider's rate or quota limit, `unreachable` for a provider
 * whose own API could not be reached, `absent` for a trak whose sandbox the provider
 * removed, `lost` for a sandbox that could not be reached otherwise, `failed` for a
 * request the provider refused or a verb that exited — and `said` the sentence to lead
 * with. `file` and `verb` name the runner file and what it was asked; `stderr` is
 * everything the script printed there, for the details.
 */
export const RunnerFailureDto = Schema.Struct({
  kind: Schema.Literal("limited", "unreachable", "absent", "lost", "failed"),
  said: Schema.String,
  file: Schema.String,
  verb: Schema.String,
  stderr: Schema.String,
})
export type RunnerFailureDto = Schema.Schema.Type<typeof RunnerFailureDto>
export const WorktreeFailedDto = Schema.TaggedStruct("WorktreeFailed", {
  reason: Schema.String,
  runner: Schema.optional(RunnerFailureDto),
  ...recorded,
})
/**
 * Git declined to merge this trak's branch into its destination. `reason` is git's
 * own sentence where git spoke, and it names the files in the way.
 */
export const MergeFailedDto = Schema.TaggedStruct("MergeFailed", {
  reason: Schema.String,
  ...recorded,
})
/**
 * The engine refused to start the step: its agent writes, and the branch merged after
 * the plan holding it was accepted. The composer is asked again from that position.
 */
export const StepRefusedDto = Schema.TaggedStruct("StepRefused", {
  step: Schema.Number,
  reason: Schema.String,
  ...recorded,
})
/**
 * The merge did not go in because the two branches disagree — which is the work
 * disagreeing rather than git failing, and the one git outcome the trak plans
 * against instead of stopping at. `into` is what it was aimed at, absent on a
 * detached `HEAD`.
 */
export const ConflictedDto = Schema.TaggedStruct("Conflicted", {
  paths: Schema.Array(Schema.String),
  into: Schema.optional(Schema.String),
  ...recorded,
})
/**
 * The work is on the branch. The checkout is still there until somebody closes
 * it. `sha` is the branch tip, not necessarily a commit this step produced —
 * absent means nothing has been committed on this branch yet. `step` is absent
 * for the catch-all commit past the last step and at abandonment.
 */
export const WorkCommittedDto = Schema.TaggedStruct("WorkCommitted", {
  sha: Schema.optional(Schema.String),
  step: Schema.optional(Schema.Number),
  ...recorded,
})
/**
 * The checkout, the branch and its copy on the forge are gone — the archive, done.
 * `sha` is the merge commit GitHub reported for the branch's pull request at the
 * press; absent on a plain archive and on every log written before it existed.
 */
export const WorktreeRemovedDto = Schema.TaggedStruct("WorktreeRemoved", {
  sha: Schema.optional(Schema.String),
  ...recorded,
})
/** The branch went in, and `sha` is the merge commit on the host's own branch. */
export const WorkMergedDto = Schema.TaggedStruct("WorkMerged", { sha: Schema.String, ...recorded })
/**
 * A spawn child's branch was dropped rather than merged: its parent had landed, and
 * the parent's branch did not already hold the child's tip. Its documents still reach
 * the parent, by the landing or by a `ChildRefiled`; the child ends `Closed`. `reason`
 * is the sentence to draw.
 */
export const ChangesDroppedDto = Schema.TaggedStruct("ChangesDropped", {
  reason: Schema.String,
  ...recorded,
})
/**
 * What the API did, which is `ApiErrorKind` in `src/agent/types/provider-event.ts`.
 *
 * Spelled out here rather than imported: `shared/` is the contract and the engine depends
 * on it, never the other way round, so a member added there and not here fails `tsc` at
 * the boundary that converts.
 *
 * **One constant for the two shapes that carry it**, because they are the same fact at two
 * ages: `TurnFailedDto` is what the log remembers about a turn that died, and
 * `FailedStateDto` is the one the trak is standing in now. A member on one and not the
 * other would be one vocabulary written twice.
 *
 * **Absent is *nobody said*, not `unclassified`.** Only a provider failure the CLI
 * reported in-band carries one; every other failure, and every log written before the
 * field existed, has none — so a surface that filled the gap with `unclassified` would be
 * putting words in the provider's mouth.
 */
export const ApiErrorKindDto = Schema.Literal(
  "rate_limit",
  "overloaded",
  "server",
  "auth",
  "interrupted",
  "unclassified",
)
/**
 * A turn the engine wrote an ending for. `apiKind` rides beside `reason` — what the
 * provider called it, beside what it said.
 *
 * **It is here and not only on the state because the state is only ever the newest
 * one.** A trak restarted past an interruption is `AgentWorking` again, and by then the
 * log is the only thing left that knows that turn ended and how — which is what a surface
 * drawing the history needs, rather than matching English against `reason`.
 */
export const TurnFailedDto = Schema.TaggedStruct("TurnFailed", {
  step: Schema.optional(Schema.Number),
  sessionId: Schema.optional(Schema.String),
  reason: Schema.String,
  apiKind: Schema.optional(ApiErrorKindDto),
  runner: Schema.optional(RunnerFailureDto),
  ...spent,
  ...recorded,
})
/**
 * `step` is the position of the turn this restart ended, absent when nothing was
 * in flight. It carries because it is the only ending an interrupted turn ever
 * gets — see the domain event — and a surface pairing filed documents to turns
 * has no other way to know a turn ended without filing.
 */
export const RestartedDto = Schema.TaggedStruct("Restarted", {
  sessionId: Schema.optional(Schema.String),
  step: Schema.optional(Schema.Number),
  ...recorded,
})
/**
 * A person pressed Stop on the turn in flight, before anything was killed — the trak
 * moves to `Stopping`. `Stopped`'s fields, for its reasons: this is the interrupted
 * turn's ending on a log written since the event existed, and `Stopped` after it
 * carries nothing.
 */
export const StopRequestedDto = Schema.TaggedStruct("StopRequested", {
  sessionId: Schema.optional(Schema.String),
  step: Schema.optional(Schema.Number),
  ...recorded,
  ...spent,
})
/**
 * A person interrupted the turn that was running, to say something else.
 *
 * The same two fields as `Restarted` and the opposite event: `step` is the position of
 * the turn this stop *ended*, and it carries for the same reason — a stop is that turn's
 * only ending, so a surface pairing filed documents to turns is off by one without it.
 * `sessionId` is the conversation the killed turn was holding, which whatever the person
 * types next resumes.
 */
export const StoppedDto = Schema.TaggedStruct("Stopped", {
  sessionId: Schema.optional(Schema.String),
  step: Schema.optional(Schema.Number),
  ...recorded,
  ...spent,
})
/**
 * A person asked the step to file what it has, rather than saying anything to it.
 *
 * `Stopped`'s two fields, and the opposite ending: the step is re-entered at once,
 * on the session it was holding, and told to file. `step` carries for `Stopped`'s
 * reason — where a turn was killed this is that turn's only ending — and `sessionId`
 * is absent where nothing was killed, because a step parked in a conversation
 * already holds the session the turn resumes.
 */
export const FilingAskedDto = Schema.TaggedStruct("FilingAsked", {
  sessionId: Schema.optional(Schema.String),
  step: Schema.optional(Schema.Number),
  ...recorded,
  ...spent,
})
/**
 * A person changed the trak's run mode part-way through. Moves nothing: the next gate
 * is the first one the new mode decides, and a turn in flight finishes on its own.
 */
export const ModeChangedDto = Schema.TaggedStruct("ModeChanged", {
  mode: RunModeDto,
  ...recorded,
})
/**
 * A person asked to hold the current step until they accept it, whatever the mode would
 * do at its gates (`holding: true`), or took that back before it fired. A spawn has no
 * gate and is passed over. One-shot — the
 * engine spends it as that step is accepted, and writes no event for that.
 */
export const HoldChangedDto = Schema.TaggedStruct("HoldChanged", {
  holding: Schema.Boolean,
  ...recorded,
})
/**
 * A person asked for the next check run not to happen (`skipping: true`), or took that
 * back. One-shot — the engine spends it as the `ChecksPassed` that names what it skipped
 * lands, and writes no event for that. Offered on every mode.
 */
export const SkipChecksChangedDto = Schema.TaggedStruct("SkipChecksChanged", {
  skipping: Schema.Boolean,
  ...recorded,
})
/**
 * A person turned auto-merge on or off. A setting rather than a one-shot: it stands until
 * the next press. On is a fresh start — the send count back to 0 and a stop cleared. What
 * auto-merge is doing now is `TrakProjectionDto.autoMerge`; a surface does not fold these.
 */
export const AutoMergeChangedDto = Schema.TaggedStruct("AutoMergeChanged", {
  on: Schema.Boolean,
  ...recorded,
})
/**
 * A person picked the method this trak's pull request merges by. A setting: it stands until
 * the next pick, and the press and auto-merge both merge with it. What stands now is
 * `TrakProjectionDto.mergeMethod`; a surface does not fold these.
 */
export const MergeMethodPickedDto = Schema.TaggedStruct("MergeMethodPicked", {
  method: Schema.Literal("merge", "squash", "rebase"),
  ...recorded,
})
/**
 * The trak's owner changed, on a log from when Take ownership existed. `from` and `to` are
 * host user ids; `from` is absent where the trak had no owner. Every turn after it runs on
 * `to`'s credential.
 */
export const OwnerChangedDto = Schema.TaggedStruct("OwnerChanged", {
  from: Schema.optional(Schema.String),
  to: Schema.String,
  ...recorded,
})
/**
 * A person said something while the trak was being driven, and nobody has read it
 * yet. `id` is what the `MessageDelivered` that ends the wait names. What is still
 * waiting is `TrakProjectionDto.messages` — a surface does not fold these.
 */
export const MessageWaitingDto = Schema.TaggedStruct("MessageWaiting", {
  id: Schema.String,
  message: Schema.String,
  attachments: Schema.optional(Schema.Array(AttachmentDto)),
  ...recorded,
})
/**
 * The model received the waiting message `id` names. Where in the turn it was read is
 * the `Said` entry on the transcript.
 */
export const MessageDeliveredDto = Schema.TaggedStruct("MessageDelivered", {
  id: Schema.String,
  ...recorded,
})
/** A spawn position's children exist, and these are their trak ids. */
export const ChildrenSpawnedDto = Schema.TaggedStruct("ChildrenSpawned", {
  step: Schema.Number,
  ids: Schema.Array(Schema.String),
  ...recorded,
})
/**
 * The traks the compose entry at `step` handed off were named, and the plan gate went
 * past: one id per description in that run's `handOff`, in its order, and the branch
 * they are cut from. Nothing waits on them — the daemon opens each once, and from then
 * on it is a trak of its own.
 *
 * On a goal's trak `ids` is empty and `base` absent: the hand-off went to the goal's
 * composer, which opens what it decides to.
 */
export const HandedOffDto = Schema.TaggedStruct("HandedOff", {
  step: Schema.Number,
  base: Schema.optional(Schema.String),
  ids: Schema.Array(Schema.String),
  ...recorded,
})
/** The goal the finish at `step` proposed has started, as `goal`. */
export const GoalOpenedDto = Schema.TaggedStruct("GoalOpened", {
  step: Schema.Number,
  goal: Schema.String,
  ...recorded,
})
/** One child came back. `sha` is absent when it changed no files. */
export const ChildLandedDto = Schema.TaggedStruct("ChildLanded", {
  step: Schema.Number,
  child: Schema.Number,
  id: Schema.String,
  branch: Schema.String,
  sha: Schema.optional(Schema.String),
  /**
   * Every document the child filed, under its own keys. Absent on a log written
   * before the landing carried them, which holds the child's last document alone
   * as `artifact` — the wire mirrors the log, so both shapes are here.
   */
  artifacts: Schema.optional(Schema.Array(Schema.Tuple(Schema.String, DocumentDto))),
  artifact: Schema.optional(DocumentDto),
  decisions: Schema.Array(DecidedDto),
  /** What the child's composer handed up, when it did — see `FinishedDto`. */
  handUp: Schema.optional(Schema.String),
  ...recorded,
})
/**
 * A landed child came back again — sent back and ended a second time — with what it
 * filed since its landing and nothing it had already delivered. Moves the parent nowhere.
 */
export const ChildRefiledDto = Schema.TaggedStruct("ChildRefiled", {
  step: Schema.Number,
  child: Schema.Number,
  id: Schema.String,
  artifacts: Schema.Array(Schema.Tuple(Schema.String, DocumentDto)),
  decisions: Schema.Array(DecidedDto),
  handUp: Schema.optional(Schema.String),
  ...recorded,
})
/** All of them are back, and this is where the batch entered the trak. */
export const ChildrenJoinedDto = Schema.TaggedStruct("ChildrenJoined", {
  step: Schema.Number,
  merged: Schema.Array(Schema.String),
  ...recorded,
})

/**
 * A human declared the trak over. The second way one comes to rest, and the one
 * that has to be said — a trak left to rot is a hole in the record rather than a
 * finding.
 *
 * `Stopped`'s three fields beside the reason, present where the archive killed a running
 * turn: `sessionId` says one was killed and names its conversation, `step` is the position
 * it was at — absent for the composer — and `usage` is what it had spent. All absent
 * where the trak was parked and nothing was running.
 */
export const AbandonedDto = Schema.TaggedStruct("Abandoned", {
  reason: Schema.String,
  sessionId: Schema.optional(Schema.String),
  step: Schema.optional(Schema.Number),
  ...recorded,
  ...spent,
})

/**
 * A human is done with a trak that had finished: take the checkout away. The
 * third way one comes to rest, and the one that says nothing went wrong — a
 * `review` trak has nothing to merge and closing it is success.
 */
export const ClosedDto = Schema.TaggedStruct("Closed", { ...recorded })

/**
 * A human asked for this trak's branch to go into the one they are standing on.
 * It carries **no destination** on purpose — a merge goes where the human
 * currently is, and recording a target would be recording a fact about somebody
 * else's checkout. Where it landed comes back as `WorkMerged`.
 */
export const MergedDto = Schema.TaggedStruct("Merged", { ...recorded })

/**
 * The outside world reached a piece of work that had already come to rest — a CI
 * failure, a PR comment, "actually, more". `what` is that sentence.
 *
 * `agent` says which door it came through, and is absent for every re-entry that
 * handed the sentence to the composer. Named, one turn of that agent ran on it
 * instead — no plan and no gate on one — and the record says which agent it was.
 */
export const ReenteredDto = Schema.TaggedStruct("Reentered", {
  what: Schema.String,
  agent: Schema.optional(Schema.String),
  /** Set where the engine sent an auto-merging trak back; `what` is then the pull request. */
  cause: Schema.optional(ReentryCauseDto),
  /** The pull request's base branch, where the re-entry answers the forge refusing a merge. */
  base: Schema.optional(Schema.String),
  ...recorded,
})

/**
 * The engine stopped merging an auto-merging trak's pull request on its own: it sent the
 * trak back as many times as it may, and the forge still would not merge it. `cause` is
 * what the forge said the last time. Moves nothing.
 */
export const AutoMergeStoppedDto = Schema.TaggedStruct("AutoMergeStopped", {
  cause: StopCauseDto,
  ...recorded,
})

export const EventDto = Schema.Union(
  TrakCreatedDto,
  ComposerReturnedDto,
  AgentReturnedDto,
  HumanActedDto,
  ChecksPassedDto,
  CheckFailedDto,
  ChecksCancelledDto,
  EffectsRanDto,
  EffectFailedDto,
  ConditionsMetDto,
  ConditionsUnmetDto,
  WaitSkippedDto,
  WorktreeReadyDto,
  WorktreeFailedDto,
  SetupStartedDto,
  SetupPassedDto,
  SetupFailedDto,
  MergeFailedDto,
  ConflictedDto,
  StepRefusedDto,
  WorkCommittedDto,
  WorktreeRemovedDto,
  WorkMergedDto,
  ChangesDroppedDto,
  TurnFailedDto,
  RestartedDto,
  StopRequestedDto,
  StoppedDto,
  FilingAskedDto,
  ModeChangedDto,
  HoldChangedDto,
  SkipChecksChangedDto,
  AutoMergeChangedDto,
  MergeMethodPickedDto,
  OwnerChangedDto,
  MessageWaitingDto,
  MessageDeliveredDto,
  ChildrenSpawnedDto,
  HandedOffDto,
  GoalOpenedDto,
  ChildLandedDto,
  ChildRefiledDto,
  ChildrenJoinedDto,
  AbandonedDto,
  ClosedDto,
  MergedDto,
  ReenteredDto,
  AutoMergeStoppedDto,
)
export type EventDto = Schema.Schema.Type<typeof EventDto>
