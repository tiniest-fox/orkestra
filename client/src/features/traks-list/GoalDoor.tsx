/**
 * The way to start a goal, in the goal stack's place while no goal is shown, opening the
 * New Goal drawer. Once a goal is shown the stack closes on `GoalNewRow` instead. It is the
 * banner's own anatomy — a grey ring on a dashed track, `No goal yet`, the pitch as the
 * line and the empty rail — so the page keeps one height whether a goal is shown or not.
 */

import { Link } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"
import type { ReactNode } from "react"
import GoalRing from "./GoalRing"

const GoalDoor = (): ReactNode => (
  <Link
    to="/goals/new"
    className="group relative mx-gutter flex flex-col overflow-hidden rounded-t-surface bg-surface text-left"
  >
    <span className="flex flex-col gap-0.5 px-3 py-2.5">
      <span className="flex h-5 items-center gap-2">
        <span className="flex h-5 w-7 shrink-0 items-center justify-center">
          <GoalRing ink={undefined} mark="door" landed={0} planned={0} />
        </span>
        <span className="min-w-0 flex-1 truncate text-base font-medium text-fg-muted">
          No goal yet
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent">
          Start a goal
          <ArrowRight size={14} aria-hidden />
        </span>
      </span>
      <span className="truncate pl-9 text-sm text-fg-subtle">
        <span className="max-sm:hidden">
          Give Orkestra a finished state, and let it open the traks
        </span>
        <span className="sm:hidden">Give Orkestra a finished state</span>
      </span>
    </span>
    <span aria-hidden className="h-1 bg-border" />
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-t-surface border border-border group-hover:border-accent/60"
    />
  </Link>
)

export default GoalDoor
