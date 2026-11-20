/**
 * A ```walkthrough fence, drawn as a `Navigator`: the chosen path's numbered steps down
 * the rail, and the picked step's lifeline diagram with its words under it beside them.
 *
 * **The paths are tabs in the header band**, where there is more than one; one path draws
 * its count of steps there instead. Back and Next are the footer.
 *
 * **One step index for every path**, clamped where it is read, so choosing a path keeps
 * the reader on the same step where the new path has one.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { Walk } from "../format/walkthrough"
import Navigator from "./Navigator"
import RailNumber from "./RailNumber"
import WalkDiagram from "./WalkDiagram"
import WalkStepWords from "./WalkStepWords"

const press = (narrow: boolean): string =>
  `flex cursor-pointer items-center gap-1 rounded-control px-2 hover:bg-hover-row disabled:cursor-default disabled:opacity-40 ${narrow ? "min-h-11" : "min-h-6"}`

/** The paths as tabs, for the header band's end. */
const Paths = ({
  walk,
  path,
  setPath,
  narrow,
}: {
  readonly walk: Walk
  readonly path: number
  readonly setPath: (path: number) => void
  readonly narrow: boolean
}): ReactNode => (
  <span role="tablist" className="flex shrink-0 gap-0.5">
    {walk.paths.map((each, i) => (
      <button
        key={each.name}
        type="button"
        role="tab"
        aria-selected={path === i}
        onClick={() => {
          setPath(i)
        }}
        className={`cursor-pointer rounded-control border px-1.5 uppercase ${narrow ? "min-h-11 px-2.5" : ""} ${path === i ? "border-guide bg-canvas text-fg" : "border-transparent text-fg-subtle hover:text-fg"}`}
      >
        {each.name}
      </button>
    ))}
  </span>
)

const Walkthrough = ({ walk }: { readonly walk: Walk }): ReactNode => {
  const [path, setPath] = useState(0)
  const [at, setAt] = useState(0)
  const steps = walk.paths[path]?.steps ?? []
  const on = Math.min(at, steps.length - 1)
  return (
    <Navigator
      label="Walkthrough"
      renderEnd={(narrow) =>
        walk.paths.length > 1 ? (
          <Paths walk={walk} path={path} setPath={setPath} narrow={narrow} />
        ) : (
          <span>{steps.length === 1 ? "1 step" : `${String(steps.length)} steps`}</span>
        )
      }
      items={steps.map((step, i) => ({
        key: String(i),
        title: step.title,
        sub: step.at.map((lane) => walk.actors[lane]).join(" → "),
        lead: <RailNumber n={i + 1} on={i === on} />,
        group: undefined,
        waiting: false,
      }))}
      picked={on}
      onPick={setAt}
      open={false}
      renderStates={() =>
        steps.map((step, i) => (
          // A path's steps are positional and never reorder.
          // oxlint-disable-next-line react/no-array-index-key
          <div key={i} className="flex min-w-0 flex-col gap-3 p-2.5">
            <WalkDiagram actors={walk.actors} steps={steps} at={i} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-semibold text-fg">{step.title}</span>
              <p className="m-0 text-fg-muted">
                <WalkStepWords text={step.body} />
              </p>
            </div>
          </div>
        ))
      }
      renderFooter={(narrow) => (
        <>
          <button
            type="button"
            disabled={on <= 0}
            onClick={() => {
              setAt(on - 1)
            }}
            className={press(narrow)}
          >
            <ChevronLeft size={12} aria-hidden />
            Back
          </button>
          <span className="flex-1 text-center tabular-nums">
            {on + 1} of {steps.length}
          </span>
          <button
            type="button"
            disabled={on >= steps.length - 1}
            onClick={() => {
              setAt(on + 1)
            }}
            className={press(narrow)}
          >
            Next
            <ChevronRight size={12} aria-hidden />
          </button>
        </>
      )}
    />
  )
}

export default Walkthrough
