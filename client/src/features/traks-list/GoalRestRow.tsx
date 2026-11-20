/**
 * A goal at rest, folded to one line in the goal stack: its ring, its title, the state's
 * word, and Dismiss. Nothing else — the count is the ring's, and the goal's own screen
 * still says how it ended. Start new is not offered here: the stack closes on a New goal
 * row whatever is shown, so the press would be a second door to the same place.
 *
 * The link is stretched over the card for `GoalBanner`'s reason, and Dismiss is raised
 * above it. On a phone Dismiss is an icon square, so the title truncates before it does.
 */

import { Link } from "@tanstack/react-router"
import { X } from "lucide-react"
import type { ReactNode } from "react"
import type { GoalDto } from "../../api/types"
import Button from "../../components/Button"
import { goalInk, goalTitle, goalWords } from "../../format/goal"
import { ringMark } from "./ringMark"
import GoalRing from "./GoalRing"

const GoalRestRow = ({
  goal,
  open,
  first,
  phone,
  onDismiss,
  dismissing,
}: {
  readonly goal: GoalDto
  /** The goal is open in the drawer beside the list. */
  readonly open: boolean
  /** The top of the stack, which rounds its top corners. */
  readonly first: boolean
  readonly phone: boolean
  readonly onDismiss: () => void
  readonly dismissing: boolean
}): ReactNode => {
  const { label, ink } = goalWords(goal)
  const title = goalTitle(goal)
  const corners = first ? "rounded-t-surface" : ""
  return (
    <div
      className={`group relative mx-gutter flex h-11 items-center gap-2 overflow-hidden bg-surface px-3 ${corners}`}
    >
      <span className="flex h-5 w-7 shrink-0 items-center justify-center">
        <GoalRing ink={ink} mark={ringMark(goal)} landed={goal.landed} planned={goal.planned} />
      </span>
      <Link
        to="/goals/$id"
        params={{ id: goal.id }}
        aria-label={`Goal: ${title}`}
        className="min-w-0 flex-1 truncate text-sm font-medium text-fg outline-none after:absolute after:inset-0"
      >
        {title}
      </Link>
      <span className={`shrink-0 text-xs font-medium ${goalInk[ink]}`}>{label}</span>
      <span className="relative z-10 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          icon={phone ? X : undefined}
          aria-label={`Dismiss ${title}`}
          disabled={dismissing}
          onClick={onDismiss}
        >
          {phone ? undefined : "Dismiss"}
        </Button>
      </span>
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 border ${corners} ${open ? "border-accent/60" : "border-border group-hover:border-accent/60 group-has-[a:focus-visible]:border-accent"}`}
      />
    </div>
  )
}

export default GoalRestRow
