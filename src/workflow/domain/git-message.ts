// domain: what a commit and a merge are titled, so `git log` on any branch says
// which trak wrote each commit and what for. Pure, and read by the runtime's
// `CommitWork` and `MergeWork` and by the route that commits a parent's checkout
// on a person's behalf before merging a child into it.

import { artifactKey, isCompose } from "./outputs/proposal.js"
import type { Trak } from "./trak.js"
import type { BranchName } from "../../vcs/index.js"

/**
 * The message a step's commit is made under.
 *
 * With a step, the subject is `artifactKey(entry, step)` — the same key the
 * artifact is filed under and the projection's filename — so a commit and its
 * document are named alike, and the body is the step's own instruction, which
 * is what a person reading `git log` on the branch wants to know it was for.
 *
 * With no step — the catch-all commit past the last one, and at `Abandoning` —
 * or when the step cannot be named (a missing entry), it falls back to the
 * trak's own description: a naming problem must not fail a commit.
 */
export const commitMessage = (trak: Trak, step: number | undefined): string => {
  const trailer = `Orkestra-Trak: ${trak.id}\n`
  const fallback = (): string => {
    const subject = trak.description.split("\n")[0]?.trim() ?? ""
    return `${subject === "" ? "orkestra trak" : subject}\n\n${trailer}`
  }
  if (step === undefined) return fallback()
  const entry = trak.plan?.steps[step]
  // A compose entry has no instruction and never reaches a commit of its own; the
  // fallback subject is right for it as it is for a position that is not a step.
  if (entry === undefined || isCompose(entry)) return fallback()
  const summary = entry.instruction.split("\n")[0]?.trim() ?? ""
  return `${artifactKey(entry, step)}: ${summary}\n\n${entry.instruction}\n\n${trailer}`
}

/**
 * What a merged branch goes in under, with the same trailer for the same reason:
 * `git log` answers which trak brought each piece in, and the branch name says
 * which piece. Used by a spawn's join and by a human's merge alike — a trak
 * merging into somebody's branch is the same sentence one level up.
 */
export const mergeMessage = (trak: Trak, branch: BranchName): string =>
  `Merge ${branch}\n\nOrkestra-Trak: ${trak.id}\n`
