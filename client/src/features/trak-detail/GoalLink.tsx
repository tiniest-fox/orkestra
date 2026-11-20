/**
 * The way from a trak a goal opened back to that goal: the goal's target and title as a
 * link on the header's metadata row, after the trak's id. It is the part of that row that
 * gives way, so the title truncates and the id beside it keeps its width.
 *
 * **Its hit target clears the phone's 44px floor without growing the row**: the padding
 * that makes it 44 tall is taken back by a negative margin of the same size, so the line
 * keeps its height and only the press reaches past it.
 */

import { Link } from "@tanstack/react-router"
import { Target } from "lucide-react"
import type { ReactNode } from "react"
import type { GoalLinkTo } from "./useGoalLink"

const GoalLink = ({ goal }: { readonly goal: GoalLinkTo }): ReactNode => (
  <Link
    to="/goals/$id"
    params={{ id: goal.id }}
    aria-label={`Part of the goal ${goal.title}`}
    className="flex min-w-0 items-center gap-1 text-fg-muted max-sm:-my-3.5 max-sm:py-3.5 underline decoration-border underline-offset-2 hover:decoration-fg-subtle"
  >
    <Target size={10} aria-hidden className="shrink-0" />
    <span className="truncate">{goal.title}</span>
  </Link>
)

export default GoalLink
