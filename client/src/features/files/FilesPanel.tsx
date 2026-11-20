/**
 * The desk's Files panel: a `components/Drawer` from the left, beside the strip's cell that
 * opens it, from the top of the window down to the strip, and drawn like the trak drawer
 * — tools on the left, git on the right. `FilesHeader` stays at
 * the top; under it the tree, or a file's band with back on it and the file.
 *
 * **A link in a rendered file to a file in the tree opens that file here.** Any other
 * relative link, and a web link, leaves for a tab as it does anywhere else; an anchor alone
 * is taken and goes nowhere, since the headings carry no ids to jump to and a tab of this
 * page is worse than nothing.
 *
 * **It covers the list's titles while it is open**, which the person accepted when they
 * picked it. A trak drawer is never open beside it — `traks-list/useProjectTools` keeps
 * one of the two. A `dialog`, by passing `dismiss`, for the reason every overlay is — the
 * desktop shell hides a native page under one.
 */

import type { ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import Drawer from "../../components/Drawer"
import { MarkdownLinks } from "../../components/Markdown"
import FilesHeader from "./FilesHeader"
import FilesTree from "./FilesTree"
import FileViewer from "./FileViewer"
import { linkedFile } from "./linkedFile"
import type { FileBrowser } from "./useFileBrowser"
import type { FileReading } from "./useFileContent"
import type { FilesRead } from "./useProjectFiles"

const FilesPanel = ({
  browser,
  files,
  reading,
  branch,
  onSearch,
  hint,
}: {
  readonly browser: FileBrowser
  readonly files: FilesRead
  readonly reading: FileReading
  /** The checkout's branch, as the git strip names it; `undefined` before git answers. */
  readonly branch: string | undefined
  /** Open the ⌘K palette. */
  readonly onSearch: () => void
  /** The chord that opens it on this platform, as the press spells it. */
  readonly hint: string
}): ReactNode => {
  const { file } = browser
  return (
    <Drawer label="Project files" side="left" dismiss={browser.close}>
      <FilesHeader
        branch={branch}
        count={files.data?.paths.length}
        hint={hint}
        onSearch={onSearch}
        onClose={browser.close}
      />
      {file === undefined ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <FilesTree files={files} browser={browser} tap={false} />
        </div>
      ) : (
        <MarkdownLinks
          follow={(href) => {
            if (href.startsWith("#")) return true
            const target = linkedFile(file.path, href)
            if (target === undefined || files.data?.paths.includes(target) !== true) return false
            browser.openFile(target)
            return true
          }}
        >
          <FileViewer
            file={file}
            reading={reading}
            tap={false}
            onView={browser.setView}
            lead={
              <button
                type="button"
                aria-label="Back to the tree"
                onClick={browser.back}
                className="flex size-7 shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-hover-bare"
              >
                <ChevronLeft size={15} aria-hidden />
              </button>
            }
          />
        </MarkdownLinks>
      )}
    </Drawer>
  )
}

export default FilesPanel
