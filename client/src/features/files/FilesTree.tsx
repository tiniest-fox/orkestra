/**
 * The tree in its four states: the rows, the first read, an empty checkout, and a read
 * that failed with nothing earlier to show. A poll that fails behind rows already drawn
 * leaves them drawn.
 */

import type { ReactNode } from "react"
import Button from "../../components/Button"
import { browseRows } from "./browseTree"
import FileTreeView from "./FileTreeView"
import type { FileBrowser } from "./useFileBrowser"
import type { FilesRead } from "./useProjectFiles"

const Said = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <div className="flex flex-col items-start gap-3 px-3 py-4 text-sm text-fg-muted">{children}</div>
)

const FilesTree = ({
  files,
  browser,
  tap,
}: {
  readonly files: FilesRead
  readonly browser: FileBrowser
  readonly tap: boolean
}): ReactNode => {
  if (files.data === undefined) {
    if (files.failed === undefined)
      return (
        <Said>
          <span role="status">Listing the project checkout…</span>
        </Said>
      )
    return (
      <Said>
        <span role="alert">Could not list the project checkout: {files.failed}</span>
        <Button size="sm" variant="quiet" onClick={files.retry}>
          Try again
        </Button>
      </Said>
    )
  }
  if (files.data.paths.length === 0)
    return <Said>Git sees no files in the project checkout. A file added there appears here.</Said>
  return (
    <FileTreeView
      rows={browseRows(files.data.paths, browser.folders)}
      selected={browser.file?.path}
      tap={tap}
      onFolder={browser.toggleFolder}
      onFile={(path) => {
        browser.openFile(path)
      }}
    />
  )
}

export default FilesTree
