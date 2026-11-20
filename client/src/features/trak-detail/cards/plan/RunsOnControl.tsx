/**
 * What a proposed agent step runs on — its agent and its model — as one button group of two
 * joined readouts, each opening its own menu. It stands on the tile's name line where the
 * agent's name is drawn everywhere else:
 *
 * - **The agent half reads as the name line always has**: the agent's mark and its name in
 *   mono capitals. Its menu lists every agent a plan may name, each with the start of its
 *   description, and a check on the current one.
 * - **The model half is the CLI's mark and the bare model name**, drawn the same whether or
 *   not anybody picked it. Its menu is `models.yaml` in file order, and the agent's own
 *   model is tagged *`<agent>`’s own*.
 * - **A step continuing an earlier conversation has its model half inert**, on `surface-2`
 *   behind a lock and with no chevron: it runs on that conversation's model, which is the
 *   one drawn. Choosing a new session in its continues menu is what makes it live again.
 * - **A swap drops the model pick and says nothing about it**: the half then reads the new
 *   agent's own model.
 *
 * **Both panels open under the whole group, from its left edge** — `OverflowMenu`'s
 * `under` — so on a phone either one starts where the group does and stays on screen.
 *
 * **Each half is drawn by hand rather than as a `Button`**, for `OpenerControl`'s reason:
 * the two share an edge, and the inner corners are square, which no `Button` draws. The
 * look is `Button`'s `quiet` at `md`, the 44px floor included.
 */

import type { LucideIcon } from "lucide-react"
import type { ComponentType, ReactNode } from "react"
import { useMemo } from "react"
import { Check, ChevronDown, Lock } from "lucide-react"
import type { AgentDto } from "../../../../api/types"
import MenuItem from "../../../../components/MenuItem"
import OverflowMenu, { type TriggerProps } from "../../../../components/OverflowMenu"
import { agentGlyph } from "../../../../format/glyph"
import { bareName, cliGlyph } from "../../../../format/modelName"

/** One half's box: `Button`'s `quiet` at `md`, with the corners the half owns. */
const HALF =
  "inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap border border-border px-3 text-base max-sm:min-h-11"

/** The press's own states, as `Button` draws them. */
const PRESS =
  "relative bg-surface text-fg transition-[border-color] duration-100 hover:z-10 hover:border-accent/60 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"

/**
 * A half that opens its menu. Built per face and held while the face is the same, because
 * `OverflowMenu` renders its trigger as a component: a new one each render would remount
 * the button under the person's pointer. The face changes only on a pick, which shuts the
 * panel anyway.
 */
const halfDrawing = (
  corners: string,
  label: string,
  glyph: LucideIcon,
  face: ReactNode,
): ComponentType<TriggerProps> => {
  const Glyph = glyph
  const Half = ({ open, toggle }: TriggerProps): ReactNode => (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={toggle}
      className={`${HALF} ${PRESS} ${corners}`}
    >
      <Glyph size={13} aria-hidden className="shrink-0" />
      {face}
      <ChevronDown size={13} aria-hidden className="shrink-0" />
    </button>
  )
  return Half
}

/** Both halves' triggers, each held while what it draws is the same — see `halfDrawing`. */
const useHalves = (mark: string, agent: string, glyph: LucideIcon, model: string | undefined) => ({
  AgentHalf: useMemo(
    () =>
      halfDrawing(
        model === undefined ? "rounded-control" : "rounded-l-control",
        `Step ${mark} agent: ${agent}`,
        glyph,
        <span className="font-mono text-2xs uppercase tracking-wider">{agent}</span>,
      ),
    [mark, agent, glyph, model],
  ),
  ModelHalf: useMemo(
    () =>
      model === undefined
        ? undefined
        : halfDrawing(
            "-ml-px rounded-r-control",
            `Step ${mark} model: ${bareName(model)}`,
            cliGlyph(model),
            <span className="font-mono">{bareName(model)}</span>,
          ),
    [mark, model],
  ),
})

/** The model half with nothing to open: locked, behind the lock, or the list has not answered. */
const InertHalf = ({
  model,
  locked,
}: {
  readonly model: string
  readonly locked: boolean
}): ReactNode => {
  const Glyph = locked ? Lock : cliGlyph(model)
  return (
    <span
      title={locked ? "Locked to the conversation it continues" : undefined}
      className={`${HALF} -ml-px rounded-r-control bg-surface-2 text-fg-muted`}
    >
      <Glyph size={locked ? 12 : 13} aria-hidden className="shrink-0 text-fg-subtle" />
      <span className="font-mono">{bareName(model)}</span>
    </span>
  )
}

/** A menu row in `ContinuesMenu`'s shape, with the mark of what it names first. */
const Row = ({
  chosen,
  glyph: Glyph,
  name,
  phrase,
}: {
  readonly chosen: boolean
  readonly glyph: LucideIcon
  readonly name: string
  readonly phrase: string | undefined
}): ReactNode => (
  // The width `ContinuesMenu` gives its rows, for its reason: the row's own width is what
  // makes the phrase truncate, and it keeps the panel on a 358px screen.
  <span className="flex w-56 items-center gap-1.5 sm:w-80">
    <Glyph size={13} aria-hidden className="shrink-0 text-fg-subtle" />
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className={`whitespace-nowrap font-mono ${chosen ? "font-medium text-accent" : ""}`}>
        {name}
      </span>
      {phrase === undefined ? undefined : (
        <span className="min-w-0 truncate text-sm text-fg-subtle">{phrase}</span>
      )}
    </span>
    {chosen ? <Check size={13} aria-hidden className="shrink-0 text-accent" /> : undefined}
  </span>
)

const RunsOnControl = ({
  mark,
  agent,
  model,
  locked,
  agents,
  models,
  onAgent,
  onModel,
}: {
  /** The step's number on the card, for the names a screen reader gives the halves. */
  readonly mark: string
  /** The agent it runs now, swapped or proposed. */
  readonly agent: string
  /** The model it runs on as drawn — `modelOn`. `undefined` draws the agent half alone. */
  readonly model: string | undefined
  /** It continues an earlier conversation, so its model is that conversation's. */
  readonly locked: boolean
  /** The library: the menu offers the `plannable` ones. */
  readonly agents: readonly AgentDto[]
  /** `models.yaml`'s list, in file order. Empty draws no model menu. */
  readonly models: readonly string[]
  readonly onAgent: (agent: string) => void
  /** A model, given with the agent's own so a pick of that one can be taken as no pick. */
  readonly onModel: (model: string, own: string | undefined) => void
}): ReactNode => {
  const own = agents.find((a) => a.name === agent)?.model
  const modelLive = model !== undefined && !locked && models.length > 0
  const { AgentHalf, ModelHalf } = useHalves(mark, agent, agentGlyph(agents, agent), model)
  return (
    <span className="relative inline-flex min-w-0">
      <OverflowMenu trigger={AgentHalf} under>
        {(shut) =>
          agents
            .filter((a) => a.plannable)
            .map((a) => (
              <MenuItem
                key={a.name}
                role="menuitemradio"
                checked={a.name === agent}
                onClick={() => {
                  onAgent(a.name)
                  shut()
                }}
              >
                <Row
                  chosen={a.name === agent}
                  glyph={agentGlyph(agents, a.name)}
                  name={a.name}
                  phrase={a.description}
                />
              </MenuItem>
            ))
        }
      </OverflowMenu>
      {model === undefined ? undefined : modelLive && ModelHalf !== undefined ? (
        <OverflowMenu trigger={ModelHalf} under>
          {(shut) =>
            models.map((m) => (
              <MenuItem
                key={m}
                role="menuitemradio"
                checked={m === model}
                onClick={() => {
                  onModel(m, own)
                  shut()
                }}
              >
                <Row
                  chosen={m === model}
                  glyph={cliGlyph(m)}
                  name={bareName(m)}
                  phrase={m === own ? `${agent}’s own` : undefined}
                />
              </MenuItem>
            ))
          }
        </OverflowMenu>
      ) : (
        <InertHalf model={model} locked={locked} />
      )}
    </span>
  )
}

export default RunsOnControl
