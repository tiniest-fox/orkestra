/**
 * A file on a phone, full screen, with a back press to the tree. Over the whole window
 * at `z-40`, as the sheets are, and it pays both safe-area insets itself since no bar
 * sits above or below it. It offers no view toggle, so a markdown file draws its lines.
 */

import type { KeyboardEvent, ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import FileViewer from "./FileViewer"
import type { OpenFile } from "./useFileBrowser"
import type { FileReading } from "./useFileContent"

const PhoneFile = ({
  file,
  reading,
  onBack,
}: {
  readonly file: OpenFile
  readonly reading: FileReading
  readonly onBack: () => void
}): ReactNode => (
  <div
    role="dialog"
    aria-label={file.path}
    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") onBack()
    }}
    className="fixed inset-0 z-40 flex flex-col bg-surface pt-safe-t pb-safe-b"
  >
    <FileViewer
      file={file}
      reading={reading}
      tap
      onView={undefined}
      lead={
        <button
          type="button"
          aria-label="Back to the tree"
          onClick={onBack}
          className="flex size-11 shrink-0 items-center justify-center rounded-control text-fg-muted"
        >
          <ChevronLeft size={20} aria-hidden />
        </button>
      }
    />
  </div>
)

export default PhoneFile
