/**
 * What a row says about a trak resting on an unmet condition — the words, the tone, the
 * mark, the pile's half of the rule, and what is left of the forge's answer once one of
 * the two has taken the status line.
 *
 * **A wait on the deploy says what the deploy said, and nothing else.** The wire names the
 * wait, and where it is `deployed` the row's words are the script's last answer where
 * there is one — *Not live yet* in `working`, *Failed* in `bad`, *Live* in `good` for the
 * sweep it takes the step to start — and *Not live yet* before the script has run at all.
 * No version, no time and no forge clause: the person chose the word alone, and the trak's
 * own page has the rest. The mark stays the dashed ring, in the answer's tone — nothing has
 * settled here either.
 *
 * **A wait that has stopped asking says so before anything else gets a word.** The daemon
 * drops a stopped wait from its sweep, so nothing will ever start the held step — and the
 * trak's own page goes on running `deploy.sh`, so the deploy the wire carries beside a
 * stopped wait goes *live* once the release lands. Read off the deploy alone the row would
 * say *Live* in green, which is the deploy about to release the step; it says *Gave up* in
 * `bad` instead, as the page's own held card does — and it says it for a project's own
 * script too, which is the same wait in the same state. It is read ahead of the pull
 * request as well: `waitFirst` below gives the row to the forge because resolving the pull
 * request is what lets the wait pass, and a wait that has given up will not pass when it
 * does.
 *
 * **The wait is the second override on a list that permits one, and which of the two
 * leads is decided once, in `waitFirst`.** `pullRung` files a finished trak by what GitHub
 * says about its branch, and it has already done so before the wait is read. The wait
 * beats it — a trak with a step still to run is not done, however its pull request stands
 * — **except where the wait is on the branch going in and the forge says it has not.**
 * `merged` and `deployed` cannot pass until the pull request merges, so a row saying *Not
 * live yet* over *Conflicts* names the wait and hides the thing in its way; there the pull
 * request takes the row, and the wait is the quiet clause after it. Once the forge says
 * merged the wait has the row back, which is the post-merge case this file was written
 * for: a deploy being checked sits under *Waiting on deploy* rather than under *Merged*.
 * A forge that could not be asked, or has not answered, yields nothing: `UNASKED` and
 * `ASKING` make no claim about the branch, and a row must not move on one. A project's own
 * condition script is untouched by any of this — it has nothing to do with the branch.
 *
 * Whichever leads, the other is not lost — the pile may move the row but may not delete
 * what was displaced — so it comes back as `aside`, a quiet clause after the leader's own
 * words. The one exception is the deploy's row while the deploy leads, which by the
 * person's choice carries no forge clause.
 *
 * **The words name no condition and count nothing down.** The wire carries the name, but
 * the settled row says *held on a condition* and leaves which one to the trak's own
 * screen — and the next ask is daemon memory the list never fetches. `working` for
 * `HeldCard`'s reason — nobody owes a waiting trak anything, so it is never amber — and
 * `circleDashed` because nothing has settled here yet, which is the mark's meaning at
 * every scale it is drawn at.
 *
 * **The three readers of the rule are all here or read from here.** `rowWords` and
 * `rowMark` below, and `sections.ts`'s `fileOf`, each ask `waitFirst` and nothing else
 * about who leads — so a row cannot wear the dashed ring under *Has issues*, or say
 * *Conflicts* under *Waiting on deploy*. A stop moves the words alone and neither of the
 * other two: the pile a stopped deploy wait sits under was decided and is not a defect.
 */

import type { DeployDto, TrakSummaryDto } from "../../api/types"
import { stoppedWords } from "../../format/failure"
import { runInterrupted } from "../../format/interrupted"
import { phaseWords } from "../../format/preparing"
import { seamWords } from "../../format/seam"
import { trakLabel, type TrakLabel } from "../../format/trakLabel"
import type { Rung } from "./pullRung"
import { stateIcon, type StateIcon } from "./stateIcon"

const WAITING: TrakLabel = { label: "Held on a condition", tone: "working" }

/** The wait will not be asked again, so the step it holds is never going to start by itself. */
const GAVE_UP: TrakLabel = { label: "Gave up", tone: "bad" }

const WAITING_ICON: StateIcon = { icon: "circleDashed", running: false }

/** A command was in flight and nothing is carrying it — the detail page's stopped notice. */
const STOPPED: TrakLabel = { label: stoppedWords.chip, tone: "bad" }

/**
 * Whether the trak's wait is the deploy's — `deployed` is the engine's own name, and the
 * one wait the list files apart from the moment it starts rather than once the script
 * has answered. Read here and by `sections.ts`, so a row cannot say the deploy's words
 * under *Waiting*.
 */
export const onDeploy = (trak: TrakSummaryDto): boolean => trak.waiting?.name === "deployed"

/**
 * Whether the wait needs the branch to go in — the two conditions the engine answers
 * itself, by name. Both learn the pull request merged before anything else, so a pull
 * request that has not is what either is actually waiting on.
 */
const onBranch = (trak: TrakSummaryDto): boolean =>
  trak.waiting?.name === "merged" || onDeploy(trak)

/**
 * Whether the wait leads the row over the forge's answer — the one place the two
 * overrides are ordered. `false` where there is no wait at all, so a caller can read it as
 * *the row is the wait's* without first asking whether there is one.
 *
 * The pull request leads only on a wait on the branch going in, and only where the forge
 * has said the branch is out — `Rung.unmerged` carries why the merged rung, `UNASKED` and
 * `ASKING` all read as *not said*.
 */
export const waitFirst = (trak: TrakSummaryDto, rung: Rung | undefined): boolean =>
  trak.waiting !== undefined && !(onBranch(trak) && rung?.unmerged === true)

const DEPLOY_WORDS: Record<Exclude<DeployDto, { answer: "none" }>["answer"], TrakLabel> = {
  live: { label: "Live", tone: "good" },
  "not-yet": { label: "Not live yet", tone: "working" },
  "gave-up": { label: "Failed", tone: "bad" },
}

/**
 * What the deploy's row says: the sweep's last answer where the script has run, and
 * *Not live yet* before it has — the branch has not merged, so nothing is live, which is
 * what the trak's own page says of it too.
 */
const deployWords = (deploy: DeployDto | undefined): TrakLabel =>
  DEPLOY_WORDS[deploy === undefined || deploy.answer === "none" ? "not-yet" : deploy.answer]

/** The wait's own words, or absent where the trak is not waiting. */
const waitWords = (trak: TrakSummaryDto): TrakLabel | undefined =>
  trak.waiting === undefined ? undefined : onDeploy(trak) ? deployWords(trak.deploy) : WAITING

/**
 * The action at the seam, where one is crossing: its progress as the quiet clause after
 * the state's own phrase, which already says *Stopping…*. Otherwise the preparation the
 * trak is in, where it is in one: the phrase itself at `Preparing`,
 * where *Preparing the worktree* says less than it does, and the quiet clause after the
 * state's own phrase everywhere else — a turn whose files are being copied, or that started
 * ahead of a setup still running, is still the state it is in.
 */
const withPreparing = (
  trak: TrakSummaryDto,
  own: TrakLabel,
): TrakLabel & { readonly aside: string | undefined } => {
  // The action at the seam first: it is what the engine is doing now, and the newest
  // operation wins where two overlap, which is the engine's own rule for the status.
  if (trak.seam !== undefined) return { ...own, aside: seamWords(trak.seam).line }
  if (trak.preparing === undefined) return { ...own, aside: undefined }
  const { label } = phaseWords(trak.preparing)
  return trak.state._tag === "Preparing"
    ? { label, tone: own.tone, aside: undefined }
    : { ...own, aside: label }
}

/**
 * The status line, its tone, and whichever of the wait and the forge's answer was
 * displaced by the other.
 *
 * The rung's words where there is one and no wait, the state's own where there is neither
 * — exactly as every row read before there was a wait, with the preparation the trak is
 * in laid over them — so the only rows the wait changes are the ones it is on. A stopped wait is read first, before the deploy's answer and
 * before `waitFirst`: the aside follows the wait's own rule either way, gone on the
 * deploy and the rung's words elsewhere.
 *
 * An interrupted trak is read before all of it, and can carry neither: a wait and a rung
 * are both `Finished`'s, and nothing at `Finished` has a command in flight.
 */
export const rowWords = (
  trak: TrakSummaryDto,
  rung: Rung | undefined,
): TrakLabel & { readonly aside: string | undefined } => {
  if (runInterrupted(trak.state, trak.running)) return { ...STOPPED, aside: undefined }
  const own = rung ?? trakLabel(trak.state, trak.branchMoved)
  const wait = waitWords(trak)
  if (wait === undefined) return withPreparing(trak, own)
  if (trak.waiting?.stopped === true) {
    return { ...GAVE_UP, aside: onDeploy(trak) ? undefined : rung?.label }
  }
  if (!waitFirst(trak, rung)) return { ...own, aside: wait.label }
  return { ...wait, aside: onDeploy(trak) ? undefined : rung?.label }
}

/**
 * The mark the row wears and whether its segment travels: the dashed ring while the wait
 * leads, and `stateIcon`'s answer — the rung's on a finished row — everywhere else. Read
 * by `TrakMark`.
 *
 * An interrupted trak keeps its state's glyph with the segment stopped: the segment says
 * *this is happening now*, and nothing is.
 */
export const rowMark = (trak: TrakSummaryDto, rung: Rung | undefined): StateIcon => {
  if (waitFirst(trak, rung)) return WAITING_ICON
  const mark = stateIcon(trak.state, rung)
  return runInterrupted(trak.state, trak.running) ? { ...mark, running: false } : mark
}
