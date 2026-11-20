/**
 * Why GitHub will not merge a pull request now, as the line the finished band draws above
 * its merge press.
 *
 * **GitHub's API returns facts and no sentence**, so each cause is worded here the way
 * GitHub's own merge box words it. A refusal GitHub reports as blocked opens with *Merging
 * is blocked.*; a conflict, a branch behind its base and a draft are their own sentence.
 * A block nothing GitHub returned explains reads as a branch rule.
 */

import type { MergeHoldDto } from "../api/types"

/** `“a”`, `“a” and “b”`, `“a”, “b” and “c”` — GitHub's quotes around a check's name. */
const quoted = (names: readonly string[]): string => {
  const marks = names.map((name) => `“${name}”`)
  const last = marks.pop()
  return marks.length === 0 ? (last ?? "") : `${marks.join(", ")} and ${last ?? ""}`
}

const checks = (names: readonly string[], state: string): string =>
  names.length === 1
    ? `Required status check ${quoted(names)} ${state === "failing" ? "is failing" : "has not finished"}.`
    : `Required status checks ${quoted(names)} ${state === "failing" ? "are failing" : "have not finished"}.`

/** One cause, as one sentence. */
const sentence = (hold: MergeHoldDto): string => {
  switch (hold.cause) {
    case "draft":
      return "This pull request is still a work in progress."
    case "conflicting":
      return "This branch has conflicts that must be resolved."
    case "behind":
      return "This branch is out-of-date with the base branch."
    case "changesRequested":
      return "Changes were requested by reviewers with write access."
    case "reviewRequired": {
      const n = hold.approvals ?? 1
      return n === 1
        ? "At least 1 approving review is required by reviewers with write access."
        : `At least ${String(n)} approving reviews are required by reviewers with write access.`
    }
    case "checks":
      return checks(hold.names, "failing")
    case "waiting":
      return checks(hold.names, "waiting")
    case "rule":
      return "Merging is blocked by a branch rule."
  }
}

/** Whether GitHub calls this cause a block, which is what earns the line its lead. */
const blocks = (hold: MergeHoldDto): boolean =>
  hold.cause === "changesRequested" ||
  hold.cause === "reviewRequired" ||
  hold.cause === "checks" ||
  hold.cause === "waiting"

/** The band's line: the lead where GitHub blocks it, then one sentence per cause. */
export const mergeHoldsLine = (
  holds: readonly MergeHoldDto[],
): { readonly lead: string | undefined; readonly text: string } => ({
  lead: holds.some(blocks) ? "Merging is blocked." : undefined,
  text: holds.map(sentence).join(" "),
})
