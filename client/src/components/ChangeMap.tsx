/**
 * A ```changes fence, drawn as a `Navigator`: the step's diff as named buckets down the
 * rail, each with its reason, and the picked bucket's files as a tree with a reason on
 * every one.
 *
 * **Two readings of one fence.** Standalone — a pull-request body, a document no page
 * placed — it draws what the agent wrote and a file opens nothing. Joined — on the step's
 * own page, through `MarkdownChanges` — every file the diff holds shows its line counts and
 * opens its lines inline under its row, and the join adds what only the diff can say: a
 * warning on a path it lacks, and an Unexplained bucket for files nobody named. A diff the
 * engine capped says neither (`joinChanges`).
 *
 * **The lines take the paired gutter at a desk and the new side's alone when the figure is
 * narrow**, which is the navigator's own width rather than the viewport's.
 */

import type { ReactNode } from "react"
import { createContext, useContext, useState } from "react"
import type { ChangeBucket as Bucket, MapBucket } from "../format/changeMap"
import { bucketTotals, joinChanges, type DiffJoin } from "../format/changeMap"
import CodeSpans from "./CodeSpans"
import FileTree, { type TreeFile } from "./FileTree"
import Navigator from "./Navigator"

/**
 * The step's diff, as a page hands it to the change maps below it.
 *
 * `lines` draws one file's lines, capped, with the way out to the Changes tab. It is the
 * page's because the lines and the tab are both the Changes feature's, which nothing in
 * `components/` may reach.
 */
export interface StepDiff {
  /** What the diff is called in the foot — `step 3 · build`, or `the uncommitted work`. */
  readonly name: string
  readonly join: DiffJoin
  /** How many files the engine left out of the list, where it capped it. */
  readonly omitted: number | undefined
  readonly lines: (path: string, gutter: "pair" | "new") => ReactNode
}

/** Nothing is the default, and draws every change map standalone — `Images`' reason. */
const Diff = createContext<StepDiff | undefined>(undefined)

/** The provider, so a page can say which step's diff the change maps below it describe. */
export const MarkdownChanges = ({
  diff,
  children,
}: {
  readonly diff: StepDiff | undefined
  readonly children: ReactNode
}): ReactNode => <Diff value={diff}>{children}</Diff>

/** The line under a joined map: what it was joined to. */
const foot = (diff: StepDiff): string => {
  const held = diff.join.files.length
  const files =
    diff.omitted === undefined
      ? `${String(held)} files`
      : `${String(held)} of ${String(held + diff.omitted)} files loaded`
  return `Joined to ${diff.name}'s diff · ${files} · press a file to see its lines`
}

/**
 * Which bucket is which, across polls. An agent's bucket by its place and its name, since an
 * agent may name two buckets alike and each must still be picked on its own; the join's own
 * bucket by a key no agent can write, since it comes and goes at the end of the list and so
 * moves no agent bucket's place.
 */
const keyOf = (bucket: MapBucket, at: number): string =>
  bucket.unexplained ? "\u0000unexplained" : `${String(at)}\u0000${bucket.name}`

const subOf = (bucket: MapBucket): ReactNode => {
  if (bucket.why !== undefined) return <CodeSpans text={bucket.why} />
  return bucket.unexplained
    ? "Changed in this step, and named in no bucket."
    : `${String(bucket.files.length)} files`
}

/**
 * The header's count: the diff's files where there is one — a named path it lacks is not
 * one of them — or the files named, and their lines where a diff counted them.
 */
const Tally = ({
  buckets,
  diff,
}: {
  readonly buckets: readonly MapBucket[]
  readonly diff: StepDiff | undefined
}): ReactNode => {
  const files = buckets.flatMap((bucket) => bucket.files)
  const { lines } = bucketTotals(files)
  return (
    <span className="shrink-0 font-mono normal-case tracking-normal tabular-nums">
      {diff === undefined ? files.length : diff.join.files.length} files
      {lines !== undefined && (
        <>
          {" · "}
          <span className="text-diff-added">+{lines.added}</span>{" "}
          <span className="text-diff-deleted">−{lines.deleted}</span>
        </>
      )}
    </span>
  )
}

const ChangeMap = ({ buckets }: { readonly buckets: readonly Bucket[] }): ReactNode => {
  const diff = useContext(Diff)
  // By key and path rather than index, so a poll that adds an Unexplained bucket or a
  // file moves nothing the reader picked or opened.
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const [opened, setOpened] = useState<string | undefined>(undefined)
  const drawn = joinChanges(buckets, diff?.join)
  const at = Math.max(
    0,
    drawn.findIndex((bucket, i) => keyOf(bucket, i) === picked),
  )
  const filesOf = (bucket: MapBucket, narrow: boolean): readonly TreeFile[] =>
    bucket.files.map((file) => ({
      ...file,
      body:
        diff === undefined || file.counts === undefined
          ? undefined
          : () => (
              <div className="min-w-0 overflow-hidden rounded-control border border-guide bg-canvas">
                {diff.lines(file.path, narrow ? "new" : "pair")}
              </div>
            ),
    }))
  return (
    <Navigator
      label="Changes"
      renderEnd={() => <Tally buckets={drawn} diff={diff} />}
      items={drawn.map((bucket, i) => ({
        key: keyOf(bucket, i),
        title: bucket.name,
        sub: subOf(bucket),
        lead: undefined,
        group: undefined,
        waiting: bucket.unexplained,
      }))}
      picked={at}
      onPick={(i) => {
        const bucket = drawn[i]
        setPicked(bucket === undefined ? undefined : keyOf(bucket, i))
        setOpened(undefined)
      }}
      open={opened !== undefined}
      renderStates={(narrow) =>
        drawn.map((bucket, i) => (
          <FileTree
            key={keyOf(bucket, i)}
            files={filesOf(bucket, narrow)}
            narrow={narrow}
            opened={i === at ? opened : undefined}
            onOpen={setOpened}
          />
        ))
      }
      renderFooter={diff === undefined ? undefined : () => <span>{foot(diff)}</span>}
    />
  )
}

export default ChangeMap
