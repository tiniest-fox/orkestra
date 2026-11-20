/**
 * Builders for the wire shapes, for tests and for the atelier catalogue.
 *
 * The engine has smart constructors — `Events.trakCreated`, `TrakState.AgentWorking` — and
 * `house-style` says to use them rather than hand-writing a `_tag`. Nothing crosses the
 * wire but plain objects, so this side had none, and every test wrote the same floor out
 * again: `{ id, description, state, running }` for a summary, and
 * `{ decisions: [], log: [], transcript: [], custody: {} }` for a detail.
 * This file is that missing half. One `make*` per shape, so a change to a slice under `shared/src/dto/`
 * lands here instead of in twenty test files.
 *
 * **Kind `pure`** (`client-style`'s admission table): it imports `api/types` and nothing
 * else. That is exactly enough — a DTO is a plain object on the wire, with no Schema to
 * decode and no `effect` to reach for.
 *
 * **It exports functions, so the atelier ignores it, which is correct.** A catalogue knob
 * needs a value it can name, not a function it would have to call, so the `*.fixtures.ts`
 * files are what the walk finds and this is what they call. See
 * `.claude/skills/atelier/references/catalogue.md`.
 */

import type {
  AgentDto,
  ChangesDto,
  CliUsageDto,
  CheckRunDto,
  ComposerOutputDto,
  DecidedDto,
  DeployDto,
  DocumentDto,
  EngineFrameDto,
  GoalDetailDto,
  GoalDto,
  EntryDto,
  EventDto,
  FileChangeDto,
  HostedProcessDto,
  HostGitDto,
  ModelsDto,
  ViewDto,
  ParentDto,
  PlanDto,
  PullRequestCheckDto,
  PullRequestCommentDto,
  PullRequestFoundDto,
  PullRequestsDto,
  PullRequestSummaryDto,
  ReviewDto,
  ReviewThreadDto,
  StepOutputDto,
  OpenerDto,
  OpenersDto,
  TrakDetailDto,
  TrakSummaryDto,
  TranscriptEntryDto,
  TurnInFlightDto,
  UsageDto,
  WaitingDto,
  WorktreeDto,
} from "./api/types"

/** One member of a `_tag`-discriminated wire union, by its tag. */
type Event<T extends EventDto["_tag"]> = Extract<EventDto, { _tag: T }>
type Entry<T extends TranscriptEntryDto["_tag"]> = Extract<TranscriptEntryDto, { _tag: T }>
type Frame<T extends EngineFrameDto["_tag"]> = Extract<EngineFrameDto, { _tag: T }>
type Output<T extends StepOutputDto["type"]> = Extract<StepOutputDto, { type: T }>
type Composed<T extends ComposerOutputDto["type"]> = Extract<ComposerOutputDto, { type: T }>

/**
 * What a caller may override: everything but the discriminant, since a builder that let
 * you change the tag would be building a different shape than its name says.
 *
 * Both discriminants are named because the wire uses both — `_tag` for what the engine
 * says to itself, `type` for what an agent writes by hand. Omitting a key a shape does not
 * have is a no-op, so one alias covers every builder here.
 */
type Over<T> = Partial<Omit<T, "_tag" | "type">>

/**
 * Ids and session ids, distinct per call and never worth reading.
 *
 * **Nothing may assert on one.** A test that cares about an id passes it in. The counter
 * exists so that two traks built in a row are two traks rather than one written twice, and
 * it is safe only because of that rule — within a file it is call-order dependent, though
 * Vitest gives each test file a fresh module registry so no file can disturb another.
 */
let n = 0
const next = (): number => (n += 1)
const nextId = (): string => `trak-${next()}`
const nextSession = (): string => `s-${next()}`

// ============================================================================
// The two the whole client is written over
// ============================================================================

export const makeTrak = (over: Over<TrakSummaryDto> = {}): TrakSummaryDto => ({
  id: nextId(),
  description: "add a client",
  state: { _tag: "Composing" },
  running: false,
  mode: "manual",
  // `true`, so that a finished trak built here reads as one that wrote something — which
  // is what the great majority of them are and what every case not about this fact means.
  // A case about a trak that kept nothing passes `false`.
  branchMoved: true,
  ...over,
})

/**
 * A wait on a project's own script — the case every held row is about unless it says
 * `deployed`, which is the one name the list files apart.
 */
export const makeWaiting = (over: Over<WaitingDto> = {}): WaitingDto => ({
  step: 2,
  name: "pr-merged",
  stopped: false,
  ...over,
})

export const makeDetail = (over: Over<TrakDetailDto> = {}): TrakDetailDto => ({
  id: nextId(),
  description: "add a client",
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  // Empty by default for `marks`'s reason: on a bare trak nothing runs next, and a test
  // about the names says so by passing them.
  nextChecks: [],
  // No `deploy.sh`, which is what most projects have and what every case not about
  // the deploy means; one about it passes `true` and the answer it expects.
  deployScript: false,
  state: { _tag: "Composing" },
  decisions: [],
  // Empty by default because the default mode is `manual`, where it is always empty —
  // a test about the marks says so by passing both.
  marks: [],
  log: [],
  transcript: [],
  custody: {},
  ...over,
})

// ============================================================================
// The pieces they carry
// ============================================================================

export const makeParent = (over: Over<ParentDto> = {}): ParentDto => ({
  id: "parent",
  step: 1,
  child: 0,
  depth: 1,
  ...over,
})

export const makeWorktree = (over: Over<WorktreeDto> = {}): WorktreeDto => ({
  path: "/tmp/w",
  branch: "trak/t",
  base: "abc1234",
  ...over,
})

/**
 * One agent of the library. The only shape here that is not part of a trak.
 *
 * The default description carries two sentences on purpose: a tile shows the first one
 * only, so a builder handing back a single sentence would make that cut untestable.
 *
 * `start` defaults true because the New Trak grid is the case most tests are about;
 * `unblock` and `resolve` are the other kind and pass it in.
 */
export const makeAgent = (over: Over<AgentDto> = {}): AgentDto => ({
  name: "build",
  description: "Builds an agreed change. The plan says what; the code says where.",
  start: true,
  conditions: [],
  model: "opus",
  plannable: true,
  ...over,
})

/**
 * `models.yaml` as the engine sends it — the list a chat may run on, and the default. Like
 * `makeAgent`, not part of a trak: it is the library. One qualified entry by default,
 * because the qualifier is the case a surface drawing a name has to survive.
 */
export const makeModels = (over: Over<ModelsDto> = {}): ModelsDto => ({
  default: "opus",
  allowed: ["fable", "opus", "sonnet", "haiku", "codex/gpt-5.6-sol"],
  ...over,
})

/**
 * One installed opener — a terminal by default; an editor passes its own id and name.
 * Like `makeAgent`, not part of a trak — it is the engine's machine. No `icon` by
 * default, because the data URL is the one field a test never reads and the fallback
 * glyph is the case worth rendering; a test about the icon passes one in.
 */
export const makeOpener = (over: Over<OpenerDto> = {}): OpenerDto => ({
  id: "com.mitchellh.ghostty",
  name: "Ghostty",
  ...over,
})

/** The listing, each kind bound to its one default opener so both controls have a press to draw. */
export const makeOpeners = (over: Over<OpenersDto> = {}): OpenersDto => ({
  terminal: { apps: [makeOpener()], chosen: "com.mitchellh.ghostty" },
  editor: { apps: [makeOpener({ id: "dev.zed.Zed", name: "Zed" })], chosen: "dev.zed.Zed" },
  ...over,
})

export const makeDocument = (over: Over<DocumentDto> = {}): DocumentDto => ({
  sections: { Summary: "What the step did." },
  ...over,
})

export const makeDecided = (over: Over<DecidedDto> = {}): DecidedDto => ({
  text: "Branch names are cut to a measure rather than setting one",
  source: "stated",
  ...over,
})

// ============================================================================
// The plan
// ============================================================================

type Entryish<T extends EntryDto["type"]> = Extract<EntryDto, { type: T }>

// An agent turn is the same struct in a proposal and in a plan, so this returns the member
// rather than either union — a `ProposalDto`'s steps will not take an `EntryDto`, whose
// compose entry has an optional `instruction` where a proposal's is required.

export const makeAgentStep = (over: Over<Entryish<"agent">> = {}): Entryish<"agent"> => ({
  type: "agent",
  agent: "builder",
  instruction: "build the drawer",
  conversational: false,
  ...over,
})

/** The plan's compose entry, which a proposal has no counterpart for. */
export const makeComposeEntry = (over: Over<Entryish<"compose">> = {}): Entryish<"compose"> => ({
  type: "compose",
  ...over,
})

export const makePlan = (over: Over<PlanDto> = {}): PlanDto => ({
  title: "Add a read-only client",
  steps: [makeComposeEntry(), makeAgentStep()],
  ...over,
})

// ============================================================================
// What an agent files
// ============================================================================

export const makeArtifact = (over: Over<Output<"artifact">> = {}): Output<"artifact"> => ({
  type: "artifact",
  sections: {},
  ...over,
})

export const makeProposal = (over: Over<Composed<"proposal">> = {}): Composed<"proposal"> => ({
  type: "proposal",
  title: "Add a read-only client",
  steps: [],
  ...over,
})

// ============================================================================
// The log
// ============================================================================

// Each returns its own member rather than `EventDto`, for the reason the transcript
// builders give below: a value typed to the union cannot be handed to something that
// wants one member, and several surfaces take exactly one — `FailedNotice` wants a
// `failed`, `ProposalCard` a `proposal`. A member still goes into a `readonly EventDto[]`
// wherever a log is wanted, so narrowing costs nothing and buys those.

/**
 * A `UsageDto` whose turn was read at its last call: the counts are the turn's spend, the
 * reading is what the window held, and the two are deliberately different numbers.
 */
export const makeReadUsage = (
  held: UsageDto["context"],
  contextWindow?: number,
  over: Over<UsageDto> = {},
): UsageDto => ({
  ...makeUsage(over),
  ...(held === undefined ? {} : { context: held }),
  ...(contextWindow === undefined ? {} : { contextWindow }),
})

/**
 * The record's turn as the detail carries it: a step's, with the provider's figure as
 * of its last report and nothing read since. A case about the estimate passes one.
 */
export const makeTurnInFlight = (over: Over<TurnInFlightDto> = {}): TurnInFlightDto => ({
  step: 2,
  usage: makeUsage(),
  estimate: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  ...over,
})

/**
 * What one turn spent, at a live turn's proportions: the input is almost all cache, and
 * the uncached remainder is tens. A case about a count passes it in.
 */
export const makeUsage = (over: Over<UsageDto> = {}): UsageDto => ({
  inputTokens: 20,
  outputTokens: 1_000,
  cacheReadTokens: 50_000,
  cacheWriteTokens: 5_000,
  costUsd: 0.1,
  tools: {},
  ...over,
})

export const makeTrakCreated = (over: Over<Event<"TrakCreated">> = {}): Event<"TrakCreated"> => ({
  _tag: "TrakCreated",
  description: "add a client",
  ...over,
})

export const makeComposerReturned = (
  over: Over<Event<"ComposerReturned">> = {},
): Event<"ComposerReturned"> => ({
  _tag: "ComposerReturned",
  sessionId: nextSession(),
  output: makeProposal(),
  ...over,
})

export const makeAgentReturned = (
  over: Over<Event<"AgentReturned">> = {},
): Event<"AgentReturned"> => ({
  _tag: "AgentReturned",
  step: 1,
  sessionId: nextSession(),
  output: makeArtifact(),
  ...over,
})

export const makeHumanActed = (over: Over<Event<"HumanActed">> = {}): Event<"HumanActed"> => ({
  _tag: "HumanActed",
  step: 1,
  action: { _tag: "Approve" },
  ...over,
})

export const makeChecksPassed = (
  over: Over<Event<"ChecksPassed">> = {},
): Event<"ChecksPassed"> => ({
  _tag: "ChecksPassed",
  step: 1,
  ran: ["verify"],
  ...over,
})

export const makeCheckFailed = (over: Over<Event<"CheckFailed">> = {}): Event<"CheckFailed"> => ({
  _tag: "CheckFailed",
  step: 1,
  name: "verify",
  output: "1 test failed",
  ...over,
})

export const makeEffectsRan = (over: Over<Event<"EffectsRan">> = {}): Event<"EffectsRan"> => ({
  _tag: "EffectsRan",
  step: 1,
  ran: [{ name: "open-pr", output: "https://example.invalid/pull/7" }],
  ...over,
})

export const makeEffectFailed = (
  over: Over<Event<"EffectFailed">> = {},
): Event<"EffectFailed"> => ({
  _tag: "EffectFailed",
  step: 1,
  name: "open-pr",
  output: "gh: not authenticated",
  ...over,
})

export const makeWorktreeReady = (
  over: Over<Event<"WorktreeReady">> = {},
): Event<"WorktreeReady"> => ({
  _tag: "WorktreeReady",
  worktree: makeWorktree(),
  ...over,
})

export const makeWorkCommitted = (
  over: Over<Event<"WorkCommitted">> = {},
): Event<"WorkCommitted"> => ({
  _tag: "WorkCommitted",
  ...over,
})

export const makeTurnFailed = (over: Over<Event<"TurnFailed">> = {}): Event<"TurnFailed"> => ({
  _tag: "TurnFailed",
  reason: "the CLI exited 1",
  ...over,
})

export const makeRestarted = (over: Over<Event<"Restarted">> = {}): Event<"Restarted"> => ({
  _tag: "Restarted",
  sessionId: nextSession(),
  ...over,
})

export const makeStopped = (over: Over<Event<"Stopped">> = {}): Event<"Stopped"> => ({
  _tag: "Stopped",
  sessionId: nextSession(),
  ...over,
})

/** A person pressed Stop, before anything was killed. */
export const makeStopRequested = (
  over: Over<Event<"StopRequested">> = {},
): Event<"StopRequested"> => ({
  _tag: "StopRequested",
  sessionId: nextSession(),
  ...over,
})

/** A check a person ended. `name` is absent where the press raced the run starting. */
export const makeChecksCancelled = (
  over: Over<Event<"ChecksCancelled">> = {},
): Event<"ChecksCancelled"> => ({
  _tag: "ChecksCancelled",
  step: 1,
  name: "verify",
  ...over,
})

/** A filing asked of a step. `sessionId` only where a turn was killed for it — see `filed.ts`. */
export const makeFilingAsked = (over: Over<Event<"FilingAsked">> = {}): Event<"FilingAsked"> => ({
  _tag: "FilingAsked",
  ...over,
})

/**
 * A trak archived. `sessionId` only where a turn was killed for it — `filed.ts` counts
 * that one as the turn's ending and a bare one as nothing.
 */
export const makeAbandoned = (over: Over<Event<"Abandoned">> = {}): Event<"Abandoned"> => ({
  _tag: "Abandoned",
  reason: "did it by hand",
  ...over,
})

export const makeHandedOff = (over: Over<Event<"HandedOff">> = {}): Event<"HandedOff"> => ({
  _tag: "HandedOff",
  step: 0,
  base: "main",
  ids: ["quiet-emerald-capybara"],
  ...over,
})

export const makeChildrenSpawned = (
  over: Over<Event<"ChildrenSpawned">> = {},
): Event<"ChildrenSpawned"> => ({
  _tag: "ChildrenSpawned",
  step: 1,
  ids: ["child-1"],
  ...over,
})

// ============================================================================
// The forge
// ============================================================================

/**
 * Each returns its own leaf rather than the union above it, for the reason the transcript
 * builders give: every section of the pull-request half draws exactly one of these, so a
 * value typed to the whole answer could not be handed to any of them.
 *
 * `verdict: "failed"` is the default because a failing check is the only kind that carries
 * a tick, and it is what most cases here are about; a test wanting one of the other four
 * says which.
 *
 * **`id` counts up and the rest of the defaults are shared**, deliberately: two checks or
 * two reviews built with no arguments are two things, which is what the wire promises and
 * what a case about a collision needs in order to make one on purpose.
 */
export const makePullRequestCheck = (
  over: Over<PullRequestCheckDto> = {},
): PullRequestCheckDto => ({
  id: `run:${String(next())}`,
  name: "verify",
  verdict: "failed",
  at: 1_000,
  url: "https://github.com/o/r/actions/runs/9",
  ...over,
})

export const makePullRequestComment = (
  over: Over<PullRequestCommentDto> = {},
): PullRequestCommentDto => ({
  who: "reviewer",
  body: "This composes outside the switch, doesn't it?",
  url: `https://github.com/o/r/pull/41#discussion_r${String(next())}`,
  at: 1_000,
  ...over,
})

/** Open by default: a resolved thread is the case a test says it is about. */
export const makeReviewThread = (over: Over<ReviewThreadDto> = {}): ReviewThreadDto => ({
  path: "client/src/features/trak-detail/controls.ts",
  line: 41,
  resolved: false,
  outdated: false,
  comments: [makePullRequestComment()],
  ...over,
})

export const makeReview = (over: Over<ReviewDto> = {}): ReviewDto => ({
  id: `review-${String(next())}`,
  who: "reviewer",
  verdict: "changesRequested",
  at: 1_000,
  url: `https://github.com/o/r/pull/41#pullrequestreview-${String(next())}`,
  threads: [],
  ...over,
})

/**
 * One row of the forge's listing — the coarse shape a list draws, not the pane's.
 *
 * `branch` is the whole of how this reaches a trak, so it is a plain default a case
 * overrides when it is matching one; `state: "open"`, `merging: "clean"` and
 * `checks: "none"` are the floor for the same reason `makePullRequest`'s are — a case
 * about a draft or a failing rollup says exactly that and nothing else.
 */
export const makePullRequestSummary = (
  over: Over<PullRequestSummaryDto> = {},
): PullRequestSummaryDto => ({
  number: 41,
  title: "Show a branch's pull request in the finished pane",
  url: "https://github.com/o/r/pull/41",
  state: "open",
  isDraft: false,
  merging: "clean",
  checks: "none",
  ...over,
})

/**
 * What `deploy.sh` said, as a run that found the commit not live yet — the answer a trak
 * waiting on `deployed` carries for most of its wait. A case about a live or a failed
 * deploy says so; one about a project with no script writes `{ answer: "none" }`, which
 * is the whole of that member.
 *
 * `at` is fixed rather than `Date.now()`: a builder that read the clock would draw *just
 * now* in every case and never the *minutes ago* a card is read at.
 */
export const makeDeploy = (over: Over<Exclude<DeployDto, { answer: "none" }>> = {}): DeployDto => ({
  answer: "not-yet",
  version: "v2026.09.10-3",
  detail: "building, 6m in",
  text: "",
  at: 1_000,
  ...over,
})

/**
 * An answer with no entries in it, which is what a caller that asked about nothing gets —
 * and the case most tests want to start from.
 *
 * **No entry is not the same as an entry with no pull request**, so neither is the
 * default: a test about a branch the forge has nothing on writes `{ branch }`, and a test
 * about a branch nobody asked about leaves it out. Getting either by forgetting a field is
 * exactly what this shape exists to prevent. The other member carries nothing a builder
 * would save — `{ _tag: "ForgeUnavailable", why }` is the whole of it.
 */
export const makeListing = (over: Over<PullRequestsDto> = {}): PullRequestsDto => ({
  _tag: "PullRequests",
  entries: [],
  ...over,
})

/**
 * The one member of `PullRequestDto` anything draws. The other two carry nothing a builder
 * would save — a test writes `{ _tag: "NoPullRequest" }` or `{ _tag: "ForgeUnavailable",
 * why }` and the discriminant is the whole of it.
 *
 * `state: "open"` and `merging: "clean"` are the floor, so a case about mergeability or
 * about a pull request that is no longer open says exactly that and nothing else.
 * `rollup: "none"` for `makePullRequestSummary`'s reason, and **no default `branch`**: an
 * answer that names one is filed into the branch store, so a case about the store says
 * which branch it is about and every other case stays out of it.
 */
export const makePullRequest = (over: Over<PullRequestFoundDto> = {}): PullRequestFoundDto => ({
  _tag: "PullRequest",
  number: 41,
  url: "https://github.com/o/r/pull/41",
  title: "Show a branch's pull request in the finished pane",
  state: "open",
  isDraft: false,
  merging: "clean",
  rollup: "none",
  checks: [],
  reviews: [],
  conversation: [],
  truncated: [],
  mergeMethods: [],
  mergeVerdict: { _tag: "Mergeable" },
  ...over,
})

// ============================================================================
// The transcript
// ============================================================================

// Each returns its own member rather than the union, because the surfaces draw them one
// at a time — `api/types.ts` names `ToolEntryDto` and the rest for that reason, and a
// builder typed to the union could not be handed to something that takes only a tool call.

export const makeSpawned = (over: Over<Entry<"Spawned">> = {}): Entry<"Spawned"> => ({
  _tag: "Spawned",
  pid: 100,
  ...over,
})

export const makeSession = (over: Over<Entry<"Session">> = {}): Entry<"Session"> => ({
  _tag: "Session",
  id: nextSession(),
  ...over,
})

export const makeTool = (over: Over<Entry<"Tool">> = {}): Entry<"Tool"> => ({
  _tag: "Tool",
  name: "Read",
  kind: "Read",
  ...over,
})

export const makeViewEntry = (over: Over<Entry<"View">> = {}): Entry<"View"> => ({
  _tag: "View",
  call: "call-view",
  server: "metrics",
  tool: "show_dashboard",
  uri: "ui://metrics/dashboard.html",
  ...over,
})

/** A check-tool call's line, before it answers — the line the engine writes as it takes the call. */
export const makeCheckEntry = (over: Over<Entry<"Check">> = {}): Entry<"Check"> => ({
  _tag: "Check",
  call: "toolu_1",
  server: "orkestra-trak",
  tool: "run_check",
  name: "verify-light",
  ...over,
})

/** Auto mode's classifier refusing the call `toolu_1`, as a real run recorded it. */
export const makeDenied = (over: Over<Entry<"Denied">> = {}): Entry<"Denied"> => ({
  _tag: "Denied",
  call: "toolu_1",
  tool: "Bash",
  reason: "[Safety Bypass Flag]",
  source: "classifier",
  ...over,
})

/** A hook that ran cleanly around the call `exec-1` and printed nothing. */
export const makeHook = (over: Over<Entry<"Hook">> = {}): Entry<"Hook"> => ({
  _tag: "Hook",
  call: "exec-1",
  event: "preToolUse",
  status: "completed",
  durationMs: 3,
  source: "/Users/someone/.codex/hooks.json",
  output: [],
  ...over,
})

export const makeView = (over: Partial<ViewDto> = {}): ViewDto => ({
  server: "metrics",
  tool: "show_dashboard",
  html: "<p>dashboard</p>",
  arguments: {},
  result: { content: [{ type: "text", text: "count is 0" }], isError: false },
  cli: "claude",
  answers: true,
  ...over,
})

export const makeText = (over: Over<Entry<"Text">> = {}): Entry<"Text"> => ({
  _tag: "Text",
  text: "Reading the loader to see where the alias resolves.",
  ...over,
})

export const makeNote = (over: Over<Entry<"Note">> = {}): Entry<"Note"> => ({
  _tag: "Note",
  text: "Thinking",
  ...over,
})

export const makeReask = (over: Over<Entry<"Reask">> = {}): Entry<"Reask"> => ({
  _tag: "Reask",
  reason: "the answer was not valid JSON",
  ...over,
})

export const makeSubagent = (over: Over<Entry<"Subagent">> = {}): Entry<"Subagent"> => ({
  _tag: "Subagent",
  call: "call-1",
  ...over,
})

export const makeSubagentResult = (
  over: Over<Entry<"SubagentResult">> = {},
): Entry<"SubagentResult"> => ({ _tag: "SubagentResult", call: "call-1", ok: true, ...over })

export const makeBackground = (over: Over<Entry<"Background">> = {}): Entry<"Background"> => ({
  _tag: "Background",
  tasks: [{ id: "task-1" }],
  ...over,
})

export const makeBackgroundStarted = (
  over: Over<Entry<"BackgroundStarted">> = {},
): Entry<"BackgroundStarted"> => ({
  _tag: "BackgroundStarted",
  taskId: "task-1",
  call: "call-1",
  ...over,
})

export const makeApiRetry = (over: Over<Entry<"ApiRetry">> = {}): Entry<"ApiRetry"> => ({
  _tag: "ApiRetry",
  attempt: 2,
  of: 5,
  status: "429",
  ...over,
})

// ============================================================================
// The stream
// ============================================================================

// Narrow, like the transcript entries: `Removed` and `Resync` carry no `seq`, so a frame
// typed to the union cannot be spread and given one — which is how a test says "the same
// frame, arriving out of order".

export const makeAppended = (over: Over<Frame<"Appended">> = {}): Frame<"Appended"> => ({
  _tag: "Appended",
  trak: "trak-1",
  seq: 1,
  event: makeWorktreeReady(),
  state: { _tag: "AwaitingProposal" },
  mode: "manual",
  holding: false,
  skippingChecks: false,
  messages: [],
  returned: [],
  decisions: [],
  marks: [],
  ...over,
})

export const makeActivity = (over: Over<Frame<"Activity">> = {}): Frame<"Activity"> => ({
  _tag: "Activity",
  trak: "trak-1",
  seq: 1,
  entry: makeTool(),
  ...over,
})

export const makeRemoved = (over: Over<Frame<"Removed">> = {}): Frame<"Removed"> => ({
  _tag: "Removed",
  trak: "trak-1",
  ...over,
})

/**
 * A run in flight. `chunks: 0` is the floor a `CheckOutput` at `seq: 1` follows, so a
 * test about a gap says so by passing a count rather than by counting the frames it sent.
 */
export const makeCheckRun = (over: Over<CheckRunDto> = {}): CheckRunDto => ({
  step: 0,
  name: "verify",
  command: "bash /repo/.orkestra/checks/verify.sh",
  limit: 300,
  startedAt: 1_000,
  output: "",
  chunks: 0,
  ...over,
})

export const makeCheckStarted = (
  over: Over<Frame<"CheckStarted">> = {},
): Frame<"CheckStarted"> => ({
  _tag: "CheckStarted",
  trak: "trak-1",
  run: makeCheckRun(),
  ...over,
})

export const makeCheckOutput = (over: Over<Frame<"CheckOutput">> = {}): Frame<"CheckOutput"> => ({
  _tag: "CheckOutput",
  trak: "trak-1",
  step: 0,
  seq: 1,
  chunk: "compiling\n",
  ...over,
})

export const makeCheckEnded = (over: Over<Frame<"CheckEnded">> = {}): Frame<"CheckEnded"> => ({
  _tag: "CheckEnded",
  trak: "trak-1",
  run: makeCheckRun({ finished: { verdict: "passed", exitCode: 0, at: 2_000 } }),
  ...over,
})

/** A turn's spend so far. `makeInFlight({ turn: undefined })` is the same turn ended. */
export const makeInFlight = (over: Over<Frame<"InFlight">> = {}): Frame<"InFlight"> => ({
  _tag: "InFlight",
  trak: "trak-1",
  turn: makeTurnInFlight(),
  ...over,
})

/** A preparation moved. `makePreparing({ preparing: undefined })` is none running any more. */
export const makePreparing = (over: Over<Frame<"Preparing">> = {}): Frame<"Preparing"> => ({
  _tag: "Preparing",
  trak: "trak-1",
  preparing: { _tag: "SetupBeside" },
  ...over,
})

/** A stop crossing into its sandbox. `seam: undefined` is the same action ended. */
export const makeSeamStatus = (over: Over<Frame<"SeamStatus">> = {}): Frame<"SeamStatus"> => ({
  _tag: "SeamStatus",
  trak: "trak-1",
  seam: { action: "stop", phase: "crossing", attempt: 1, since: 0 },
  ...over,
})

/** A drive taken. `makeDrive({ custody: {} })` is the same drive let go. */
export const makeDrive = (over: Over<Frame<"Drive">> = {}): Frame<"Drive"> => ({
  _tag: "Drive",
  trak: "trak-1",
  custody: { holder: { since: 1_000 } },
  ...over,
})

// ============================================================================
// What the work did to the files
// ============================================================================

/**
 * A file with one small hunk in it, which is the shape most assertions want. A test that
 * cares about hunks passes its own.
 */
export const makeFileChange = (over: Over<FileChangeDto> = {}): FileChangeDto => ({
  path: "src/app/server.ts",
  change: "modified",
  additions: 2,
  deletions: 1,
  binary: false,
  hunks: [
    {
      oldStart: 10,
      oldCount: 3,
      newStart: 10,
      newCount: 4,
      heading: "const routes = ",
      lines: [
        { kind: "context", text: "const routes = [", oldLine: 10, newLine: 10 },
        { kind: "del", text: "  merge,", oldLine: 11 },
        { kind: "add", text: "  merge,", newLine: 11 },
        { kind: "add", text: "  changes,", newLine: 12 },
      ],
    },
  ],
  ...over,
})

export const makeChanges = (over: Over<ChangesDto> = {}): ChangesDto => ({
  at: "all",
  files: [makeFileChange()],
  ...over,
})

/** A declared process at rest: never started at this trak's checkout. */
export const makeHostedProcess = (over: Over<HostedProcessDto> = {}): HostedProcessDto => ({
  name: "dev",
  description: "The app's dev server",
  page: true,
  readySeconds: 30,
  run: 0,
  state: { _tag: "NotStarted" },
  log: "",
  chunks: 0,
  ...over,
})

/** The project checkout on `main`, level with `origin/main`, fetched a minute before the epoch. */
export const makeHostGit = (over: Over<HostGitDto> = {}): HostGitDto => ({
  head: { _tag: "Branch", name: "main" },
  origin: true,
  upstream: { name: "origin/main", ahead: 0, behind: 0 },
  fetchedAt: 0,
  fetching: false,
  ...over,
})

/** Claude's plan usage, never read since the engine started, with no turn running. */
export const makeCliUsage = (over: Over<CliUsageDto> = {}): CliUsageDto => ({
  cli: "claude",
  polling: false,
  usage: { _tag: "NotRead" },
  ...over,
})

/** A process changed state — the whole process, as the engine sends it. */
export const makeProcessFrame = (over: Over<Frame<"Process">> = {}): Frame<"Process"> => ({
  _tag: "Process",
  trak: "trak-1",
  process: makeHostedProcess(),
  ...over,
})

/** The next chunk of a run's output. */
export const makeProcessOutput = (
  over: Over<Frame<"ProcessOutput">> = {},
): Frame<"ProcessOutput"> => ({
  _tag: "ProcessOutput",
  trak: "trak-1",
  name: "dev",
  run: 1,
  seq: 1,
  chunk: "ready in 412 ms\n",
  ...over,
})

// ============================================================================
// Goals
// ============================================================================

export const makeGoal = (over: Over<GoalDto> = {}): GoalDto => ({
  id: `goal-${next()}`,
  file: "search.md",
  title: "Search across every trak",
  line: "Find any trak by typing",
  finished: "A person types into one box and lands on the spot.",
  limits: {},
  state: { _tag: "Watching" },
  paused: false,
  running: false,
  offers: ["Chat"],
  plan: [],
  subgoalPlan: [],
  traks: [],
  subgoals: [],
  landed: 0,
  planned: 0,
  messages: [],
  dismissed: false,
  ...over,
})

export const makeGoalDetail = (over: Over<GoalDetailDto> = {}): GoalDetailDto => ({
  goal: makeGoal(),
  log: [],
  settled: [],
  subgoals: [],
  transcript: [],
  ...over,
})
