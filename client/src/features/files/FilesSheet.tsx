/**
 * The phone's Files sheet: the tree under its heading, rising from the dock's Files tab.
 * No search entry — on a phone search is the top bar's glyph alone, as the person chose.
 * A file opens full screen over it (`PhoneFile`), and its back press returns here.
 */

import type { ReactNode } from "react"
import Sheet from "../../components/Sheet"
import FilesTree from "./FilesTree"
import type { FileBrowser } from "./useFileBrowser"
import type { FilesRead } from "./useProjectFiles"

const FilesSheet = ({
  browser,
  files,
}: {
  readonly browser: FileBrowser
  readonly files: FilesRead
}): ReactNode => (
  <Sheet label="Project files" tall flush onClose={browser.close}>
    <span className="px-4 pb-2 font-mono text-2xs tracking-wider text-fg-subtle uppercase">
      Project checkout · files
    </span>
    {/* Edge to edge, as the sheet's other rows are: the sheet is `flush`. */}
    <div className="border-t border-border">
      <FilesTree files={files} browser={browser} tap />
    </div>
  </Sheet>
)

export default FilesSheet
