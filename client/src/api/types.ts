/**
 * The port's vocabulary — the wire contract, renamed to nothing and re-exported.
 *
 * `client/.oxlintrc.json` restricts `@orkestra/shared` and its slices to type imports outside
 * `src/api/**`, and this file is what makes that livable: a feature says
 * `import type { TrakSummaryDto } from "../../api/types"` and never learns that a
 * package called `@orkestra/shared` exists. When the transport becomes Tauri IPC,
 * the shapes it speaks are still these.
 *
 * **Types only. No values, ever.** This file is kind `contract` in `client-style`'s
 * admission table — a re-export list and nothing else. `ApiError` is a class and
 * `branchLimit` is a number the wire package sets, so both live on the seam,
 * `api/http.ts` and `api/forge.ts`, and a feature that needs one takes it from there.
 *
 * **One name per consumer, added by the consumer that imports it.** `knip` reports an
 * exported type nobody imports, and `ignoreExportsUsedInFile` does not cover a
 * re-export, so a name listed ahead of its consumer fails `pnpm verify`. The rule takes
 * names away too: cutting the last importer cuts the name. A member reached off a shape
 * already named here stays unnamed — `PullRequestsDto["entries"]` is the same type by a
 * longer route — unless a builder in `fixtures.ts` or a component has to say what it
 * takes.
 */
export type { RecentProjectDto } from "@orkestra/shared/launcher"
export type { AttachmentDto, AttachmentUploadedDto } from "@orkestra/shared/dto/attachments"
export type { PageLogin } from "@orkestra/shared/page"
export type { RailProjectDto, RailStateDto } from "@orkestra/shared/rail"
export type {
  CreatedDto,
  MergePreviewDto,
  PlanEditsDto,
  StepEditDto,
  MergeMethodRequestDto,
} from "@orkestra/shared/dto/actions"
export type {
  ChangeHunkDto,
  ChangeLineDto,
  ChangesDto,
  FileChangeDto,
} from "@orkestra/shared/dto/changes"
export type { RefusalDto, RunModeDto } from "@orkestra/shared/dto/common"
export type {
  ReportDto,
  ReportLeftOutReasonDto,
  ReportLogDto,
  ReportSendAnswerDto,
  ReportSendRequestDto,
  ReportTrakDto,
} from "@orkestra/shared/dto/report"
export type {
  FileContentDto,
  FileMatchDto,
  FileSearchDto,
  ProjectFilesDto,
} from "@orkestra/shared/dto/files"
export type { AgentDto, ModelsDto } from "@orkestra/shared/dto/fleet"
export type {
  ForgeListingDto,
  PullRequestsDto,
  PullRequestSummaryDto,
  PullRequestCheckDto,
  PullRequestCommentDto,
  PullRequestDto,
  PullRequestFoundDto,
  MergeHoldDto,
  ReviewDto,
  ReviewThreadDto,
} from "@orkestra/shared/dto/forge"
export type { GitActionDto, GitPressedDto, HostGitDto } from "@orkestra/shared/dto/git"
export type {
  GoalActionDto,
  GoalActionRequestDto,
  GoalDetailDto,
  GoalDraftDto,
  GoalDto,
  GoalEventDto,
  GoalLimitsDto,
  GoalListDto,
  GoalSettingsDto,
  GoalStateDto,
  GoalTrakDto,
  PlannedSubgoalDto,
  PlannedTrakDto,
} from "@orkestra/shared/dto/goals"
export type {
  PushKeyDto,
  LoginRequestDto,
  PushSubscriptionDto,
} from "@orkestra/shared/dto/host-engine"
export type {
  ChildDto,
  ComposerOutputDto,
  CorrectionDto,
  DecidedDto,
  PlaceDto,
  DocumentDto,
  EntryDto,
  EventDto,
  ParentDto,
  PlanDto,
  StepDto,
  QuestionDto,
  ReconsultWhyDto,
  RecordedDto,
  ReentryCauseDto,
  StopCauseDto,
  AutoMergeDto,
  StepOutputDto,
  UsageDto,
  ReattachingDto,
  TurnInFlightDto,
  WorktreeDto,
} from "@orkestra/shared/dto/log"
export type {
  ChooseOpenerRequestDto,
  OpenCheckoutRequestDto,
  OpenerDto,
  OpenerKindDto,
  OpenerListDto,
  OpenersDto,
} from "@orkestra/shared/dto/openers"
export type {
  EngineFrameDto,
  ProcessFrameDto,
  ProcessOutputFrameDto,
} from "@orkestra/shared/dto/stream"
export type { AppendedFrameDto } from "@orkestra/shared/dto/trak-frames"
export type {
  ArchivedTrakDto,
  ArchivedTrakListDto,
  ViewDto,
  ViewResultDto,
  CheckRunDto,
  DeployDto,
  LandedDto,
  HostedProcessDto,
  HostedStateDto,
  PreparingStageDto,
  PreparingPhaseDto,
  SeamStatusDto,
  HandoffDto,
  MarkDto,
  TrakDetailDto,
  TrakListDto,
  TrakProjectionDto,
  TrakStateDto,
  TrakSummaryDto,
  UnattendedDto,
  WaitingDto,
} from "@orkestra/shared/dto/trak"
export type {
  ViewEntryDto,
  CheckEntryDto,
  HookEntryDto,
  DeniedEntryDto,
  ApiRetryEntryDto,
  NoteEntryDto,
  SubagentEntryDto,
  SubagentResultEntryDto,
  ToolEntryDto,
  TranscriptEntryDto,
  WaitingMessageDto,
} from "@orkestra/shared/dto/transcript"
export type {
  CliUsageDto,
  CliUsagesDto,
  PlanWindowDto,
  UsageFrameDto,
  UsageUnavailableDto,
} from "@orkestra/shared/dto/usage"
