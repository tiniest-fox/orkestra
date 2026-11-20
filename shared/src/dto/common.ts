// The wire contract between the engine's HTTP server and the client, one file per
// feature under shared/src/dto/, and this one holding the refusals every route can
// answer with. There is no barrel: an importer names the slice it uses, as
// `@orkestra/shared/dto/<slice>`, so an edit to one feature's shapes reaches only what
// imports that slice. Which slices a slice may import is its override in the root
// .oxlintrc.json, and this file imports none.
//
// These schemas mirror the engine's domain shapes (Event, TrakState, the output
// unions) but use plain strings where the engine uses branded types — brands are
// engine-internal and don't cross the wire. The on-disk log.jsonl format IS this
// format: events with `_tag`, outputs with `type`, optional fields absent.
//
// Drift detection: the server maps domain → DTO via `Schema.encodeUnknown` or a
// manual switch, so a renamed engine field breaks the server's `tsc` first; a
// renamed DTO breaks the client's `tsc`. Both are compile-time, not runtime.
//
// The server imports the runtime Schemas for encode/validation, and the client's
// `src/api/` imports them to decode every response; everywhere else the client takes
// `import type`. `shared/tsconfig.json`'s second pass, which has no Node types, is what
// keeps the contract browser-safe.

import { Schema } from "effect"

// ============================================================================
// Refusals — the body on every 4xx
// ============================================================================

/**
 * Why the engine would not do it.
 *
 * **A body rather than a reason phrase, and it was forced rather than chosen.** A
 * dirty-tree refusal is a list of files, and an HTTP reason phrase may not contain a
 * newline — so the moment the first refusal had something to *say*, the status line
 * stopped being able to carry it. The rest followed: `409 Not parked` and `409 Already
 * driving` were one status told apart by a phrase, which is the most fragile thing on
 * the wire (HTTP/2 carries none at all, and an intermediary may rewrite it).
 *
 * A closed union, so a client switches over it exhaustively and a new refusal is a
 * compile error rather than a case that silently reads as "something went wrong".
 */
/**
 * The tree the request would act on has uncommitted work: the host repository, which a
 * merge, pull or reconcile would move, or the parent's checkout a child's merge would go into.
 */
export const DirtyDto = Schema.TaggedStruct("Dirty", {
  files: Schema.NonEmptyArray(Schema.String),
})
/** The project checkout is on no branch, so there is nothing to pull into or push from. */
export const DetachedHeadDto = Schema.TaggedStruct("DetachedHead", {})
/** The project checkout has no remote named `origin` to fetch from or publish to. */
export const NoOriginDto = Schema.TaggedStruct("NoOrigin", {})
/** The checked-out branch tracks no remote branch, so a pull has nothing to fast-forward to. */
export const NoUpstreamDto = Schema.TaggedStruct("NoUpstream", {})
/**
 * Both the branch and its upstream have commits the other lacks. A pull only
 * fast-forwards and a push is never forced, so a reconcile — which merges — is the press
 * that applies.
 */
export const DivergedDto = Schema.TaggedStruct("Diverged", {
  ahead: Schema.Number,
  behind: Schema.Number,
})
/** The upstream has commits the branch lacks, so the remote would reject the push. Pull first. */
export const BehindDto = Schema.TaggedStruct("Behind", { behind: Schema.Number })
/**
 * A reconcile would conflict in `files`, and nothing in the checkout moved to find that
 * out. `description` is the request for a trak that would settle it — the merge, both
 * branches and the files, in the engine's words — and it is here because this refusal is
 * the one moment it is wanted.
 */
export const ConflictDto = Schema.TaggedStruct("Conflict", {
  files: Schema.NonEmptyArray(Schema.String),
  description: Schema.String,
})
/** Nobody is being asked anything here, so there is nothing to answer. */
export const NotParkedDto = Schema.TaggedStruct("NotParked", {})
/** The trak has not run out of plan, so there is no checkout to take away. */
export const NotFinishedDto = Schema.TaggedStruct("NotFinished", {})
/** A drive is already in flight for this trak. */
export const DrivingDto = Schema.TaggedStruct("Driving", {})
/**
 * The goal branch could not be made when the goal started, or its pull request into the
 * default branch could not be opened at Confirm done; `reason` says which and why. Nothing
 * was recorded, so pressing again retries.
 */
export const GoalBranchRefusedDto = Schema.TaggedStruct("GoalBranchRefused", {
  reason: Schema.String,
})
/**
 * A sub-goal's branch conflicts with its parent's goal branch at Confirm done, in `paths`;
 * nothing was merged, and the sub-goal stays at its done gate. `into` is the parent's branch.
 */
export const SubgoalConflictedDto = Schema.TaggedStruct("SubgoalConflicted", {
  into: Schema.String,
  paths: Schema.Array(Schema.String),
})
/** A goal cannot be confirmed done while these sub-goals of it are still going. */
export const SubgoalsLiveDto = Schema.TaggedStruct("SubgoalsLive", { subgoals: Schema.String })
/** It has already come to rest, so there is nothing left to declare over. */
export const AtRestDto = Schema.TaggedStruct("AtRest", {})
/** It is still going, and re-entering is for work that had stopped. */
export const NotAtRestDto = Schema.TaggedStruct("NotAtRest", {})
/**
 * A re-entry refused because the trak's pull request had merged and its branch could not
 * be moved onto the base, or the forge could not say whether it had. `why` is the engine's
 * sentence, with git's own account where git stopped. Nothing was appended, and the branch
 * is where it was.
 */
export const BranchNotMovedDto = Schema.TaggedStruct("BranchNotMoved", { why: Schema.String })
/** Nothing holds this trak's plan, so there is no wait to skip. */
export const NotWaitingDto = Schema.TaggedStruct("NotWaiting", {})
/** No failed effect is what stopped this trak, so there is no effect to skip. */
export const NoFailedEffectDto = Schema.TaggedStruct("NoFailedEffect", {})
/**
 * There is no agent turn running here for an interruption to reach.
 *
 * **Two ways to earn it, which is why the sentence says *running* rather than *is an
 * agent turn*.** Mostly it is the position: a stop takes over the drive and parks the
 * trak, which only means something where a `claude` or a check is what is going — the
 * setup script and every git operation would be interrupted with no gate to leave the
 * trak at, a parent waiting on its children has nothing of its own running, and a
 * composer writing a trak's *first* plan has no plan to wait beside. Abandoning is the
 * way out of those. A check earns it only where nothing of this daemon's is driving,
 * since there is then no fiber for the interruption to reach. Asking the step to file
 * earns it at the same positions and at every gate but a step's own conversation — the
 * one place a step is holding a turn nobody has asked to finish.
 *
 * The other is timing, and it is the same answer for a different reason: the engine
 * records a turn a moment after the state says one has begun, so a stop can arrive at a
 * trak that is about to run one and has not yet. Pressing again a moment later lands.
 *
 * **A crashed run is not one of the two**, however much it looks like the second: the
 * record outlives its holder, so the stop is accepted and parks the trak at the gate
 * carrying the session that dead turn was holding. Only a crash inside the same window
 * earns this, and `POST /resume` is what that one wants.
 */
export const NothingToStopDto = Schema.TaggedStruct("NothingToStop", {})
/**
 * A hold asked for on a `manual` trak, where every gate is stood at already. Refused
 * rather than recorded, so `holding` is never `true` on a mode that has no place to
 * show it.
 */
export const OnManualDto = Schema.TaggedStruct("OnManual", {})
/** It has been archived, or is being archived, so there is no pull request left to merge. */
export const ArchivedDto = Schema.TaggedStruct("Archived", {})
/** A child lands in its parent's checkout and has no pull request of its own to merge. */
export const ChildTrakDto = Schema.TaggedStruct("ChildTrak", {})
/** Auto-merge turned on for a trak whose goal file says `auto_merge: false`. */
export const GoalForbidsAutoMergeDto = Schema.TaggedStruct("GoalForbidsAutoMerge", {})
/**
 * The plan as a person edited it breaks a rule every plan is held to, and `reason` says
 * which in the engine's words — the same sentence the composer is re-asked with when its
 * own plan breaks it. Nothing was appended.
 */
export const PlanRefusedDto = Schema.TaggedStruct("PlanRefused", { reason: Schema.String })
/**
 * The edits were made against a proposal that is no longer the one at the gate: the
 * composer has answered again since, or the gate has gone past. Nothing was appended.
 */
export const ProposalMovedDto = Schema.TaggedStruct("ProposalMoved", {})

/**
 * A view's press named a tool its own server does not open to views — one marked for
 * the model alone, or one the server does not have. Nothing was called.
 */
export const ToolNotOpenDto = Schema.TaggedStruct("ToolNotOpen", {})
/**
 * The forge did not merge this trak's pull request. `why` says there is no pull request or
 * that the forge could not be asked, or is the forge's own refusal, verbatim. Nothing was
 * appended.
 */
export const PullNotMergedDto = Schema.TaggedStruct("PullNotMerged", { why: Schema.String })
/** A view's press on a trak whose checkout is gone: there is no directory to start a CLI in. */
export const NoCheckoutDto = Schema.TaggedStruct("NoCheckout", {})
/**
 * A view's press needed a CLI started and it did not start, or started and never
 * reached the view's server. `cli` is which, as the far end names it; the press was not
 * sent, and pressing again tries again.
 */
export const CliNotStartedDto = Schema.TaggedStruct("CliNotStarted", {
  cli: Schema.String,
  reason: Schema.String,
})
/** A view's press reached the CLI and came back refused or unanswered; `reason` is its own sentence. */
export const ToolCallFailedDto = Schema.TaggedStruct("ToolCallFailed", { reason: Schema.String })
/**
 * On a host with more than one user, a press that would start a turn on a trak or goal
 * somebody else owns. `reason` names the owner. Nothing was appended.
 */
export const NotOwnerDto = Schema.TaggedStruct("NotOwner", { reason: Schema.String })
/**
 * A file was not taken: an upload off the type allowlist or over its limit — `415` and
 * `413` — or a message naming an upload the engine no longer holds, or more files than a
 * message may carry — `422`. `reason` names the limit, in the words the chat bar shows.
 * Nothing was appended. The limits are `@orkestra/shared/dto/attachments`'.
 */
export const AttachmentRefusedDto = Schema.TaggedStruct("AttachmentRefused", {
  reason: Schema.String,
})
export const RefusalDto = Schema.Union(
  DirtyDto,
  GoalBranchRefusedDto,
  SubgoalConflictedDto,
  SubgoalsLiveDto,
  NotParkedDto,
  NotFinishedDto,
  DrivingDto,
  AtRestDto,
  NotAtRestDto,
  BranchNotMovedDto,
  NotWaitingDto,
  NoFailedEffectDto,
  NothingToStopDto,
  OnManualDto,
  ArchivedDto,
  ChildTrakDto,
  GoalForbidsAutoMergeDto,
  PlanRefusedDto,
  ProposalMovedDto,
  DetachedHeadDto,
  NoOriginDto,
  NoUpstreamDto,
  DivergedDto,
  BehindDto,
  ToolNotOpenDto,
  NoCheckoutDto,
  CliNotStartedDto,
  ToolCallFailedDto,
  ConflictDto,
  PullNotMergedDto,
  NotOwnerDto,
  AttachmentRefusedDto,
)
export type RefusalDto = Schema.Schema.Type<typeof RefusalDto>

/**
 * How much of a trak its person wants to stand at. Set when it is created and changed
 * any time after by `POST /api/traks/:id/mode`, which is picked up at the next gate.
 *
 * The same four words the engine uses, because this one crosses in both directions —
 * it is sent to start a trak and read back off one — and two vocabularies for one
 * setting is a translation nobody would be able to check.
 *
 * `smart` reads a document when the turn that filed it said the work was ambiguous, or
 * when the record shows the person was already in that position; everything else goes
 * past. `manual` stands at every gate and `auto` at none. `decider` takes every document
 * as `auto` does, and leaves questions, conversations and hand-offs to the person.
 */
export const RunModeDto = Schema.Literal("manual", "smart", "auto", "decider")
export type RunModeDto = Schema.Schema.Type<typeof RunModeDto>
