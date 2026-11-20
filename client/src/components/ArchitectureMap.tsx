/**
 * An ```overview fence, drawn as a `Navigator`: the parts a plan touches down the rail in
 * call order, numbered, then what it talks to but leaves alone under "Outside"; the
 * picked part's files as a tree beside them.
 *
 * **A file opens into its own sketch**, drawn as pseudo-code inside its dashed edge; a
 * file the agent wrote none for does not open. A sketch written for the whole part — the
 * form filed before a file could carry one — draws once, under the tree.
 *
 * **What a reader moves is local state, and nothing else is.** A filed document is frozen,
 * so which part is picked and which file is open are the reader's and die with the
 * component.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import type { MapPart, Overview } from "../format/overview"
import CodeSpans from "./CodeSpans"
import FileTree, { type TreeFile } from "./FileTree"
import Navigator from "./Navigator"
import type { RailItem } from "./NavigatorRail"
import PseudoCode from "./PseudoCode"
import RailNumber from "./RailNumber"

/** A part's files as the tree draws them, under its root where it named one. */
const treeFiles = (part: MapPart): readonly TreeFile[] =>
  part.files.map((file) => {
    const { sketch } = file
    return {
      kind: file.touch === "new" ? "added" : "modified",
      path: part.root === undefined ? file.path : `${part.root.replace(/\/$/, "")}/${file.path}`,
      oldPath: undefined,
      why: file.note,
      counts: undefined,
      missing: false,
      body: sketch === undefined ? undefined : () => <PseudoCode source={sketch} edge />,
    }
  })

const railOf = (map: Overview, at: number): readonly RailItem[] => [
  ...map.parts.map((part, i) => ({
    key: `part-${String(i)}`,
    title: part.name,
    sub: part.gist === undefined ? undefined : <CodeSpans text={part.gist} />,
    lead: <RailNumber n={i + 1} on={i === at} />,
    group: undefined,
    waiting: false,
  })),
  ...map.outside.map((entry, i) => ({
    key: `outside-${String(i)}`,
    title: entry.name,
    sub: entry.note === undefined ? undefined : <CodeSpans text={entry.note} />,
    lead: undefined,
    group: i === 0 ? "Outside" : undefined,
    waiting: false,
  })),
]

const ArchitectureMap = ({ map }: { readonly map: Overview }): ReactNode => {
  const [picked, setPicked] = useState(0)
  const [opened, setOpened] = useState<string | undefined>(undefined)
  // A redraw with fewer entries must not leave the index past the end.
  const at = Math.min(picked, map.parts.length + map.outside.length - 1)
  return (
    <Navigator
      label="Overview"
      renderEnd={() => (
        <span>{map.parts.length === 1 ? "1 part" : `${String(map.parts.length)} parts`}</span>
      )}
      items={railOf(map, at)}
      picked={at}
      onPick={(i) => {
        setPicked(i)
        setOpened(undefined)
      }}
      open={opened !== undefined}
      renderStates={(narrow) => [
        ...map.parts.map((part, i) => (
          <div key={part.name} className="flex min-w-0 flex-col">
            <FileTree
              files={treeFiles(part)}
              narrow={narrow}
              opened={i === at ? opened : undefined}
              onOpen={setOpened}
            />
            {part.sketch !== undefined && (
              <div className="min-w-0 px-2.5 pb-2.5">
                <PseudoCode source={part.sketch} edge />
              </div>
            )}
          </div>
        )),
        ...map.outside.map((entry) => (
          <div key={entry.name} className="flex min-w-0 flex-col gap-1 p-2.5 text-fg-muted">
            <p className="m-0">{entry.name} is not changed by this plan.</p>
            {entry.note !== undefined && (
              <p className="m-0 text-sm text-fg-subtle">
                <CodeSpans text={entry.note} />
              </p>
            )}
          </div>
        )),
      ]}
      renderFooter={
        map.order === undefined
          ? undefined
          : () => (
              <span>
                <span className="text-fg-muted">Order</span> {map.order}
              </span>
            )
      }
    />
  )
}

export default ArchitectureMap
