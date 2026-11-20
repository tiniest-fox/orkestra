/**
 * The way to start a goal while goals are shown: one dashed line closing the goal stack,
 * opening the New Goal drawer. It is there whether the goals above it are going or at
 * rest, since a project runs any number at once. Dashed because it is no goal yet — the
 * grey ring on a dashed track says the same. While no goal is shown `GoalDoor` stands in
 * the stack's place instead.
 *
 * Always the last card, so it carries the stack's bottom corners.
 */

import { Link } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"
import type { ReactNode } from "react"
import GoalRing from "./GoalRing"

const GoalNewRow = (): ReactNode => (
  <Link
    to="/goals/new"
    className="group relative mx-gutter flex h-11 items-center gap-2 overflow-hidden rounded-b-surface bg-surface px-3"
  >
    <span className="flex h-5 w-7 shrink-0 items-center justify-center">
      <GoalRing ink={undefined} mark="door" landed={0} planned={0} />
    </span>
    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-muted">New goal</span>
    <ArrowRight size={14} aria-hidden className="shrink-0 text-accent" />
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-b-surface border border-dashed border-border group-hover:border-accent/60 group-focus-visible:border-accent"
    />
  </Link>
)

export default GoalNewRow
