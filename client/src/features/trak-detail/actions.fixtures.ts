/**
 * What a hook hands a control, for the atelier catalogue.
 *
 * `Chat`, `Approval`, `Merge` and the rest are `use*` return types — a page calls the hook
 * and passes the result down, so these arrive as **props rather than context** and no
 * wrapper could supply them. They are also the cheapest fixtures here: a handful of
 * booleans, a sentence, and a callback that does nothing.
 *
 * **Three states, not one.** Every one of these has the same three: at rest, pending while
 * the request is out, and refused with a sentence saying why. Those are the states the
 * controls exist to draw, and a single fixture would show the first and hide the two that
 * are hard to reach by hand.
 *
 * A no-op is `() => {}` and not a stub that records — a fixture is looked at, not asserted
 * on, and a control that appears to work while changing nothing is the honest picture of a
 * component whose behaviour lives in a hook that is not here.
 */

import type { PullRequestDto } from "../../api/types"
import {
  makePullRequest,
  makePullRequestCheck,
  makePullRequestComment,
  makeReview,
  makeReviewThread,
} from "../../fixtures"
import { checkPick, threadPick, type Forge } from "./pull-request/pullRequest"
import type { Picked } from "./pull-request/picks/reentryBody"
import type { UnfinishedArchive } from "./useArchiveUnfinished"
import type { Answering } from "./useAnswer"
import type { Approval } from "./useApprove"
import type { Changes } from "./finished/acts/useReenter"
import type { Archiving } from "./useArchive"
import type { Ending } from "./finished/finished"
import type { Deploy } from "./deploy/useDeploy"
import type { Finishing } from "./finished/useFinishing"
import type { CommitAndMerge } from "./finished/merge/useCommitAndMerge"
import type { Skipping } from "./waits/useSkipWait"
import type { AutoMergeSetting } from "./run-mode/useSetAutoMerge"
import type { Merge } from "./finished/merge/useMerge"
import type { PullMerging } from "./finished/merge/useMergePullRequest"
import type { MergeMethodPick } from "./finished/merge/useSetMergeMethod"
import type { Resumption } from "./failure/useResume"
// The client's own narrowing of `TrakStateDto`, not a wire type — it lives beside the
// controls that switch on it rather than in `api/types`.
import type { EndStateDto } from "./controls"

const noop = (): void => {}
const REFUSED = "the engine is not at rest — park it first"

/* ------------------------------------------------------------------------- chat */

export const chat = {
  draft: "",
  write: noop,
  send: noop,
  isPending: false,
  disabled: false,
  said: undefined,
}
export const chatTyping = { ...chat, draft: "split the union before deriving the panel" }
export const chatSending = { ...chatTyping, isPending: true }
export const chatDisabled = { ...chat, disabled: true }
/** A refusal keeps the draft — that is the whole reason `draft` is in the hook's result. */
export const chatRefused = {
  ...chatTyping,
  said: "the trak is driving; nothing can be sent while it is",
}

/* ------------------------------------------------------ the one-press mutations */

export const approval: Approval = {
  approve: noop,
  approveWith: noop,
  isPending: false,
  disabled: false,
  said: undefined,
}
export const approving: Approval = { ...approval, isPending: true }
export const approvalDisabled: Approval = { ...approval, disabled: true }
export const approvalRefused: Approval = { ...approval, said: REFUSED }

/**
 * The answer form's, and the reason it is here rather than a `useState` in the catalogue:
 * `AnswerForm` holds what is typed itself and takes only the four facts a hook decides, so
 * the same three states plus at-rest are the whole of what a knob can vary.
 */
export const answering: Answering = {
  send: noop,
  isPending: false,
  disabled: false,
  said: undefined,
}
export const answeringSending: Answering = { ...answering, isPending: true }
export const answeringDisabled: Answering = { ...answering, disabled: true }
export const answeringRefused: Answering = { ...answering, said: REFUSED }

export const resumption: Resumption = {
  resume: noop,
  isPending: false,
  disabled: false,
  said: undefined,
}
export const resuming: Resumption = { ...resumption, isPending: true }
export const resumptionRefused: Resumption = {
  ...resumption,
  said: "there is nothing to resume from",
}

export const unfinishedArchive: UnfinishedArchive = {
  archive: noop,
  isPending: false,
  disabled: false,
  said: undefined,
}
export const unfinishedArchivePending: UnfinishedArchive = {
  ...unfinishedArchive,
  isPending: true,
}
export const unfinishedArchiveRefused: UnfinishedArchive = {
  ...unfinishedArchive,
  said: REFUSED,
}

export const archiving: Archiving = {
  archive: noop,
  isPending: false,
  disabled: false,
  said: undefined,
}
export const archivingPending: Archiving = { ...archiving, isPending: true }
export const archivingRefused: Archiving = {
  ...archiving,
  said: "the worktree still has uncommitted changes",
}

/* --------------------------------------------------------------------- the merge */

export const merge: Merge = {
  merge: noop,
  forget: noop,
  isPending: false,
  disabled: false,
  said: undefined,
  files: [
    "src/lib/catalogue.ts",
    "app/lib/catalogue.ts",
    "templates/skill/references/catalogue.md",
  ],
}
/** Nothing to merge, which is a different picture from a merge that is ready. */
export const emptyMerge: Merge = { ...merge, files: [], disabled: true }
/** The press through a dirty parent, at rest. */
export const commitAndMerge: CommitAndMerge = {
  commit: noop,
  isPending: false,
  disabled: false,
  said: undefined,
}
export const merging: Merge = { ...merge, isPending: true }
export const mergeRefused: Merge = { ...merge, said: "the host repo is on a detached HEAD" }

/* ------------------------------------------------------------------- the changes */

export const changes: Changes = {
  what: "",
  write: noop,
  send: noop,
  isPending: false,
  disabled: false,
  said: undefined,
}
export const changesAsked: Changes = {
  ...changes,
  what: "keep the branch knob but name it after the discriminant",
}
export const changesSending: Changes = { ...changesAsked, isPending: true }
export const changesRefused: Changes = { ...changesAsked, said: "the trak has already been closed" }

/* ----------------------------------------------------------------------- the forge */

/**
 * What the forge answers. Three, because they are three pictures the pane owes: a branch
 * with a pull request on it, one with none, and a forge that could not be asked — and the
 * last two draw exactly the same thing, which is nothing at all.
 */
export const noPullRequest: PullRequestDto = { _tag: "NoPullRequest" }
export const forgeUnavailable: PullRequestDto = {
  _tag: "ForgeUnavailable",
  why: "gh is not authenticated",
}
export const openPullRequest: PullRequestDto = makePullRequest({
  merging: "conflicting",
  decision: "changesRequested",
  checks: [
    makePullRequestCheck(),
    makePullRequestCheck({ name: "build", verdict: "passed", url: undefined }),
    makePullRequestCheck({ name: "e2e", verdict: "skipped", url: undefined }),
  ],
  reviews: [
    makeReview({
      body: "Two things, one of them structural.",
      threads: [makeReviewThread(), makeReviewThread({ resolved: true, line: 88 })],
    }),
  ],
  conversation: [makePullRequestComment({ who: "someone-else", body: "Timeout?" })],
})

/** What ticking three things puts in the box at the foot. */
export const pickedThings: readonly Picked[] = [
  checkPick(makePullRequestCheck(), 41, 60_000),
  threadPick(makeReview(), makeReviewThread(), 0, 41),
  {
    key: "merging",
    label: "GitHub will not merge it as it stands",
    said: "",
    where: [],
    quote: "",
  },
]

/* ------------------------------------------------------------------ the finishing */

/**
 * An answer this session, which is the state everything below wants: the card at full
 * colour, nothing waiting, and the synced line reading *just now*.
 *
 * `at` is `Date.now()` rather than a frozen stamp, because the line it feeds is measured
 * against the moment the catalogue renders — a fixed one would drift into *3 hours ago*
 * while somebody looked at it.
 */
const answered = (pull: PullRequestDto | undefined): Forge => ({
  pull,
  row: undefined,
  at: pull === undefined ? undefined : Date.now(),
  confirmed: pull !== undefined,
  fetching: false,
})

/** No deploy to draw — a project with no `deploy.sh`, which is what most panes see. */
const noDeploy: Deploy = { answer: { answer: "none" }, checking: false, fetching: false }

/** Nothing held, so the press is never drawn — every catalogue pane rests on no wait. */
const skipping: Skipping = { skip: () => {}, isPending: false, disabled: false, said: undefined }

/** Auto-merge's switch, at rest — no press made, nothing refused. */
const autoMerge: AutoMergeSetting = {
  set: () => {},
  isPending: false,
  disabled: false,
  said: undefined,
}

/** The method menu, with no pick on its way. */
const methodPick: MergeMethodPick = { pick: () => {}, picking: undefined, said: undefined }

/** No forge merge on offer — every pane but one with an open pull request. */
const pullMerging: PullMerging = {
  merge: () => {},
  isPending: false,
  disabled: true,
  said: undefined,
}

export const finishing: Finishing = {
  skipping,
  autoMerge,
  pullMerging,
  methodPick,
  pull: undefined,
  merge,
  commitAndMerge,
  archiving,
  changes,
  preview: { branch: "trak/01HQ8G", into: "main" },
  forge: answered(noPullRequest),
  deploy: noDeploy,
}
/** Nothing answered yet — `preview` is undefined until it does, and wherever nothing asked. */
export const finishingUnknown: Finishing = {
  skipping,
  autoMerge,
  pullMerging,
  methodPick,
  pull: undefined,
  merge: emptyMerge,
  commitAndMerge,
  archiving,
  changes,
  preview: undefined,
  forge: answered(undefined),
  deploy: noDeploy,
}
/** A child merges into its parent rather than into the host's branch. */
export const finishingChild: Finishing = {
  skipping,
  autoMerge,
  pullMerging,
  methodPick,
  pull: undefined,
  merge,
  commitAndMerge,
  archiving,
  changes,
  preview: { branch: "trak/01HQ8M", into: "trak/01HQ8L", parentId: "01HQ8L" },
  forge: answered(noPullRequest),
  deploy: noDeploy,
}
/** The branch has one, so no local Merge is on offer and the pane grows its second half. */
export const finishingPullRequest: Finishing = {
  skipping,
  autoMerge,
  pullMerging,
  methodPick,
  pull: undefined,
  merge: emptyMerge,
  commitAndMerge,
  archiving,
  changes,
  preview: undefined,
  forge: answered(openPullRequest),
  deploy: noDeploy,
}

/* --------------------------------------------------------------- what is on offer */

/** `TrakControls`' three. Its `Offers` is not exported, so this is matched structurally. */
export const offers = { abandon: true, close: true, child: false }
export const allOffers = { abandon: true, close: true, child: true }
export const noOffers = { abandon: false, close: false, child: false }

/** `FinishedActs`' three, which are a different three under the same name. */
export const finishedOffers = { merge: true, archive: true, changes: true }
export const mergeOnly = { merge: true, archive: false, changes: false }

/* ------------------------------------------------------------------- the ending */

export const ending: Ending = {
  branch: "trak/01HQ8G",
  commits: 7,
  steps: 4,
  gates: 2,
  elapsed: "1h 12m",
  overrode: [],
}
/** A run that overrode two gates, and one that never got a branch. */
export const overrodeEnding: Ending = { ...ending, overrode: ["verify", "review"] }
export const bareEnding: Ending = {
  branch: undefined,
  commits: 0,
  steps: 1,
  gates: 0,
  elapsed: undefined,
  overrode: [],
}

export const into = { name: "main", note: "the branch the host is on" }

/* ------------------------------------------------------------- where it ended up */

export const endFinished: EndStateDto = { _tag: "Finished" }
export const endMerging: EndStateDto = { _tag: "Merging" }
export const endClosing: EndStateDto = { _tag: "Closing", merged: "9f2c1ab" }
export const endClosed: EndStateDto = { _tag: "Closed" }
export const endMerged: EndStateDto = { _tag: "Merged", sha: "9f2c1ab" }
