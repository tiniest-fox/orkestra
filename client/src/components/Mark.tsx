import type { ReactNode } from "react"

/**
 * The mark: `public/favicon.svg`, redrawn rather than linked, so it costs no request and
 * its square follows the accent token rather than the file's fixed color. The
 * ring is stroked white in both schemes because it is a hole in a saturated square, not
 * a colour that should follow the room.
 *
 * Drawn in the app bar, the phone's header and the desktop launch window, which is what
 * put it here rather than inside `AppBar`. 20px but in the phone's header, where it stands
 * for a project's 28px picture.
 */
const Mark = ({ size = 20 }: { readonly size?: number }): ReactNode => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
    <rect width="32" height="32" rx="8" className="fill-accent" />
    <circle cx="16" cy="16" r="6" fill="none" stroke="white" strokeWidth="4" />
  </svg>
)

export default Mark
