/**
 * Which model a chat runs on — every model `models.yaml` lists, as tiles, in the pane.
 *
 * The picker stands where
 * the pane's empty state stood, the way `AgentGrid` stands in New Trak's, because the
 * door's one choice is worth the pane and the pane already scrolls — so no band is added
 * above the chat bar at either width. The door's own sentence survives above the list and
 * the picker takes no heading of its own.
 *
 * **Two across at every width.** The round saved two, and at 375px two is what `AgentGrid`
 * draws; it left open whether a desk wants more, and this draws what was looked at.
 *
 * **A model reads as its bare name behind a mark for the CLI that runs it**, and the
 * `codex/` qualifier is never drawn — `modelName.ts` carries the rule and the one thing the
 * client is allowed to know about a model. Nothing here names one, orders them, or says
 * which is the default: the list is drawn as it arrived, and being the chosen tile is the
 * whole of how the default is shown.
 *
 * **Chosen is an edge and nothing else**, for `AgentGrid`'s reason — a tile is a surface,
 * and moving its ground to say it was picked reads as a different level rather than a
 * different state.
 */

import type { ReactNode } from "react"
import { bareName, cliGlyph } from "../../format/modelName"

/** The two states a tile has — `AgentGrid`'s, so the two grids agree. */
const edge = (chosen: boolean): string =>
  chosen ? "border-accent" : "border-border hover:bg-hover-row"

const ModelGrid = ({
  models,
  chosen,
  onPick,
  said,
  children,
}: {
  /** `allowed`, verbatim and in file order. Empty while the query is out. */
  readonly models: readonly string[]
  /** The tile drawn as picked — the person's pick, or the engine's default until one. */
  readonly chosen: string | undefined
  readonly onPick: (model: string) => void
  /** Why there are no models to show, when that is a failure rather than a wait. */
  readonly said?: string
  /** The door's own sentence, drawn above the list. */
  readonly children: ReactNode
}): ReactNode => (
  <div className="flex flex-col gap-3 px-4 py-4">
    <p className="text-base text-fg-muted">{children}</p>
    {said === undefined ? undefined : (
      <p role="alert" className="text-sm text-tone-bad">
        {said}
      </p>
    )}
    {models.length === 0 ? undefined : (
      <div role="group" aria-label="Which model answers" className="grid grid-cols-2 gap-2">
        {models.map((model) => {
          const Glyph = cliGlyph(model)
          return (
            <button
              key={model}
              type="button"
              aria-pressed={model === chosen}
              onClick={() => {
                onPick(model)
              }}
              className={`flex min-w-0 flex-col items-start gap-1 rounded-surface border bg-surface p-3 text-left transition-colors max-sm:min-h-11 ${edge(model === chosen)}`}
            >
              <span className="inline-flex min-w-0 items-center gap-1 font-mono text-sm font-medium text-fg">
                <Glyph size={12} aria-hidden className="shrink-0 opacity-70" />
                <span className="truncate">{bareName(model)}</span>
              </span>
            </button>
          )
        })}
      </div>
    )}
  </div>
)

export default ModelGrid
