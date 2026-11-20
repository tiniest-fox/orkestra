// Pure mapping between the engine's domain shapes and the @orkestra/shared
// DTOs. No Effect, no I/O — just plain functions over plain objects.
//
// Drift detection is compile-time: each switch exhausts the domain union, so a
// new Event or TrakState variant is a TS error here until handled, and a
// renamed engine field is a TS error at the field read. The shared Schemas are
// the contract this maps TO; `.make` (the engine's own pattern) is what keeps
// the `_tag`/`type` literals from widening to `string` at the assignment.
//
// `_tag` literals on the wire match the engine's on-disk format (`log.jsonl`
// is `encodeEvent`'s output). Branded ids (`TrakId`, `SessionId`, `CommitSha`,
// `BranchName`, `WorktreePath`) are subtypes of `string` and erase on assignment.

import { Array as Arr } from "effect"

import {
  GoalActedDto,
  GoalAtGateStateDto,
  GoalComposingStateDto,
  GoalDoneProposedDto,
  GoalDoneStateDto,
  GoalDroppedDto,
  GoalSettingsChangedDto,
  GoalDroppedStateDto,
  type GoalDto,
  GoalEscalatedDto,
  GoalActionRequestedDto,
  type GoalActionRequestDto,
  type GoalEventDto,
  GoalFailedStateDto,
  GoalPausedDto,
  GoalPlanProposedDto,
  GoalReplannedDto,
  GoalResumedDto,
  GoalStartedDto,
  GoalAskedDto,
  GoalDraftedDto,
  type GoalDraftDto,
  GoalDismissedDto,
  type GoalStateDto,
  GoalTrakDroppedDto,
  GoalTrakMessagedDto,
  GoalTrakOpenedDto,
  GoalTrakRecomposedDto,
  GoalTrakHandedOffDto,
  GoalTrakWokeDto,
  GoalSubgoalOpenedDto,
  GoalSubgoalWokeDto,
  GoalTurnEndedDto,
  GoalTurnFailedDto,
  GoalTurnStoppedDto,
  GoalWatchingStateDto,
} from "@orkestra/shared/dto/goals"
import { AutoMergeDto } from "@orkestra/shared/dto/log"
import {
  type FileContentDto,
  FileBinaryDto,
  type FileSearchDto,
  FileTextDto,
  FileTooLargeDto,
  type ProjectFilesDto,
} from "@orkestra/shared/dto/files"
import {
  type ArchivedTrakListDto,
  CopyingStageDto,
  LaunchingStageDto,
  ReadyingStageDto,
} from "@orkestra/shared/dto/trak"
import type {
  ActRequestDto,
  MergePreviewDto,
  ResumePreviewDto,
  StepEditDto,
} from "@orkestra/shared/dto/actions"
import type {
  ChangeHunkDto,
  ChangeLineDto,
  ChangesDto,
  FileChangeDto,
} from "@orkestra/shared/dto/changes"
import {
  BehindDto,
  ConflictDto,
  DetachedHeadDto,
  DirtyDto,
  DivergedDto,
  NoOriginDto,
  NoUpstreamDto,
  type RefusalDto,
} from "@orkestra/shared/dto/common"
import { AgentDto } from "@orkestra/shared/dto/fleet"
import {
  NoPullRequestDto,
  ForgeNoOriginDto,
  ForgeUnavailableDto,
  type ForgeListingDto,
  PullRequestFoundDto,
  PullRequestEntryDto,
  PullRequestsDto,
  PullRequestSummaryDto,
  type PullRequestDto,
  MergeableDto,
  MergeBlockedDto,
  MergeCheckingDto,
  type MergeVerdictDto,
} from "@orkestra/shared/dto/forge"
import {
  HostBranchDto,
  HostDetachedDto,
  type GitPressedDto,
  type HostGitDto,
} from "@orkestra/shared/dto/git"
import {
  AgentReturnedDto,
  AgentStepDto,
  ArtifactDto,
  AnswerQuestionsActionDto,
  ApproveActionDto,
  ChatActionDto,
  CheckFailedDto,
  LocalPlaceDto,
  type PlaceDto,
  RemotePlaceDto,
  ChildDto,
  ChildLandedDto,
  ChildRefiledDto,
  ChildrenJoinedDto,
  ChildrenSpawnedDto,
  HandedOffDto,
  GoalOpenedDto,
  ChecksCancelledDto,
  ConditionsMetDto,
  ConditionsUnmetDto,
  WaitSkippedDto,
  ChecksPassedDto,
  ClosedDto,
  MergedDto,
  type ComposerOutputDto,
  ComposerReturnedDto,
  CorrectionDto,
  DecidedDto,
  StuckDto,
  DocumentDto,
  ReadingDto,
  TurnInFlightDto,
  EffectFailedDto,
  EffectsRanDto,
  type EventDto,
  FailedDto,
  FinishedDto,
  HumanActedDto,
  AbandonedDto,
  ReenteredDto,
  AutoMergeStoppedDto,
  MessageDto,
  ParentDto,
  ProposalDto,
  QuestionsDto,
  QuestionDto,
  QuestionOptionDto,
  RecordedDto,
  ReplanActionDto,
  RestartedDto,
  StopRequestedDto,
  StoppedDto,
  FilingAskedDto,
  ModeChangedDto,
  HoldChangedDto,
  MessageDeliveredDto,
  MessageWaitingDto,
  SkipChecksChangedDto,
  AutoMergeChangedDto,
  MergeMethodPickedDto,
  OwnerChangedDto,
  SkipActionDto,
  PermitActionDto,
  PermissionDto,
  SpawnStepDto,
  type StepDto,
  type StepOutputDto,
  TrakCreatedDto,
  TurnFailedDto,
  WorkCommittedDto,
  WorktreeFailedDto,
  MergeFailedDto,
  ConflictedDto,
  StepRefusedDto,
  WorktreeReadyDto,
  SetupStartedDto,
  SetupPassedDto,
  SetupFailedDto,
  WorktreeRemovedDto,
  UsageDto,
  WorkMergedDto,
  ChangesDroppedDto,
  WorktreeDto,
  ComposeEntryDto,
  type EntryDto,
  PlanDto,
  ProposedComposeDto,
} from "@orkestra/shared/dto/log"
import {
  ActivityFrameDto,
  CheckEndedFrameDto,
  CheckOutputFrameDto,
  CheckStartedFrameDto,
  InFlightFrameDto,
  PreparingFrameDto,
  SeamStatusFrameDto,
  ProcessFrameDto,
  ProcessOutputFrameDto,
  GoalFrameDto,
  type EngineFrameDto,
} from "@orkestra/shared/dto/stream"
import { AppendedFrameDto, DriveFrameDto, RemovedFrameDto } from "@orkestra/shared/dto/trak-frames"
import {
  AgentWorkingDto,
  AwaitingChildrenDto,
  AwaitingHumanDto,
  AwaitingProposalDto,
  AwaitingComposerAnswersDto,
  CheckRunDto,
  HostedDidNotComeUpDto,
  HostedExitedDto,
  HostedNotStartedDto,
  HostedProcessDto,
  HostedProcessListDto,
  HostedRunningDto,
  HostedPreparingDto,
  HostedStartingDto,
  type HostedStateDto,
  HostedStoppedByRestartDto,
  HostedStoppedDto,
  HandingOffDto,
  CheckRunningDto,
  ConditionRunningDto,
  CommittingDto,
  ClosedStateDto,
  ClosingDto,
  MergedStateDto,
  MergingDto,
  ComposingDto,
  type DeployDto,
  DeployNoneDto,
  DeployRanDto,
  LandedDto,
  CustodyDto,
  PreparingCheckoutDto,
  PreparingCreatingDto,
  PreparingResumingDto,
  PreparingRebuildingDto,
  PreparingSeedingDto,
  PreparingCopyingDto,
  PreparingSettingUpDto,
  PreparingSetupBesideDto,
  type PreparingPhaseDto,
  EffectingDto,
  FailedStateDto,
  FinishedStateDto,
  IntegratingDto,
  AbandoningDto,
  AbandonedStateDto,
  JoiningDto,
  PreparingDto,
  type SeamStatusDto,
  StoppingDto,
  ViewDto,
  ViewResultDto,
  SpawningDto,
  type TrakDetailDto,
  type OwnershipDto,
  type HandoffDto,
  type TrakProjectionDto,
  type TrakStateDto,
  WaitingDto,
  type TrakSummaryDto,
  HeldMarkDto,
  type MarkDto,
  UnattendedModeDto,
  UnattendedUneventfulDto,
  UnattendedResolvingDto,
} from "@orkestra/shared/dto/trak"
import {
  ApiRetryEntryDto,
  NoteEntryDto,
  ReaskEntryDto,
  SessionEntryDto,
  SpawnedEntryDto,
  BackgroundEntryDto,
  BackgroundStartedEntryDto,
  SaidEntryDto,
  ViewEntryDto,
  CheckEntryDto,
  HookEntryDto,
  DeniedEntryDto,
  SubagentEntryDto,
  SubagentResultEntryDto,
  TextEntryDto,
  ToolEntryDto,
  type TranscriptEntryDto,
  type WaitingMessageDto,
} from "@orkestra/shared/dto/transcript"
import type { AttachmentDto } from "@orkestra/shared/dto/attachments"
import {
  type CliUsageDto,
  type PlanUsageDto,
  UsageFrameDto,
  UsageNotReadDto,
  UsageReadDto,
  UsageUnavailableStateDto,
} from "@orkestra/shared/dto/usage"
import type { ApiErrorKind } from "../agent/types/provider-event.js"
import type { RunnerFailure } from "../agent/types/runner-failure.js"
import type { McpResult, McpView } from "../agent/types/mcp.js"
import { noEstimate, type Usage } from "../agent/types/usage.js"
import type { Place } from "../agent/types/place.js"
import type { SessionId } from "../agent/types/session.js"
import type { TranscriptEntry, TurnPosition } from "../agent/types/transcript-entry.js"
import { type CliUsage, PlanUsage } from "../agent/types/plan-usage.js"
import { SpawnStage } from "../agent/types/spawn-stage.js"
import { viewDocument } from "./view-policy.js"
import type { Agent } from "../library/types/agent.js"
import { agentNamed } from "../library/logic/resolve.js"
import type { Library } from "../library/types/library.js"
import {
  type ChangeHunk,
  type ChangeLine,
  type Changes,
  type FileChange,
  ForgeAnswer,
  ForgeListing,
  HostHead,
  SyncRefusal,
  type Worktree,
} from "../vcs/index.js"
import type { ChangesAt } from "./changes.js"
import type { Rebuild } from "../vcs/ports/sandboxes.js"
import { PreparingPhase } from "../vcs/types/preparing.js"
import { MergeVerdict, type PullRequest } from "../vcs/types/pull-request.js"
import type { HostGitView, Pressed } from "./host-git.js"
import { ProjectFile } from "./project-tree.js"
import type { ProjectFiles, ProjectGrep } from "../vcs/types/project-files.js"
import { render, type Templates } from "../prompts/index.js"
import { type Event, isSetupEvent, type SetupEvent } from "../workflow/domain/event.js"
import {
  type ActionRequest,
  type Goal,
  type GoalEvent,
  goalName,
  goalOffers,
  type GoalSpec,
  type GoalState,
} from "../workflow/domain/goal.js"
import type { HumanAction } from "../workflow/domain/human-action.js"
import { Actions } from "../workflow/domain/human-action.js"
import { Edits, type PlanEdit } from "../workflow/domain/plan-edit.js"
import { AUTO_MERGE_SENDS } from "../workflow/domain/attention.js"
import { attachedField } from "../workflow/domain/attachment.js"
import { activeAt, leftSince, mayIdle, touchedAt } from "../workflow/domain/activity.js"
import {
  asGate,
  atRest,
  type AutoMerge,
  type Mark,
  nextCheckedPosition,
  firstUnrun,
  effortAt,
  modelAt,
  type GoalId,
  type Trak,
  type TrakState,
  timeWaitOf,
  waitingAt,
} from "../workflow/domain/trak.js"
import { resolveWaitUntil } from "../workflow/domain/wait-until.js"
import type { ArchivedTrak } from "../workflow/ports/archive.js"
import type { CheckRun } from "../workflow/ports/checks.js"
import {
  type Frame,
  type Reattaching,
  reattachingOf,
  type TurnSpent,
} from "../workflow/ports/feed.js"
import { type HostedRun, HostedState } from "../workflow/ports/hosted-processes.js"
import type { SeamStatus } from "../workflow/ports/seam-status.js"
import type { Outage } from "../workflow/ports/outages.js"
import type { Holder, InFlightTurn } from "../workflow/ports/runs.js"
import { readDeployOutput } from "../workflow/domain/condition.js"
import { type DeployStatus, deployStatusOf } from "./deploys.js"
import type { Artifact, Document } from "../workflow/domain/outputs/artifact.js"
import {
  type Decided,
  identified,
  type Recorded,
  requirementsIn,
  supersededBy,
} from "../workflow/domain/outputs/decided.js"
import type { ComposerOutput } from "../workflow/domain/outputs/composer-output.js"
import {
  type AgentStep,
  type Child,
  childSteps,
  instructionOf,
  isCompose,
  isConversational,
  isSpawn,
  type Plan,
  type Proposal,
  type ProposedStep,
  type Step,
} from "../workflow/domain/outputs/proposal.js"
import type { Question } from "../workflow/domain/outputs/question.js"
import type { StepOutput } from "../workflow/domain/outputs/step-output.js"

// ============================================================================
// TrakState (server → client) — and no Gate; see `toDetailDto`
// ============================================================================

/**
 * Which archive a failure in `Closing` or `Abandoning` stopped. `Closing` without `merged`
 * is `closed` even where GitHub merged the pull request: the forge is asked after the
 * teardown, so nothing here knows that yet.
 */
const archivingOf = (
  from: TrakState | undefined,
): "merged" | "closed" | "abandoned" | undefined => {
  if (from?._tag === "Closing") return from.merged === undefined ? "closed" : "merged"
  return from?._tag === "Abandoning" ? "abandoned" : undefined
}

/**
 * `failedFrom` is read for the two facts about the position a failed trak's surface needs
 * and the state does not carry: an `archive` failure's `archiving`, and whether a failed
 * effect stopped it — `effectFailedAt`'s rule.
 */

/** A message still to be read, with its files where it was sent any. */
const waitingDto = (m: {
  readonly id: string
  readonly message: string
  readonly attachments: readonly AttachmentDto[]
}): WaitingMessageDto => ({
  id: m.id,
  message: m.message,
  ...(m.attachments.length === 0 ? {} : { attachments: m.attachments }),
})

export const toStateDto = (state: TrakState, failedFrom?: TrakState): TrakStateDto => {
  switch (state._tag) {
    case "Preparing":
      return PreparingDto.make({})
    case "Composing":
      return ComposingDto.make({})
    case "AwaitingProposal":
      return AwaitingProposalDto.make({})
    case "AwaitingComposerAnswers":
      return AwaitingComposerAnswersDto.make({})
    case "AgentWorking":
      return AgentWorkingDto.make({ step: state.step })
    case "Stopping":
      return StoppingDto.make(state.step === undefined ? {} : { step: state.step })
    case "CheckRunning":
      return CheckRunningDto.make({ step: state.step })
    case "ConditionRunning":
      return ConditionRunningDto.make({ step: state.step })
    case "AwaitingHuman":
      return AwaitingHumanDto.make({ step: state.step, kind: state.kind })
    case "Spawning":
      return SpawningDto.make({ step: state.step })
    case "HandingOff":
      return HandingOffDto.make({ step: state.step })
    case "AwaitingChildren":
      return AwaitingChildrenDto.make({ step: state.step })
    case "Joining":
      return JoiningDto.make({ step: state.step })
    case "Committing":
      return CommittingDto.make({ step: state.step })
    case "Effecting":
      return EffectingDto.make({ step: state.step })
    case "Integrating":
      return IntegratingDto.make({})
    case "Abandoning":
      return AbandoningDto.make({ reason: state.reason })
    case "Finished":
      return FinishedStateDto.make({})
    case "Merging":
      return MergingDto.make({})
    case "Closing": {
      // Spread rather than assigned: `merged` is an exact optional, so a plain
      // close has no key at all rather than one holding `undefined`.
      const fields: { merged?: string } = {}
      if (state.merged !== undefined) fields.merged = state.merged
      return ClosingDto.make({ ...fields })
    }
    case "Closed":
      return ClosedStateDto.make({})
    case "Merged":
      return MergedStateDto.make({ sha: state.sha })
    case "Abandoned":
      return AbandonedStateDto.make({ reason: state.reason })
    case "Failed": {
      // Spread, because `apiKind` and `archiving` are exact optionals: a failure nobody
      // classified has no key rather than one holding `undefined`.
      const archiving = state.kind === "archive" ? archivingOf(failedFrom) : undefined
      return FailedStateDto.make({
        error: state.error,
        kind: state.kind,
        ...(state.apiKind === undefined ? {} : { apiKind: state.apiKind }),
        ...(archiving === undefined ? {} : { archiving }),
        ...toRunnerField(state.runner),
        ...(state.runnersOnly === undefined ? {} : { runnersOnly: state.runnersOnly }),
        ...(state.carried === undefined ? {} : { carried: state.carried }),
        ...(state.setup === undefined ? {} : { setup: state.setup }),
        ...(state.kind === "project" && failedFrom?._tag === "Effecting"
          ? { effecting: true as const }
          : {}),
      })
    }
  }
}

// ============================================================================
// Nested shapes reused by the Event + output unions
// ============================================================================

const toWorktreeDto = (w: Worktree) =>
  WorktreeDto.make({ path: w.path, branch: w.branch, base: w.base })

const toDocumentDto = (doc: Document) => DocumentDto.make({ sections: doc.sections })

/**
 * The standing channel an envelope filed, under one name.
 *
 * `requirementsIn` is where the engine's old field name is still read; nothing past
 * this point has to know there was one. Absent stays absent — an envelope that filed
 * nothing carries no key, per the optional-field idiom used throughout this file.
 */
const toRequirementDtos = (out: {
  readonly requirements?: readonly Decided[] | undefined
  readonly decisions?: readonly Decided[] | undefined
}) => {
  const filed = requirementsIn(out)
  return filed.length === 0 ? {} : { requirements: filed.map(toDecidedDto) }
}

const toDecidedDto = (d: Decided) => {
  const supersedes = supersededBy(d)
  return DecidedDto.make({
    text: d.text,
    source: d.source,
    // Absent stays absent: a legacy entry has no kind, and a default here would
    // tell a card the agent picked one. The legacy `supersedes` kind is spent into
    // the field, which is the whole of what it said.
    ...(d.kind === undefined || d.kind === "supersedes" ? {} : { kind: d.kind }),
    ...(Arr.isNonEmptyReadonlyArray(supersedes) ? { supersedes } : {}),
  })
}

/**
 * The step's document, what it settled, and what it says is wrong elsewhere.
 *
 * Separate from `toDocumentDto` because the two genuinely differ: `Trak.artifacts`
 * holds documents alone, and what an envelope carried lives on the trak.
 */
const toArtifactDto = (out: Artifact) =>
  ArtifactDto.make({
    ...toDocumentDto(out),
    ...toRequirementDtos(out),
    ...(out.corrections === undefined
      ? {}
      : {
          corrections: out.corrections.map((c) => CorrectionDto.make({ at: c.at, text: c.text })),
        }),
    ...(out.uncovered_work === undefined ? {} : { uncovered_work: out.uncovered_work }),
  })

/**
 * The accumulated list with each entry's id, which only the whole list can give —
 * so a mapper over one entry would have to invent it.
 */
const toRecordedDtos = (decisions: readonly Recorded[]) =>
  identified(decisions).map((d) =>
    RecordedDto.make({
      text: d.text,
      source: d.source,
      at: d.at,
      id: d.id,
      ...(d.supersedes === undefined ? {} : { supersedes: d.supersedes }),
    }),
  )

const toQuestionDto = (q: Question) => {
  const options = q.options.map((o) => {
    const opt: { label: string; description?: string; recommended?: boolean } = { label: o.label }
    if (o.description !== undefined) opt.description = o.description
    if (o.recommended !== undefined) opt.recommended = o.recommended
    return QuestionOptionDto.make({ ...opt })
  })
  const fields: { context?: string } = {}
  if (q.context !== undefined) fields.context = q.context
  return QuestionDto.make({ question: q.question, options, ...fields })
}

// `conversational` is read through its predicate rather than copied, which is what
// turns the engine's absent-means-false into the plain boolean the wire promises.
/** The instruction of the entry a trak is standing at, if that entry has one. */
const entryInstructionAt = (s: Step | undefined): string | undefined =>
  s === undefined ? undefined : instructionOf(s)

/**
 * A piece, as the wire draws it: its plan, in order. One entry for a piece written
 * as a bare pair, which is what `childSteps` turns the two arms into.
 */
const toChildDtos = (c: Child): readonly ChildDto[] =>
  childSteps(c).map((s) =>
    ChildDto.make({
      agent: s.agent,
      instruction: s.instruction,
      ...(s.model === undefined ? {} : { model: s.model }),
    }),
  )

/**
 * The conversation the composer put this step into, where it named one.
 *
 * Spread rather than assigned, the same device `rationale` uses: absent is the composer
 * naming no conversation, and a key holding `undefined` would be a claim of its own on
 * the wire.
 *
 * Copied straight across rather than read through `continuesFrom`, which is where this
 * differs from `conversational` beside it: what crosses is the key the composer wrote,
 * for a person at the plan gate to read. Whether it resolves is the engine's question,
 * and answering it again out here would be a second reading to keep in step with the
 * first.
 */
const continuesOf = (s: AgentStep): { continues?: string } =>
  s.continues === undefined ? {} : { continues: s.continues }

/**
 * The instant the step waits for, resolved against `anchor` — when the plan naming it
 * was proposed. Spread for `continuesOf`'s reason, and absent as well where the anchor
 * is: a duration nothing can count from is left off rather than sent as a guess.
 *
 * Resolved here rather than copied, which is where this differs from `continues`: the
 * composer's spelling is an hour or a duration, and a surface handed either would have
 * to hold the anchor and the arithmetic to draw a countdown — two readings of one
 * instant, free to disagree with the sweep's.
 */
const waitUntilOf = (s: AgentStep, anchor: number | undefined): { waitUntil?: number } => {
  const until = s.wait_until === undefined ? undefined : resolveWaitUntil(s.wait_until, anchor)
  return until === undefined ? {} : { waitUntil: until }
}

/** The engine condition the step waits on itself — spread for `continuesOf`'s reason. */
const waitForOf = (s: AgentStep): { waitFor?: "merged" | "deployed" } =>
  s.wait_for === undefined ? {} : { waitFor: s.wait_for }

const toStepDto = (s: ProposedStep, anchor: number | undefined): StepDto =>
  s.type === "compose"
    ? ProposedComposeDto.make({ instruction: s.instruction })
    : isSpawn(s)
      ? SpawnStepDto.make({
          instruction: s.instruction,
          children: s.children.map(toChildDtos),
        })
      : AgentStepDto.make({
          agent: s.agent,
          instruction: s.instruction,
          conversational: isConversational(s),
          ...continuesOf(s),
          ...waitUntilOf(s, anchor),
          ...waitForOf(s),
        })

/**
 * What the composer returned — a compose entry here is one it scheduled for itself.
 * `at` is when: the stamp on the event carrying it, and the anchor every wait it
 * names counts from.
 */
const toProposalDto = (p: Proposal, at: number | undefined) => {
  const fields: { rationale?: string; handOff?: readonly string[] } = {}
  if (p.rationale !== undefined) fields.rationale = p.rationale
  if (p.handOff !== undefined) fields.handOff = [...p.handOff]
  return ProposalDto.make({
    title: p.title,
    ...fields,
    steps: p.steps.map((st) => toStepDto(st, at)),
  })
}

/**
 * The model the step runs on and the effort it runs at, read from the same functions
 * the spawn site reads — so an entry continuing another's session carries that
 * session's, not its own agent's — and spread for `continuesOf`'s reason. Absent where
 * the agent cannot be found, which is the entry the spawn will refuse too; the effort
 * absent besides wherever nothing declared one. The model's context window rides
 * beside them, from the project's own table, and is absent wherever the table
 * states none.
 */
const modelDtoOf = (
  trak: Trak,
  index: number,
  lib: Library,
): { model?: string; contextWindow?: number; effort?: string } => {
  const model = modelAt(trak, index, lib)
  if (model === undefined) return {}
  const contextWindow = lib.models.windows[model]
  const effort = effortAt(trak, index, lib)
  return {
    model,
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(effort === undefined ? {} : { effort }),
  }
}

const toEntryDto = (
  trak: Trak,
  index: number,
  s: Step,
  anchor: number | undefined,
  lib: Library,
): EntryDto =>
  isCompose(s)
    ? ComposeEntryDto.make({
        ...(s.why === undefined ? {} : { why: s.why }),
        ...(s.instruction === undefined ? {} : { instruction: s.instruction }),
      })
    : isSpawn(s)
      ? SpawnStepDto.make({
          instruction: s.instruction,
          children: s.children.map(toChildDtos),
        })
      : AgentStepDto.make({
          agent: s.agent,
          instruction: s.instruction,
          conversational: isConversational(s),
          // A plan's unrun tail is the proposal, so an entry carries the conversation
          // its step was proposed to continue. What draws it is a surface's own call.
          ...continuesOf(s),
          ...waitUntilOf(s, anchor),
          ...waitForOf(s),
          ...modelDtoOf(trak, index, lib),
        })

const toPlanDto = (trak: Trak, p: Plan, lib: Library) => {
  // Spread rather than assigned: `rationale` is an exact optional, and a plan with
  // nothing to say has no key at all rather than one holding `undefined`.
  const fields: { rationale?: string } = {}
  if (p.rationale !== undefined) fields.rationale = p.rationale
  // The unrun tail resolves its waits against `planAt`, which is theirs by
  // construction — see `Trak.planAt`. An entry that ran was proposed by a turn the
  // trak no longer names, so it gets no anchor and carries no instant.
  const unrun = firstUnrun(trak)
  return PlanDto.make({
    title: p.title,
    ...fields,
    steps: p.steps.map((s, i) => toEntryDto(trak, i, s, i >= unrun ? trak.planAt : undefined, lib)),
  })
}

// ============================================================================
// Output unions (type-discriminated, matching the engine's agent boundary)
// ============================================================================

const toComposerOutputDto = (out: ComposerOutput, at: number | undefined): ComposerOutputDto => {
  switch (out.type) {
    case "proposal":
      return toProposalDto(out, at)
    case "questions":
      return QuestionsDto.make({ questions: out.questions.map(toQuestionDto) })
    case "failed":
      return FailedDto.make({ error: out.error })
    case "finished":
      return FinishedDto.make({
        reason: out.reason,
        ...(out.handUp === undefined ? {} : { handUp: out.handUp }),
        ...(out.handOff === undefined ? {} : { handOff: [...out.handOff] }),
        ...(out.goal === undefined ? {} : { goal: out.goal }),
      })
    case "message":
      return MessageDto.make({ text: out.text })
  }
}

const toStepOutputDto = (out: StepOutput): StepOutputDto => {
  switch (out.type) {
    case "artifact":
      return toArtifactDto(out)
    case "stuck":
      return StuckDto.make({
        tried: out.tried,
        happened: out.happened,
        diagnosis: out.diagnosis,
        ...toRequirementDtos(out),
      })
    case "questions":
      return QuestionsDto.make({ questions: out.questions.map(toQuestionDto) })
    case "permission":
      return PermissionDto.make({ command: out.command, reason: out.reason })
    case "failed":
      return FailedDto.make({ error: out.error })
    case "message":
      return MessageDto.make({ text: out.text })
  }
}

const toHumanActionDto = (action: HumanAction) => {
  switch (action._tag) {
    case "Approve":
      return ApproveActionDto.make({})
    case "Chat":
      return ChatActionDto.make({ message: action.message, ...attachedField(action.attachments) })
    case "AnswerQuestions":
      return AnswerQuestionsActionDto.make({ answers: action.answers, note: action.note })
    case "Replan":
      return ReplanActionDto.make({ reason: action.reason })
    case "Skip":
      return SkipActionDto.make({ message: action.message })
    case "Permit":
      return PermitActionDto.make({ granted: action.granted })
  }
}

// ============================================================================
// Event (_tag-discriminated, exhaustive over the engine's union)
// ============================================================================

/**
 * Absent stays absent: `at` is an exact optional, and a log written before
 * `Store.append` stamped one has no time to report.
 */
const stamp = (event: Event): { at?: number } => (event.at === undefined ? {} : { at: event.at })

/** The optional fields built by hand, so a landing with none carries no keys. */
const toChildLandedDto = (event: Extract<Event, { _tag: "ChildLanded" }>) => {
  const fields: {
    sha?: string
    artifacts?: (readonly [string, DocumentDto])[]
    artifact?: DocumentDto
    handUp?: string
  } = {}
  if (event.sha !== undefined) fields.sha = event.sha
  if (event.handUp !== undefined) fields.handUp = event.handUp
  if (event.artifacts !== undefined) {
    fields.artifacts = event.artifacts.map(([key, doc]) => [key, toDocumentDto(doc)] as const)
  }
  if (event.artifact !== undefined) fields.artifact = toDocumentDto(event.artifact)
  return ChildLandedDto.make({
    step: event.step,
    child: event.child,
    id: event.id,
    branch: event.branch,
    ...fields,
    decisions: event.decisions.map(toDecidedDto),
  })
}

const toChildRefiledDto = (event: Extract<Event, { _tag: "ChildRefiled" }>) =>
  ChildRefiledDto.make({
    step: event.step,
    child: event.child,
    id: event.id,
    artifacts: event.artifacts.map(([key, doc]) => [key, toDocumentDto(doc)] as const),
    decisions: event.decisions.map(toDecidedDto),
    ...(event.handUp === undefined ? {} : { handUp: event.handUp }),
  })

/**
 * A spread over the body rather than an `at` in twenty `.make` calls — and it is
 * the mechanism rather than a convenience: a new `Event` variant gets its
 * timestamp on the wire without anyone remembering to add it.
 */
export const toEventDto = (event: Event): EventDto => ({ ...eventBody(event), ...stamp(event) })

/** Absent means unmeasured, which is a different fact from free. */
const toUsageDto = (usage: Usage): UsageDto =>
  UsageDto.make({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    costUsd: usage.costUsd,
    tools: { ...usage.tools },
    ...(usage.context === undefined ? {} : { context: { ...usage.context } }),
    ...(usage.contextWindow === undefined ? {} : { contextWindow: usage.contextWindow }),
  })

/** The runner verb that failed, as an exact optional: absent rather than undefined. */
const toRunnerField = (runner: RunnerFailure | undefined): { runner?: RunnerFailure } =>
  runner === undefined ? {} : { runner }

/** `TurnFailed`'s exact optionals, each set only where the event has it. */
interface TurnFailedFields {
  step?: number
  sessionId?: string
  apiKind?: ApiErrorKind
  runner?: RunnerFailure
}

const toSpentDto = (usage: Usage | undefined): { usage?: UsageDto } =>
  usage === undefined ? {} : { usage: toUsageDto(usage) }

/**
 * The turn in flight as the wire carries it, or nothing where the record holds no turn
 * or the turn has reported nothing yet — a spawn that has not said anything has no
 * figure, and a zero would say it read an empty window. The estimate is absent exactly
 * where `usage` is, and a record written before it was kept reads as nothing read.
 */
const toInFlightDto = (
  turn: TurnSpent | undefined,
  reattaching: Reattaching | undefined,
): TurnInFlightDto | undefined => {
  if (turn === undefined && reattaching === undefined) return undefined
  const step = turn?.step ?? reattaching?.step
  return TurnInFlightDto.make({
    ...(step === undefined ? {} : { step }),
    ...(turn === undefined
      ? {}
      : { usage: toUsageDto(turn.usage), estimate: { ...turn.estimate } }),
    ...(reattaching === undefined
      ? {}
      : {
          reattaching: {
            kind: reattaching.kind,
            said: reattaching.said,
            since: reattaching.since,
          },
        }),
  })
}

const spentInFlight = (turn: InFlightTurn | undefined): TurnSpent | undefined =>
  turn?.usage === undefined
    ? undefined
    : { step: turn.step, usage: turn.usage, estimate: turn.estimate ?? noEstimate }

/** Absent means nothing was taken out of the agent's words — see `EventDto`'s `envelope`. */
const toWroteDto = (envelope: string | undefined): { envelope?: string } =>
  envelope === undefined ? {} : { envelope }

/**
 * What a trak was born holding, and absent on one a human asked for.
 *
 * Its own function rather than a block inside the switch below, which is otherwise the
 * one arm long enough to matter: four exact optionals means four `if`s, and the
 * mapper has a line budget the rest of the cases have to fit inside.
 */
const toBornDto = (
  event: Extract<Event, { readonly _tag: "TrakCreated" }>,
): {
  parent?: ParentDto
  plan?: ReturnType<typeof toProposalDto>
  decisions?: ReturnType<typeof toRecordedDtos>
  handedOffFrom?: string
} => {
  const born: {
    parent?: ParentDto
    plan?: ReturnType<typeof toProposalDto>
    decisions?: ReturnType<typeof toRecordedDtos>
    handedOffFrom?: string
  } = {}
  if (event.parent !== undefined) born.parent = ParentDto.make({ ...event.parent })
  if (event.plan !== undefined) born.plan = toProposalDto(event.plan, event.at)
  if (event.decisions !== undefined) born.decisions = toRecordedDtos(event.decisions)
  if (event.handedOffFrom !== undefined) born.handedOffFrom = event.handedOffFrom
  return born
}

/**
 * The two fields every interrupted turn's ending carries, each absent rather than present
 * and undefined — `workCommitted`'s hand-building, for its reason.
 */
const toEndingFields = (event: {
  readonly sessionId?: SessionId | undefined
  readonly step?: number | undefined
}): { sessionId?: string; step?: number } => {
  const fields: { sessionId?: string; step?: number } = {}
  if (event.sessionId !== undefined) fields.sessionId = event.sessionId
  if (event.step !== undefined) fields.step = event.step
  return fields
}

/** Where setup stands, and on a failure the turn it killed and what that spent. */
const toSetupDto = (event: SetupEvent) => {
  if (event._tag === "SetupStarted") return SetupStartedDto.make({})
  if (event._tag === "SetupPassed") return SetupPassedDto.make({})
  return SetupFailedDto.make({
    reason: event.reason,
    ...toEndingFields(event),
    ...toSpentDto(event.usage),
  })
}

/** The press's shape, and the killed turn's session and spend on the one press that kills. */
const toHumanActedDto = (event: Extract<Event, { readonly _tag: "HumanActed" }>) =>
  HumanActedDto.make({
    step: event.step,
    action: toHumanActionDto(event.action),
    ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
    ...toSpentDto(event.usage),
  })

/** The reason, and the killed turn's three fields where the archive killed one. */
const toAbandonedDto = (event: Extract<Event, { readonly _tag: "Abandoned" }>) =>
  AbandonedDto.make({
    reason: event.reason,
    ...toEndingFields(event),
    ...toSpentDto(event.usage),
  })

/**
 * A place as the wire draws it. A `Remote` with no exec id is a checkout's record rather
 * than one command's, and no field that reaches the wire carries one, so it is read as no
 * place at all.
 */
const toPlaceDto = (place: Place): PlaceDto | undefined => {
  if (place._tag === "Local") return LocalPlaceDto.make({})
  if (place.exec === undefined) return undefined
  return RemotePlaceDto.make({
    runner: place.runner,
    exec: place.exec,
    ...(place.sandbox === undefined ? {} : { sandbox: place.sandbox }),
  })
}

/** `place`, spread, so none leaves no key. */
const placeField = (place: Place | undefined): { place?: PlaceDto } => {
  const dto = place === undefined ? undefined : toPlaceDto(place)
  return dto === undefined ? {} : { place: dto }
}

/** Each check's place that the wire can carry, or nothing where none can. */
const placesField = (
  places: Readonly<Record<string, Place>> | undefined,
): { places?: Record<string, PlaceDto> } => {
  const carried = Object.entries(places ?? {}).flatMap(([name, place]) => {
    const dto = toPlaceDto(place)
    const entry: [string, PlaceDto] | undefined = dto === undefined ? undefined : [name, dto]
    return entry === undefined ? [] : [entry]
  })
  return carried.length === 0 ? {} : { places: Object.fromEntries(carried) }
}

/** `skipped` and `reused` are exact optionals, absent where nothing was skipped or reused. */
const toChecksPassedDto = (event: Extract<Event, { readonly _tag: "ChecksPassed" }>) =>
  ChecksPassedDto.make({
    step: event.step,
    ran: [...event.ran],
    ...(event.skipped === undefined ? {} : { skipped: [...event.skipped] }),
    ...(event.reused === undefined ? {} : { reused: [...event.reused] }),
    ...placesField(event.places),
  })

/** `name` is an exact optional, absent where the press raced the run starting. */
const toChecksCancelledDto = (event: Extract<Event, { readonly _tag: "ChecksCancelled" }>) =>
  ChecksCancelledDto.make({
    step: event.step,
    ...(event.name === undefined ? {} : { name: event.name }),
  })

/**
 * Both extras spread rather than assigned: they are exact optionals on the event, and a
 * key present holding `undefined` is a different shape on the way through Schema. A log
 * written before either existed carries neither, and a timed-out check has no exit code
 * on this build either.
 */
const toCheckFailedDto = (event: Extract<Event, { _tag: "CheckFailed" }>): EventDto =>
  CheckFailedDto.make({
    step: event.step,
    name: event.name,
    output: event.output,
    ...(event.command === undefined ? {} : { command: event.command }),
    ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
    ...placeField(event.place),
  })

/** The two answers a condition gives the log, straight across. */
const toConditionDto = (
  event: Extract<Event, { _tag: "ConditionsMet" | "ConditionsUnmet" }>,
): EventDto => {
  const merged = event.merged === undefined ? {} : { merged: event.merged }
  return event._tag === "ConditionsMet"
    ? ConditionsMetDto.make({ step: event.step, ran: [...event.ran], ...merged })
    : ConditionsUnmetDto.make({
        step: event.step,
        name: event.name,
        output: event.output,
        stopped: event.stopped,
        ...merged,
      })
}

/** `into` is an exact optional: a detached host has no branch name and no key. */
const toConflictedDto = (event: Extract<Event, { readonly _tag: "Conflicted" }>) =>
  ConflictedDto.make({
    paths: [...event.paths],
    ...(event.into === undefined ? {} : { into: event.into }),
  })

/** `merged` spread rather than assigned, on `toConditionDto`'s terms: an exact optional. */
const toWaitSkippedDto = (event: Extract<Event, { _tag: "WaitSkipped" }>): EventDto =>
  WaitSkippedDto.make({
    step: event.step,
    name: event.name,
    ...(event.merged === undefined ? {} : { merged: event.merged }),
  })

/** Both fields exact optionals: a catch-all commit names no step, and a no-op commit no sha. */
const toWorkCommittedDto = (event: Extract<Event, { _tag: "WorkCommitted" }>): EventDto => {
  const fields: { sha?: string; step?: number } = {}
  if (event.sha !== undefined) fields.sha = event.sha
  if (event.step !== undefined) fields.step = event.step
  return WorkCommittedDto.make({ ...fields })
}

/**
 * What a compose entry's finish or plan opened outside this trak: the traks a hand-off was
 * named as, or the goal a proposal started as. A goal's trak's hand-off names no traks and
 * no base: the wire says so with none of either.
 */
const toOpenedDto = (event: Extract<Event, { _tag: "HandedOff" | "GoalOpened" }>): EventDto =>
  event._tag === "GoalOpened"
    ? GoalOpenedDto.make({ step: event.step, goal: event.goal })
    : HandedOffDto.make({
        step: event.step,
        ids: [...(event.ids ?? [])],
        ...(event.base === undefined ? {} : { base: event.base }),
      })

const toReenteredDto = (event: Extract<Event, { _tag: "Reentered" }>): EventDto =>
  ReenteredDto.make({
    what: event.what,
    ...(event.agent === undefined ? {} : { agent: event.agent }),
    ...(event.cause === undefined ? {} : { cause: event.cause }),
    ...(event.base === undefined ? {} : { base: event.base }),
  })

/** A person changing how the trak is run: the mode, a one-shot, auto-merge or its method. */
const toSettingDto = (event: SettingEvent): EventDto => {
  switch (event._tag) {
    case "ModeChanged":
      return ModeChangedDto.make({ mode: event.mode })
    case "HoldChanged":
      return HoldChangedDto.make({ holding: event.holding })
    case "SkipChecksChanged":
      return SkipChecksChangedDto.make({ skipping: event.skipping })
    case "AutoMergeChanged":
      return AutoMergeChangedDto.make({ on: event.on })
    case "MergeMethodPicked":
      return MergeMethodPickedDto.make({ method: event.method })
    case "OwnerChanged":
      return OwnerChangedDto.make({
        to: event.to,
        ...(event.from === undefined ? {} : { from: event.from }),
      })
  }
}

/** A stop's events and a filing's — each the interrupted turn's ending and spend, where it carries one. */
const toStopDto = (
  event: Extract<Event, { readonly _tag: "StopRequested" | "Stopped" | "FilingAsked" }>,
): EventDto => {
  const fields = { ...toEndingFields(event), ...toSpentDto(event.usage) }
  switch (event._tag) {
    case "StopRequested":
      return StopRequestedDto.make(fields)
    case "Stopped":
      return StoppedDto.make(fields)
    case "FilingAsked":
      return FilingAskedDto.make(fields)
  }
}

type SettingEvent = Extract<Event, { readonly _tag: (typeof SETTINGS)[number] }>
const SETTINGS = [
  "ModeChanged",
  "HoldChanged",
  "SkipChecksChanged",
  "AutoMergeChanged",
  "MergeMethodPicked",
  "OwnerChanged",
] as const
const isSetting = (event: Event): event is SettingEvent =>
  SETTINGS.some((tag) => tag === event._tag)

const toTrakCreatedDto = (event: Extract<Event, { readonly _tag: "TrakCreated" }>) =>
  TrakCreatedDto.make({
    description: event.description,
    ...toBornDto(event),
    ...attachedField(event.attachments),
  })

const toMessageWaitingDto = (event: Extract<Event, { readonly _tag: "MessageWaiting" }>) =>
  MessageWaitingDto.make({
    id: event.id,
    message: event.message,
    ...attachedField(event.attachments),
  })

const eventBody = (event: Event): EventDto => {
  if (isSetupEvent(event)) return toSetupDto(event)
  if (isSetting(event)) return toSettingDto(event)
  switch (event._tag) {
    case "TrakCreated":
      return toTrakCreatedDto(event)
    case "ComposerReturned":
      return ComposerReturnedDto.make({
        sessionId: event.sessionId,
        output: toComposerOutputDto(event.output, event.at),
        ...toSpentDto(event.usage),
        ...toWroteDto(event.envelope),
      })
    case "AgentReturned":
      return AgentReturnedDto.make({
        step: event.step,
        sessionId: event.sessionId,
        output: toStepOutputDto(event.output),
        ...toSpentDto(event.usage),
        ...toWroteDto(event.envelope),
      })
    case "HumanActed":
      return toHumanActedDto(event)
    case "ChecksPassed":
      return toChecksPassedDto(event)
    case "CheckFailed":
      return toCheckFailedDto(event)
    case "ChecksCancelled":
      return toChecksCancelledDto(event)
    case "EffectsRan":
      return EffectsRanDto.make({
        step: event.step,
        ran: event.ran,
        ...(event.skipped === undefined ? {} : { skipped: event.skipped }),
      })
    case "EffectFailed":
      return EffectFailedDto.make({ step: event.step, name: event.name, output: event.output })
    case "ConditionsMet":
    case "ConditionsUnmet":
      return toConditionDto(event)
    case "WaitSkipped":
      return toWaitSkippedDto(event)
    case "WorktreeReady":
      return WorktreeReadyDto.make({ worktree: toWorktreeDto(event.worktree) })
    case "WorktreeFailed":
      return WorktreeFailedDto.make({ reason: event.reason, ...toRunnerField(event.runner) })
    case "MergeFailed":
      return MergeFailedDto.make({ reason: event.reason })
    case "StepRefused":
      return StepRefusedDto.make({ step: event.step, reason: event.reason })
    case "Conflicted":
      return toConflictedDto(event)
    case "WorkCommitted":
      return toWorkCommittedDto(event)
    case "WorktreeRemoved":
      return WorktreeRemovedDto.make(event.sha === undefined ? {} : { sha: event.sha })
    case "TurnFailed": {
      // `apiKind` goes with them, and it is the half a restart takes away: the state moves
      // off `Failed` and the log becomes the only record that this turn was interrupted
      // rather than merely stopped. Exact-optional like the rest — absent is *nobody
      // said*, never `unclassified`.
      const fields: TurnFailedFields = toRunnerField(event.runner)
      if (event.step !== undefined) fields.step = event.step
      if (event.sessionId !== undefined) fields.sessionId = event.sessionId
      if (event.apiKind !== undefined) fields.apiKind = event.apiKind
      return TurnFailedDto.make({ ...fields, reason: event.reason, ...toSpentDto(event.usage) })
    }
    case "Restarted":
      return RestartedDto.make(toEndingFields(event))
    case "StopRequested":
    case "Stopped":
    case "FilingAsked":
      return toStopDto(event)
    case "MessageWaiting":
      return toMessageWaitingDto(event)
    case "MessageDelivered":
      return MessageDeliveredDto.make({ id: event.id })
    case "ChildrenSpawned":
      return ChildrenSpawnedDto.make({ step: event.step, ids: [...event.ids] })
    case "HandedOff":
    case "GoalOpened":
      return toOpenedDto(event)
    case "ChildLanded":
      return toChildLandedDto(event)
    case "ChildRefiled":
      return toChildRefiledDto(event)
    case "ChildrenJoined":
      return ChildrenJoinedDto.make({ step: event.step, merged: [...event.merged] })
    case "Abandoned":
      return toAbandonedDto(event)
    case "Closed":
      return ClosedDto.make({})
    case "Merged":
      return MergedDto.make({})
    case "WorkMerged":
      return WorkMergedDto.make({ sha: event.sha })
    case "ChangesDropped":
      return ChangesDroppedDto.make({ reason: event.reason })
    case "Reentered":
      return toReenteredDto(event)
    case "AutoMergeStopped":
      return AutoMergeStoppedDto.make({ cause: event.cause })
  }
}

// ============================================================================
// Transcript entries (_tag-discriminated, exhaustive over the engine's union)
// ============================================================================

/**
 * The two fields every entry carries, hoisted rather than repeated in nine arms and
 * spread for the reason `detail` is: absent is a third state beside a number and
 * `"composer"`, and `undefined` is not a legal value of an exact optional.
 */
const carriedDto = (entry: TranscriptEntry): { position?: TurnPosition; at?: number } => ({
  ...(entry.position === undefined ? {} : { position: entry.position }),
  ...(entry.at === undefined ? {} : { at: entry.at }),
})

/** The delegation a line happened inside, spread for the reason `carriedDto` is. */
const insideDto = (parent: string | undefined): { parent?: string } =>
  parent === undefined ? {} : { parent }

export const toViewResultDto = (result: McpResult): ViewResultDto =>
  ViewResultDto.make({
    content: result.content,
    ...(result.structured === undefined ? {} : { structured: result.structured }),
    ...(result.meta === undefined ? {} : { meta: result.meta }),
    isError: result.isError,
  })

/**
 * One kept view as a surface draws it. The server's HTML is wrapped here, at the
 * boundary every surface reads through, in the document that carries its network
 * policy — so the stored HTML stays the server's own and no surface is handed it bare.
 */
export const toViewDto = (view: McpView, cli: string | undefined, answers: boolean): ViewDto =>
  ViewDto.make({
    server: view.server,
    tool: view.tool,
    html: viewDocument(view.html, view.policy),
    arguments: view.arguments,
    result: toViewResultDto(view.result),
    ...(cli === undefined ? {} : { cli }),
    answers,
  })

const toHookEntryDto = (entry: Extract<TranscriptEntry, { _tag: "Hook" }>): HookEntryDto =>
  HookEntryDto.make({
    ...(entry.call === undefined ? {} : { call: entry.call }),
    event: entry.event,
    status: entry.status,
    ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
    ...(entry.source === undefined ? {} : { source: entry.source }),
    ...(entry.message === undefined ? {} : { message: entry.message }),
    output: entry.output,
    ...carriedDto(entry),
  })

const toDeniedEntryDto = (entry: Extract<TranscriptEntry, { _tag: "Denied" }>): DeniedEntryDto =>
  DeniedEntryDto.make({
    ...(entry.call === undefined ? {} : { call: entry.call }),
    tool: entry.tool,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    ...(entry.source === undefined ? {} : { source: entry.source }),
    ...carriedDto(entry),
  })

const toSpawnedEntryDto = (entry: Extract<TranscriptEntry, { _tag: "Spawned" }>) =>
  SpawnedEntryDto.make({ pid: entry.pid, ...placeField(entry.place), ...carriedDto(entry) })

export const toTranscriptEntryDto = (entry: TranscriptEntry): TranscriptEntryDto => {
  switch (entry._tag) {
    case "Spawned":
      return toSpawnedEntryDto(entry)
    case "Reask":
      return ReaskEntryDto.make({ reason: entry.reason, ...carriedDto(entry) })
    case "Session":
      return SessionEntryDto.make({ id: entry.id, ...carriedDto(entry) })
    case "Tool":
      // Spread rather than assigned: a tool with nothing to show has no `detail`,
      // and `undefined` is not a legal value of an exact optional.
      return ToolEntryDto.make({
        name: entry.name,
        kind: entry.kind,
        ...(entry.detail === undefined ? {} : { detail: entry.detail }),
        ...(entry.command === undefined ? {} : { command: entry.command }),
        ...(entry.call === undefined ? {} : { call: entry.call }),
        ...(entry.backgrounded === undefined ? {} : { backgrounded: entry.backgrounded }),
        ...insideDto(entry.parent),
        ...carriedDto(entry),
      })
    case "Text":
      return TextEntryDto.make({
        text: entry.text,
        ...insideDto(entry.parent),
        ...carriedDto(entry),
      })
    case "Said":
      return SaidEntryDto.make({ text: entry.text, ...carriedDto(entry) })
    case "View":
      return ViewEntryDto.make({
        call: entry.call,
        server: entry.server,
        tool: entry.tool,
        uri: entry.uri,
        ...carriedDto(entry),
      })
    case "Check":
      return CheckEntryDto.make({
        call: entry.call,
        server: entry.server,
        tool: entry.tool,
        name: entry.name,
        ...(entry.outcome === undefined ? {} : { outcome: entry.outcome }),
        ...carriedDto(entry),
      })
    case "Hook":
      return toHookEntryDto(entry)
    case "Denied":
      return toDeniedEntryDto(entry)
    case "Subagent":
      return SubagentEntryDto.make({
        call: entry.call,
        ...(entry.agentType === undefined ? {} : { agentType: entry.agentType }),
        ...(entry.description === undefined ? {} : { description: entry.description }),
        ...(entry.prompt === undefined ? {} : { prompt: entry.prompt }),
        ...carriedDto(entry),
      })
    case "SubagentResult":
      return SubagentResultEntryDto.make({
        call: entry.call,
        ok: entry.ok,
        ...(entry.summary === undefined ? {} : { summary: entry.summary }),
        ...(entry.outcome === undefined ? {} : { outcome: entry.outcome }),
        ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
        ...carriedDto(entry),
      })
    case "Background":
      return BackgroundEntryDto.make({
        tasks: entry.tasks.map((t) => ({
          id: t.id,
          ...(t.taskType === undefined ? {} : { taskType: t.taskType }),
          ...(t.description === undefined ? {} : { description: t.description }),
        })),
        ...carriedDto(entry),
      })
    case "BackgroundStarted":
      return BackgroundStartedEntryDto.make({
        taskId: entry.taskId,
        call: entry.call,
        ...(entry.description === undefined ? {} : { description: entry.description }),
        ...carriedDto(entry),
      })
    case "ApiRetry":
      return ApiRetryEntryDto.make({
        attempt: entry.attempt,
        of: entry.of,
        ...(entry.status === undefined ? {} : { status: entry.status }),
        ...(entry.waitedMs === undefined ? {} : { waitedMs: entry.waitedMs }),
        ...carriedDto(entry),
      })
    case "Note":
      return NoteEntryDto.make({
        text: entry.text,
        // Only an outcome has one, and it is what puts it on the row of the call it answers.
        ...(entry.call === undefined ? {} : { call: entry.call }),
        ...insideDto(entry.parent),
        ...carriedDto(entry),
      })
  }
}

// ============================================================================
// Summaries (server → client)
// ============================================================================

/**
 * The composer's sentence for the plan entry the trak is standing at, and
 * `undefined` where it is not standing at one — before a plan exists, and once
 * the plan has run out.
 *
 * `"step" in state` rather than a switch over the eight states that carry one:
 * the question is literally whether there is an index to look up, and a list of
 * tags would be a second copy of the union's own shape to keep true. Every entry
 * carries an instruction, so a state with a step and a plan always has one — the
 * remaining `undefined` is an index past the end of a plan the log has since
 * replaced, which is a broken trak rather than a missing sentence.
 */
const stepInstruction = (trak: Trak): string | undefined =>
  trak.plan === undefined || !("step" in trak.state) || trak.state.step === undefined
    ? undefined
    : entryInstructionAt(trak.plan.steps[trak.state.step])

/**
 * The agent taking a turn right now, and `undefined` at every other state.
 *
 * A tag test rather than `"step" in state`, which is what separates this from
 * `stepInstruction` above: eight states carry a position and only one of them is an
 * agent turn in flight. Checks, spawns, joins, commits, sends and the five gates stand at
 * an agent's entry without that agent running, and the list draws them by what they are
 * doing rather than by whose position they are on. See `TrakSummaryDto.agent`.
 *
 * **Custody is asked too.** An `AgentWorking` nothing holds is a turn whose process died,
 * and a name sent there would put the agent's face on a row that says it stopped.
 *
 * The entry's type is still asked, so an `AgentWorking` whose position is not an agent
 * entry reports nothing rather than a name read off a shape that has none. Nothing in
 * the engine produces that pairing; the alternative to checking is a cast.
 */
const stepAgent = (trak: Trak, running: boolean): string | undefined => {
  if (!running || trak.plan === undefined || trak.state._tag !== "AgentWorking") return undefined
  const entry = trak.plan.steps[trak.state.step]
  return entry === undefined || isCompose(entry) || isSpawn(entry) ? undefined : entry.agent
}

/**
 * The check scripts that run on the trak's next step, by name.
 *
 * Which entry is next is the domain's answer and which scripts its agent declares is
 * the library's; this is where the two meet, because a screen is told both rather than
 * holding either. The entry's type is asked for `stepAgent`'s reason. An agent the
 * library does not have answers nothing rather than dying as `RunChecks` would: a
 * mapper is total, and the step that reaches that entry is the one that says so.
 */
export const nextChecksOf = (trak: Trak, lib: Library): readonly string[] => {
  const at = nextCheckedPosition(trak)
  const entry = at === undefined ? undefined : trak.plan?.steps[at]
  if (entry === undefined || isCompose(entry) || isSpawn(entry)) return []
  return agentNamed(lib, entry.agent)?.checks ?? []
}

/**
 * The envelope the activity line holds, read off the log rather than looked for in
 * the text.
 *
 * The join is containment against the newest turn that reported one, which is the
 * same join a surface makes with `EventDto.envelope` — the entry is written while the
 * stream is flowing and the event only once the turn is over, so the two are matched
 * by their text and never by position. Backwards, because the newest turn is the one
 * whose words are still on the row, and a turn writing again puts its own entry there.
 */
const envelopeIn = (
  history: readonly Event[],
  activity: readonly TranscriptEntry[],
): string | undefined => {
  const texts = activity.flatMap((entry) => (entry._tag === "Text" ? [entry.text] : []))
  if (texts.length === 0) return undefined
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const e = history[i]
    if (e === undefined) continue
    if (e._tag !== "AgentReturned" && e._tag !== "ComposerReturned") continue
    const held = e.envelope
    if (held !== undefined && texts.some((text) => text.includes(held))) return held
  }
  return undefined
}

/**
 * The stretch of the running turn a row summarises: everything since the agent last spoke
 * at the top level, or since the turn began if it has not.
 *
 * **The row draws what the live log draws last**, and that is a row of the log rather than
 * an entry — `Read 4 files` is four entries. So the slice has to start early enough to hold
 * the whole of the last row, and the agent's own words are where that is guaranteed: a
 * `Text` closes the run behind it, so nothing before it can join a row after it.
 *
 * **Not the whole turn**, because the list polls every row something drives and a long turn
 * is hundreds of kilobytes. The slice is the price of one stretch of working instead.
 *
 * **A subagent's lines whose delegation opened before the slice are left out.** In the log
 * they are inside that delegation's card, which is not the last row; in a slice without the
 * card they would read as the agent's own calls and be counted into its run.
 */
export const latestStretch = (
  transcript: readonly TranscriptEntry[],
): readonly TranscriptEntry[] => {
  const position = transcript.at(-1)?.position
  let from = 0
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const entry = transcript[i]
    if (entry === undefined) continue
    // A turn that wrote no `Spawned` still ends where the stamp changes.
    if (entry.position !== position) {
      from = i + 1
      break
    }
    if (entry._tag === "Spawned" || (entry._tag === "Text" && entry.parent === undefined)) {
      from = i
      break
    }
  }
  const stretch = transcript.slice(from)
  const opened = new Set(stretch.flatMap((e) => (e._tag === "Subagent" ? [e.call] : [])))
  return stretch.filter((e) => !("parent" in e) || e.parent === undefined || opened.has(e.parent))
}

/**
 * Whether anything was kept on this trak's branch.
 *
 * **The hash, never the event.** `CommitWork` runs at every step boundary whether or not
 * anything landed, and `committed()` returns no sha when the branch tip is still where
 * the checkout started — so counting the events says *5 commits* about a branch with
 * none. The client's `commitsIn` counts distinct shas for the same reason; this is that
 * predicate reduced to the question the list asks, which needs no de-duplication because
 * a set is non-empty exactly when one element exists.
 */
const branchMoved = (history: readonly Event[]): boolean =>
  history.some((e) => e._tag === "WorkCommitted" && e.sha !== undefined)

/**
 * The position an agent is standing at, as the list ring reads it: a step index, the
 * composer, or nowhere.
 *
 * Exhaustive on purpose, because the two `undefined`s are different claims and a new
 * state has to say which it makes. A trak that has ended — `Finished`, `Closed`,
 * `Merged`, `Abandoned` — has no agent, so a ring on it would put a face on a row nobody
 * is running; the states between a plan's last step and its ending, and before its
 * first, stand at no entry. `Failed` stands where it failed from, which is the position
 * a resume re-enters.
 */
const standingAt = (
  state: TrakState,
  failedFrom: TrakState | undefined,
): TurnPosition | undefined => {
  switch (state._tag) {
    case "Composing":
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
      return "composer"
    case "HandingOff":
    case "AgentWorking":
    case "CheckRunning":
    case "ConditionRunning":
    case "AwaitingHuman":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    case "Effecting":
      return state.step
    case "Stopping":
      return state.step ?? "composer"
    case "Failed":
      return failedFrom === undefined ? undefined : standingAt(failedFrom, undefined)
    case "Preparing":
    case "Integrating":
    case "Merging":
    case "Closing":
    case "Abandoning":
    case "Finished":
    case "Closed":
    case "Merged":
    case "Abandoned":
      return undefined
  }
}

/** Which position an ending's turn ran for: its `step`, and the composer where it has none. */
const endedAt = (e: Event): TurnPosition =>
  "step" in e && e.step !== undefined ? e.step : "composer"

/**
 * The last reading an ending at `position` carried, with the window that ending's own
 * provider reported. `"usage" in e` for `usage.ts`'s reason: an ending that gains the
 * field is read the day it does.
 */
const lastReadAt = (
  history: readonly Event[],
  position: TurnPosition,
): { readonly held: Usage["context"]; readonly window: number | undefined } | undefined => {
  const ending = history.findLast(
    (e) => "usage" in e && e.usage?.context !== undefined && endedAt(e) === position,
  )
  return ending === undefined || !("usage" in ending) || ending.usage === undefined
    ? undefined
    : { held: ending.usage.context, window: ending.usage.contextWindow }
}

/**
 * How full the window is at the position the trak stands at — `TrakSummaryDto.context`.
 *
 * The turn in flight first, where it has read anything, and otherwise the last ending
 * at that same position: never an earlier position's, since the ring is about the
 * agent standing there and a figure carried over would draw a full ring for one that
 * has spent nothing. The window is the provider's where that reading came with one,
 * and the project's table for the position's model where it did not — the composer's
 * model from the table's own `composer`, a step's through `modelAt` — and absent with
 * neither, which the list draws as no ring rather than a guessed one.
 */
const contextOf = (
  trak: Trak,
  history: readonly Event[],
  inFlight: TurnSpent | undefined,
  lib: Library | undefined,
): ReadingDto | undefined => {
  const position = standingAt(trak.state, trak.failedFrom)
  if (position === undefined) return undefined
  const live = inFlight?.usage.context
  const read =
    live !== undefined && inFlight !== undefined
      ? { held: live, window: inFlight.usage.contextWindow }
      : lastReadAt(history, position)
  if (read?.held === undefined) return undefined
  const model =
    lib === undefined
      ? undefined
      : position === "composer"
        ? lib.models.composer
        : modelAt(trak, position, lib)
  const window = read.window ?? (model === undefined ? undefined : lib?.models.windows[model])
  return ReadingDto.make({ held: { ...read.held }, ...(window === undefined ? {} : { window }) })
}

/**
 * What `deploy.sh` said, as the wire says it: the script's three exits under a
 * surface's three words, its one JSON line read out into named fields, and the rest
 * as text. `none` where nothing ran — no script, or no merge commit to hand it — and
 * that member carries no time, because a value the port did not report is not a field.
 */
export const toDeployDto = (status: DeployStatus | undefined): DeployDto => {
  if (status === undefined) return DeployNoneDto.make({ answer: "none" })
  const read = readDeployOutput(status.output)
  return DeployRanDto.make({
    answer: status.answer,
    ...(read.url === undefined ? {} : { url: read.url }),
    ...(read.version === undefined ? {} : { version: read.version }),
    ...(read.detail === undefined ? {} : { detail: read.detail }),
    text: read.text,
    at: status.at,
  })
}

/**
 * The last thing the log heard from `deploy.sh` for a trak waiting on `deployed`: the
 * not-yet that rested it, or the answer that gave up. What a row draws until the
 * daemon's own memory has something newer — a restart forgets every ask since.
 *
 * `undefined` where the wait is on anything else, or where the answer that rested the
 * trak was about the merge rather than the deploy — `not merged yet` is a fact about
 * the branch, and a deploy line drawn from it would name a run that never happened.
 */
export const loggedDeployOf = (trak: Trak, history: readonly Event[]): DeployStatus | undefined => {
  const wait = waitingAt(trak)
  if (wait === undefined || wait.name !== "deployed") return undefined
  const answer = history.findLast((e) => e._tag === "ConditionsUnmet" && e.step === wait.step)
  return answer === undefined || answer.at === undefined
    ? undefined
    : deployStatusOf(answer, answer.at)
}

/**
 * What a resting trak is held behind, read through `waitingAt` so the wire and
 * `decide` agree on which rest counts. Spread, so a trak waiting on nothing carries
 * no key rather than one holding `undefined`. The summary and the projection both
 * carry it, so a row and a page cannot disagree about which wait a trak is on.
 */
const toWaitingDto = (trak: Trak): { waiting?: WaitingDto } => {
  const wait = waitingAt(trak)
  if (wait === undefined) return {}
  const until = timeWaitOf(trak, wait)
  return {
    waiting: WaitingDto.make({
      step: wait.step,
      name: wait.name,
      stopped: wait.stopped,
      ...(until === undefined ? {} : { until }),
    }),
  }
}

/**
 * One named input rather than a positional list, for both mappers: two branches each
 * adding an input to the same signature then disagree only on the object's property
 * list and never on argument order, and a call site with nothing to say for a new input
 * leaves it out rather than gaining an `undefined` at every one.
 */
export const toSummaryDto = ({
  trak,
  history,
  running,
  activity,
  deploy,
  inFlight,
  preparing,
  seam,
  lib,
  runner,
  now,
}: {
  readonly trak: Trak
  readonly history: readonly Event[]
  readonly running: boolean
  /** The time to judge idleness at. Left out, no row is idle. */
  readonly now?: number | undefined
  /** The preparation the trak is in now — daemon memory, `Preparation`'s answer. */
  readonly preparing?: PreparingPhase | undefined
  /** The trak's action at the seam now — daemon memory, `SeamStatuses`' answer. */
  readonly seam?: SeamStatus | undefined
  /** The newest stretch of the running turn — `latestStretch`. Absent when nothing drives. */
  readonly activity?: readonly TranscriptEntry[] | undefined
  /** What `deploy.sh` last said, for a trak waiting on `deployed` and no other. */
  readonly deploy?: DeployStatus | undefined
  /** The run record's turn, read only while something is driving — `contextOf`. */
  readonly inFlight?: InFlightTurn | undefined
  /** The project's `models.yaml`, for the window a reading is drawn against. */
  readonly lib?: Library | undefined
  /** The description of the runner the project sends work through, which a preparation names. */
  readonly runner?: string | undefined
}): TrakSummaryDto => {
  const instruction = stepInstruction(trak)
  const agent = stepAgent(trak, running)
  const touched = touchedAt(history)
  const active = activeAt(history)
  const idle = now !== undefined && !running && mayIdle(trak) && leftSince(active, now)
  const context = contextOf(trak, history, spentInFlight(inFlight), lib)
  return {
    id: trak.id,
    description: trak.description,
    state: toStateDto(trak.state, trak.failedFrom),
    running,
    mode: trak.mode,
    branchMoved: branchMoved(history),
    ...toWaitingDto(trak),
    // Spread rather than assigned: absent is what a trak a human asked for has,
    // and `undefined` is not a legal value of an exact optional. The same for every
    // one below — a trak before its plan has neither title nor instruction, one
    // before its checkout has no worktree, one nothing is holding has no activity,
    // and one whose log predates `at` has no touch time.
    ...(trak.parent === undefined ? {} : { parent: ParentDto.make({ ...trak.parent }) }),
    ...(trak.goal === undefined ? {} : { goal: trak.goal }),
    ...(trak.plan === undefined ? {} : { title: trak.plan.title }),
    ...(instruction === undefined ? {} : { instruction }),
    ...(agent === undefined ? {} : { agent }),
    ...(activity === undefined || activity.length === 0
      ? {}
      : { activity: activity.map(toTranscriptEntryDto) }),
    ...toWroteDto(envelopeIn(history, activity ?? [])),
    ...(trak.worktree === undefined
      ? {}
      : { worktreePath: trak.worktree.path, branch: trak.worktree.branch }),
    ...(touched === undefined ? {} : { touched }),
    ...(active === undefined ? {} : { active }),
    ...(idle ? { idle: true } : {}),
    ...(context === undefined ? {} : { context }),
    ...(deploy === undefined ? {} : { deploy: toDeployDto(deploy) }),
    ...preparingField(preparing, runner),
    ...seamField(seam),
    ...(sandboxedIn(history) ? { sandboxed: true } : {}),
  }
}

/**
 * Whether the trak's checkout is in a sandbox, by the place the newest `WorktreeReady`
 * recorded — a checkout made again lands on its own, and a log from before places were
 * recorded says nothing, so it reads as not.
 */
const sandboxedIn = (history: readonly Event[]): boolean =>
  history.findLast((e) => e._tag === "WorktreeReady")?.place?._tag === "Remote"

/**
 * A preparation as the wire names it. The three sandbox ones carry the runner file's own
 * description, which is the one place a provider is named.
 */
const toPreparingDto = (
  phase: PreparingPhase,
  described: string | undefined,
): PreparingPhaseDto => {
  const runner = described === undefined ? {} : { runner: described }
  return PreparingPhase.$match(phase, {
    Checkout: () => PreparingCheckoutDto.make({}),
    Creating: () => PreparingCreatingDto.make(runner),
    Resuming: () => PreparingResumingDto.make(runner),
    Rebuilding: () => PreparingRebuildingDto.make(runner),
    Seeding: () => PreparingSeedingDto.make({}),
    Copying: (c) => PreparingCopyingDto.make({ sent: c.sent, total: c.total }),
    SettingUp: () => PreparingSettingUpDto.make({}),
    SetupBeside: () => PreparingSetupBesideDto.make({}),
  })
}

/** `seam`, spread, so none leaves no key. */
const seamField = (status: SeamStatus | undefined): { seam?: SeamStatusDto } =>
  status === undefined
    ? {}
    : {
        seam: {
          action: status.action,
          phase: status.phase,
          attempt: status.attempt,
          since: status.since,
          ...(status.lastError === undefined ? {} : { lastError: { ...status.lastError } }),
        },
      }

/** `preparing`, spread, so none leaves no key. */
const preparingField = (
  phase: PreparingPhase | undefined,
  runner: string | undefined,
): { preparing?: PreparingPhaseDto } =>
  phase === undefined ? {} : { preparing: toPreparingDto(phase, runner) }

/**
 * What happened at one entry's gate, with the entry as its name.
 *
 * Read off `Trak.marks` rather than rebuilt from the plan out here, for the reason
 * `continues` is copied across rather than read through `continuesFrom`: whether a gate
 * was the engine's is a question `attention.ts` answered when the gate was taken, and
 * answering it a second time at the boundary is a second reading to keep in step with
 * the first — one that a later change of mode would move.
 */
const toMarkDto = (at: number, m: Mark): MarkDto => {
  switch (m._tag) {
    case "Mode":
      return UnattendedModeDto.make({ at })
    case "Uneventful":
      return UnattendedUneventfulDto.make({ at, ambiguity: m.ambiguity })
    case "Resolving":
      return UnattendedResolvingDto.make({ at })
    case "Held":
      return HeldMarkDto.make({ at })
  }
}

/**
 * The engine's memory of a check run, straight across — every field on it is a fact the
 * `Checks` port reports, so there is nothing here to synthesise and nothing that could
 * disagree with what a frame carried.
 */
const toCheckRunDto = (run: CheckRun): CheckRunDto =>
  CheckRunDto.make({
    step: run.step,
    name: run.name,
    command: run.command,
    limit: run.limit,
    startedAt: run.startedAt,
    output: run.output,
    chunks: run.chunks,
    ...(run.call === undefined ? {} : { call: run.call }),
    ...(run.queued === undefined ? {} : { queued: run.queued }),
    ...placeField(run.place),
    ...(run.finished === undefined
      ? {}
      : {
          finished: {
            verdict: run.finished.verdict,
            at: run.finished.at,
            ...(run.finished.exitCode === undefined ? {} : { exitCode: run.finished.exitCode }),
          },
        }),
  })

/** Absent fields stay absent: an exit by signal carries no `code`, and one by code no signal. */
const toHostedStateDto = (state: HostedState): HostedStateDto =>
  HostedState.$match(state, {
    NotStarted: () => HostedNotStartedDto.make({}),
    Preparing: (s) =>
      HostedPreparingDto.make({
        port: s.port,
        startedAt: s.startedAt,
        stage: SpawnStage.$match(s.stage, {
          Readying: () => ReadyingStageDto.make({}),
          Copying: (c) => CopyingStageDto.make({ sent: c.sent, total: c.total }),
          Launching: () => LaunchingStageDto.make({}),
        }),
      }),
    Starting: (s) => HostedStartingDto.make({ port: s.port, startedAt: s.startedAt }),
    Running: (s) =>
      HostedRunningDto.make({
        port: s.port,
        startedAt: s.startedAt,
        readyAt: s.readyAt,
        url: s.url,
      }),
    DidNotComeUp: (s) =>
      HostedDidNotComeUpDto.make({
        port: s.port,
        startedAt: s.startedAt,
        at: s.at,
        reason: s.reason,
      }),
    Exited: (s) =>
      HostedExitedDto.make({
        port: s.port,
        startedAt: s.startedAt,
        at: s.at,
        ...(s.code === undefined ? {} : { code: s.code }),
        ...(s.signal === undefined ? {} : { signal: s.signal }),
      }),
    Stopped: (s) => HostedStoppedDto.make({ port: s.port, startedAt: s.startedAt, at: s.at }),
    StoppedByRestart: (s) => HostedStoppedByRestartDto.make({ at: s.at }),
  })

export const toHostedProcessDto = (run: HostedRun): HostedProcessDto =>
  HostedProcessDto.make({
    name: run.name,
    description: run.description,
    page: run.page,
    readySeconds: run.readySeconds,
    run: run.run,
    state: toHostedStateDto(run.state),
    log: run.log,
    chunks: run.chunks,
    ...placeField(run.place),
  })

export const toHostedProcessListDto = (runs: readonly HostedRun[]): HostedProcessListDto =>
  HostedProcessListDto.make({ processes: runs.map(toHostedProcessDto) })

/**
 * The wire's mergeability: `blocked` is drawn as `clean`, as it was before the engine
 * needed the two apart — the pane says what the reviews and checks say beside it.
 */
const drawnMerging = (m: PullRequest["merging"]): PullRequestSummaryDto["merging"] =>
  m === "blocked" ? "clean" : m

/** The forge's verdict on a merge pressed now, renamed across. */
const toMergeVerdictDto = (v: MergeVerdict): MergeVerdictDto =>
  MergeVerdict.$match(v, {
    Mergeable: () => MergeableDto.make({}),
    Checking: () => MergeCheckingDto.make({}),
    Blocked: ({ holds }) => MergeBlockedDto.make({ holds }),
  })

/** How far the engine has got merging the trak on its own, and where it may stop. */
const toAutoMergeDto = (a: AutoMerge): AutoMergeDto =>
  AutoMergeDto.make({
    sentBack: a.sentBack,
    limit: AUTO_MERGE_SENDS,
    ...(a.stopped === undefined ? {} : { stopped: a.stopped }),
  })

/**
 * What the trak is, as far as its log can say — the fields `TrakDetailDto` and
 * `AppendedFrameDto` share, built once so neither can be missing one the other has.
 *
 * `trak.lastGate` is deliberately NOT projected. It is the engine's memory of the
 * last gate parked at and outlives the gate itself; `state` is what is true now,
 * and the three parked variants carry every field a gate does. See the note in
 * `shared/src/dto/trak.ts`. Nor is the map of filed documents: every document a screen
 * draws is on the log as the `AgentReturned` that filed it, and the map is the one
 * thing that would make sending this on every append expensive.
 */
const toProjectionDto = (trak: Trak, lib: Library): TrakProjectionDto => ({
  // Straight across: the wire speaks the engine's own three words, so there is
  // nothing to map and no second vocabulary that could disagree with this one.
  mode: trak.mode,
  holding: trak.holding,
  skippingChecks: trak.skippingChecks,
  messages: trak.messages.map(waitingDto),
  returned: [...trak.returned],
  state: toStateDto(trak.state, trak.failedFrom),
  ...toWaitingDto(trak),
  ...(trak.landed === undefined ? {} : { landed: LandedDto.make({ sha: trak.landed.sha }) }),
  ...(trak.handedOffFrom === undefined ? {} : { handedOffFrom: trak.handedOffFrom }),
  ...(trak.goal === undefined ? {} : { goal: trak.goal }),
  ...(trak.autoMerge === undefined ? {} : { autoMerge: toAutoMergeDto(trak.autoMerge) }),
  ...(trak.mergeMethod === undefined ? {} : { mergeMethod: trak.mergeMethod }),
  // Spread rather than assigned, for `toSummaryDto`'s reason: `undefined` is not a
  // legal value of an exact optional.
  ...(trak.plan === undefined ? {} : { plan: toPlanDto(trak, trak.plan, lib) }),
  ...(trak.worktree === undefined ? {} : { worktree: toWorktreeDto(trak.worktree) }),
  decisions: toRecordedDtos(trak.decisions),
  marks: [...trak.marks].map(([at, m]) => toMarkDto(at, m)),
})

/**
 * Who is driving, as given — `since` is `startedAt` under the name a surface wants,
 * and nothing is synthesised: a field the port does not report is not a field.
 */
const toCustodyDto = (holder: Holder | undefined): CustodyDto =>
  CustodyDto.make(holder === undefined ? {} : { holder: { since: holder.startedAt } })

export const toDetailDto = ({
  trak,
  events,
  transcript,
  holder,
  check,
  inFlight,
  outage,
  asked,
  nextAsk,
  handoff,
  rebuild,
  preparing,
  seam,
  ownership,
  runner,
}: {
  readonly trak: Trak
  readonly events: readonly Event[]
  readonly transcript: readonly TranscriptEntry[]
  readonly holder?: Holder | undefined
  readonly check?: CheckRun | undefined
  /** The run record's turn, read only while `holder` is — daemon memory, like `check`. */
  readonly inFlight?: InFlightTurn | undefined
  /** The outage the trak's sandbox is in, told only on a turn in flight — see `Outages`. */
  readonly outage?: Outage | undefined
  /**
   * What the route asked other services, because this is not one: the library's
   * `nextChecksOf` and whether the project has `.orkestra/deploy.sh`, and git's answer
   * to which branch a hand-off at the plan gate would be cut from — asked only while
   * one is pending, `undefined` the rest of the time and where the repository has no
   * default branch to name. The goal a hand-off goes to, where it goes to one — see
   * `TrakDetailDto.handOffGoal`. And the library itself, for the model each plan entry
   * resolves to — `modelDtoOf`.
   */
  readonly asked: {
    readonly nextChecks: readonly string[]
    readonly deployScript: boolean
    readonly handOffBase: string | undefined
    readonly handOffGoal?: GoalId
    readonly lib: Library
  }
  /** The daemon's memory of when a waiting trak's condition is next asked, or nothing. */
  readonly nextAsk?: number | undefined
  /** How a person picks a sandboxed trak's session up — asked only where its checkout is in a sandbox. */
  readonly handoff?: HandoffDto | undefined
  /** A person's Rebuild of that sandbox, where one is owed — daemon memory, like `check`. */
  readonly rebuild?: Rebuild | undefined
  /** The preparation the trak is in now — daemon memory, like `check`. */
  readonly preparing?: PreparingPhase | undefined
  /** The trak's action at the seam now — daemon memory, like `check`. */
  readonly seam?: SeamStatus | undefined
  /** Whose it is, for a viewer who is not its owner — asked of the request, never of the log. */
  readonly ownership?: OwnershipDto | undefined
  /** The description of the runner the project sends work through, which a preparation names. */
  readonly runner?: string | undefined
}): TrakDetailDto => ({
  id: trak.id,
  description: trak.description,
  ...toProjectionDto(trak, asked.lib),
  nextChecks: asked.nextChecks,
  deployScript: asked.deployScript,
  ...(asked.handOffBase === undefined ? {} : { handOffBase: asked.handOffBase }),
  ...(asked.handOffGoal === undefined ? {} : { handOffGoal: asked.handOffGoal }),
  log: events.map(toEventDto),
  transcript: transcript.map(toTranscriptEntryDto),
  custody: toCustodyDto(holder),
  ...(check === undefined ? {} : { check: toCheckRunDto(check) }),
  ...inFlightDto(
    spentInFlight(inFlight),
    inFlight === undefined ? undefined : reattachingOf(inFlight.step, outage),
  ),
  ...(nextAsk === undefined ? {} : { nextAsk }),
  ...(handoff === undefined ? {} : { handoff }),
  ...(rebuild === undefined ? {} : { rebuild }),
  ...preparingField(preparing, runner),
  ...seamField(seam),
  ...(ownership === undefined ? {} : { ownership }),
})

/** The frame's `turn`, as an exact optional. */
const inFlightTurnField = (turn: TurnInFlightDto | undefined): { turn?: TurnInFlightDto } =>
  turn === undefined ? {} : { turn }

/** Spread, so a turn that has reported nothing leaves no key rather than one holding `undefined`. */
const inFlightDto = (
  turn: TurnSpent | undefined,
  reattaching: Reattaching | undefined,
): { inFlight?: TurnInFlightDto } => {
  const dto = toInFlightDto(turn, reattaching)
  return dto === undefined ? {} : { inFlight: dto }
}

// ============================================================================
// Stream frames (server → every watcher)
// ============================================================================

/**
 * One `Frame` as it goes on the wire.
 *
 * The engine publishes domain values so nothing in `workflow/` learns the wire
 * contract; this is where they become the same shapes every route already sends.
 * An `Appended` frame is built from `toProjectionDto` exactly as the detail is, and a
 * `Drive` from `toCustodyDto`, which is what lets a watcher holding a `TrakDetailDto`
 * replace its fields from a frame without reconciling anything.
 *
 * `Resync` has no domain twin — the transport raises it when a subscriber asked from
 * before the feed's buffer — so it is constructed at the route rather than mapped here.
 * `runner` is the description of the runner the project sends work through, which a
 * preparation names.
 */
export const toFrameDto = (frame: Frame, lib: Library, runner?: string): EngineFrameDto => {
  switch (frame._tag) {
    case "Appended":
      return AppendedFrameDto.make({
        trak: frame.id,
        seq: frame.seq,
        event: toEventDto(frame.event),
        ...toProjectionDto(frame.trak, lib),
      })
    case "Activity":
      return ActivityFrameDto.make({
        trak: frame.id,
        seq: frame.seq,
        entry: toTranscriptEntryDto(frame.entry),
      })
    case "Removed":
      return RemovedFrameDto.make({ trak: frame.id })
    case "CheckStarted":
      return CheckStartedFrameDto.make({ trak: frame.id, run: toCheckRunDto(frame.run) })
    case "CheckOutput":
      return CheckOutputFrameDto.make({
        trak: frame.id,
        step: frame.step,
        seq: frame.seq,
        chunk: frame.chunk,
      })
    case "CheckEnded":
      return CheckEndedFrameDto.make({ trak: frame.id, run: toCheckRunDto(frame.run) })
    case "Drive":
      return DriveFrameDto.make({ trak: frame.id, custody: toCustodyDto(frame.holder) })
    case "InFlight":
      return InFlightFrameDto.make({
        trak: frame.id,
        ...inFlightTurnField(toInFlightDto(frame.turn, frame.reattaching)),
      })
    case "Process":
      return ProcessFrameDto.make({
        ...(frame.id === undefined ? {} : { trak: frame.id }),
        process: toHostedProcessDto(frame.process),
      })
    case "ProcessOutput":
      return ProcessOutputFrameDto.make({
        ...(frame.id === undefined ? {} : { trak: frame.id }),
        name: frame.name,
        run: frame.run,
        seq: frame.seq,
        chunk: frame.chunk,
      })
    case "Goal":
      return GoalFrameDto.make({ goal: frame.goal })
    case "Usage":
      return UsageFrameDto.make({ usage: toCliUsageDto(frame.usage) })
    case "Preparing":
      return PreparingFrameDto.make({ trak: frame.id, ...preparingField(frame.phase, runner) })
    case "SeamStatus":
      return SeamStatusFrameDto.make({ trak: frame.id, ...seamField(frame.status) })
  }
}

// ============================================================================
// Previews — what a command would do, before it does it
// ============================================================================

/**
 * What picking a trak back up from `position` would actually re-run.
 *
 * Exhaustive on purpose: a new state is a compile error here, which is what stops a
 * caller being asked a spend question about a position that costs nothing — or, worse,
 * not being asked about one that does.
 */
const retryAt = (position: TrakState): "rerun" | "gate" | "nowhere" => {
  switch (position._tag) {
    // `restartFrom` returns the same Await these already carry: no turn, no command,
    // nothing spent. The trak is parked, not stuck.
    case "AwaitingProposal":
    case "AwaitingComposerAnswers":
    case "AwaitingHuman":
      return "gate"

    // `restartFrom` settles. Unreachable in practice — `applyEvent` keeps `failedFrom`
    // off a terminal state — but saying so beats inventing a retry.
    case "Finished":
    case "Closed":
    case "Merged":
    case "Failed":
    case "Abandoned":
      return "nowhere"

    // `AwaitingChildren` is with them: re-entering it re-drives every child that has
    // not landed, which is the most expensive thing on this list.
    case "Preparing":
    case "Composing":
    case "AgentWorking":
    case "CheckRunning":
    // A kill, which spends nothing; with them because it is a command re-issued.
    case "Stopping":
    // With them, and cheapest of all: asking a script about the world twice costs
    // the script.
    case "ConditionRunning":
    case "HandingOff":
    case "Spawning":
    case "AwaitingChildren":
    case "Joining":
    case "Committing":
    // With them, and cheap: an effect is idempotent by construction, so re-running
    // one that already landed reports what is already there.
    case "Effecting":
    case "Integrating":
    case "Abandoning":
    // Free, and the two here that are: the checkout was on its way out when git said
    // no, and a merge that conflicted merged nothing. Re-running either is git.
    case "Closing":
    case "Merging":
      return "rerun"
  }
}

/**
 * Where a resume would pick up, and what that would cost.
 *
 * Two different situations, told apart because they read differently to a person: a
 * `Failed` trak recorded where it failed, and an interrupted one recorded nothing —
 * its state is simply neither parked nor terminal, which is `replayHistory` saying the
 * last command was still in flight when its process died.
 */
export const toResumePreviewDto = (
  trak: Trak,
  holder: { readonly startedAt: number } | undefined,
): ResumePreviewDto => {
  const failed = trak.state._tag === "Failed" ? trak.state : undefined
  const position = failed === undefined ? trak.state : trak.failedFrom
  const parked = asGate(trak.state) !== undefined
  return {
    retry: position === undefined ? "nowhere" : retryAt(position),
    // Interrupted means nothing is driving it *and* it is neither parked nor settled.
    // A trak somebody is driving right now is not interrupted, it is busy.
    interrupted: holder === undefined && failed === undefined && !parked && !atRest(trak.state),
    ...(position === undefined ? {} : { position: toStateDto(position) }),
    ...(failed === undefined ? {} : { failure: { error: failed.error, kind: failed.kind } }),
  }
}

/**
 * Where a merge would put it, and whether it would go in.
 *
 * A child names its parent instead of a branch: its work goes back where it came from,
 * and there is nowhere else it could go.
 *
 * `conflicts` arrives as an argument rather than being computed here, on this file's
 * own rule: a mapper reaches for no service, and the answer is a live `git` question
 * the route asks. `undefined` is what it means for nobody to have asked.
 */
export const toMergePreviewDto = (
  trak: Trak,
  hostBranch: string | undefined,
  conflicts: boolean | undefined,
): MergePreviewDto => ({
  ...(trak.worktree === undefined ? {} : { branch: trak.worktree.branch }),
  ...(trak.parent === undefined
    ? {
        ...(hostBranch === undefined ? {} : { into: hostBranch }),
        ...(trak.goalBranch === undefined ? {} : { goalBranch: trak.goalBranch }),
      }
    : { parentId: trak.parent.id }),
  ...(conflicts === undefined ? {} : { conflicts }),
})

const toChangeLineDto = (line: ChangeLine): ChangeLineDto => ({
  kind: line.kind,
  text: line.text,
  ...(line.oldLine === undefined ? {} : { oldLine: line.oldLine }),
  ...(line.newLine === undefined ? {} : { newLine: line.newLine }),
})

const toChangeHunkDto = (hunk: ChangeHunk): ChangeHunkDto => ({
  oldStart: hunk.oldStart,
  oldCount: hunk.oldCount,
  newStart: hunk.newStart,
  newCount: hunk.newCount,
  heading: hunk.heading,
  lines: hunk.lines.map(toChangeLineDto),
})

const toFileChangeDto = (file: FileChange): FileChangeDto => ({
  path: file.path,
  ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
  change: file.change,
  additions: file.additions,
  deletions: file.deletions,
  binary: file.binary,
  ...(file.omitted === undefined ? {} : { omitted: file.omitted }),
  hunks: file.hunks.map(toChangeHunkDto),
})

/**
 * One slice of the work, on the wire.
 *
 * `at` is echoed as the string it arrived as, so a response that lands after the
 * selection has moved can be told from the one that was asked for. A step index
 * is a number everywhere else and a string here for that reason alone — the
 * three rows of one picker are one field.
 */
export const toChangesDto = (at: ChangesAt, changes: Changes): ChangesDto => ({
  at: String(at),
  files: changes.files.map(toFileChangeDto),
  ...(changes.omittedFiles === undefined ? {} : { omittedFiles: changes.omittedFiles }),
})

/**
 * The whole fleet, in the order it arrives in — **unfiltered, and `start` is a field.**
 *
 * A plan entry may name any agent, so a surface drawing a step running `unblock` or
 * `resolve` has to be able to resolve its name; a list stopped at the startable ones left
 * those two unreachable. Filtering is now New Trak's, which is the one screen the question
 * belongs to. The engine's own `generic` rides along for exactly that reason — `fleet`
 * puts it there, and a plan row that could not resolve it would draw the fallback mark.
 *
 * **This is not a surface keeping its own opinion about which agents are odd** — the rule
 * that argument came from. The engine still says which; it says it on the row instead of by
 * omission.
 *
 * `description` goes whole. How much of it a tile shows is a question about a surface,
 * and answering it here would answer it once for all of them. `icon` crosses for the
 * same reason in reverse: which glyph an agent gets is the agent file's to say, so the
 * surface is told rather than holding a map of its own. `conditions` is the same fact
 * about which steps wait, verbatim, so the plan gate can mark them.
 */
/** `plannable` is the set a composer's plan may name — the library's own agents. */
export const toAgentDtos = (
  agents: readonly Agent[],
  plannable: ReadonlySet<string>,
): readonly AgentDto[] =>
  agents.map((a) =>
    AgentDto.make({
      name: a.name,
      description: a.description,
      start: a.start,
      ...(a.icon === undefined ? {} : { icon: a.icon }),
      conditions: a.conditions,
      model: a.model,
      plannable: plannable.has(a.name),
    }),
  )

/**
 * What the forge says about a branch, as the wire says it.
 *
 * **A rename and nothing more, which is the whole of why `vcs/` has its own
 * vocabulary for this.** Every judgement — which of a forge's merge states is a
 * refusal, which review a thread belongs to, what a check with no conclusion is —
 * was made in `vcs/logic/forge-answer.ts` against a payload a test can hold. A
 * mapper that had to decide any of it here would be deciding it somewhere no
 * fixture reaches.
 *
 * The tag names differ on purpose: inside the engine the answer is one of three
 * things a forge said, so `None` and `Unavailable` are enough; on the wire they
 * sit beside every other DTO and have to say what they are about.
 *
 * **`branch` arrives as an argument, on this file's own rule** — the branch is the
 * question rather than part of what the forge said, and the route is what holds
 * the question, exactly as `ForgeListingEntry` carries it beside the summary
 * rather than inside it. `undefined` is a trak with no branch to have asked
 * about, which is the one case the route answers without consulting the forge —
 * so the two answering members carry it wherever there was one, and
 * `ForgeUnavailable` and `NoOrigin` never do: those are about the call, not a branch.
 */
export const toPullRequestDto = (
  answer: ForgeAnswer,
  branch: string | undefined,
): PullRequestDto => {
  const asked = branch === undefined ? {} : { branch }
  return ForgeAnswer.$match(answer, {
    None: () => NoPullRequestDto.make(asked),
    Unavailable: ({ why }) => ForgeUnavailableDto.make({ why }),
    NoOrigin: () => ForgeNoOriginDto.make({}),
    Found: ({ pullRequest: pr }) =>
      PullRequestFoundDto.make({
        ...asked,
        number: pr.number,
        url: pr.url,
        title: pr.title,
        state: pr.state,
        isDraft: pr.isDraft,
        merging: drawnMerging(pr.merging),
        ...(pr.decision === undefined ? {} : { decision: pr.decision }),
        ...(pr.base === undefined ? {} : { base: pr.base }),
        rollup: pr.rollup,
        checks: pr.checks,
        reviews: pr.reviews,
        conversation: pr.conversation,
        truncated: pr.truncated,
        ...(pr.mergeMethod === undefined ? {} : { mergeMethod: pr.mergeMethod }),
        mergeMethods: [...pr.mergeMethods],
        ...(pr.mergeVerdict === undefined
          ? {}
          : { mergeVerdict: toMergeVerdictDto(pr.mergeVerdict) }),
      }),
  })
}

/**
 * What the forge said about the branches it was handed, as the wire says it — the same
 * rename, over the shape a list row reads.
 *
 * `ForgeUnavailableDto` is shared with the answer above rather than copied, because it
 * is the same fact said about a whole call instead of one branch: the forge could
 * not be asked. **What it is not is the absence of a pull request**, and the two
 * members below are the wire refusing to let a surface confuse them.
 *
 * An entry with no `pull` crosses as an entry with no `pull`: the forge was asked about
 * that branch and said there is none. A branch with no entry at all crosses as nothing,
 * which is the third fact and the one a surface may not act on.
 */
export const toForgeListingDto = (listing: ForgeListing): ForgeListingDto =>
  ForgeListing.$match(listing, {
    Unavailable: ({ why }) => ForgeUnavailableDto.make({ why }),
    NoOrigin: () => ForgeNoOriginDto.make({}),
    Listed: ({ entries }) =>
      PullRequestsDto.make({
        entries: entries.map((entry) =>
          PullRequestEntryDto.make({
            branch: entry.branch,
            ...(entry.pull === undefined
              ? {}
              : {
                  pull: PullRequestSummaryDto.make({
                    number: entry.pull.number,
                    title: entry.pull.title,
                    url: entry.pull.url,
                    state: entry.pull.state,
                    isDraft: entry.pull.isDraft,
                    merging: drawnMerging(entry.pull.merging),
                    ...(entry.pull.decision === undefined ? {} : { decision: entry.pull.decision }),
                    ...(entry.pull.base === undefined ? {} : { base: entry.pull.base }),
                    checks: entry.pull.checks,
                  }),
                }),
          }),
        ),
      }),
  })

// ============================================================================
// Request DTOs (client → server)
// ============================================================================

/**
 * Blank is absent, decided here and nowhere else.
 *
 * Three callers can send a note — a form, a shell prompt loop, and a test — and
 * only one normalisation makes *no note renders nothing* true of every path. The
 * Schema cannot state it: an empty string is a well-formed value of a free-form
 * box a person may leave alone, so refusing it would be a 400 for having typed a
 * space.
 */
const noteFrom = (note: string | undefined): string | undefined => {
  const said = note?.trim()
  return said === undefined || said === "" ? undefined : said
}

/** One edit off the wire, as the domain's. `at` and `key` pass through unread. */
const editFromDto = (e: StepEditDto): PlanEdit => {
  switch (e.edit) {
    case "remove":
      return Edits.remove(e.at)
    case "instruction":
      return Edits.reword(e.at, e.instruction)
    case "continues":
      return Edits.continueFrom(e.at, e.key)
    case "clearWait":
      return Edits.clearWait(e.at)
    case "agent":
      return Edits.swapAgent(e.at, e.agent)
    case "model":
      return Edits.pickModel(e.at, e.model)
    case "pieceRemove":
      return Edits.removePieceStep(e.at, e.piece, e.step)
    case "pieceInstruction":
      return Edits.rewordPiece(e.at, e.piece, e.step, e.instruction)
    case "pieceAgent":
      return Edits.swapPieceAgent(e.at, e.piece, e.step, e.agent)
    case "pieceModel":
      return Edits.pickPieceModel(e.at, e.piece, e.step, e.model)
  }
}

/**
 * Total — no throw. `ActRequestDto.answers` is a `NonEmptyArray`, so an empty
 * list never gets past `schemaBodyJson` and there is nothing here to guard; so is
 * `edits.steps`. Whether the edits fit the plan at the gate is the route's to ask, before
 * anything is appended — `proposal` is that question's and does not reach the domain.
 */
export const actFromDto = (req: ActRequestDto): HumanAction => {
  switch (req.action) {
    case "approve":
      return Actions.approve(
        req.edits === undefined ? undefined : Arr.map(req.edits.steps, editFromDto),
      )
    case "replan":
      return Actions.replan(req.reason)
    case "chat":
      return Actions.chat(req.message)
    case "answer":
      return Actions.answer(req.answers, noteFrom(req.note))
    case "skip":
      return Actions.skip(req.message)
    case "permit":
      return Actions.permit(req.granted)
  }
}

/** The git bar, as git and this engine's memory of its presses have it. */
export const toHostGitDto = (view: HostGitView): HostGitDto => ({
  head: HostHead.$match(view.status.head, {
    Branch: (head) => HostBranchDto.make({ name: head.name }),
    Detached: (head) => HostDetachedDto.make({ sha: head.sha }),
  }),
  origin: view.status.origin,
  ...(view.status.upstream === undefined ? {} : { upstream: { ...view.status.upstream } }),
  ...(view.fetchedAt === undefined ? {} : { fetchedAt: view.fetchedAt }),
  fetching: view.fetching,
  ...(view.failure === undefined ? {} : { failure: { ...view.failure } }),
})

/** The bar after a press that was not refused, with what only that press can say. */
export const toGitPressedDto = (view: HostGitView, pressed: Pressed): GitPressedDto => ({
  ...toHostGitDto(view),
  ...(pressed.kept === undefined ? {} : { stashed: { files: pressed.kept } }),
})

const toPlanUsageDto = (usage: PlanUsage): PlanUsageDto =>
  PlanUsage.$match(usage, {
    NotRead: () => UsageNotReadDto.make({}),
    Read: ({ at, windows }) =>
      UsageReadDto.make({ at, windows: windows.map((window) => ({ ...window })) }),
    Unavailable: ({ at, why }) => UsageUnavailableStateDto.make({ at, why: { ...why } }),
  })

/** One CLI's plan usage, as `GET /api/usage` and the `Usage` frame both carry it. */
export const toCliUsageDto = (usage: CliUsage): CliUsageDto => ({
  cli: usage.cli,
  polling: usage.polling,
  usage: toPlanUsageDto(usage.usage),
})

/** The browser's tree: the paths alone — the root is the engine's and names its disk. */
export const toProjectFilesDto = (files: ProjectFiles): ProjectFilesDto => ({
  paths: files.paths,
})

export const toFileContentDto = (file: ProjectFile): FileContentDto =>
  ProjectFile.$match(file, {
    Text: (f) => FileTextDto.make({ path: f.path, text: f.text, lines: f.lines }),
    Binary: (f) => FileBinaryDto.make({ path: f.path, bytes: f.bytes }),
    TooLarge: (f) => FileTooLargeDto.make({ path: f.path, bytes: f.bytes }),
  })

export const toFileSearchDto = (grep: ProjectGrep): FileSearchDto => ({
  matches: grep.matches.map((m) => ({ path: m.path, line: m.line, text: m.text })),
  cut: grep.cut,
})

export const toArchivedTrakListDto = (traks: readonly ArchivedTrak[]): ArchivedTrakListDto => ({
  traks: traks.map((t) => ({ id: t.id, title: t.title })),
})

/**
 * Why a press on the git bar did not run, as the body of its `409`. The templates are
 * for the one refusal that carries words an agent may be sent.
 */
export const toSyncRefusalDto = (refusal: SyncRefusal, templates: Templates): RefusalDto =>
  SyncRefusal.$match(refusal, {
    Detached: () => DetachedHeadDto.make({}),
    NoOrigin: () => NoOriginDto.make({}),
    NoUpstream: () => NoUpstreamDto.make({}),
    Dirty: (r) => DirtyDto.make({ files: r.files }),
    Diverged: (r) => DivergedDto.make({ ahead: r.ahead, behind: r.behind }),
    Behind: (r) => BehindDto.make({ behind: r.behind }),
    Conflicted: (r) =>
      ConflictDto.make({
        files: r.files,
        description: render(templates, "resolve-conflict", {
          branch: r.branch,
          upstream: r.upstream,
          files: r.files,
        }),
      }),
  })

// ============================================================================
// Goals
// ============================================================================

const toGoalStateDto = (state: GoalState): GoalStateDto => {
  switch (state._tag) {
    case "Composing":
      return GoalComposingStateDto.make({})
    case "AtGate":
      return GoalAtGateStateDto.make({ gate: state.gate })
    case "Watching":
      return GoalWatchingStateDto.make({})
    case "Failed":
      return GoalFailedStateDto.make({ reason: state.reason })
    case "Done":
      return GoalDoneStateDto.make({})
    case "Dropped":
      return GoalDroppedStateDto.make({ reason: state.reason })
  }
}

/**
 * One goal as the wire carries it. `running` is the daemon's own answer — a composer turn
 * in flight — and `offers` drops `Retry` and `NewSession` while one is, because there is then nothing to
 * retry: the state alone cannot tell a turn running from one a dead engine left owed.
 */
const toGoalLimitsDto = (limits: GoalSpec["limits"]): GoalDto["limits"] => ({
  ...limits,
  ...(limits.modes === undefined ? {} : { modes: [...limits.modes] }),
})

const toGoalDraftDto = (spec: GoalSpec): GoalDraftDto => ({
  // A draft always names its file; only a sub-goal's spec has none, and it is never drafted.
  file: spec.file ?? "",
  title: spec.title,
  line: spec.line,
  finished: spec.finished,
  limits: toGoalLimitsDto(spec.limits),
  ...(spec.branch === undefined ? {} : { branch: spec.branch }),
})

/**
 * Traks landed of planned, both counted over one set: every landed trak, and every plan
 * entry no landed trak has the title of. `plan` alone is not that set — a `replan` may list
 * only what is still to do, and `open_trak` takes titles the plan never listed — so its
 * length let `landed` run past it. A plan entry counts as landed by title, as the Traks
 * tab reads it, because the plan carries no id.
 */
const goalProgress = (goal: Goal): { readonly landed: number; readonly planned: number } => {
  const landed = goal.traks.filter((t) => t.status === "landed")
  const titles = new Set(landed.map((t) => t.title))
  const ahead = goal.plan.filter((p) => !titles.has(p.title)).length
  return { landed: landed.length, planned: landed.length + ahead }
}

const toActionRequestDto = (request: ActionRequest): GoalActionRequestDto => ({
  title: request.title,
  steps: [...request.steps],
  why: request.why,
  ...(request.trak === undefined ? {} : { trak: request.trak }),
})

/**
 * `parent` is the goal that opened this one as a sub-goal, read by the caller — absent
 * where it has none, or its log is gone, and the wire then names it by id alone.
 */
export const toGoalDto = (goal: Goal, running: boolean, parent?: Goal): GoalDto => ({
  id: goal.id,
  ...(goal.spec === undefined
    ? {}
    : {
        ...(goal.spec.file === undefined ? {} : { file: goal.spec.file }),
        title: goal.spec.title,
        line: goal.spec.line,
        finished: goal.spec.finished,
      }),
  ...(goal.spec === undefined && goal.draft !== undefined ? { title: goal.draft.title } : {}),
  limits: toGoalLimitsDto(goal.spec?.limits ?? {}),
  ...(goal.spec?.branch === undefined ? {} : { branch: goal.spec.branch }),
  ...(goal.asked === undefined ? {} : { asked: goal.asked }),
  ...(goal.openedBy === undefined ? {} : { from: goal.openedBy.from }),
  ...(goal.parent === undefined
    ? {}
    : {
        parent: {
          id: goal.parent.goal,
          title: parent === undefined ? goal.parent.goal : goalName(parent),
          ...(parent?.spec?.branch === undefined ? {} : { branch: parent.spec.branch }),
        },
      }),
  ...(goal.draft === undefined ? {} : { draft: toGoalDraftDto(goal.draft) }),
  state: toGoalStateDto(goal.state),
  paused: goal.paused,
  running,
  offers: goalOffers(goal.state).filter((a) => !(running && (a === "Retry" || a === "NewSession"))),
  plan: goal.plan.map((p) => ({ ...p })),
  subgoalPlan: goal.subgoalPlan.map((p) => ({ ...p })),
  traks: goal.traks.map((t) => ({ id: t.id, title: t.title, mode: t.mode, status: t.status })),
  subgoals: goal.subgoals.map((s) => ({ id: s.id, title: s.title, status: s.status })),
  ...goalProgress(goal),
  ...(goal.state._tag === "AtGate" &&
  goal.state.gate === "escalation" &&
  goal.escalation !== undefined
    ? {
        escalation: {
          questions: goal.escalation.questions.map(toQuestionDto),
          ...(goal.escalation.trak === undefined ? {} : { trak: goal.escalation.trak }),
        },
      }
    : {}),
  ...(goal.state._tag === "AtGate" && goal.state.gate === "action" && goal.action !== undefined
    ? { action: toActionRequestDto(goal.action) }
    : {}),
  ...(goal.done === undefined ? {} : { done: goal.done }),
  messages: goal.messages.map(waitingDto),
  ...(goal.startedAt === undefined ? {} : { startedAt: goal.startedAt }),
  ...(goal.endedAt === undefined ? {} : { endedAt: goal.endedAt }),
  dismissed: goal.dismissed,
})

/**
 * `undefined` for a line the page has no use for: a waiting message and its delivery, which
 * the goal's `messages` and the transcript's `Said` draw, and an old `Redraft` — the one
 * action the wire does not name, since no gate offers it.
 */
const goalEventBody = (e: GoalEvent): GoalEventDto | undefined => {
  switch (e._tag) {
    case "GoalStarted":
      return GoalStartedDto.make(e.parent === undefined ? {} : { parent: e.parent })
    case "GoalAsked":
      return GoalAskedDto.make({ asked: e.asked, ...attachedField(e.attachments) })
    case "GoalDrafted":
      return GoalDraftedDto.make({ call: e.call, draft: toGoalDraftDto(e.draft) })
    case "GoalDismissed":
      return GoalDismissedDto.make({})
    case "GoalTurnEnded":
      return GoalTurnEndedDto.make({ ...toSpentDto(e.usage) })
    case "GoalTurnFailed":
      return GoalTurnFailedDto.make({ reason: e.reason, ...toSpentDto(e.usage) })
    case "GoalTurnStopped":
      return GoalTurnStoppedDto.make({})
    case "PlanProposed":
      return GoalPlanProposedDto.make({
        call: e.call,
        traks: e.traks.map((p) => ({ ...p })),
        ...(e.note === undefined ? {} : { note: e.note }),
        ...(e.subgoals === undefined ? {} : { subgoals: e.subgoals.map((p) => ({ ...p })) }),
      })
    case "Replanned":
      return GoalReplannedDto.make({
        call: e.call,
        traks: e.traks.map((p) => ({ ...p })),
        why: e.why,
        ...(e.subgoals === undefined ? {} : { subgoals: e.subgoals.map((p) => ({ ...p })) }),
      })
    case "TrakOpened":
      return GoalTrakOpenedDto.make({ call: e.call, trak: e.trak, title: e.title, mode: e.mode })
    case "SubgoalOpened":
      return GoalSubgoalOpenedDto.make({ call: e.call, goal: e.goal, title: e.title })
    case "TrakMessaged":
      return GoalTrakMessagedDto.make({ call: e.call, trak: e.trak, message: e.message })
    case "TrakRecomposed":
      return GoalTrakRecomposedDto.make({ call: e.call, trak: e.trak, why: e.why })
    case "TrakDropped":
      return GoalTrakDroppedDto.make({
        trak: e.trak,
        reason: e.reason,
        ...(e.call === undefined ? {} : { call: e.call }),
      })
    case "Escalated":
      return GoalEscalatedDto.make({
        call: e.call,
        questions: e.questions.map(toQuestionDto),
        ...(e.trak === undefined ? {} : { trak: e.trak }),
      })
    case "ActionRequested":
      return GoalActionRequestedDto.make({
        call: e.call,
        title: e.title,
        steps: [...e.steps],
        why: e.why,
        ...(e.trak === undefined ? {} : { trak: e.trak }),
      })
    case "DoneProposed":
      return GoalDoneProposedDto.make({ call: e.call, summary: e.summary })
    case "TrakWoke":
      return GoalTrakWokeDto.make({ trak: e.trak, kind: e.kind })
    case "SubgoalWoke":
      return GoalSubgoalWokeDto.make({
        goal: e.goal,
        kind: e.kind,
        ...(e.said === undefined ? {} : { said: e.said }),
      })
    case "TrakHandedOff":
      return GoalTrakHandedOffDto.make({ trak: e.trak, handOff: [...e.handOff] })
    case "GoalActed":
      return e.action._tag === "Redraft" ? undefined : GoalActedDto.make({ action: e.action })
    case "GoalMessageWaiting":
    case "GoalMessageHeard":
    // Whose the goal is shows on its screen, not in its thread.
    case "GoalOwnerChanged":
    // The parent's thread draws these calls as ordinary call rows, and the sub-goal's own
    // row says where it stands: no move view is keyed to them yet.
    case "SubgoalMessaged":
    case "SubgoalDropped":
      return undefined
    case "GoalPaused":
      return GoalPausedDto.make({
        held: [...e.held],
        ...(e.subgoals === undefined ? {} : { subgoals: [...e.subgoals] }),
      })
    case "GoalResumed":
      return GoalResumedDto.make({
        released: [...e.released],
        ...(e.subgoals === undefined ? {} : { subgoals: [...e.subgoals] }),
      })
    case "GoalDropped":
      return GoalDroppedDto.make({ reason: e.reason })
    case "GoalSettingsChanged":
      return GoalSettingsChangedDto.make({ limits: toGoalLimitsDto(e.limits) })
  }
}

/** The goal's log as the page reads it: each line it draws, with its time where it has one. */
export const toGoalLogDto = (log: readonly GoalEvent[]): readonly GoalEventDto[] =>
  log.flatMap((e) => {
    const body = goalEventBody(e)
    return body === undefined ? [] : [{ ...body, ...(e.at === undefined ? {} : { at: e.at }) }]
  })
