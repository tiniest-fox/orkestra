/**
 * One file in a chat box before it is sent: a square tile, the name under it, a round ×
 * on its corner.
 *
 * **An image shows itself and anything else its kind's glyph**, so three screenshots can be
 * told apart without reading. While it uploads the tile dims and a working-tone bar fills
 * along its bottom edge; the send stays shut until every bar is gone, which is the bar's
 * whole message. The name is cut to the tile's width, and the full name is its `title`.
 *
 * **On a phone the × is 28px and reaches 44**, by an invisible `before:`. The reach spills
 * 6px past the row's gap onto the next tile's top-left corner, which holds no control, so
 * it covers nothing a press could mean.
 */

import type { ReactNode } from "react"
import { X } from "lucide-react"
import type { Attaching } from "../hooks/useAttachments"
import { KIND_ICON, KIND_WORD } from "../format/attachments"
import { sizeOf } from "../format/size"

const AttachTile = ({
  file,
  onRemove,
}: {
  readonly file: Attaching
  readonly onRemove: () => void
}): ReactNode => {
  const Icon = KIND_ICON[file.kind]
  const uploading = file.progress !== undefined
  return (
    <li
      className="relative flex w-14 shrink-0 flex-col gap-1 max-sm:w-16"
      title={`${file.name} · ${KIND_WORD[file.kind]} · ${sizeOf(file.size)}`}
    >
      <div className="relative flex size-14 items-center justify-center overflow-hidden rounded-control border border-border bg-surface-2 max-sm:size-16">
        {file.preview === undefined ? (
          <Icon size={20} aria-hidden className="text-fg-muted" />
        ) : (
          <img src={file.preview} alt="" className="size-full object-cover" />
        )}
        {uploading ? (
          <div
            role="progressbar"
            aria-label={`Uploading ${file.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(file.progress * 100)}
            className="absolute inset-0 flex flex-col justify-end bg-canvas/60"
          >
            <div className="h-1 bg-tone-working-track">
              <div
                className="h-full bg-tone-working"
                style={{ width: `${String(file.progress * 100)}%` }}
              />
            </div>
          </div>
        ) : undefined}
      </div>
      <span className="truncate font-mono text-2xs text-fg-subtle">{file.name}</span>
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-pill border border-border bg-surface text-fg-muted shadow-sm hover:text-fg max-sm:size-7 max-sm:before:absolute max-sm:before:-inset-2 max-sm:before:content-['']"
      >
        <X size={12} aria-hidden className="max-sm:size-3.5" />
      </button>
    </li>
  )
}

export default AttachTile
