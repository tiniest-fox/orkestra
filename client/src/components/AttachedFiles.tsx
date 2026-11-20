/**
 * What a chat box holds besides the text, inside the box above the field: the row of
 * tiles, then the sentence for a file it refused. Neither is drawn while it is empty.
 *
 * **The row scrolls sideways rather than wrapping**, so the box grows by one row of tiles
 * however many are attached — the pick's choice, with the cost that a fourth tile on a
 * phone is found by scrolling. The top and end padding make room for each tile's ×.
 */

import type { ReactNode } from "react"
import AttachTile from "./AttachTile"
import type { Attachments } from "../hooks/useAttachments"

const AttachedFiles = ({ attach }: { readonly attach: Attachments }): ReactNode => (
  <>
    {attach.files.length === 0 ? undefined : (
      <ul
        aria-label="Attached files"
        className="flex min-w-0 gap-2 overflow-x-auto px-1 pt-2.5 pr-2.5 pb-1.5"
      >
        {attach.files.map((f) => (
          <AttachTile key={f.key} file={f} onRemove={() => attach.remove(f.key)} />
        ))}
      </ul>
    )}
    {attach.refusal === undefined ? undefined : (
      <p role="alert" className="min-w-0 px-2 pb-1 text-sm text-tone-bad">
        <span className="font-medium">{attach.refusal.name}</span> {attach.refusal.line}
      </p>
    )}
  </>
)

export default AttachedFiles
