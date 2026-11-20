/**
 * One file a person sent, as a line inside their bubble under the words: the kind's glyph,
 * the name, the kind and the size. Every file on a goal, which has no image route, and
 * every file but an image on a trak.
 */

import type { ReactNode } from "react"
import type { AttachmentDto } from "../../../../api/types"
import { KIND_ICON, KIND_WORD, kindOf } from "../../../../format/attachments"
import { sizeOf } from "../../../../format/size"

const SentFileLine = ({ file }: { readonly file: AttachmentDto }): ReactNode => {
  const kind = kindOf(file.type)
  const Icon = KIND_ICON[kind]
  return (
    <li
      className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-fg-muted"
      title={file.path}
    >
      <Icon size={12} aria-hidden className="shrink-0" />
      <span className="min-w-0 truncate">{file.name}</span>
      <span className="shrink-0 text-fg-subtle">
        {KIND_WORD[kind]} · {sizeOf(file.size)}
      </span>
    </li>
  )
}

export default SentFileLine
