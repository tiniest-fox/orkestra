/**
 * The Files drawer's top band: `components/ScreenHeader` naming what is being browsed —
 * the checkout, its branch and how many files — with Search on the title row and no
 * actions row.
 *
 * **Desk only**, so the way out is always Close, and it closes by state rather than by a
 * route: the panel is not a route. It stays over an open file as well, so the title and
 * Close are in one place in both views; the file's own band, with back on it, sits under
 * this one.
 */

import type { ReactNode } from "react"
import { GitBranch, Search } from "lucide-react"
import Button from "../../components/Button"
import ScreenHeader from "../../components/ScreenHeader"

const FilesHeader = ({
  branch,
  count,
  hint,
  onSearch,
  onClose,
}: {
  /** The checkout's branch as the git strip names it, or nothing before git answers. */
  readonly branch: string | undefined
  /** How many files the tree holds, or nothing before it answers. */
  readonly count: number | undefined
  /** The chord that opens the palette on this platform. */
  readonly hint: string
  readonly onSearch: () => void
  readonly onClose: () => void
}): ReactNode => (
  <div className="shrink-0 border-b border-border">
    <ScreenHeader
      title="Files"
      meta={[
        "project checkout",
        ...(branch === undefined
          ? []
          : [
              <span key="branch" className="flex min-w-0 items-center gap-1">
                <GitBranch size={10} aria-hidden className="shrink-0" />
                <span className="truncate">{branch}</span>
              </span>,
            ]),
        ...(count === undefined ? [] : [`${String(count)} ${count === 1 ? "file" : "files"}`]),
      ]}
      phone={false}
      onClose={onClose}
      closeLabel="Close the files"
      action={
        <Button
          variant="quiet"
          size="md"
          icon={Search}
          kbd={hint}
          aria-label="Search traks and files"
          onClick={onSearch}
        >
          Search
        </Button>
      }
    />
  </div>
)

export default FilesHeader
