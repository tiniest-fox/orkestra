/**
 * A file `.gitattributes` marks `linguist-generated`: the same card, which arrives folded
 * with its `+/−` and no hunks, and asks for its own patch once the reader opens it.
 *
 * Asked for on opening rather than with the slice, because a project marks a path that way
 * to say nobody reads it — a design study or a proof can run to thousands of lines a slice
 * would otherwise carry on every read.
 */

import type { ComponentProps, ReactNode } from "react"
import ChangeFile from "./ChangeFile"
import { useChangedFile } from "./useChanges"

const GeneratedFile = ({
  trak,
  slice,
  file,
  folded,
  ...card
}: Omit<ComponentProps<typeof ChangeFile>, "note"> & {
  readonly trak: string
  /** The slice the card belongs to, which is the slice its patch is read from. */
  readonly slice: string
}): ReactNode => {
  const opened = useChangedFile(trak, slice, file.path, !folded)
  return (
    <ChangeFile
      {...card}
      file={opened.file ?? file}
      folded={folded}
      {...(opened.file === undefined
        ? { note: opened.isError ? "Could not read this file's changes." : "Reading its changes…" }
        : {})}
    />
  )
}

export default GeneratedFile
