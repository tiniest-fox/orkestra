/**
 * `ChatBar`'s box: the field, the send at its end, and — where the bar takes files — the
 * paperclip at its start, the attached files above the text and the refusal under them.
 *
 * **The box is the drop target, and its own edge is the outline.** While files are dragged
 * over it the 1px rule becomes a 2px dashed accent one; nothing else on the bar changes.
 * A drag that carries no files — text dragged out of the transcript — is left to the field.
 *
 * **Paste is the quickest route on a desk**: a screenshot on the clipboard is attached from
 * the field without a press. Where the clipboard also holds text, the text is pasted too.
 */

import type { ClipboardEvent, DragEvent, KeyboardEvent, ReactNode } from "react"
import { useState } from "react"
import AttachClip from "./AttachClip"
import AttachedFiles from "./AttachedFiles"
import Field from "./Field"
import type { Attachments } from "../hooks/useAttachments"

const BOX =
  "relative flex min-w-0 flex-col bg-surface has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-0 has-[textarea:focus-visible]:outline-accent"
// Drawn as an outline over the edge rather than a wider border, so the field does not move.
const EDGE = "border border-border p-1.5"
const DROPPING =
  "border border-transparent p-1.5 outline-2 outline-dashed outline-accent -outline-offset-2"

const carriesFiles = (event: DragEvent<HTMLElement>): boolean =>
  event.dataTransfer.types.includes("Files")

const ChatBox = ({
  field,
  send,
  attach,
  disabled,
  rounded,
}: {
  /** `Field`'s props as `ChatBar` builds them. */
  readonly field: {
    readonly id: string
    readonly label: string
    readonly placeholder: string
    readonly rows: number
    readonly value: string
    readonly onChange: (value: string) => void
    readonly onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
    readonly autoFocus: boolean
  }
  /** The send, or the control standing in its place. */
  readonly send: ReactNode
  readonly attach: Attachments | undefined
  readonly disabled: boolean
  /** The corners — squared on top where a band sits on the box. */
  readonly rounded: string
}): ReactNode => {
  const [dropping, setDropping] = useState(false)
  const taking = attach !== undefined && !disabled
  const over = (event: DragEvent<HTMLDivElement>): void => {
    if (!taking || !carriesFiles(event)) return
    event.preventDefault()
    setDropping(true)
  }
  return (
    <div
      className={`${BOX} ${dropping ? DROPPING : EDGE} ${rounded}`}
      onDragEnter={over}
      onDragOver={over}
      onDragLeave={(event) => {
        // Leaving for a child of the box is not leaving the box.
        const into = event.relatedTarget
        if (into instanceof Node && event.currentTarget.contains(into)) return
        setDropping(false)
      }}
      onDrop={(event) => {
        if (!taking || !carriesFiles(event)) return
        event.preventDefault()
        setDropping(false)
        attach.add([...event.dataTransfer.files])
      }}
      onPaste={(event: ClipboardEvent<HTMLDivElement>) => {
        const files = [...event.clipboardData.files]
        if (!taking || files.length === 0) return
        if (!event.clipboardData.types.includes("text/plain")) event.preventDefault()
        attach.add(files)
      }}
    >
      {attach === undefined ? undefined : <AttachedFiles attach={attach} />}
      <div className="flex min-w-0 items-end gap-1.5">
        {attach === undefined ? undefined : <AttachClip onPick={attach.add} disabled={disabled} />}
        <div className="min-w-0 flex-1">
          <Field {...field} disabled={disabled} bare />
        </div>
        {send}
      </div>
    </div>
  )
}

export default ChatBox
