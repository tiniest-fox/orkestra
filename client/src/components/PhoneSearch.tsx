import type { ReactNode } from "react"
import { Search } from "lucide-react"

/**
 * Search on a phone: a 44px press around an 18px glyph, flush to the header's right edge.
 * The app bar's ⌘K door draws it on an engine reached with no host, and a host's header
 * draws it over a project's frame, which is where the palette it opens lives.
 *
 * **Drawn in every state of the host's header, and disabled where nothing is searched** —
 * the host's settings, no project, or a project with no client yet. The press stays put
 * so the header does not change shape as a project starts.
 */
const PhoneSearch = ({ onSearch }: { readonly onSearch: (() => void) | undefined }): ReactNode => (
  <button
    type="button"
    aria-label="Search traks and files"
    disabled={onSearch === undefined}
    onClick={onSearch}
    className="-mr-2 flex size-11 shrink-0 items-center justify-center text-fg-muted disabled:text-fg-subtle disabled:opacity-50"
  >
    <Search size={18} aria-hidden />
  </button>
)

export default PhoneSearch
