/**
 * The pull request, as the head of the finished card and the three rows of its table.
 *
 * **Four states, and `cardOf` is what decides between them** — the whole answer, the traks
 * list's coarse one, nothing to draw, and nothing known yet. It is asked there rather than
 * here because `FinishedView` withholds the local Merge press on the same question, and two
 * answers to it is a card with a merge button under it.
 *
 * **A card nobody has confirmed this session keeps every word and loses its tone.** Nothing
 * is worded differently between a remembered card and a fresh one — the difference is the
 * verdicts drawn `neutral` and the state plate with them, which is the design system saying
 * *nothing is claimed here*. `PullRequestSection` is the one place that applies it.
 *
 * **The pull request is the card's subject rather than a block beside it.** It was under a
 * hairline below the move, which is the arrangement that made the forge read as a footnote
 * to a local merge that such a trak is never offered; now the header is the head of the
 * card, the three sections are rows of its table, and the move is its footer.
 *
 * **The rows run Merging, Checks, Review — shortest to longest.** Merging is one line,
 * Checks is one line and the failing few, and Review is a line per unanswered conversation,
 * which is the one row with no ceiling. Review last keeps the one-line answer to *can this
 * go in* out from under a screen of comments: the long tail is what the presses under the
 * card scroll past. Every conversation costs one line until it is pressed.
 *
 * **Each section owns its own state and its own words; nothing here summarises the three.**
 * A tinted sentence adding Checks, Review and Merging up breaks that rule however it is laid
 * out. It is the reason this file has no headline of its own and `PullRequestSection`
 * has nowhere to put one.
 *
 * Nothing on it writes to the forge. Approving, merging there, re-running a check, resolving
 * a thread and replying are all out — a tick plus a sentence re-enters the trak, and the
 * composer plans the answer.
 */

import type { ReactNode } from "react"
import CheckingLine from "../checks/CheckingLine"
import PullRequestChecks from "./PullRequestChecks"
import PullRequestCoarse from "./PullRequestCoarse"
import PullRequestHeader from "./PullRequestHeader"
import PullRequestMerging from "./PullRequestMerging"
import PullRequestReviews from "./reviews/PullRequestReviews"
import PullRequestSynced from "./PullRequestSynced"
import Rechecking from "../checks/Rechecking"
import {
  cardOf,
  pullRequestFound,
  syncedLine,
  wasTruncated,
  type Forge,
  type Heading,
  type Synced,
} from "./pullRequest"
import type { Picked } from "./picks/reentryBody"

/** The three things above the sections, whichever answer the card is drawn from. */
const CardHead = ({
  pull,
  confirmed,
  synced,
  rechecking,
  onOpen,
}: {
  readonly pull: Heading
  readonly confirmed: boolean
  readonly synced: Synced | undefined
  readonly rechecking: boolean
  readonly onOpen: (() => void) | undefined
}): ReactNode => (
  <>
    {rechecking && <Rechecking />}
    <PullRequestHeader pull={pull} confirmed={confirmed} onOpen={onOpen} />
    {synced !== undefined && <PullRequestSynced synced={synced} />}
  </>
)

const PullRequestPane = ({
  forge,
  picked,
  onToggle,
  onToggleAll,
  phone,
  onOpen,
}: {
  /** Everything known about this branch's pull request — `usePullRequest` composes it. */
  readonly forge: Forge
  readonly picked: readonly Picked[]
  /**
   * **Absent draws the whole pane with no ticks on it**, which is what a state that offers
   * no more work gets: every check, comment and refusal is still on screen to read, and
   * none of them carries a box that could be pressed and change nothing. One predicate
   * decides it — `FinishedView` asks `changesOffered` once, for the ticks and for the box
   * they land in alike.
   */
  readonly onToggle: ((picked: Picked) => void) | undefined
  /** Absent with `onToggle`: a reviewer's head tick, over every pick under it at once. */
  readonly onToggleAll: ((picked: readonly Picked[]) => void) | undefined
  /** Below the breakpoint the Review row starts folded — `PullRequestReviews`. */
  readonly phone: boolean
  /** The head's link opening the side panel — `PullRequestHeader`. */
  readonly onOpen: (() => void) | undefined
}): ReactNode => {
  const card = cardOf(forge)
  if (card === "none") return null
  if (card === "checking") return <CheckingLine>Checking GitHub for a pull request…</CheckingLine>

  // Read once here, so every row on this pane measures its elapsed time against the same
  // moment. The pane redraws on the poll, which is what the number is measuring against.
  const now = Date.now()
  // Only ever true where nothing has been confirmed: a background poll behind a card that
  // is already right is not worth a moving mark on a screen somebody is reading.
  const rechecking = forge.fetching && !forge.confirmed
  const whole = pullRequestFound(forge.pull)
  const synced =
    forge.at === undefined ? undefined : syncedLine(forge.at, whole === undefined, rechecking, now)

  if (whole !== undefined) {
    const withheld = !forge.confirmed
    return (
      <>
        <CardHead
          pull={whole}
          confirmed={forge.confirmed}
          synced={synced}
          rechecking={rechecking}
          onOpen={onOpen}
        />
        <PullRequestMerging pull={whole} picked={picked} onToggle={onToggle} withheld={withheld} />
        <PullRequestChecks
          checks={whole.checks}
          number={whole.number}
          truncated={wasTruncated(whole.truncated, "checks")}
          picked={picked}
          onToggle={onToggle}
          now={now}
          withheld={withheld}
        />
        <PullRequestReviews
          pull={whole}
          picked={picked}
          onToggle={onToggle}
          onToggleAll={onToggleAll}
          now={now}
          withheld={withheld}
          phone={phone}
        />
      </>
    )
  }

  // `cardOf` has already settled that the coarse answer names one; the check is what makes
  // that reachable to the compiler rather than a second opinion about it.
  const coarse = forge.row?.pull
  if (coarse === undefined) return null
  return (
    <>
      <CardHead
        pull={coarse}
        confirmed={false}
        synced={synced}
        rechecking={rechecking}
        onOpen={onOpen}
      />
      <PullRequestCoarse pull={coarse} picked={picked} onToggle={onToggle} />
    </>
  )
}

export default PullRequestPane
