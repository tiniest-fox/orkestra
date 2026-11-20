// The project checkout's git: its branch, counts and the presses on it. Part of the wire contract;
// `common.ts` says how the slices fit together.

import { Schema } from "effect"

// ============================================================================
// The project checkout's git — the bar's branch, counts, fetch, pull, reconcile and push
// ============================================================================

export const HostBranchDto = Schema.TaggedStruct("Branch", { name: Schema.String })
/** The whole sha; how much of it to show is the surface's. */
export const HostDetachedDto = Schema.TaggedStruct("Detached", { sha: Schema.String })
/** What the project checkout has checked out: a branch, or a commit with none. */
export const HostHeadDto = Schema.Union(HostBranchDto, HostDetachedDto)
export type HostHeadDto = Schema.Schema.Type<typeof HostHeadDto>

/** The press whose failure the bar is showing. */
export const GitActionDto = Schema.Literal("fetch", "pull", "reconcile", "push")
export type GitActionDto = Schema.Schema.Type<typeof GitActionDto>

/**
 * `GET /api/git`, and the whole of what a `POST /api/git/{fetch,pull,reconcile,push}`
 * that was not refused answers but for `GitPressedDto`'s one field — one shape, so the
 * bar redraws from whichever arrived last and a press cannot leave it disagreeing with a
 * poll.
 *
 * **The counts are as of the last fetch**, by anybody: they are read off local refs, and
 * a fetch in a terminal moves them too. `fetchedAt` is narrower — the last fetch *this
 * engine* finished — because it is what decides whether a poll fetches again.
 */
export const HostGitDto = Schema.Struct({
  head: HostHeadDto,
  /** Whether a remote named `origin` is configured. */
  origin: Schema.Boolean,
  /**
   * The remote branch the checked-out branch tracks, and how far apart they are. Absent
   * for a branch that is not published — one that tracks nothing, or whose remote branch
   * has gone — and for a detached `HEAD`. A push publishes it to `origin`.
   */
  upstream: Schema.optional(
    Schema.Struct({
      /** As git abbreviates it — `origin/main`. */
      name: Schema.String,
      ahead: Schema.Number,
      behind: Schema.Number,
    }),
  ),
  /** When this engine last finished a fetch, epoch milliseconds. Absent since boot until one has. */
  fetchedAt: Schema.optional(Schema.Number),
  /** A fetch is running now — started by a press or by a poll that found the last one stale. */
  fetching: Schema.Boolean,
  /**
   * The newest press that failed, in git's words, until that press next succeeds. A
   * refusal is never here: it is the `409` answer to the press that earned it.
   */
  failure: Schema.optional(
    Schema.Struct({ action: GitActionDto, message: Schema.String, at: Schema.Number }),
  ),
})
export type HostGitDto = Schema.Schema.Type<typeof HostGitDto>

/**
 * The body of `POST /api/git/pull` and `POST /api/git/reconcile`, and it may be absent
 * whole. `stash` sets a dirty tree aside for the press and puts it back afterwards,
 * where it would otherwise be refused `Dirty`.
 */
export const GitPressRequestDto = Schema.Struct({ stash: Schema.optional(Schema.Boolean) })
export type GitPressRequestDto = Schema.Schema.Type<typeof GitPressRequestDto>

/**
 * What a press that was not refused answers: the bar as it now stands, and one thing
 * only that press can say.
 *
 * `stashed` is a press with `stash` that landed and could not put the changes back —
 * they would conflict in `files` with what came down, so the tree is clean at the new
 * commit and the changes are in one stash entry. **On this answer and never on the
 * polled read**: the press landed, so it is no refusal, and the engine keeps no memory
 * of it to say again.
 */
export const GitPressedDto = Schema.Struct({
  ...HostGitDto.fields,
  stashed: Schema.optional(Schema.Struct({ files: Schema.NonEmptyArray(Schema.String) })),
})
export type GitPressedDto = Schema.Schema.Type<typeof GitPressedDto>
