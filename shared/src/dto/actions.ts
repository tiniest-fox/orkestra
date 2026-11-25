// What the client sends to act on a trak, and the previews it reads before spending. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"
import { AttachmentIdsDto } from "./attachments.js"
import { RunModeDto } from "./common.js"
import { TrakStateDto } from "./trak.js"

// ============================================================================
// What a command needs to know before it spends anything
// ============================================================================

/**
 * What picking a failed or interrupted trak back up would actually do.
 *
 * **Not the same question as whether it is allowed.** Every failure is retryable, but
 * `restartFrom` re-parks a gate unchanged and settles a terminal position — so only
 * `rerun` costs anything, and only `rerun` is worth asking a spend question about. A
 * caller that could not tell them apart would ask *re-run it?* about a free re-park.
 */
export const ResumePreviewDto = Schema.Struct({
  /**
   * Where it would pick up from — a state, not a sentence.
   *
   * Structured for the reason `TrakSummaryDto.activity` is: wording it here would be
   * the server deciding how a surface reads, once, for all of them. A caller already
   * holds the plan and can name the step itself.
   */
  position: Schema.optional(TrakStateDto),
  retry: Schema.Literal("rerun", "gate", "nowhere"),
  /** Present when the trak is `Failed`, which is a different offer from an interruption. */
  failure: Schema.optional(Schema.Struct({ error: Schema.String, kind: Schema.String })),
  /** True when the last process died mid-command, which reads differently from a failure. */
  interrupted: Schema.Boolean,
})
export type ResumePreviewDto = Schema.Schema.Type<typeof ResumePreviewDto>

/**
 * Where a merge would put this trak's work, so a person can be shown it before saying
 * yes.
 *
 * **The destination is shown and confirmed** — that is the whole of `closing.md`
 * decision 3, and it is why `merge` cannot be a button that just does it: a host merge
 * goes into whatever branch the machine running the daemon is standing on.
 */
export const MergePreviewDto = Schema.Struct({
  branch: Schema.optional(Schema.String),
  /** The branch the host is on. Absent means a detached HEAD. */
  into: Schema.optional(Schema.String),
  /** Set for a goal's trak on a goal branch, which merges into that branch instead. */
  goalBranch: Schema.optional(Schema.String),
  /** Set when this is a spawn's child, which merges into its parent instead. */
  parentId: Schema.optional(Schema.String),
  /**
   * Whether that merge would conflict, asked of git without performing it.
   *
   * **It changes what the press is called and never where it goes.** Both buttons
   * attempt the merge and the outcome decides, which is what makes a stale
   * prediction cost nothing in either direction — and it is why the paths a
   * resolution is planned against come from the attempt rather than from here.
   *
   * Absent means nothing asked: a trak with no branch or no destination, and one
   * that is not at a position where a merge is on the table. Not the same as
   * `false`, which is git having answered *this would go in*.
   */
  conflicts: Schema.optional(Schema.Boolean),
})
export type MergePreviewDto = Schema.Schema.Type<typeof MergePreviewDto>

/**
 * What a corpus regenerate wrote, as folders relative to `.orkestra/records/`.
 *
 * The folders rather than a count, because the answer a caller wants is *where do I
 * look* — and after a format change, seeing the names is how you notice that one of
 * them moved.
 */
export const RecordsWrittenDto = Schema.Struct({ folders: Schema.Array(Schema.String) })
export type RecordsWrittenDto = Schema.Schema.Type<typeof RecordsWrittenDto>

/** `POST /abandon` and `/reenter` each carry one sentence, and it is required. */
export const AbandonRequestDto = Schema.Struct({ reason: Schema.String })

/**
 * Change a running trak's run mode — `POST /api/traks/:id/mode`. Picked up at the next
 * gate: the turn in flight finishes, and nothing is killed. Setting `manual` clears a
 * pending hold.
 */
export const ModeRequestDto = Schema.Struct({ mode: RunModeDto })
export type ModeRequestDto = Schema.Schema.Type<typeof ModeRequestDto>

/**
 * Hold the current step until it is accepted, whatever the mode would do at its gates —
 * `POST /api/traks/:id/hold`. A spawn has no gate and is passed over; the picker does not
 * offer the switch while one runs.
 * `true` is the press; `false` takes a pending one back. Refused on `manual`, where it
 * promises nothing the mode does not.
 */
export const HoldRequestDto = Schema.Struct({ holding: Schema.Boolean })
export type HoldRequestDto = Schema.Schema.Type<typeof HoldRequestDto>

/**
 * Keep the next check run from happening — `POST /api/traks/:id/skip-checks`. `true` is
 * the press; `false` takes a pending one back. `HoldRequestDto`'s door and its `409
 * AtRest`, with no `OnManual`: every mode runs its checks.
 */
export const SkipChecksRequestDto = Schema.Struct({ skipping: Schema.Boolean })
export type SkipChecksRequestDto = Schema.Schema.Type<typeof SkipChecksRequestDto>

/**
 * Turn auto-merge on or off — `POST /api/traks/:id/auto-merge`. Taken at `Finished` as
 * well as while the trak runs; refused once it is archived, on a child, and — turning it
 * on — where the trak's goal file says `auto_merge: false`. `true` is a fresh start.
 */
export const AutoMergeRequestDto = Schema.Struct({ on: Schema.Boolean })
export type AutoMergeRequestDto = Schema.Schema.Type<typeof AutoMergeRequestDto>

/**
 * Pick the method a finished trak's pull request merges by — `POST
 * /api/traks/:id/merge-method`. Records it and merges nothing.
 */
export const MergeMethodRequestDto = Schema.Struct({
  method: Schema.Literal("merge", "squash", "rebase"),
})
export type MergeMethodRequestDto = Schema.Schema.Type<typeof MergeMethodRequestDto>
export type AbandonRequestDto = Schema.Schema.Type<typeof AbandonRequestDto>

/**
 * Pick a trak back up. The sentence is the whole of what came back.
 *
 * `agent` is the second door, and absent is the ordinary one: no agent named means the
 * composer plans what to do about the sentence, which is what every re-entry did before
 * this field. Naming one skips the composer — one conversational turn of that agent runs
 * on the sentence, and the trak comes back to rest when its artifact is approved.
 *
 * **`generic` is the only name the route accepts**, and anything else is a `400`: the
 * same answer the create route gives a name that cannot start a trak, and for the same
 * reason — the screen only ever sends what the engine offered it, so another name is a
 * hand-written request. A name rather than a boolean because it is what the log keeps.
 */
export const ReenterRequestDto = Schema.Struct({
  what: Schema.String,
  agent: Schema.optional(Schema.String),
  /**
   * The pull request's base branch, sent where the forge's refusal to merge is among what
   * was ticked. The composer is then told to merge it as the remote has it and to plan the
   * push. Not a `cause`: a person's press counts no auto-merge send and takes no gate.
   */
  base: Schema.optional(Schema.String),
})
export type ReenterRequestDto = Schema.Schema.Type<typeof ReenterRequestDto>

// ============================================================================
// API request DTOs — what the client sends to act on a trak
// ============================================================================

// `answers` is a NonEmptyArray to match `Actions.answer`, which takes a
// non-empty tuple. Stating it in the Schema is what makes the mapping total:
// an empty list is rejected by `schemaBodyJson` as a 400 rather than reaching a
// mapping function that has to throw, which surfaced as a 500.
/** Where a piece edit lands: the spawn, the piece and the step. */
const PIECE_STEP = { at: Schema.Int, piece: Schema.Int, step: Schema.Int }

/**
 * One change a person made to a proposed plan at its gate, keyed by the plan position
 * of the step it changes — the index its document key starts with, as proposed.
 *
 * Ten kinds and no others, so an edit can add no step and move none. `continues` names
 * the key of an earlier agent step as proposed — the agent the composer wrote, whatever
 * it was swapped for — and absent is a new session; the engine re-points it, and the
 * composer's own, when a removal renumbers or a swap renames. `agent` swaps the agent
 * that runs the step and drops any model picked for it; `model` is one of `ModelsDto`'s
 * `allowed`, and is refused on a step continuing another's conversation.
 *
 * The four `piece…` kinds are `remove`, `instruction`, `agent` and `model` on one step of
 * one piece of the spawn at `at`: `piece` is its index among the spawn's children and
 * `step` its index in that piece's plan, both as proposed. Removing a piece's last
 * remaining step is refused, since no piece is removed here.
 */
export const StepEditDto = Schema.Union(
  Schema.Struct({ edit: Schema.Literal("remove"), at: Schema.Int }),
  Schema.Struct({
    edit: Schema.Literal("instruction"),
    at: Schema.Int,
    instruction: Schema.String,
  }),
  Schema.Struct({
    edit: Schema.Literal("continues"),
    at: Schema.Int,
    key: Schema.optional(Schema.String),
  }),
  Schema.Struct({ edit: Schema.Literal("clearWait"), at: Schema.Int }),
  Schema.Struct({ edit: Schema.Literal("agent"), at: Schema.Int, agent: Schema.String }),
  Schema.Struct({ edit: Schema.Literal("model"), at: Schema.Int, model: Schema.String }),
  Schema.Struct({ edit: Schema.Literal("pieceRemove"), ...PIECE_STEP }),
  Schema.Struct({
    edit: Schema.Literal("pieceInstruction"),
    ...PIECE_STEP,
    instruction: Schema.String,
  }),
  Schema.Struct({ edit: Schema.Literal("pieceAgent"), ...PIECE_STEP, agent: Schema.String }),
  Schema.Struct({ edit: Schema.Literal("pieceModel"), ...PIECE_STEP, model: Schema.String }),
)
export type StepEditDto = Schema.Schema.Type<typeof StepEditDto>

/**
 * The edits an approval of a proposed plan carries.
 *
 * `proposal` is the index in the trak's `log` of the `ComposerReturned` the edits were
 * made against. A chat at the gate brings a new proposal, and edits laid over the wrong
 * one would change steps nobody looked at — so a press naming any but the newest is
 * refused `ProposalMoved` rather than applied.
 */
export const PlanEditsDto = Schema.Struct({
  proposal: Schema.Int,
  steps: Schema.NonEmptyArray(StepEditDto),
})
export type PlanEditsDto = Schema.Schema.Type<typeof PlanEditsDto>

export const ActRequestDto = Schema.Union(
  // `edits` is the plan gate's alone, and absent is taking the plan as proposed.
  Schema.Struct({ action: Schema.Literal("approve"), edits: Schema.optional(PlanEditsDto) }),
  Schema.Struct({ action: Schema.Literal("replan"), reason: Schema.String }),
  // `attachments` are upload ids from `POST /api/attachments`, placed in the checkout.
  Schema.Struct({
    action: Schema.Literal("chat"),
    message: Schema.String,
    attachments: AttachmentIdsDto,
  }),
  // `note` is optional and, unlike `answers`, may arrive blank: it is a free-form box
  // a person may leave alone, and the Schema has nothing to say about whitespace.
  // `actFromDto` is where blank becomes absent, once, for every caller.
  Schema.Struct({
    action: Schema.Literal("answer"),
    answers: Schema.NonEmptyArray(Schema.String),
    note: Schema.optional(Schema.String),
  }),
  Schema.Struct({ action: Schema.Literal("skip"), message: Schema.optional(Schema.String) }),
  Schema.Struct({ action: Schema.Literal("permit"), granted: Schema.Boolean }),
)
export type ActRequestDto = Schema.Schema.Type<typeof ActRequestDto>

export const ResumeRequestDto = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
})
export type ResumeRequestDto = Schema.Schema.Type<typeof ResumeRequestDto>

/**
 * Start a trak. The description is the whole request.
 *
 * `agent` is the one thing beside it, and absent is the ordinary case: no agent named
 * means the composer runs first and proposes the steps, which is what every trak did
 * before this field existed. Naming one skips the composer — the trak is born holding
 * a one-entry plan running that agent as a conversation, and reaches `Finished` when
 * its artifact is approved.
 *
 * **A name, not a plan.** A client that could post a plan would be a second author of
 * the composer's output shape; here it picks from `GET /api/agents` and the engine
 * builds the entry. A name that is not a startable agent is a `400` — the same answer
 * a body that does not parse gets, because that is what it is.
 *
 * `model` is the second name, and it goes with the first: the entry the engine builds
 * for `agent` runs on it instead of the agent file's `model:`. Absent is the ordinary
 * case and means the file's own. One that `GET /api/models` did not list is a `400`, as
 * is one sent with no `agent` — with the composer planning there is no entry to put it
 * on, and a pick that quietly went nowhere would be worse than a refusal.
 */
export const CreateTrakRequestDto = Schema.Struct({
  description: Schema.String,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  /**
   * How much of it the person wants to stand at. Absent is `manual` — every gate,
   * which is what a caller that has never heard of this asks for, and what the two
   * command-line entry points send by saying nothing.
   */
  mode: Schema.optional(RunModeDto),
  /**
   * Whether the engine merges the trak's pull request once it merges cleanly and its
   * checks pass, and sends the trak back on a conflict or a failing check. Absent is off.
   * Set at birth only.
   */
  autoMerge: Schema.optional(Schema.Boolean),
  /** Upload ids from `POST /api/attachments`, placed in the checkout once it is made. */
  attachments: AttachmentIdsDto,
})
export type CreateTrakRequestDto = Schema.Schema.Type<typeof CreateTrakRequestDto>

/**
 * What starting one answers with, and it is only the id.
 *
 * The trak exists — its first event is on the log, so a read by this id finds it — and
 * nothing else has happened to it yet: the drive was forked, so any state sent here
 * would be a guess about a turn that has not run. The id is what a caller needs to go
 * and watch.
 */
export const CreatedDto = Schema.Struct({ id: Schema.String })
export type CreatedDto = Schema.Schema.Type<typeof CreatedDto>
