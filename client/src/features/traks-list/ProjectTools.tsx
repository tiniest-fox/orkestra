/**
 * What the file browser and the ⌘K palette draw over the list, by layout: on a desk the
 * Files panel; on a phone the Files sheet, then a file full screen over it; and the
 * palette over either. The doors to them — the strip's Files cell, the dock's Files tab,
 * the top bar's ⌘K press — are drawn where each lives; this is what they open.
 */

import type { ReactNode } from "react"
import type { AgentDto, TrakSummaryDto } from "../../api/types"
import FilesPanel from "../files/FilesPanel"
import FilesSheet from "../files/FilesSheet"
import PhoneFile from "../files/PhoneFile"
import Palette from "../palette/Palette"
import type { ProjectTools as Tools } from "./useProjectTools"

const ProjectTools = ({
  tools,
  phone,
  traks,
  archived,
  agents,
  branch,
}: {
  readonly tools: Tools
  readonly phone: boolean
  readonly traks: readonly TrakSummaryDto[]
  /** How many traks are put away. */
  readonly archived: number
  readonly agents: readonly AgentDto[]
  /** The project checkout's branch, as the git strip names it, for the Files header. */
  readonly branch: string | undefined
}): ReactNode => {
  const { browser, files, reading } = tools
  return (
    <>
      {browser.open &&
        (!phone ? (
          <FilesPanel
            browser={browser}
            files={files}
            reading={reading}
            branch={branch}
            onSearch={tools.openPalette}
            hint={tools.hint}
          />
        ) : browser.file === undefined ? (
          <FilesSheet browser={browser} files={files} />
        ) : (
          <PhoneFile file={browser.file} reading={reading} onBack={browser.back} />
        ))}
      {tools.palette && (
        <Palette
          search={tools.search}
          traks={traks}
          archivedCount={archived}
          paths={files.data?.paths ?? []}
          agents={agents}
          phone={phone}
          onClose={tools.closePalette}
          onFile={tools.openFound}
        />
      )}
    </>
  )
}

export default ProjectTools
