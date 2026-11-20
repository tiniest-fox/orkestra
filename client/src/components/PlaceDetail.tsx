/**
 * What pressing a place pill shows: the runner's own description, then the sandbox id and
 * the exec id, each with a copy press.
 *
 * **The description is the runner file's, carried by the wire**, so this names no
 * provider: whatever a project's runner says about itself is the whole of what a reader
 * learns about where the sandbox lives. The sandbox row is absent where the runner
 * printed no id.
 */

import type { ReactNode } from "react"
import { useState } from "react"
import { Check, Cloud, Copy } from "lucide-react"
import type { PlaceDto } from "../api/types"

const CopyRow = ({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}): ReactNode => {
  const [copied, setCopied] = useState(false)
  const Glyph = copied ? Check : Copy
  return (
    <div className="flex min-w-0 items-center gap-2 py-0.5">
      <span className="w-14 shrink-0 text-xs text-fg-subtle">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{value}</span>
      <button
        type="button"
        aria-label={copied ? `${label} id copied` : `Copy ${label.toLowerCase()} id`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => setCopied(true))
        }}
        className="flex size-7 shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-hover-bare max-sm:size-11"
      >
        <Glyph size={13} aria-hidden />
      </button>
    </div>
  )
}

const PlaceDetail = ({
  place,
}: {
  readonly place: Extract<PlaceDto, { readonly _tag: "Remote" }>
}): ReactNode => (
  <div className="flex min-w-0 flex-col gap-1">
    <p className="flex min-w-0 items-start gap-1.5 pb-1 text-sm text-fg">
      <span className="flex h-4 shrink-0 items-center">
        <Cloud size={13} aria-hidden className="text-fg-muted" />
      </span>
      <span className="min-w-0">{place.runner}</span>
    </p>
    {place.sandbox === undefined ? undefined : <CopyRow label="Sandbox" value={place.sandbox} />}
    <CopyRow label="Exec" value={place.exec} />
  </div>
)

export default PlaceDetail
