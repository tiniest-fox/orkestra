/**
 * The chevron cell beside an action that is not Fetch, and the menu it opens upward:
 * Fetch, with the age of the last one. Fetch stays one press behind whatever the bar's
 * action is, and is drawn nowhere else on the desk.
 *
 * **The strip holds whether it is open**, because a risen notice stands in the same
 * corner and gives way to it. Shut on Escape, on focus leaving, or on a press anywhere
 * outside it — `GitBranchCell`'s rule.
 */

import type { FocusEvent, KeyboardEvent, ReactNode } from "react"
import { useCallback, useRef } from "react"
import { ChevronUp, RefreshCw } from "lucide-react"
import MenuItem from "../../../components/MenuItem"
import { useTapOutside } from "../../../hooks/useTapOutside"
import GitFetched from "./GitFetched"
import type { GitView } from "./gitView"
import type { GitPress } from "./useGitBar"

const GitMenu = ({
  view,
  press,
  open,
  setOpen,
}: {
  readonly view: GitView
  readonly press: (press: GitPress) => void
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
}): ReactNode => {
  const root = useRef<HTMLSpanElement>(null)
  const shut = useCallback(() => {
    setOpen(false)
  }, [setOpen])
  useTapOutside(root, open, shut)
  return (
    <span
      ref={root}
      className="relative flex"
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Escape") setOpen(false)
      }}
      onBlur={(event: FocusEvent<HTMLSpanElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        aria-label="More git actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!view.idle}
        onClick={() => {
          setOpen(!open)
        }}
        className="flex h-full w-7 shrink-0 items-center justify-center text-fg-muted transition-colors hover:bg-hover-bare disabled:opacity-45"
      >
        <ChevronUp size={13} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-1 bottom-full mb-1 flex w-52 flex-col rounded-surface border border-border bg-surface p-1 shadow-menu"
        >
          <MenuItem
            onClick={() => {
              setOpen(false)
              press({ action: "fetch", stash: false })
            }}
          >
            <span className="flex items-center gap-2">
              <RefreshCw size={13} aria-hidden className="text-fg-muted" />
              Fetch
              <span className="ml-auto">
                <GitFetched view={view} />
              </span>
            </span>
          </MenuItem>
        </div>
      )}
    </span>
  )
}

export default GitMenu
