/**
 * What a trak can be started as — **Compose a plan**, and the agents you can talk to
 * instead.
 *
 * Starting a trak is *choosing a kind of work*, and so worth the whole pane. The grid
 * stands where the pane's empty state would, so the drawer's
 * four bands do not move.
 *
 * **At desk width Compose a plan is a card, not another tile; below the breakpoint it
 * is the grid's first tile, spanning both columns.** Both are the phone rounds' own
 * words — *Compose a plan as the first tile, spanning both columns* — and the desk
 * shape is `shelf`'s, unchanged. Either way it is the default, it is what happens when
 * nothing is picked, and it is the only entry whose words are written here — the others
 * carry their file's own `description:`, cut at its first sentence. Its line is written
 * in full in both shapes: there is no agent file to take one from, and clamping it
 * would drop the half that says a person approves.
 *
 * **On the phone the grid is one grid**, so the *or start with one agent* rule is not
 * drawn there — a heading over a grid whose first tile is the thing it contrasts with
 * would be labelling both sides at once. Two across, because at three a tile is ~110px
 * and every sentence clamps to a fragment; at two every name and sentence is whole, for
 * the price of six tiles above the fold instead of nine.
 *
 * **Chosen is an edge and nothing else** — no fill, no tint, no check. A tile is a
 * surface, and moving its ground to say it was picked reads as a different level rather
 * than a different state. Hover is the row tint, so an unchosen tile under the cursor
 * cannot be mistaken for the chosen one.
 *
 * **One selection, and there is no "none".** Compose a plan *is* the absence of a picked
 * agent, which is exactly what the create request omits — so the value is
 * `string | undefined` rather than a union with a `"compose"` member that the seam would
 * then have to translate away.
 */

import type { ReactNode } from "react"
import { ListTree } from "lucide-react"
import Plate from "../../components/Plate"
import type { AgentDto } from "../../api/types"
import { glyphFor } from "../../format/glyph"
import { firstSentence } from "./firstSentence"

// One clause per half, and both halves stay whatever else is cut: what it does, and
// that a person approves it.
const COMPOSE_BLURB = "Proposes the steps; you approve the plan before anything runs."

/** The two states a tile has. Same shape for the card and the tiles, so they agree. */
const edge = (chosen: boolean): string =>
  chosen ? "border-accent" : "border-border hover:bg-hover-row"

const AgentGrid = ({
  agents,
  picked,
  onPick,
  said,
  phone = false,
}: {
  /** The startable ones — `NewTrakPage` filters, since the route sends the whole
   *  library. Empty while the query is out. */
  readonly agents: readonly AgentDto[]
  /** The agent's name, or `undefined` for Compose a plan. */
  readonly picked: string | undefined
  readonly onPick: (picked: string | undefined) => void
  /** Why there are no agents to show, when that is a failure rather than a wait. */
  readonly said?: string
  /** Below the breakpoint compose joins the grid as its first tile — the docstring
   *  carries the two shapes. A prop rather than the hook, so the grid stays a view. */
  readonly phone?: boolean
}): ReactNode => {
  const compose = (
    <button
      type="button"
      aria-pressed={picked === undefined}
      onClick={() => {
        onPick(undefined)
      }}
      className={`flex w-full items-start gap-3 rounded-surface border bg-surface p-3 text-left transition-colors ${
        phone ? "col-span-2" : ""
      } ${edge(picked === undefined)}`}
    >
      <Plate tone="neutral">
        <ListTree size={14} aria-hidden />
      </Plate>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-baseline gap-2">
          <span className="text-base font-semibold text-fg">Compose a plan</span>
          <span className="text-sm text-fg-subtle">default</span>
        </span>
        <span className="text-base text-fg-muted">{COMPOSE_BLURB}</span>
      </span>
    </button>
  )

  const tiles = agents.map((agent) => {
    const Glyph = glyphFor(agent.icon)
    const chosen = picked === agent.name
    return (
      <button
        key={agent.name}
        type="button"
        aria-pressed={chosen}
        onClick={() => {
          onPick(agent.name)
        }}
        className={`flex flex-col gap-1 rounded-surface border bg-surface p-3 text-left transition-colors ${edge(chosen)}`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Glyph size={13} className="shrink-0 text-fg-subtle" aria-hidden />
          <span className="truncate font-mono text-sm font-medium text-fg">{agent.name}</span>
        </span>
        <span className="line-clamp-2 text-sm text-fg-muted">
          {firstSentence(agent.description)}
        </span>
      </button>
    )
  })

  const complaint =
    said === undefined ? undefined : (
      <p role="alert" className="text-sm text-tone-bad">
        {said}
      </p>
    )

  if (phone)
    return (
      <div className="flex flex-col gap-3 px-4 py-4">
        {complaint}
        <div className="grid grid-cols-2 gap-2">
          {compose}
          {tiles}
        </div>
      </div>
    )

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {compose}
      {complaint ??
        (agents.length === 0 ? undefined : (
          <>
            <p className="text-sm font-medium uppercase tracking-wide text-fg-subtle">
              or start with one agent
            </p>
            <div className="grid grid-cols-3 gap-2">{tiles}</div>
          </>
        ))}
    </div>
  )
}

export default AgentGrid
