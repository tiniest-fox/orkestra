/**
 * The paperclip at a chat box's leading edge, and the picker it opens.
 *
 * **The picker is a hidden `<input type="file">`**, pressed through, because it is the only
 * way a page can open the system's own chooser — on a phone, the one that offers the photo
 * library and the camera. Its value is cleared after each pick, so picking the same file
 * twice still reports a change.
 */

import type { ReactNode } from "react"
import { useRef } from "react"
import { Paperclip } from "lucide-react"
import Button from "./Button"
import { ACCEPT } from "../format/attachments"

const AttachClip = ({
  onPick,
  disabled,
}: {
  readonly onPick: (files: readonly File[]) => void
  readonly disabled: boolean
}): ReactNode => {
  const input = useRef<HTMLInputElement>(null)
  return (
    <span className="flex shrink-0 max-sm:[&>button]:size-11">
      <Button
        variant="ghost"
        size="lg"
        icon={Paperclip}
        aria-label="Attach files"
        disabled={disabled}
        onClick={() => input.current?.click()}
      />
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])]
          event.currentTarget.value = ""
          if (files.length > 0) onPick(files)
        }}
      />
    </span>
  )
}

export default AttachClip
