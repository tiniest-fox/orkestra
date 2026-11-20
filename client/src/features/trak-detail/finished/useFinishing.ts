/**
 * Everything the finished position presses, in one call.
 *
 * **An aggregator, not a hook with a discriminator.** The four presses stay four
 * mutations with four refusal vocabularies and one `said` each — `useMerge` carries why
 * that matters, and nothing here merges them; the skip on a held step is a fifth, with
 * a refusal of its own, the merge of a pull request on the forge a sixth, auto-merge's switch
 * beside it a seventh, and the method menu on that press an eighth. What this saves is the page
 * holding ten hooks and ten props for one pane.
 *
 * The preview rides along because it belongs to the same pane, asked once here off the
 * state the page already holds rather than twice in two places that could disagree. Its
 * `enabled` is `destinationAsked` and **not** `mergeOffered`, which is the near-miss: a
 * merge in flight has a destination to draw and no press to label.
 *
 * **The forge rides along for the same reason and on a wider state gate.** Where the
 * preview asks at three of the six ended states, the pull-request half is drawn at all six
 * — including the ones the preview stops asking at, because a merged pull request still has
 * to say the work is in over there.
 *
 * **Both are then narrowed by `branchMoved`, and it is one fact for one reason.** A branch
 * nothing was committed to has nowhere for a merge to go and cannot have a pull request, so
 * each question has exactly one possible answer and neither answer is drawn. What they cost
 * unasked is not a render: the preview is a `git merge-tree` against the daemon's own
 * checkout, and the forge is a `gh` process every `POLL_MS` for as long as the drawer is
 * open. `traks-list/forgeBranches` refuses the same rows for the same reason, one route
 * over. It is not a fact about `TrakStateDto`, which is why it is `&&`-ed here rather than
 * pushed into a switch — `controls.ts` records what a control drawn from anything but the
 * state costs.
 *
 * **Safe at all six, and the fact is what makes it so rather than the states.** `moved` is
 * false at `Closed` as well — that is where archiving a no-code trak lands —
 * and `mergeRoute` still takes a trak with no commits, so `Merging` and `Merged` are
 * reachable that way too. None of that matters: a branch with no commits has no destination
 * and can have no pull request wherever it stands, and `arrowEnd` draws no right-hand side
 * there either, so nothing that would have been on screen goes missing. `finishingLive` is
 * where both are written down, so the pair cannot drift and neither needs React to check.
 */

import type { LandedDto, MergePreviewDto, TrakDetailDto, TrakStateDto } from "../../../api/types"
import { archiveFailed, destinationAsked, finishedPosition } from "../controls"
import { deployAsked } from "../deploy/deploy"
import { pullMergeOf, type Forge, type PullMerge } from "../pull-request/pullRequest"
import { useArchive, type Archiving } from "../useArchive"
import { useCommitAndMerge, type CommitAndMerge } from "./merge/useCommitAndMerge"
import { useMerge, type Merge } from "./merge/useMerge"
import { useMergePreview } from "./merge/useMergePreview"
import { useMergePullRequest, type PullMerging } from "./merge/useMergePullRequest"
import { useSetMergeMethod, type MergeMethodPick } from "./merge/useSetMergeMethod"
import { useDeploy, type Deploy } from "../deploy/useDeploy"
import { usePullRequest } from "../pull-request/usePullRequest"
import { useReenter, type Changes } from "./acts/useReenter"
import { useSkipWait, type Skipping } from "../waits/useSkipWait"
import { useSetAutoMerge, type AutoMergeSetting } from "../run-mode/useSetAutoMerge"

export interface Finishing {
  readonly merge: Merge
  /** The merge of the pull request on the forge — the band's press while one is open. */
  readonly pullMerging: PullMerging
  /** `pullMergeOf`: the open pull request that press is drawn from, asked once so the hook's
   *  guard and the drawn press read one answer. */
  readonly pull: PullMerge | undefined
  /** The menu beside that press, which records the method it merges by. */
  readonly methodPick: MergeMethodPick
  /** The way through a dirty parent: commit its checkout, then merge. Drawn only where the
   *  preview names a parent — the route refuses a trak at the top. */
  readonly commitAndMerge: CommitAndMerge
  readonly archiving: Archiving
  readonly changes: Changes
  /** Where a merge would land. `undefined` until it answers, and wherever nothing asked. */
  readonly preview: MergePreviewDto | undefined
  /**
   * Everything known about the branch's pull request: this pane's own answer, the traks
   * list's cheaper one about the same branch, when either was got, and whether anything has
   * been confirmed since the page opened. `cardOf` is what turns it into which of the four
   * cards this is, and it is asked once — the pane draws from it and the local Merge press
   * is withheld on it.
   */
  readonly forge: Forge
  /**
   * What `deploy.sh` says about the merge commit, asked only where there is one —
   * `deployAsked` — and drawn as the block above the card. Every answer but `none` may
   * run a script, which is why it is gated here beside the other two outside reads.
   */
  readonly deploy: Deploy
  /**
   * The press that starts the held step with its wait unmet. Drawn only where the pane
   * draws a wait — the held card, or the deploy block's head — and it spends, so it is
   * under the same custody as the four presses.
   */
  readonly skipping: Skipping
  /**
   * Auto-merge's switch beside the forge merge press. Spends nothing and takes no custody,
   * as in the picker; a second instance of the hook, so each surface's refusal draws beside
   * its own press.
   */
  readonly autoMerge: AutoMergeSetting
}

/**
 * Which of the pane's two outside questions are live — the only decision this file makes,
 * and a pure function so that it is checkable without a React tree.
 *
 * A hook here is a `useQuery` of an options factory, and this is the same split one level
 * up: an aggregator has no options object of its own, so the gates it composes would
 * otherwise be reachable only by counting requests through a rendered page. See the header
 * for what each gate is and why `moved` narrows both.
 *
 * `state` is `undefined` while the detail is still loading, which is also when `moved` is
 * `false` — nothing is asked until there is a trak to ask about.
 */
export const finishingLive = (
  state: TrakStateDto | undefined,
  moved: boolean,
  /** `TrakDetailDto.landed` — the commit a wait found the branch merged as. */
  landed: LandedDto | undefined,
  /** `TrakDetailDto.deployScript` — whether the project has anything to ask. */
  deployScript: boolean,
): { readonly destination: boolean; readonly forge: boolean; readonly deploy: boolean } =>
  state === undefined || !moved
    ? { destination: false, forge: false, deploy: false }
    : {
        destination: destinationAsked(state),
        // Not at an archive that did not finish: the person has already ended the trak,
        // so a pull request's standing would only offer presses it no longer takes.
        forge: finishedPosition(state) !== undefined && !archiveFailed(state),
        // Narrowed by `moved` with the other two, and it is the same one fact: a branch
        // nothing was committed to never lands, so there is never a commit to ask about.
        // By the plan having run out, like the forge: a landed trak whose held step is
        // now running draws no finished pane, so there is nothing to draw an answer on.
        // And by the project having a script at all, which is the one gate the route
        // cannot stand in for: it answers `none` at once without one, and the line drawn
        // while it does is a jump on every merged page of a project that never deploys.
        deploy: deployScript && finishedPosition(state) !== undefined && deployAsked(state, landed),
      }

/**
 * `running` is the detail's `custody.holder !== undefined` and `moved` is `branchMoved`
 * over its log — both read by the caller, so nothing here holds a second opinion about a
 * trak the page already has in hand. `owner` is the trak the presses act for, and the
 * three fields off it are read as they are: the state gates every question, the
 * worktree's branch is what the list's coarse answer is matched on — the forge names
 * branches and knows nothing about traks, the same join `rungsOf` makes on the list — and
 * `landed` is the commit a wait found the branch merged as, which is what the deploy is
 * asked about, and `deployScript` whether the project has anything to ask. `undefined`
 * while the detail is still loading.
 */
export const useFinishing = (
  id: string,
  running: boolean,
  owner:
    | Pick<TrakDetailDto, "state" | "worktree" | "landed" | "deployScript" | "mergeMethod">
    | undefined,
  moved: boolean,
): Finishing => {
  const live = finishingLive(owner?.state, moved, owner?.landed, owner?.deployScript === true)
  // Held apart because the second press is given the first's `forget`: a commit that
  // lands re-issues the merge, so the files the pre-check remembered are stale on both
  // of its exits — `useCommitAndMerge` carries the one this cannot be gated out of.
  const merge = useMerge(id, running)
  const forge = usePullRequest(id, live.forge, owner?.worktree?.branch)
  const methodPick = useSetMergeMethod(id)
  const pull = pullMergeOf(forge, methodPick.picking ?? owner?.mergeMethod)
  return {
    merge,
    pullMerging: useMergePullRequest(id, pull?.verdict?._tag === "Mergeable"),
    pull,
    methodPick,
    commitAndMerge: useCommitAndMerge(id, running, merge.forget),
    archiving: useArchive(id, running),
    changes: useReenter(id, running),
    preview: useMergePreview(id, live.destination).data,
    forge,
    deploy: useDeploy(id, live.deploy),
    skipping: useSkipWait(id, running),
    autoMerge: useSetAutoMerge(id),
  }
}
