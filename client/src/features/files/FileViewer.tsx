/**
 * One file: the band, then the text — or, for a file there is nothing to draw of, a
 * sentence in its place. A binary file and one over the 1 MB cap are named with their
 * size and no content, because the engine sends none; a file the tree no longer names
 * says so; a read that failed offers to try again.
 *
 * **A markdown file can be drawn rendered**, where the caller offers `onView`: the band
 * holds the Rendered | Source toggle and the text reads as a document, in a column of at
 * most 100ch. The phone offers none, so a phone draws every file's lines.
 *
 * `lead` is the caller's press at the band's left — back, on both layouts. Close is the
 * desk drawer's header's, above the band.
 */

import type { ReactNode } from "react"
import Button from "../../components/Button"
import Markdown, { MarkdownDocument } from "../../components/Markdown"
import { sizeOf } from "../../format/size"
import { factsOf, isMarkdown } from "./fileFacts"
import FileHead from "./FileHead"
import FileLines from "./FileLines"
import type { FileView, OpenFile } from "./useFileBrowser"
import type { FileReading } from "./useFileContent"
import ViewToggle from "./ViewToggle"

/** A quiet sentence where the text would be. */
const Instead = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-canvas px-6 text-center text-sm text-fg-muted">
    {children}
  </div>
)

const Body = ({
  file,
  rendered,
  reading,
}: {
  readonly file: OpenFile
  readonly rendered: boolean
  readonly reading: FileReading
}): ReactNode => {
  const { shown } = reading
  switch (shown._tag) {
    case "Loading":
      return (
        <Instead>
          <span role="status">Reading the file…</span>
        </Instead>
      )
    case "Gone":
      return <Instead>This file is no longer in the project checkout.</Instead>
    case "Failed":
      return (
        <Instead>
          <span role="alert">Could not read the file: {shown.message}</span>
          <Button size="sm" variant="quiet" onClick={reading.retry}>
            Try again
          </Button>
        </Instead>
      )
    case "Shown":
      switch (shown.file._tag) {
        case "Text":
          // Its own scroll box, as `FileLines` has, or a long README stretches the drawer.
          return rendered ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <article className="max-w-[100ch] px-6 py-5 text-fg">
                <MarkdownDocument>
                  <Markdown>{shown.file.text}</Markdown>
                </MarkdownDocument>
              </article>
            </div>
          ) : (
            <FileLines path={file.path} text={shown.file.text} line={file.line} />
          )
        case "Binary":
          return <Instead>A binary file, {sizeOf(shown.file.bytes)}. Nothing here to read.</Instead>
        case "TooLarge":
          return (
            <Instead>
              {sizeOf(shown.file.bytes)} — over the viewer’s 1 MB, so it is not drawn here.
            </Instead>
          )
      }
  }
}

const FileViewer = ({
  file,
  reading,
  tap,
  onView,
  lead,
}: {
  readonly file: OpenFile
  readonly reading: FileReading
  readonly tap: boolean
  /** Switch a markdown file's view; `undefined` offers no toggle and draws only lines. */
  readonly onView: ((view: FileView) => void) | undefined
  readonly lead: ReactNode
}): ReactNode => {
  const text = reading.shown._tag === "Shown" && reading.shown.file._tag === "Text"
  const viewable = onView !== undefined && text && isMarkdown(file.path)
  return (
    <>
      <FileHead
        path={file.path}
        facts={reading.shown._tag === "Shown" ? factsOf(reading.shown.file) : undefined}
        tap={tap}
        toggle={viewable ? <ViewToggle view={file.view} onView={onView} /> : undefined}
        lead={lead}
      />
      <Body file={file} rendered={viewable && file.view === "rendered"} reading={reading} />
    </>
  )
}

export default FileViewer
