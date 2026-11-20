// A trak as the engine reports it: its state, summary, projection, detail and what hangs off them. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"
import {
  ApiErrorKindDto,
  AutoMergeDto,
  EventDto,
  ParentDto,
  PlaceDto,
  PlanDto,
  ReadingDto,
  RecordedDto,
  RunnerFailureDto,
  TurnInFlightDto,
  WorktreeDto,
} from "./log.js"
import { RunModeDto } from "./common.js"
import { TranscriptEntryDto, WaitingMessageDto } from "./transcript.js"

// ============================================================================
// TrakState — one per variant, _tag-discriminated, plain strings
// ============================================================================

export const PreparingDto = Schema.TaggedStruct("Preparing", {})
export const ComposingDto = Schema.TaggedStruct("Composing", {})
export const AwaitingProposalDto = Schema.TaggedStruct("AwaitingProposal", {})
export const AwaitingComposerAnswersDto = Schema.TaggedStruct("AwaitingComposerAnswers", {})
export const AgentWorkingDto = Schema.TaggedStruct("AgentWorking", { step: Schema.Number })
export const CheckRunningDto = Schema.TaggedStruct("CheckRunning", { step: Schema.Number })
/**
 * A person pressed Stop on the turn at `step` — absent for the composer — and the engine
 * is ending it. Its intent is on the log already; what the kill is doing now is
 * `SeamStatusDto`. Left for the step's conversation gate or the plan gate.
 */
export const StoppingDto = Schema.TaggedStruct("Stopping", { step: Schema.optional(Schema.Number) })
/**
 * The plan has reached step `step` and its agent's conditions are being asked before
 * it starts — a script about the world, not a check on the work. Not met, the trak
 * rests at `Finished` holding the entry, which `TrakProjectionDto.waiting` says.
 * Every first entry of an agent step passes through here, nearly always inside one
 * command with nothing to draw.
 */
export const ConditionRunningDto = Schema.TaggedStruct("ConditionRunning", {
  step: Schema.Number,
})
export const AwaitingHumanDto = Schema.TaggedStruct("AwaitingHuman", {
  step: Schema.Number,
  kind: Schema.Literal("approval", "answers", "checks", "stuck", "conversation", "permission"),
})
/** A spawn position's child traks are being created. */
export const SpawningDto = Schema.TaggedStruct("Spawning", { step: Schema.Number })
/**
 * The plan gate went past and the traks the compose entry at `step` handed off are
 * being named, before the plan is entered. `Spawning`'s shape, and gone within one
 * command like it; nothing is being asked of anyone.
 */
export const HandingOffDto = Schema.TaggedStruct("HandingOff", { step: Schema.Number })
/**
 * They exist and owe this trak events. **Not a gate** — nobody is being asked
 * anything, so nothing here is answerable.
 */
export const AwaitingChildrenDto = Schema.TaggedStruct("AwaitingChildren", {
  step: Schema.Number,
})
/** All of them landed, and their work is being brought together. */
export const JoiningDto = Schema.TaggedStruct("Joining", { step: Schema.Number })
/** A completed step's work is being committed onto the branch. */
export const CommittingDto = Schema.TaggedStruct("Committing", { step: Schema.Number })
/**
 * The step's work is on the branch and the effects its agent declared are running —
 * the one place a plan reaches outside this checkout. Every step boundary passes
 * through it, including one with no effects at all, where it is entered and left
 * inside one command and nobody sees it.
 */
export const EffectingDto = Schema.TaggedStruct("Effecting", { step: Schema.Number })
export const IntegratingDto = Schema.TaggedStruct("Integrating", {})
/** A human said this trak is over; its work is being kept on its branch anyway. */
export const AbandoningDto = Schema.TaggedStruct("Abandoning", { reason: Schema.String })
/**
 * The plan ran out, the work is on the branch, and **the checkout is still
 * there**. Nobody has decided what happens to it: a human merges, re-enters or
 * closes it. Terminal in the sense that the engine does nothing further on its
 * own, which is not the same as the end of the trak.
 */
export const FinishedStateDto = Schema.TaggedStruct("Finished", {})
/** `git merge` is running in the host repository, into whatever branch it is on. */
export const MergingDto = Schema.TaggedStruct("Merging", {})
/**
 * A human is done with it, and the checkout is being taken away. `merged` is the
 * commit its branch went in as, absent for a plain close — which is what makes
 * this one state rather than two: clearing up is the same either way.
 */
export const ClosingDto = Schema.TaggedStruct("Closing", {
  merged: Schema.optional(Schema.String),
})
/**
 * Archived without a merge: the checkout, the branch and the branch's copy on
 * the forge are gone, and the log is what remains. **Not `Abandoned`** — nothing
 * was given up on, and a trak with nothing to merge ends here on purpose.
 */
export const ClosedStateDto = Schema.TaggedStruct("Closed", {})
/**
 * The work landed — a merge made from this machine, or a pull request GitHub said
 * merged, asked once at the archive. `sha` is the merge commit either way. The
 * one ending that says where the work *went*, which is why it is not a flag on
 * `Closed`.
 */
export const MergedStateDto = Schema.TaggedStruct("Merged", { sha: Schema.String })
/**
 * Declared over before it finished, and archived — the checkout, the branch and
 * the branch's copy on the forge went with it. Terminal, and **not a failure** —
 * nothing went wrong in the engine and there is nothing to retry, which is why it
 * is a state of its own rather than a `Failed` with a kinder word on it.
 */
export const AbandonedStateDto = Schema.TaggedStruct("Abandoned", { reason: Schema.String })
/**
 * Where the trak stopped, on two axes.
 *
 * `kind` says whose fault it is — the engine's `Failure`, spelled out here rather than
 * imported for the reason `ApiErrorKindDto` above carries — and `apiKind` says what the
 * API did, which is that constant and the same one `TurnFailedDto` takes. `archiving`
 * is the `archive` kind's own detail rather than a third axis: which archive it stopped.
 */
export const FailedStateDto = Schema.TaggedStruct("Failed", {
  error: Schema.String,
  kind: Schema.Literal("agent", "provider", "worktree", "archive", "merge", "project", "engine"),
  apiKind: Schema.optional(ApiErrorKindDto),
  /**
   * After a merge, after a close, or while abandoning — off `failedFrom`, which the wire
   * does not carry. Absent on every other kind. One kind rather than three, because the
   * failure and its press are the same and only the sentence about the work differs.
   */
  archiving: Schema.optional(Schema.Literal("merged", "closed", "abandoned")),
  /**
   * The runner verb the failure came from, where one did — so the notice leads with its
   * sentence rather than with the kind's. Absent with no runner file.
   */
  runner: Schema.optional(RunnerFailureDto),
  /**
   * The refusal of an engine started under `pnpm host --runners-only`, in the guard's own
   * words — a spawn it would not run on the host, whichever `kind` that made the failure.
   * The notice leads with it, since the fix is a runner rather than a retry.
   */
  runnersOnly: Schema.optional(Schema.String),
  /**
   * The ref holding the sandbox's uncommitted changes — `refs/orkestra/carried/<trak>` in
   * the project's repository — where a remake captured them and failed before putting
   * them back. A retry starts from the branch without them, so the notice says where they
   * are rather than that nothing is lost.
   */
  carried: Schema.optional(Schema.String),
  /**
   * What the project's setup script printed, where setup is what failed — so the notice
   * says setup failed rather than that the checkout could not be made, and can show it.
   * Absent on every other failure, and on one written before the field existed.
   */
  setup: Schema.optional(Schema.String),
  /**
   * `true` where a failed effect stopped the trak — the one failure a person may skip
   * past rather than retry. Off `failedFrom`, as `archiving` is. Absent on every other.
   */
  effecting: Schema.optional(Schema.Literal(true)),
})

export const TrakStateDto = Schema.Union(
  PreparingDto,
  ComposingDto,
  AwaitingProposalDto,
  AwaitingComposerAnswersDto,
  AgentWorkingDto,
  StoppingDto,
  CheckRunningDto,
  ConditionRunningDto,
  AwaitingHumanDto,
  HandingOffDto,
  SpawningDto,
  AwaitingChildrenDto,
  JoiningDto,
  CommittingDto,
  EffectingDto,
  IntegratingDto,
  AbandoningDto,
  FinishedStateDto,
  MergingDto,
  ClosingDto,
  ClosedStateDto,
  MergedStateDto,
  AbandonedStateDto,
  FailedStateDto,
)
export type TrakStateDto = Schema.Schema.Type<typeof TrakStateDto>

// There is deliberately no `GateDto`. The three parked states are already
// variants of `TrakStateDto` carrying every field a gate has, so "is this trak
// parked, and at what step" is answered by switching on `state._tag` — the one
// value that is true right now. The engine's `Trak.gate` is a *different*
// question ("the last gate this trak parked at", which survives into
// `AgentWorking` on purpose — see `domain/trak.ts`), and putting it on the wire
// invited the client to act on a trak that had already moved on.

// ============================================================================
// API response DTOs
// ============================================================================

/**
 * What an MCP tool call returned, as the view's own protocol names its parts: `content`
 * is the blocks, `structured` the server's `structuredContent` and `meta` its `_meta`.
 * The engine reads none of the three; a surface hands them to the view.
 */
export const ViewResultDto = Schema.Struct({
  content: Schema.Array(Schema.Unknown),
  structured: Schema.optional(Schema.Unknown),
  meta: Schema.optional(Schema.Unknown),
  isError: Schema.Boolean,
})
export type ViewResultDto = Schema.Schema.Type<typeof ViewResultDto>

/**
 * One kept view, whole — the body of `GET /api/traks/:id/views/:call`.
 *
 * **`html` is a string to set as a frame's `srcdoc`, never an address to open.** The
 * engine and the surface share an origin, so a view served as a page of its own would
 * run a server's script as the app. It is a document of the engine's own that holds
 * the server's HTML in a frame inside it: the network policy the server declared is
 * written on it, and it lets that frame load nothing else. A surface adds neither.
 *
 * `arguments` and `result` are the call's own, kept when it completed: a view draws
 * from them with no CLI running, and a surface never calls the tool again to redraw.
 *
 * `cli` is the CLI a press starts once the turn is over, as the far end names it — the
 * provider half of a model's name. `answers` is whether a press can reach anything:
 * `false` once the trak's checkout is gone, since there is no directory to start in.
 */
export const ViewDto = Schema.Struct({
  server: Schema.String,
  tool: Schema.String,
  html: Schema.String,
  arguments: Schema.Unknown,
  result: ViewResultDto,
  cli: Schema.optional(Schema.String),
  answers: Schema.Boolean,
})
export type ViewDto = Schema.Schema.Type<typeof ViewDto>

/**
 * A view's press — the body of `POST /api/traks/:id/views/:call/call`. `tool` is a bare
 * tool name, as the view wrote it; the server is the view's own and is not named here,
 * so a press cannot ask for another's.
 */
export const ViewCallRequestDto = Schema.Struct({
  tool: Schema.String,
  arguments: Schema.Unknown,
})
export type ViewCallRequestDto = Schema.Schema.Type<typeof ViewCallRequestDto>

/**
 * What `deploy.sh` said about a merge commit — the body of `GET /api/traks/:id/deploy`,
 * and a waiting row's `TrakSummaryDto.deploy`.
 *
 * **Two members, on whether the script ran.** `none` is a trak with nothing to ask
 * about — no `deploy.sh` in the project, or no merge commit to hand it — and it
 * carries no `at` because nothing ran at any time. The other three are the script's
 * three exits, with what it printed: the fields off its one JSON line where it wrote
 * one, and everything else as `text`. `at` is when the script ran, epoch milliseconds,
 * and a surface draws it beside the answer — a deploy's status is a fact about a world
 * that moves without telling the engine.
 *
 * The route runs the script while a merged trak's page is open, the way the pull
 * request pane polls, sharing one run across tabs and reusing an answer for a short
 * while; the sweep runs it on the interval the script's own header declares while a
 * trak waits. Both land here.
 */
export const DeployNoneDto = Schema.Struct({ answer: Schema.Literal("none") })
export const DeployRanDto = Schema.Struct({
  answer: Schema.Literal("live", "not-yet", "gave-up"),
  url: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
  text: Schema.String,
  at: Schema.Number,
})
export const DeployDto = Schema.Union(DeployNoneDto, DeployRanDto)
export type DeployDto = Schema.Schema.Type<typeof DeployDto>

/**
 * Since when, rather than which pid.
 *
 * One process does all the driving, so a pid on the wire is the daemon's own on every
 * held row — the same number everywhere, and nothing a reader can act on. `startedAt`
 * is on the record already, which is what makes *running for 2m* a projection rather
 * than an invention: a value the port does not report is not a field, and this one is
 * reported.
 *
 * Present-or-absent is still the signal that something is driving this trak.
 */
export const CustodyDto = Schema.Struct({
  holder: Schema.optional(Schema.Struct({ since: Schema.Number })),
})
export type CustodyDto = Schema.Schema.Type<typeof CustodyDto>

/**
 * The condition a resting trak is held behind: which entry, the script's name, and
 * whether the script has said the thing it waits for never will happen.
 *
 * Present only on a trak at `Finished` — the one rest a wait produces — on the
 * projection and on the list's summary alike, so a row can say which wait it is. A merge or an
 * archive ends the trak with the entry still unrun, which is the pending step being
 * dropped, and a re-entry re-cuts the plan from the held entry.
 */
export const WaitingDto = Schema.Struct({
  step: Schema.Number,
  name: Schema.String,
  stopped: Schema.Boolean,
  /**
   * The instant the wait is on, epoch milliseconds — present exactly where the wait is
   * the entry's own clock rather than a condition by name. Its presence is the whole
   * signal: `name` is then `wait_until`, `stopped` is never true of it, and the detail's
   * `nextAsk` is this same number.
   */
  until: Schema.optional(Schema.Number),
})
export type WaitingDto = Schema.Schema.Type<typeof WaitingDto>

/**
 * The preparation a trak is in now — engine memory, never on its log, so a restart
 * forgets it and the work that resumes names its own again.
 *
 * `Checkout` is a worktree made on the engine's machine. `Creating`, `Resuming` and
 * `Rebuilding` are the trak's sandbox made from the runner's tools template, started again
 * after an idle stop, or made again with its uncommitted work carried across; each carries
 * the runner file's `description`, which is where the provider is named — no surface
 * names one — absent only where the runner file went away under it. `Seeding` is the repository sent into a new sandbox, and `Copying` the files a
 * command there reads, `sent` of `total`. `SettingUp` is the project's setup script run
 * before the work that needs it; `SetupBeside` is the same script still running beside a
 * turn that started ahead of it, which is why it can stand beside any state.
 */
export const PreparingCheckoutDto = Schema.TaggedStruct("Checkout", {})
export const PreparingCreatingDto = Schema.TaggedStruct("Creating", {
  runner: Schema.optional(Schema.String),
})
export const PreparingResumingDto = Schema.TaggedStruct("Resuming", {
  runner: Schema.optional(Schema.String),
})
export const PreparingRebuildingDto = Schema.TaggedStruct("Rebuilding", {
  runner: Schema.optional(Schema.String),
})
export const PreparingSeedingDto = Schema.TaggedStruct("Seeding", {})
export const PreparingCopyingDto = Schema.TaggedStruct("Copying", {
  sent: Schema.Number,
  total: Schema.Number,
})
export const PreparingSettingUpDto = Schema.TaggedStruct("SettingUp", {})
export const PreparingSetupBesideDto = Schema.TaggedStruct("SetupBeside", {})
/**
 * What a trak's engine action at the seam — the boundary with where its work runs — is
 * doing now. Daemon memory, on no log: `action` names the action (`stop` today),
 * `phase` whether it is asking the sandbox's state, crossing into it, or waiting before
 * the next attempt, `attempt` the crossing being made from one, `since` when the action
 * began in epoch milliseconds, and `lastError` the transport failure it is waiting out, in
 * the runner's words.
 */
export const SeamStatusDto = Schema.Struct({
  action: Schema.String,
  phase: Schema.Literal("readying", "crossing", "waiting"),
  attempt: Schema.Number,
  since: Schema.Number,
  lastError: Schema.optional(
    Schema.Struct({ kind: Schema.Literal("unreachable", "lost"), said: Schema.String }),
  ),
})
export type SeamStatusDto = Schema.Schema.Type<typeof SeamStatusDto>

export const PreparingPhaseDto = Schema.Union(
  PreparingCheckoutDto,
  PreparingCreatingDto,
  PreparingResumingDto,
  PreparingRebuildingDto,
  PreparingSeedingDto,
  PreparingCopyingDto,
  PreparingSettingUpDto,
  PreparingSetupBesideDto,
)
export type PreparingPhaseDto = Schema.Schema.Type<typeof PreparingPhaseDto>

export const TrakSummaryDto = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  /**
   * The plan's title — one line naming the work, and the name a row in the list goes
   * by.
   *
   * Both this and `description` are on the wire, because they answer different
   * questions: the title is what this is, and the description is what was asked for,
   * word for word. A list wants the first — a raw request is a paragraph, and a list
   * of paragraphs is unreadable — and the detail page wants the second, since a
   * summary of a request is not a thing to hold anyone to.
   *
   * Absent until a plan exists, which is the only time a row has to fall back to the
   * request. **A trak started with an agent has a plan from birth**, and its title is
   * the request verbatim — so the row reads exactly as the fallback would until a
   * composer turn happens, which is why the wart is affordable. It moves afterwards:
   * every composer turn rewrites it, so a trak that was re-cut is renamed on the list
   * at the same moment.
   */
  title: Schema.optional(Schema.String),
  state: TrakStateDto,
  running: Schema.Boolean,
  /**
   * The trak's run mode, which every row draws as a mark — the list never fetches a
   * detail, so `TrakProjectionDto.mode` does not reach it. Required for that field's
   * reason: absence would be a second way to say `manual`.
   */
  mode: RunModeDto,
  /**
   * The wait this trak rests on at `Finished`, if any — the same `WaitingDto` the
   * projection carries, repeated here because the list never fetches a detail. The
   * name is what a row files on: a wait on `deployed` is the deploy's row from the
   * moment it starts, before the script has ever run, where every other wait is *held
   * on a condition*. Absent means the trak waits on nothing, as on the projection.
   */
  waiting: Schema.optional(WaitingDto),
  /**
   * Where a child came from, absent on a trak a human asked for.
   *
   * On the summary and not the detail, because the list is the one surface that
   * has to draw the relationship: a spawn of four puts four more rows in it, and
   * flat they read as four unrelated pieces of work. `child` is the position in
   * the spawn, which is what orders siblings — the store lists ids by directory
   * and that is not plan order.
   */
  parent: Schema.optional(ParentDto),
  /** The goal whose composer opened this trak, absent on every other trak. */
  goal: Schema.optional(Schema.String),
  /**
   * The composer's own sentence for the plan entry the trak is at —
   * `ProposalDto.steps[i].instruction`, which every entry carries, agent and
   * spawn alike.
   *
   * On the summary because a state word is a poor answer to *what is happening*:
   * "Working" is true of half a list at once, and this says which work. Absent
   * wherever there is no entry to read it off — before a plan exists, and once
   * the plan has run out — which is why the row it draws is two lines there and
   * three everywhere else.
   *
   * It costs no I/O: the list endpoint already replays each log, so this is a
   * projection off a `Trak` it is holding anyway.
   */
  instruction: Schema.optional(Schema.String),
  /**
   * Which agent is taking a turn right now, by name — the same projection off the same
   * plan entry `instruction` is, and it costs no I/O for the same reason.
   *
   * **Present only while an agent turn is actually in flight**, which is `AgentWorking`
   * with `running` and nothing else — an `AgentWorking` nothing holds is a turn whose
   * process died. A trak running its checks, spawning, joining, committing or
   * standing at any of the five gates is *at* an agent's position without that agent
   * running, and a name sent there would put a face on a row where nobody is working.
   * So its absence is the list's whole rule: a row draws the agent's mark where this is
   * here and the state's own glyph where it is not.
   *
   * Absent on a `Spawning` position too, which is the shape that makes this a name
   * rather than a tagged position: nothing on the list ever needs the composer or a
   * spawn named, because neither is a state this is sent at.
   */
  agent: Schema.optional(Schema.String),
  /**
   * The newest stretch of the running turn — the same entries `TrakDetailDto.transcript`
   * carries, from the agent's last words at the top level, or the turn's start, onwards.
   *
   * Entries rather than a rendered line, so the row summarises them with the rules the
   * live log draws by, and says `Read 4 files` where the log does. Formatting them is the
   * client's job in both places; a string here would be the server deciding how a row
   * reads. The engine's `latestStretch` carries where the slice starts and why.
   *
   * **Sent only while `running`.** Once nothing holds a trak, its last transcript
   * entry is not what is happening but the last thing that happened before the run
   * stopped, and a row drawing it says a trak is busy when it is not. That is also
   * what keeps the read cheap: the transcript file is opened for the held traks and
   * no others.
   */
  activity: Schema.optional(Schema.Array(TranscriptEntryDto)),
  /**
   * The envelope inside `activity`, when one of its entries holds one — the same string the
   * log's `AgentReturned`/`ComposerReturned` carries, sent here because the list has
   * no log to read it off.
   *
   * Without it the newest line of a trak that has just filed is a truncated line of
   * JSON, which says less than no line at all. Absent whenever `activity` is, and
   * whenever the turn wrote no envelope.
   */
  envelope: Schema.optional(Schema.String),
  /**
   * Where this trak's checkout is — the same string `TrakDetailDto.worktree.path`
   * carries.
   *
   * What a row subtracts from the path in `activity`, so it names the file rather
   * than the home directory the file is under. The path alone rather than the whole
   * `WorktreeDto`: a row needs a root and nothing else.
   *
   * Absent until the checkout exists — everything before a worktree runs in the
   * directory the daemon was started in — and a row with no root draws its detail
   * whole. It costs no I/O, on `instruction`'s argument.
   */
  worktreePath: Schema.optional(Schema.String),
  /**
   * The branch this trak's work is on.
   *
   * **It is here to be matched, never to be drawn**, which is the whole of why it was
   * kept off a summary until now: a `branch` beside a title invites a row to print it,
   * and a row already says what the work is in words a person wrote. What it is for is
   * `ForgeListingDto` — the forge answers about branches and knows nothing about traks,
   * so this is the only thing that joins one of its rows to one of these.
   *
   * Absent until the checkout exists, like `worktreePath`, and it costs no I/O for
   * `instruction`'s reason: the endpoint is holding the whole log already.
   */
  branch: Schema.optional(Schema.String),
  /**
   * Whether any commit was kept on this trak's branch.
   *
   * **The one thing a list cannot work out for itself.** A trak that ran its plan out
   * without writing code is filed in a pile of its own and offered no merge, and the fact
   * that decides it lives in the log: `WorkCommitted` carries no sha when the branch tip
   * is still where the checkout started. The detail page counts it off the log it already
   * holds (`commitsIn`); the list holds no log, so it arrives here.
   *
   * **Any hash at all, never a count.** `WorkCommitted.sha` is the branch tip after the
   * commit rather than a commit that step made, so two steps that changed nothing report
   * the same one and a count needs de-duplicating. A set is non-empty exactly when one
   * element exists, so *some event carries a sha* is provably the same predicate as
   * `commits > 0` with nothing to keep in step.
   *
   * **Required, not optional.** `false` before a checkout exists is true — nothing has
   * been committed — and an absence that could be read as an answer is the failure
   * `rungsOf` is written around.
   *
   * It costs no I/O, on `instruction`'s argument: the endpoint is holding the whole log
   * already.
   */
  branchMoved: Schema.Boolean,
  /**
   * The preparation the trak is in now — `PreparingPhaseDto` — and absent where none is.
   * Daemon memory, as on the detail; the list re-reads on its frame.
   */
  preparing: Schema.optional(PreparingPhaseDto),
  /** The trak's action at the seam now — `SeamStatusDto` — and absent where none is. */
  seam: Schema.optional(SeamStatusDto),
  /**
   * When a person last touched this trak — epoch milliseconds, the `at` of the
   * newest human-caused event in its log.
   *
   * What the list orders on. A row's position has to answer *what have I been
   * dealing with*, and the events an agent or the engine writes cannot say that:
   * ordering on the newest event of any kind would float a trak that has been
   * grinding unattended for an hour above the one a person answered a minute ago,
   * which inverts the reading. `touchedAt` in `workflow/domain/activity.ts` owns which
   * events count.
   *
   * Not rendered. The list sorts on it and shows no timestamp — surfacing the
   * number would invite reading it as *when something last happened*, which is a
   * different fact and one the row's `activity` already covers.
   *
   * Optional because a log written before events carried `at` has none, and
   * *unmeasured* is the honest answer rather than a zero that would sort to the
   * bottom of time. `TrakRecord.timed` is the same call. A row without it sorts
   * last in its section: absent means *we do not know*, and an unknown at the top
   * of the list would be the engine asserting something it cannot.
   *
   * It costs no I/O, on `instruction`'s argument — the list endpoint is holding
   * the whole log already.
   */
  touched: Schema.optional(Schema.Number),
  /**
   * When anything last happened to this trak — epoch milliseconds, the newest of a
   * person's press and a finished agent turn. What `idle` counts from, and what idle rows
   * order on: a trak a goal or an agent worked on recently has not been left.
   * Absent on a log written before events carried `at`.
   */
  active: Schema.optional(Schema.Number),
  /**
   * The trak has been left: nothing drives it, it is not resting on a condition the engine
   * still asks, and nothing has been `active` for three days. Computed against the clock
   * on every list read and never recorded, so the next press or finished turn ends it.
   * Absent on every other row.
   */
  idle: Schema.optional(Schema.Literal(true)),
  /**
   * How full the context window is at the position the trak stands at: the reading of
   * the turn in flight while one runs, otherwise the last reading an ending at that
   * position carried, over the window the engine resolved for it — `ReadingDto`.
   *
   * **Absent on a trak that has ended** — merged, finished, closed, abandoned — and on
   * one standing at a position nothing has read yet: a step whose first turn has said
   * nothing, a trak with no plan, one between its last step and its ending. The list
   * draws a ring where this is here and its window is known, and nothing where either
   * is missing; a ring on a merged row would be a face on a trak nobody is running.
   *
   * This position's own reading only, never an earlier step's: the question the ring
   * answers is what the agent now running or waiting holds, and a figure carried over
   * from the step before would draw a full ring for an agent that has spent nothing.
   */
  context: Schema.optional(ReadingDto),
  /**
   * What `deploy.sh` last said about this trak's merge commit — **only while the trak
   * is waiting on `deployed`**, and absent on every other row. The list draws a
   * waiting row's last answer; a merged trak's page asks the route below instead,
   * because a list that ran the script for every merged row would spend script runs
   * on traks nobody is waiting for.
   *
   * The daemon's own memory of the sweep's last ask, falling back to the not-yet the
   * log holds, which is what a restart reads until the sweep asks again.
   */
  deploy: Schema.optional(DeployDto),
  /** The trak's checkout is in a sandbox, by the place its last `WorktreeReady` recorded. */
  sandboxed: Schema.optional(Schema.Literal(true)),
})
export type TrakSummaryDto = Schema.Schema.Type<typeof TrakSummaryDto>

/**
 * `GET /api/traks`: a row per live trak, and how many are put away.
 *
 * **No row is sent for an archived trak.** The engine holds the set of them and never
 * opens their logs for a list, so what the archived header can say is a number, and it
 * does not open; a search finds one by name through `ArchivedTrakListDto` instead.
 * `archived` counts the parentless ones, because a header's count is of groups: an
 * archived child is not a row anywhere, on a band or on its own.
 */
export const TrakListDto = Schema.Struct({
  traks: Schema.Array(TrakSummaryDto),
  archived: Schema.Number,
})
export type TrakListDto = Schema.Schema.Type<typeof TrakListDto>

/**
 * How much of the work a turn said was unsettled when it met it — what it ran into,
 * never how sure it is of what it produced.
 *
 * The engine's own three words, for `RunModeDto`'s reason. It reaches a surface only
 * inside an `UnattendedDto`, where the point is that a gate went past on a rung this
 * low; the rung a document reports is in the document.
 */
export const AmbiguityDto = Schema.Literal("none", "some", "a_lot")
export type AmbiguityDto = Schema.Schema.Type<typeof AmbiguityDto>

/**
 * What happened at one plan entry's gate, named by `at`: the engine took it, and what
 * it read to take it — or a pressed Hold held this entry until a person accepted it.
 *
 * **One value per entry, and the two outcomes are members of one union**, so a document
 * cannot carry both bands: an entry has more than one gate, so the engine records
 * whichever gate the entry reached last, and a hold is written last where both would
 * land on one entry.
 *
 * **Nothing in the log corroborates the engine's own.** Running unattended writes no
 * `HumanActed`: the engine advances rather than recording that somebody pressed
 * something, so this is the only account of why a document nobody read was taken. It
 * is what the rule read at the moment it took the gate, stamped then and never
 * recomputed — so a change of mode afterwards moves no mark already made.
 *
 * `Mode` is the person's standing answer for the whole trak and has no evidence to
 * give beyond `TrakDetailDto.mode`. `Uneventful` is what `smart` lets through:
 * `ambiguity` is what the turn at that position reported, and the rest of the reason is
 * the absence of anything in the record — no second turn here, nothing raised, no
 * conversation planned, no round of fixing that has stopped landing.
 *
 * **A compose entry carries its own**, because the plan gate is asked about the run
 * that wrote the plan rather than about the entry approving would enter — so a round of
 * complaint-and-fix names its re-cut and its fix separately.
 */
export const UnattendedModeDto = Schema.TaggedStruct("Mode", { at: Schema.Number })
export const UnattendedUneventfulDto = Schema.TaggedStruct("Uneventful", {
  at: Schema.Number,
  ambiguity: AmbiguityDto,
})
/**
 * The engine sent the trak back to resolve a conflict on its pull request, and that
 * re-entry runs to rest with nobody at its gates, whatever the mode.
 */
export const UnattendedResolvingDto = Schema.TaggedStruct("Resolving", { at: Schema.Number })
export const UnattendedDto = Schema.Union(
  UnattendedModeDto,
  UnattendedUneventfulDto,
  UnattendedResolvingDto,
)
export type UnattendedDto = Schema.Schema.Type<typeof UnattendedDto>
/**
 * A pressed Hold held this entry until a person accepted it, and this is the acceptance
 * that spent it. Whether the mode *would* have gone past is not recorded — every gate
 * this entry reached stood — so a surface says what the person asked for and never that
 * a gate was taken from the mode.
 */
export const HeldMarkDto = Schema.TaggedStruct("Held", { at: Schema.Number })
export const MarkDto = Schema.Union(UnattendedDto, HeldMarkDto)
export type MarkDto = Schema.Schema.Type<typeof MarkDto>

/**
 * A check run at a position: the one in flight, or the last one to finish.
 *
 * **Nothing on disk backs this**, which is the one thing to know before drawing it. A
 * check's output is not written down — a script looping on `echo` would otherwise fill
 * something permanent — so the engine holds the run in memory and this is that memory
 * crossing. It is replaced when the trak's next check starts and it is gone when the
 * daemon restarts, at which point a *failed* run is still readable off `CheckFailedDto`
 * in the log and a passed one is not readable at all.
 *
 * `chunks` counts the `CheckOutput` frames that have gone out for this run, and it is
 * what makes patching decidable: a frame whose `seq` is not `chunks + 1` means something
 * was missed, and the answer is to ask for this again rather than to append into a hole.
 *
 * `limit` is the check's `timeout_seconds` and `startedAt` is epoch milliseconds; elapsed
 * is the gap between that and now, or `finished.at`. Both are reported rather than
 * synthesised at the boundary — a duration the server computed would be one nothing could
 * check.
 */
export const CheckRunDto = Schema.Struct({
  step: Schema.Number,
  /** The check's own name, from its filename — `verify`. */
  name: Schema.String,
  /** The line as spawned, absolute path and all. Shortening it for display is the client's. */
  command: Schema.String,
  limit: Schema.Number,
  startedAt: Schema.Number,
  output: Schema.String,
  chunks: Schema.Number,
  /**
   * The tool call an agent started this run with, through the engine's check tool. Such
   * a run judged no document: a surface draws it at the call, never on a card.
   */
  call: Schema.optional(Schema.String),
  /** Waiting for the exclusive turn, with nothing run yet. Absent once it runs. */
  queued: Schema.optional(Schema.Literal(true)),
  /** Where the check runs, from the moment it is spawned. */
  place: Schema.optional(PlaceDto),
  /**
   * Absent while it is still running. `cancelled` is a person having ended it — not a
   * failure, and drawn as neither verdict: nothing has said the work is wrong.
   */
  finished: Schema.optional(
    Schema.Struct({
      verdict: Schema.Literal("passed", "failed", "cancelled"),
      /** Absent for a timeout, for a check that could not be spawned, and for a cancel. */
      exitCode: Schema.optional(Schema.Number),
      at: Schema.Number,
    }),
  ),
})
export type CheckRunDto = Schema.Schema.Type<typeof CheckRunDto>

/**
 * Where a hosted process stands — one of the eight a surface draws.
 *
 * `Preparing` is a start before its script runs, at `stage`: `Readying` the sandbox —
 * waking it and checking its seed — `Copying` the files a command there reads, `sent` of
 * `total`, or `Launching` the script. Each stage has a time limit, and a start that
 * passes one ends `DidNotComeUp` with a reason naming the stage.
 *
 * `DidNotComeUp` is a start that failed: nothing answered on `port` within the
 * declaration's `ready_seconds`, the script exited before anything did, or it could not
 * be spawned; `reason` says which, in a sentence, and where the script printed anything,
 * its last lines follow on lines of their own. `Exited` is one that came up and later
 * ended on its own — `code` absent when a signal ended it. `Stopped` is a stop press, or
 * the command a turn runs. `StoppedByRestart` is a process the engine found still running
 * from before it restarted, and killed; nothing else about that run survived it.
 *
 * Times are epoch milliseconds, and `url` is the loopback address that answered:
 * `http://127.0.0.1:<port>/` or `http://[::1]:<port>/`, since a dev server may bind only
 * one of the two.
 */
export const HostedNotStartedDto = Schema.TaggedStruct("NotStarted", {})
export const ReadyingStageDto = Schema.TaggedStruct("Readying", {})
export const CopyingStageDto = Schema.TaggedStruct("Copying", {
  sent: Schema.Number,
  total: Schema.Number,
})
export const LaunchingStageDto = Schema.TaggedStruct("Launching", {})
export const PreparingStageDto = Schema.Union(ReadyingStageDto, CopyingStageDto, LaunchingStageDto)
export type PreparingStageDto = Schema.Schema.Type<typeof PreparingStageDto>
export const HostedPreparingDto = Schema.TaggedStruct("Preparing", {
  port: Schema.Number,
  startedAt: Schema.Number,
  stage: PreparingStageDto,
})
export const HostedStartingDto = Schema.TaggedStruct("Starting", {
  port: Schema.Number,
  startedAt: Schema.Number,
})
export const HostedRunningDto = Schema.TaggedStruct("Running", {
  port: Schema.Number,
  startedAt: Schema.Number,
  readyAt: Schema.Number,
  url: Schema.String,
})
export const HostedDidNotComeUpDto = Schema.TaggedStruct("DidNotComeUp", {
  port: Schema.Number,
  startedAt: Schema.Number,
  at: Schema.Number,
  reason: Schema.String,
})
export const HostedExitedDto = Schema.TaggedStruct("Exited", {
  port: Schema.Number,
  startedAt: Schema.Number,
  at: Schema.Number,
  code: Schema.optional(Schema.Number),
  signal: Schema.optional(Schema.String),
})
export const HostedStoppedDto = Schema.TaggedStruct("Stopped", {
  port: Schema.Number,
  startedAt: Schema.Number,
  at: Schema.Number,
})
export const HostedStoppedByRestartDto = Schema.TaggedStruct("StoppedByRestart", {
  at: Schema.Number,
})
export const HostedStateDto = Schema.Union(
  HostedNotStartedDto,
  HostedPreparingDto,
  HostedStartingDto,
  HostedRunningDto,
  HostedDidNotComeUpDto,
  HostedExitedDto,
  HostedStoppedDto,
  HostedStoppedByRestartDto,
)
export type HostedStateDto = Schema.Schema.Type<typeof HostedStateDto>

/**
 * One declared hosted process at one trak, as the daemon holds it.
 *
 * **Daemon memory, like `CheckRunDto`**: a process's state and output are written to no
 * file, so this is what a screen that refetched is caught up from, and an engine restart
 * forgets all of it but the `StoppedByRestart` it leaves for each process it killed.
 *
 * `page` is the declaration's: whether the process serves something to look at. `run`
 * tells one run from the next — a restart is a new one, and `ProcessOutput` frames name
 * the run they belong to. `log` is stdout and stderr together, kept from the end, and
 * `chunks` counts the frames sent for this run — the gap detector, for `CheckRunDto`'s
 * reason.
 */
export const HostedProcessDto = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  page: Schema.Boolean,
  readySeconds: Schema.Number,
  run: Schema.Number,
  state: HostedStateDto,
  log: Schema.String,
  chunks: Schema.Number,
  /** Where the run's script runs, from the moment it is spawned — absent while `Preparing` before that. */
  place: Schema.optional(PlaceDto),
})
export type HostedProcessDto = Schema.Schema.Type<typeof HostedProcessDto>

/** `GET /api/traks/:id/processes`: every declared process at the trak, in name order. */
export const HostedProcessListDto = Schema.Struct({
  processes: Schema.Array(HostedProcessDto),
})
export type HostedProcessListDto = Schema.Schema.Type<typeof HostedProcessListDto>

/**
 * The trak's branch has gone in, and `sha` is the commit it landed as.
 *
 * Present only once a wait has found it so — a `merged` or `deployed` wait passing, a
 * merge made from this machine while one was pending, or the `merged` asked once more
 * as a person skips a wait — and never on a trak merged with no wait, which ends
 * `Merged` and is never run on afterwards.
 * What a surface does with it: hide the merge press, because the branch is in, and
 * draw the deploy, because there is a commit to ask about. The engine's half is that
 * no `permission: write` agent runs on this trak from here on.
 */
export const LandedDto = Schema.Struct({ sha: Schema.String })
export type LandedDto = Schema.Schema.Type<typeof LandedDto>

/**
 * What a trak *is* right now, as far as its log can say: every field a screen draws
 * that the engine derives by replaying the log — and nothing it holds in memory only.
 *
 * **One shape, on two messages.** `TrakDetailDto` is this plus the two files and the
 * daemon's own memory; `AppendedFrameDto` is this plus the event that produced it.
 * Both spread these fields rather than naming them, so a field added here reaches the
 * stream and the full read in the same edit — a screen patching from frames cannot be
 * missing something the read would have given it, which is the gap that left a drawer
 * drawing one step while its buttons refused for another.
 *
 * What is deliberately *not* here: `custody`, `check` and `inFlight`, which no log holds
 * and no append can carry (`DriveFrameDto`, the check frames and `InFlightFrameDto` are
 * their own messages);
 * `nextChecks`, which the log does not answer either — it is read off the agent files
 * the plan names, which is `.orkestra/` policy and not replayed state; and the map of
 * filed documents — a few hundred kilobytes on a long trak, and every document a screen
 * draws is already on the log as the `AgentReturned` that filed it.
 */
export const TrakProjectionDto = Schema.Struct({
  /**
   * Required rather than optional, unlike the field on the event behind it: every
   * trak has a mode, and a log written before the field existed replays as `manual`
   * before this is built. Absence on the wire would be a second way to say `manual`.
   */
  mode: RunModeDto,
  /** The plan is held at this entry until its condition is met. See `WaitingDto`. */
  waiting: Schema.optional(WaitingDto),
  /** The branch went in while a wait was pending. See `LandedDto`. */
  landed: Schema.optional(LandedDto),
  /**
   * The trak whose composer handed this work off, on a trak born that way — the link's
   * near end, for a surface to name where the request came from. The far end is the
   * `HandedOff` on that trak's own log. Never on a child, which carries `parent`.
   */
  handedOffFrom: Schema.optional(Schema.String),
  /** The goal whose composer opened this trak — what the header links back to. */
  goal: Schema.optional(Schema.String),
  /** The engine merges this trak's pull request on its own. Absent where it does not. */
  autoMerge: Schema.optional(AutoMergeDto),
  /**
   * The method a person picked on the finished band, which the press and auto-merge both
   * merge with. Absent is the repository's default.
   */
  mergeMethod: Schema.optional(Schema.Literal("merge", "squash", "rebase")),
  /**
   * A press on *Hold* is pending: the current step stands at every gate it reaches
   * whatever `mode` would do there, and this goes back to `false` as a person accepts
   * it. Never `true` on
   * `manual` — the engine clears it when the mode is set there.
   */
  holding: Schema.Boolean,
  /**
   * A press on *Skip checks* is pending: the next check run on this trak does not
   * happen, and the step is accepted as a pass would accept it. Goes back to `false` as
   * that run is recorded — never on a run with nothing to skip, so it waits past a step
   * that declares no checks. Offered on every mode, `manual` included.
   */
  skippingChecks: Schema.Boolean,
  /**
   * What a person has said that no agent has read yet, oldest first. Each leaves as
   * the model receives it, as the chat at the gate the trak parks at, or into
   * `returned`.
   */
  messages: Schema.Array(WaitingMessageDto),
  /**
   * Messages that waited and were never sent — a stop takes every waiting message, and
   * so does the trak coming to rest. Offered back to the person, oldest first, until
   * they say something again.
   */
  returned: Schema.Array(Schema.String),
  state: TrakStateDto,
  /** Absent before the composer has returned: a trak in `Preparing` or `Composing`. */
  plan: Schema.optional(PlanDto),
  /** Absent until the checkout exists — and on a trak whose checkout failed. */
  worktree: Schema.optional(WorktreeDto),
  /**
   * Every requirement recorded so far, in log order. The description plus these is
   * what is currently being asked for. The key is the engine's — see `decided.ts`.
   *
   * Derived state — not the scaffolding `Trak.lastGate` is, which is why this crosses
   * the wire and that one does not.
   */
  decisions: Schema.Array(RecordedDto),
  /**
   * What happened at each of this trak's gates that is behind it: which the engine
   * took and why, and which entry a pressed Hold held until a person accepted it. At
   * most one per entry. Empty on a trak that has run on `manual` throughout and nobody
   * pressed Hold on.
   *
   * Derived state like `decisions` — stamped by the engine as each gate was taken or
   * each hold spent, so a surface cannot answer it differently and a later change of
   * mode cannot move it. Whether a *person* stood at a gate the rule took anyway is a
   * question about the log — see `stoodAt` in the client.
   */
  marks: Schema.Array(MarkDto),
})
export type TrakProjectionDto = Schema.Schema.Type<typeof TrakProjectionDto>

/**
 * How a person picks up a sandboxed trak's session themselves. The session and the files
 * it edited are in the sandbox, so it is resumed there — through a shell the terminal
 * press opens, or the `host` line pasted on the machine a host runs on. Every string is
 * the engine's; a surface composes no command.
 */
export const HandoffDto = Schema.Struct({
  /** What to run in that shell to resume the trak's latest session; absent before its first turn. */
  resume: Schema.optional(Schema.String),
  /**
   * The command that opens that shell, to run on the host's machine — present only under
   * `pnpm host`, where no terminal the engine could open is the viewer's, so a surface
   * draws this in place of the terminal press.
   */
  host: Schema.optional(Schema.String),
})
export type HandoffDto = Schema.Schema.Type<typeof HandoffDto>

/**
 * Whose a trak or goal is, sent only to a viewer who is not its owner on a host with more
 * than one user: every press that would start a turn is refused to them. `owner` is the
 * owner's login. Asked per request, of who is looking, so it never rides a frame.
 */
export const OwnershipDto = Schema.Struct({
  owner: Schema.String,
})
export type OwnershipDto = Schema.Schema.Type<typeof OwnershipDto>

/**
 * `GET /api/traks/:id/access`: what the viewer may do to a trak they see. `owner` presses
 * everything; `manage` and `view` are a sharer's, and no trak is shared yet. A trak the
 * viewer does not see is a 404, as a missing one is.
 */
export const TrakAccessDto = Schema.Struct({
  level: Schema.Literal("owner", "manage", "view"),
})
export type TrakAccessDto = Schema.Schema.Type<typeof TrakAccessDto>

export const TrakDetailDto = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  ...TrakProjectionDto.fields,
  /**
   * The check scripts that run on the trak's next step, by name — `["verify"]` — and
   * empty where none will: the next entry's agent declares none, the plan has run out,
   * or the composer is about to rewrite it.
   *
   * **Which entry is next is the engine's answer**, off `nextCheckedPosition`: the
   * position whose `RunChecks` is issued next when the trak goes forward — the running
   * step's own while its agent works, the entry after it once the step has filed. A
   * surface that worked that out from `state` and `plan` would be the second copy of the
   * state machine, and which scripts an agent declares is `.orkestra/` policy the
   * surface cannot see at all.
   *
   * Names rather than scripts, because what a screen does with this is say which will
   * not run. Here rather than on `TrakProjectionDto` because the library answers it and
   * the log does not, so it waits for the poll while the `plan` it is read from rides
   * the frame — see `applyFrame`.
   */
  nextChecks: Schema.Array(Schema.String),
  /**
   * Whether the project has `.orkestra/deploy.sh` — the library's answer, like
   * `nextChecks`, and a fact about the project rather than the trak. It is what
   * enables the deploy on screen: a surface asks `GET /api/traks/:id/deploy` and
   * draws the deploy block only where this is `true`, because the route answers
   * `none` at once everywhere else and a line drawn while it does is a jump on every
   * merged page of a project that never deploys.
   */
  deployScript: Schema.Boolean,
  /**
   * The branch a hand-off on the plan at the gate would be cut from — the repository's
   * default branch, as `origin/HEAD` names it — and absent where the repository has
   * none to name, where the card says so instead of a name. Sent only while a plan
   * carrying a hand-off nothing has yet opened is on the table, because it costs a
   * `git` per read and means nothing at any other moment: once the gate goes past the
   * `HandedOff` on the log carries the branch that was used.
   */
  handOffBase: Schema.optional(Schema.String),
  /**
   * The goal this trak's hand-offs go to, and absent on a trak no goal opened. Also absent
   * while a hand-off is on the table and the goal is done or dropped: that one goes the
   * ordinary way, and `handOffBase` names its branch. Once a gate has gone past, the
   * `HandedOff` on the log says which way it went — no ids is the goal.
   */
  handOffGoal: Schema.optional(Schema.String),
  log: Schema.Array(EventDto),
  transcript: Schema.Array(TranscriptEntryDto),
  custody: CustodyDto,
  /**
   * The check the engine ran here most recently, and absent for a trak whose steps
   * declare none — which is half the agents in this project.
   *
   * Like `custody`, this is the daemon's own memory rather than anything replayed, and
   * it is here for the same reason: a screen watching a run has to survive its own
   * refetch, and there is no file to survive with.
   */
  check: Schema.optional(CheckRunDto),
  /**
   * What the turn now running has spent so far — `TurnInFlightDto` — and absent where
   * nothing is in flight or the turn has reported nothing yet.
   *
   * Daemon memory, like `custody` and for its reason: it is read off the run record, a
   * screen watching a turn has to survive its own refetch, and `InFlightFrameDto` is
   * what keeps it moving between polls. A step's meter lays it over the endings on the
   * log for the position it names, and only there — `step` is what says which.
   */
  inFlight: Schema.optional(TurnInFlightDto),
  /**
   * When the daemon next asks the condition `waiting` names, epoch milliseconds.
   *
   * Daemon memory, like `check` and for its reason: no log holds when an ask falls.
   * Absent wherever `waiting` is, where the condition has given up, and between a
   * restart and the daemon's first sweep, which is what re-arms it.
   */
  nextAsk: Schema.optional(Schema.Number),
  /**
   * Present only where the trak's checkout is in a sandbox, which has no local path: no
   * editor opens on it, and the terminal press opens a shell in the sandbox.
   */
  handoff: Schema.optional(HandoffDto),
  /**
   * A person's Rebuild of the trak's sandbox: `waiting` for the turn, check or effect
   * holding it to end, then `rebuilding`; absent where none is owed. Daemon memory, like
   * `check`: an engine restart forgets one still waiting, and the press is made again.
   */
  rebuild: Schema.optional(Schema.Literal("waiting", "rebuilding")),
  /**
   * The preparation the trak is in now, and absent where none is — daemon memory, like
   * `check`, kept moving between polls by `PreparingFrameDto`.
   */
  preparing: Schema.optional(PreparingPhaseDto),
  /**
   * The trak's action at the seam now, and absent where none is — daemon memory, kept
   * moving between polls by `SeamStatusFrameDto`.
   */
  seam: Schema.optional(SeamStatusDto),
  /** Present only where the viewer is not the owner — `OwnershipDto`. */
  ownership: Schema.optional(OwnershipDto),
})
export type TrakDetailDto = Schema.Schema.Type<typeof TrakDetailDto>

/** A put-away trak as a search finds it — no summary is built for one. */
export const ArchivedTrakDto = Schema.Struct({ id: Schema.String, title: Schema.String })
export type ArchivedTrakDto = Schema.Schema.Type<typeof ArchivedTrakDto>

/** `GET /api/traks/archived?q=`: the put-away traks whose title or id holds `q`. */
export const ArchivedTrakListDto = Schema.Struct({ traks: Schema.Array(ArchivedTrakDto) })
export type ArchivedTrakListDto = Schema.Schema.Type<typeof ArchivedTrakListDto>
