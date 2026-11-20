/**
 * The right-hand slot of a trak's row: what is waiting on you if anything is, otherwise
 * the last thing the agent did; then the ring saying how full the standing agent's
 * window is; then the way in.
 *
 * **One slot, two things, never both.** A trak at a gate is not writing a transcript, so
 * there is nothing to lose by preferring the press. Below the breakpoint the slot is the
 * ring and the chevron alone: the phone rounds took everything else out — no accent fill
 * anywhere in the list but the dock's button, and no hover to reveal a chevron on — and
 * the action's wording is not lost, because the piece that needs you says so on its own
 * plate, one press away.
 *
 * **The ring sits past the press and the activity line, beside the chevron.** `ContextMark`
 * is the reading at the position the trak stands at over its window — `contextShare.ts`
 * carries the rule, and the engine carries which reading. Past everything rather than
 * before it, so a row that draws one costs the press no width.
 */

import type { ReactNode } from "react"
import Button from "../../components/Button"
import { QUIET } from "../../components/ToolCall"
import type { TrakSummaryDto } from "../../api/types"
import ContextMark from "./ContextMark"
import RowArchive from "./RowArchive"
import { contextShare } from "./contextShare"
import TrakIcon from "./TrakIcon"

/**
 * The line in the drawer's quiet ink. The title holds the whole of it, because the slot
 * truncates and a hover is the only way to read the agent's words here.
 */
const Activity = ({ activity }: { readonly activity: string }): ReactNode => (
  <span className="flex max-w-64 items-center gap-1.5" title={activity}>
    <span className="text-fg-subtle">
      <TrakIcon name="activity" size={11} />
    </span>
    <span className={QUIET}>{activity}</span>
  </span>
)

const RowTrailing = ({
  trak,
  name,
  phone,
  action,
  activity,
  merged,
}: {
  readonly trak: TrakSummaryDto
  /** What the row is called, for the press's accessible name. */
  readonly name: string
  readonly phone: boolean
  /** The press's word, where the state offers one — `rowAction`, composed by the row. */
  readonly action: string | undefined
  /** What the live log would draw last, as one line — `latestActivity`. */
  readonly activity: string | undefined
  /** The forge says the branch is in, for what Archive's confirmation says. */
  readonly merged: boolean | undefined
}): ReactNode => {
  const share = contextShare(trak)
  const mark =
    share === undefined ? undefined : (
      <ContextMark
        share={share}
        says={`${String(Math.round(share * 100))}% of the context window`}
      />
    )
  if (phone)
    return (
      <>
        {mark}
        <span className="text-fg-subtle">
          <TrakIcon name="chevronRight" size={13} />
        </span>
      </>
    )
  return (
    <>
      {action === undefined ? (
        activity !== undefined && <Activity activity={activity} />
      ) : action === "Archive" ? (
        // The one word that acts in place — `RowArchive` says why.
        <RowArchive trak={trak} name={name} merged={merged} />
      ) : (
        // Renders an `<a>`, not a `<button>`: every other word names a destination rather
        // than what you will press — `rowAction`. `Button` covers both, and passing `to`
        // is what chooses the element.
        //
        // It carries no tone of its own: an outlined-amber treatment here is a variant the
        // design system never described. The tone belongs to the status line beside it;
        // this is just the way out of the row.
        <Button
          variant="primary"
          size="sm"
          to="/traks/$id"
          params={{ id: trak.id }}
          aria-label={`${action} — ${name}`}
        >
          {action}
        </Button>
      )}
      {mark}
      {/* v5's affordance, kept: the row is a destination, and on hover it says so in the
          place a reader's eye is already ending up. `aria-hidden`, because the title link
          it belongs to is already named. */}
      <span className="text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100">
        <TrakIcon name="chevronRight" size={13} />
      </span>
    </>
  )
}

export default RowTrailing
