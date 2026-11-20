/**
 * What auto-merge is doing on a trak, in words — the details line, and the caption of a
 * re-entry the engine made. The count and the limit are the engine's; nothing here knows
 * how many sends a trak gets.
 */

import type { AutoMergeDto, ReentryCauseDto, StopCauseDto } from "../../api/types"

/**
 * Why it would not merge, as a phrase. A conflict carrying `into` is the engine's own local
 * merge, in a project with no `origin`: there is no pull request to name, only the branch
 * of the project's checkout it would not go into. The branch is not in backticks: every
 * surface that draws this phrase draws it as plain text, so they would show literally.
 */
const causeText = (cause: ReentryCauseDto): string => {
  switch (cause._tag) {
    case "Conflict":
      return cause.into === undefined
        ? "its pull request conflicts with its base"
        : `its branch conflicts with ${cause.into} in the project's checkout`
    case "Checks":
      return cause.failed.length === 0
        ? "its checks failed"
        : `its checks failed: ${cause.failed.join(", ")}`
  }
}

/**
 * Why it stopped. A cause it sent the trak back for counts the sends; the other two are
 * the forge holding a merge no send could release, so there is no count to give.
 */
const stoppedText = (sentBack: number, stopped: StopCauseDto): string => {
  switch (stopped._tag) {
    case "Conflict":
    case "Checks":
      return `stopped after ${String(sentBack)} sends — ${causeText(stopped)}`
    case "Blocked":
      return "stopped — its checks pass, and GitHub still holds the merge (a required review or rule)"
    case "Refused":
      return `stopped — GitHub refused the merge: ${stopped.why}`
  }
}

/** The details line: off, on with how many sends are spent, or why it stopped. */
export const autoMergeLine = (autoMerge: AutoMergeDto | undefined): string => {
  if (autoMerge === undefined) return "off"
  const { sentBack, limit, stopped } = autoMerge
  if (stopped !== undefined) {
    return `${stoppedText(sentBack, stopped)}; merge or archive it yourself`
  }
  return sentBack === 0 ? "on" : `on · sent back ${String(sentBack)} of ${String(limit)}`
}

/** A re-entry's caption, where the engine sent the trak back to make it merge. */
export const sentBackText = (cause: ReentryCauseDto): string => `auto-merge: ${causeText(cause)}`

/** Whether the engine is still merging it on its own — on, and not stopped. */
export const autoMerging = (autoMerge: AutoMergeDto | undefined): boolean =>
  autoMerge !== undefined && autoMerge.stopped === undefined

/** The switch row's phrase, beside its name: what on means, how far it has got, or stopped. */
export const autoMergePhrase = (autoMerge: AutoMergeDto | undefined): string => {
  if (autoMerge?.stopped !== undefined) return "stopped"
  if (autoMerge === undefined || autoMerge.sentBack === 0) return "once its checks pass"
  return `sent back ${String(autoMerge.sentBack)} of ${String(autoMerge.limit)}`
}

/**
 * Where auto-merge stands, as a sentence starting *Auto-merge*, for the line above a switch
 * — or `undefined` while there is nothing to say. A stop is `waiting` and names what to do,
 * and the cause decides it: turning the switch on again is a fresh start, which releases a
 * stop for sends spent and does nothing for a merge GitHub holds.
 */
export const autoMergeNotice = (
  autoMerge: AutoMergeDto | undefined,
): { readonly waiting: boolean; readonly text: string } | undefined => {
  if (autoMerge === undefined) return undefined
  const { sentBack, limit, stopped } = autoMerge
  if (stopped !== undefined) {
    const next =
      stopped._tag === "Blocked"
        ? "Merge it on GitHub once the review is in."
        : "Turn it on to try again."
    return { waiting: true, text: `Auto-merge ${stoppedText(sentBack, stopped)}. ${next}` }
  }
  return sentBack === 0
    ? undefined
    : {
        waiting: false,
        text: `Auto-merge sent it back ${String(sentBack)} of ${String(limit)} times to make it mergeable.`,
      }
}
