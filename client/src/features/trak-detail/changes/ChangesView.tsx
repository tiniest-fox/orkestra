/**
 * What the drawer shows on Changes: the slice picker, and the diff under it.
 *
 * **All four view states, and the third is the one that bites.** A poll of the uncommitted
 * slice that drops must not blank a diff somebody is reading, so this branches on
 * `data === undefined` before it branches on `isError` — the other order flickers the pane
 * to an error every time a laptop wakes up.
 *
 * **The list is keyed to the slice.** Which cards a reader has folded is about the files
 * they were looking at, and carrying that across a press of the picker would open one
 * slice's cards according to another's.
 *
 * **Which layout draws is the width of this box, not the viewport** — the diff needs only
 * the width the pane gives it, so a phone shell does not have to exist for the stack to
 * work, and a drawer squeezed under a narrow window gets the layout that fits it. The
 * `ResizeObserver` is on this component's own node, which is the one subscription a
 * presentational component may hold (`client-style`, Presentational).
 *
 * **The picker is this surface's at both widths, drawn in two places.** Pinned above the
 * desk's two scrollers; handed to the stack as its `lead`, because on a phone it scrolls
 * away with the top of the list and nothing is pinned above the code.
 */

import type { ReactNode } from "react"
import { useLayoutEffect, useRef, useState } from "react"
import { FileDiff, Unplug } from "lucide-react"
import EmptyState from "../../../components/EmptyState"
import { total } from "./changes"
import ChangeList from "./ChangeList"
import ChangeStack from "./ChangeStack"
import SlicePicker from "./SlicePicker"
import { emptyWords } from "./slices"
import type { Changes } from "./useChanges"
import type { Landing } from "./useLanding"

/**
 * Below this box width the stack draws; at it and above, the sidecar. Above any
 * full-width pane a phone shell hands over, and below the 732px the desk's drawer gives
 * the pane at full size — so a real phone always stacks and a full drawer never does.
 */
const STACK_UNDER_PX = 672

const ChangesView = ({
  changes,
  landing,
  bandBelow,
}: {
  readonly changes: Changes
  /** A file to open the diff at, asked for by a change map's Open in Changes. */
  readonly landing: Landing
  /** Whether the ownership band is drawn below — `ChangeStack` then leaves it the inset. */
  readonly bandBelow: boolean
}): ReactNode => {
  const { id, slices, at, pick, data, isError, error } = changes
  const box = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)

  useLayoutEffect(() => {
    const node = box.current
    if (node === null) return
    const read = (): void => {
      // A box that has no layout yet reports 0, and an unlaid-out box is not a narrow
      // one — it is also every box happy-dom ever reports, so tests draw the desk.
      setNarrow(node.clientWidth > 0 && node.clientWidth < STACK_UNDER_PX)
    }
    read()
    const watch = new ResizeObserver(read)
    watch.observe(node)
    return () => {
      watch.disconnect()
    }
  }, [])

  // The row rather than its name: what an empty slice means depends on whether the position
  // ran one agent or joined several, and only the row says which.
  const words = emptyWords(slices.find((slice) => slice.at === at))

  const picker = (
    <SlicePicker
      slices={slices}
      at={at}
      total={data === undefined || data.files.length === 0 ? undefined : total(data.files)}
      onPick={pick}
    />
  )

  return (
    <div ref={box} className="flex h-full min-h-0 flex-col">
      {data === undefined ? (
        <>
          {picker}
          {isError ? (
            <EmptyState shape="blocks" tone="bad" icon={Unplug} title="Could not read the changes">
              {error?.message ?? "The engine did not say why."}
            </EmptyState>
          ) : (
            <EmptyState shape="blocks" loading />
          )}
        </>
      ) : data.files.length === 0 ? (
        <>
          {picker}
          <EmptyState shape="blocks" icon={FileDiff} title={words.title}>
            {words.line}
          </EmptyState>
        </>
      ) : narrow ? (
        <ChangeStack
          key={at}
          trak={id}
          slice={at}
          files={data.files}
          omitted={data.omittedFiles}
          landing={landing.path}
          onLanded={landing.drop}
          lead={picker}
          bandBelow={bandBelow}
        />
      ) : (
        <>
          {picker}
          <ChangeList
            key={at}
            trak={id}
            slice={at}
            files={data.files}
            omitted={data.omittedFiles}
            landing={landing.path}
            onLanded={landing.drop}
          />
        </>
      )}
    </div>
  )
}

export default ChangesView
