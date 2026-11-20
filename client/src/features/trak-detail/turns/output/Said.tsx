/**
 * What a person wrote to the agent, as the bubble everything addressed to an agent takes.
 *
 * **Two states of one thing.** Filled is a message the agent has: the one that started a
 * turn, or one it read part-way through. `waiting` is the same message before anybody
 * has read it — the same box in the same place with the fill taken out and an edge put
 * where it was, so the difference a reader sees is the one that is true: it is theirs,
 * and it has not landed.
 *
 * The row it sits in is its caller's: a list item at a turn's head, a bare row inside a
 * turn, a row with a mark beside it while it waits.
 *
 * **What a person writes is markdown too**, drawn as `AgentMessage` draws an agent's — so
 * the bubble is a `div`, since a list, a table or a fence cannot sit in a `p` — except that
 * a single newline stays a line break: what they pasted reads back as they pasted it.
 *
 * **Where the files it was sent with go.** On a trak, whose page says which checkout images come from, each image is a
 * thumbnail in a row just above the bubble; every other file is a line inside it, under
 * the words. A goal has no image route, so there every file is a line.
 */

import type { ReactNode } from "react"
import type { AttachmentDto } from "../../../../api/types"
import Markdown, { useMarkdownImages } from "../../../../components/Markdown"
import { kindOf } from "../../../../format/attachments"
import SentFileLine from "./SentFileLine"
import SentThumbs from "./SentThumbs"

const WIDTH = "min-w-0 max-w-[80%] max-sm:max-w-[90%]"

const NONE: readonly AttachmentDto[] = []

const Said = ({
  text,
  waiting = false,
  attachments = NONE,
}: {
  readonly text: string
  readonly waiting?: boolean
  /** What the message was sent with — the `attachments` of the item it came from. */
  readonly attachments?: readonly AttachmentDto[]
}): ReactNode => {
  const resolve = useMarkdownImages()
  const images =
    resolve === undefined ? NONE : attachments.filter((f) => kindOf(f.type) === "image")
  const lines = attachments.filter((f) => !images.includes(f))
  const bubble = (
    <div
      className={`${images.length === 0 ? WIDTH : "min-w-0 max-w-full"} rounded-surface px-4 py-2 ${
        waiting ? "border border-source-human/35 text-fg-muted" : "bg-source-human/10 text-fg"
      }`}
    >
      <Markdown said>{text}</Markdown>
      {lines.length === 0 ? undefined : (
        <ul aria-label="Sent files" className="mt-2 flex min-w-0 flex-col gap-1">
          {lines.map((f) => (
            <SentFileLine key={f.path} file={f} />
          ))}
        </ul>
      )}
    </div>
  )
  if (images.length === 0 || resolve === undefined) return bubble
  return (
    <div className={`flex ${WIDTH} flex-col items-end gap-1.5`}>
      <SentThumbs images={images} resolve={resolve} />
      {bubble}
    </div>
  )
}

export default Said
