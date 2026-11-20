/**
 * Everything the trak screen holds about its side panel: the processes, the presses on
 * them, the pull request, and where the reader has the panel — open or shut, which item,
 * which view, and whether it has the whole drawer.
 *
 * **The pull request is offered only inside Orkestra.app**, where the shell's native view
 * can draw GitHub's page — GitHub refuses to be framed, so a browser and a phone get no tab.
 * It is asked the same question with the same key as the finished card, so where the card
 * is this trak's there is one forge read rather than two; and only once the plan has run
 * out, as the card is.
 *
 * **The processes are keyed to the trak that owns the position**, like every other press
 * on the screen: at a spawn's piece they are the piece's, because a piece has a checkout of
 * its own and a child has no page to start one from. So the opener in the header wears the
 * piece's worst state there. **The pull request stays the page's trak's** — `openPull`
 * says why.
 *
 * **Where the panel stands is held for the tab, not per trak**, and that was this build's
 * call: every trak in a project has the same declared processes, so stepping to the next
 * trak with the panel open keeps it open on the same item — which is how a person comparing
 * one trak's dev server against another's would want it. Nothing is written to storage.
 */

import { useRef, useState } from "react"
import { pageBridge } from "../../../api/page"
import { pageOrigins } from "../../../api/pageDomain"
import type { HostedProcessDto, TrakDetailDto } from "../../../api/types"
import type { PageOrigins } from "../../../format/hosted"
import { branchMoved } from "../finished/finished"
import { finishingLive } from "../finished/useFinishing"
import { headingOf } from "../pull-request/pullRequest"
import { usePullRequest } from "../pull-request/usePullRequest"
import type { PanelItem, PanelPull } from "./panelItem"
import { type HeldPage, panelLink } from "./panelLink"
import type { ProcessView } from "./ProcessViews"
import { useProcesses } from "../../../hooks/useProcesses"
import { type ProcessPresses, useProcessPress } from "../../../hooks/useProcessPress"

/** Stable, so a render before the answer does not hand a new array to every reader. */
const NONE: readonly HostedProcessDto[] = []

export interface SidePanel {
  /** Every process the project declares — empty while the answer is out, or where none is. */
  readonly processes: readonly HostedProcessDto[]
  /** The trak's pull request, inside Orkestra.app once the forge has found one. */
  readonly pull: PanelPull | undefined
  readonly presses: ProcessPresses
  /** Open, and something to show in it. */
  readonly open: boolean
  readonly toggle: () => void
  /**
   * Opens the panel at the pull request — the card's link. `undefined` while there is none,
   * and wherever the card on screen is a spawn's piece: the panel's pull request is the
   * page's trak's, and a piece's card names the piece's.
   */
  readonly openPull: (() => void) | undefined
  /**
   * Takes a plain press on a link in the trak's markdown where it names a process of this
   * trak or its pull request — opens the panel there and answers `true` — and answers
   * `false` for every other link, which then goes to the browser.
   */
  readonly follow: (href: string) => boolean
  /** Where each process is served behind a host's page domain; `undefined` with none. */
  readonly origins: PageOrigins | undefined
  /** The page the last such link asked for, and the run it was asked of — `ProcessBody`. */
  readonly held: HeldPage | undefined
  readonly active: PanelItem | undefined
  readonly setActive: (item: PanelItem) => void
  readonly view: ProcessView
  readonly setView: (view: ProcessView) => void
  /** The panel has the whole drawer and the trak column is hidden. Desk only. */
  readonly full: boolean
  readonly setFull: (full: boolean) => void
}

/** The pull request the panel offers — `undefined` outside the app, and where there is none. */
const usePanelPull = (id: string, trak: TrakDetailDto | undefined): PanelPull | undefined => {
  const live =
    pageBridge() !== undefined &&
    finishingLive(trak?.state, branchMoved(trak?.log ?? []), trak?.landed, false).forge
  const forge = usePullRequest(id, live, trak?.worktree?.branch)
  const heading = live ? headingOf(forge) : undefined
  return heading === undefined ? undefined : { heading, confirmed: forge.confirmed }
}

export const useSidePanel = (
  id: string,
  trak: TrakDetailDto | undefined,
  /** The trak that owns the position on screen — `id` itself, or a piece of it. */
  at: string,
): SidePanel => {
  const processes = useProcesses(at).data ?? NONE
  const pull = usePanelPull(id, trak)
  const presses = useProcessPress(at)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<PanelItem | undefined>(undefined)
  const [view, setView] = useState<ProcessView>("page")
  const [full, setFull] = useState(false)
  // With the trak it was asked of, so stepping to another position never hands that
  // trak's run of the same name and number a page from this one's.
  const [held, setHeld] = useState<{ readonly of: string; readonly page: HeldPage }>()
  // Never reset, so no two presses in this tab hand the shell the same run.
  const clicks = useRef(0)
  const origins = pageOrigins(at)
  return {
    processes,
    pull,
    presses,
    open: open && (processes.length > 0 || pull !== undefined),
    toggle: () => setOpen((was) => !was),
    openPull:
      pull === undefined || at !== id
        ? undefined
        : () => {
            setActive({ kind: "pull" })
            setOpen(true)
          },
    follow: (href) => {
      const link = panelLink(href, processes, pull?.heading.url, origins)
      if (link === undefined) return false
      if (link.kind === "pull") setActive({ kind: "pull" })
      else {
        setActive({ kind: "process", name: link.name })
        setView("page")
        clicks.current += 1
        // A process that is not up has no page to hold: a later Start loads its root.
        setHeld(
          link.page === undefined
            ? undefined
            : { of: at, page: { name: link.name, ...link.page, click: clicks.current } },
        )
      }
      setOpen(true)
      return true
    },
    origins,
    held: held?.of === at ? held.page : undefined,
    active,
    setActive,
    view,
    setView,
    full,
    setFull,
  }
}
