/**
 * What the plate over a finished card says when a merge into the destination's checkout
 * did not go in — and whether there is one to draw at all.
 *
 * **Two ways to earn it, and they are not one state with a different chip.** A merge that
 * **failed** ran and was declined: the trak is `Failed{merge}`, git's stderr is on the
 * state, and there is text to draw. A press that was **refused** was checked first — the
 * route asks about the parent's checkout before issuing anything — and a `Dirty` refusal
 * carries paths and nothing else. Git never spoke, so the plate degrades to a sentence and
 * a file list. One plate draws both, with the files standing where git's output would be.
 *
 * **The refusal wins over the failure where both are true, because it is the later of the
 * two.** A person who pressed Merge on a trak already at `Failed{merge}` and was refused
 * has a fresher answer than the failure: the files named now, not the sentence git said
 * then. The ordering holds only because the one press that reverses it — a commit that
 * lands and a merge git still declines — makes the Merge press forget its files as it
 * lands (`useCommitAndMerge`), so a list this is handed is never older than the failure
 * beside it. Nothing here could tell the two apart from `(state, files)` alone.
 *
 * **A refusal the press earned is true only while that press can still be made.** The
 * files outlive the state they were earned at — `useMerge`'s error stands until the id
 * changes, and a commit-and-merge is a different mutation — so once the trak has moved
 * past the merge, to `Merging` and on to `Merged` or `Closed`, they are a memory of a
 * refusal that no longer holds. `mergeOffered` is the gate: the states it answers for
 * are exactly the ones a refusal can still be about.
 *
 * **Only a child's refusal is plated.** The host repository keeps its dirty refusal at the
 * Merge press — a person's own working directory holds their own files, and nothing
 * commits it for them — so a refusal with no parent named stays in the band. A failure is
 * plated wherever it happened, because the finishing card is kept there either way; it is
 * only the press that needs a parent.
 */

import type { TrakStateDto } from "../../../../api/types"
import { failureWords } from "../../../../format/failure"
import { mergeOffered } from "../../controls"

/** The press that commits the parent and merges, and what it costs, beside it. */
export interface CommitWords {
  readonly press: string
  readonly says: string
}

export interface MergeRefusal {
  /** The mono-caps mark above the sentence. */
  readonly head: string
  /** What happened, in one sentence. */
  readonly line: string
  /** What git said, whole, where it ran — the engine's own command prefix included.
   *  `undefined` where the press was refused before git was asked. */
  readonly said: string | undefined
  /** The paths the pre-check named, where git never spoke. Empty where it did. */
  readonly files: readonly string[]
  /** The commit-and-merge press, where the destination is a parent's checkout. */
  readonly commit: CommitWords | undefined
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`

const commitWords = (parent: string, files: readonly string[]): CommitWords => ({
  press: `Commit ${parent} and merge`,
  says:
    files.length === 0
      ? "Commits whatever is uncommitted in that checkout under the trak's own description, then merges."
      : `Commits the ${plural(files.length, "file")} in that checkout under the trak's own description, then merges.`,
})

/**
 * `files` is the Merge press's last `Dirty` refusal, or empty; `parent` is the id the merge
 * preview names, or `undefined` for a trak at the top and until the preview answers.
 */
export const mergeRefusal = (
  state: TrakStateDto,
  files: readonly string[],
  parent: string | undefined,
): MergeRefusal | undefined => {
  if (parent !== undefined && files.length > 0 && mergeOffered(state)) {
    return {
      head: "the merge was refused",
      line: `git would not merge into ${parent}'s checkout: there is uncommitted work there that the merge would overwrite. Nothing has moved, and the branch is untouched.`,
      said: undefined,
      files,
      commit: commitWords(parent, files),
    }
  }
  if (state._tag === "Failed" && state.kind === "merge") {
    const words = failureWords(state)
    return {
      head: words.head,
      line: words.line,
      said: state.error,
      files: [],
      commit: parent === undefined ? undefined : commitWords(parent, []),
    }
  }
  return undefined
}

/**
 * The engine's prefix and git's own words, apart.
 *
 * The runtime records a declined merge as `merge: git merge … exited 2: <stderr>`, on one
 * line up to the colon after the exit code. The prefix is drawn as its own line, the way
 * `GateFace` draws a check's command, so `git merge --no-ff …` does not read as something
 * git said. A string with no such prefix — the engine's own two sentences, or a log
 * written another way — is all output.
 */
export const gitSaid = (
  said: string,
): { readonly command: string | undefined; readonly output: string } => {
  const found = /^(.*? exited [^:\n]*): ?([\s\S]*)$/.exec(said)
  const command = found?.[1]
  const output = found?.[2]
  return command === undefined || output === undefined
    ? { command: undefined, output: said }
    : { command: `${command}:`, output }
}
