import type { ReactNode } from "react"
import { splitTail } from "./paths"

/**
 * A row's second line: the path, in mono one step below the name, clipped in the middle.
 * The head is the flex item that shrinks and takes the ellipsis; the last two segments
 * are `shrink-0`, so the part that tells two same-named folders apart never leaves the
 * screen. Clipping the tail instead would show the same parent twice and tell nothing
 * apart.
 *
 * `title` carries the whole path for a hover, since the middle is what is missing.
 */
const PathLine = ({
  short,
  path,
}: {
  readonly short: string
  readonly path: string
}): ReactNode => {
  const [head, tail] = splitTail(short)
  return (
    <span className="flex min-w-0 font-mono text-xs text-fg-subtle" title={path}>
      <span className="min-w-0 truncate">{head}</span>
      <span className="shrink-0">{tail}</span>
    </span>
  )
}

export default PathLine
