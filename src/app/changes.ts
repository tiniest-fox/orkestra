// Which slice of a trak's work `GET /api/traks/:id/changes` was asked for, and
// what that is in git's terms.
//
// Here rather than in `workflow/` for `images.ts`'s reason: it drives nothing,
// takes no custody and touches no trak's state. It reads a log and answers a
// question about it.
//
// Pure, and deliberately so — every judgement below is about which commits a
// step's work sits between, which is the half of this feature that has an
// interesting wrong answer.

import { ChangeRange, type CommitSha, type Worktree } from "../vcs/index.js"
import type { Event } from "../workflow/domain/event.js"
import type { Trak } from "../workflow/domain/trak.js"

/**
 * What the `at` query parameter can name: the whole branch, what is in the
 * checkout and uncommitted, or one position of the plan.
 *
 * A step **index** rather than a commit hash, because the index is the id the
 * whole app already navigates by and it never renumbers. It costs the merge
 * commit of a spawned piece its own row — that folds into the neighbouring step.
 */
export type ChangesAt = "all" | "uncommitted" | number

/**
 * The parameter, read. `undefined` is a request this route will not answer —
 * a 400 rather than a slice with no files, because *I do not know what you
 * asked for* and *there is nothing there* are different sentences.
 *
 * An absent parameter is `all`: it is the one slice every trak can answer, and
 * it is what a caller with nothing particular in mind means.
 */
export const requestedAt = (raw: string | undefined): ChangesAt | undefined => {
  if (raw === undefined || raw === "all") return "all"
  if (raw === "uncommitted") return "uncommitted"
  return /^\d+$/.test(raw) ? Number(raw) : undefined
}

/** A commit the log records, in the order the log records them. */
interface Kept {
  readonly sha: CommitSha
  /** Absent is the composer, which has no position — the log's own convention. */
  readonly step: number | undefined
}

const keptIn = (log: readonly Event[]): readonly Kept[] =>
  log.flatMap((e) =>
    e._tag === "WorkCommitted" && e.sha !== undefined ? [{ sha: e.sha, step: e.step }] : [],
  )

/**
 * The two ends of one step's work.
 *
 * **The far end is the last commit this step reported**, because a step that was
 * restarted reports twice and the second is where it got to.
 *
 * **The near end is the last commit a *different* position reported**, and that
 * is the whole of what makes both awkward cases right. A step re-run after a
 * failure would otherwise be diffed against its own first attempt, showing only
 * the retry; and a step that changed nothing reports the sha the step before it
 * did — `Vcs.commitWork` reads its answer off the branch rather than off what it
 * committed — so skipping back to the last *different* sha would show that
 * earlier step's work under this one's name. Taking the previous position's sha
 * gives an empty range there, which is exactly what happened.
 *
 * **A spawn resolves here like any other position, and its range is the join.**
 * `ChildrenJoined` decides `keepStep` at the spawn's own index, so `CommitWork`
 * runs there as at any step boundary and the sha `commitWork` reports is the
 * parent's branch tip once every piece's merge has landed. Nothing above assumes
 * one commit per step, which is what makes that right: the near end is still the
 * previous position's sha, so the range spans every merge rather than one turn's
 * work.
 *
 * `undefined` when the position committed nothing: an empty answer, not a
 * failure. A compose has no sha of its own, and neither has a spawn whose pieces
 * have not joined yet.
 */
const stepRange = (
  log: readonly Event[],
  worktree: Worktree,
  step: number,
): ChangeRange | undefined => {
  const kept = keptIn(log)
  const last = kept.findLastIndex((c) => c.step === step)
  const to = kept[last]
  if (to === undefined) return undefined
  const before = kept.slice(0, last).findLast((c) => c.step !== step)
  return ChangeRange.Commits({ from: before?.sha ?? worktree.base, to: to.sha })
}

/**
 * The slice, in git's terms — or `undefined` when there is nothing to read,
 * which is an empty answer rather than an error.
 *
 * A trak with no worktree has never had a branch, so no slice of it exists. That
 * is a trak that failed before its checkout was made, and it is the one case
 * where every row of the picker is empty at once.
 */
export const rangeFor = (
  trak: Trak,
  log: readonly Event[],
  at: ChangesAt,
): ChangeRange | undefined => {
  const worktree = trak.worktree
  if (worktree === undefined) return undefined
  if (at === "all") return ChangeRange.Branch({ worktree })
  if (at === "uncommitted") return ChangeRange.Uncommitted({ worktree })
  return stepRange(log, worktree, at)
}
