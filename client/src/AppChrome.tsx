/**
 * The root route's component: the bar, the door under it, and whatever the router is
 * showing behind the door.
 *
 * **It is a route component, and that is load-bearing rather than tidy.** The bar holds
 * a `Link`, which calls `useLinkProps`, which reads router context — and outside the
 * provider that context is null and the whole app renders as a blank page with one
 * `TypeError`. Being the root route keeps it above every page and gives it the context
 * it needs to navigate.
 *
 * **The gate draws the bar, and this file hands it what the slot holds.** The login is
 * drawn under the bar with the slot empty, so the one thing that knows whether this browser
 * is in is the one thing that can decide the slot. `SessionGate` is that thing; the chrome
 * still knows nothing about a trak beyond where one is started.
 *
 * **The stream is inside the gate, and is not per screen.** An `EventSource` answered
 * 401 closes and stays closed, so the stream must not open before the login; inside the
 * gate it mounts when the session is good, unmounts when it goes, and opens afresh with
 * the cookie when a person logs back in. The root route never unmounts on navigation, so
 * one subscription still serves the list and whatever drawer is open. With no passphrase
 * on the engine the gate is a pass-through and none of this is visible.
 *
 * **The project's openers are the one data the chrome holds, and they sit in the slot
 * for the same reason the stream sits in the gate.** `ProjectOpeners` asks for the
 * listing, so it must not mount before the login — and being part of `action` is what
 * keeps it unmounted until the gate draws the slot.
 *
 * **The ⌘K door is in the slot and opens what the traks list draws.** The palette searches
 * traks and files, so it lives with the list's queries; the door only sets
 * `hooks/usePalette`'s flag, which the list reads. It is the one thing in the slot drawn
 * on a phone, as a glyph: search is reached from the top bar there, as the person chose.
 *
 * **On a phone the bar names the project. Inside a host's frame it stands down, at any
 * width, once the host's page says it draws the phone's header over the frame** — the
 * page also asks the frame to open search (`hooks/useHostFrame`). The name is read only
 * where the bar draws it.
 *
 * **The new-build band is the chrome's for the stream's reason**: a rebuild is news on
 * every screen, and a band per page would be a check per page. It decides for itself
 * whether there is anything to draw, the way `EngineStream` decides what to subscribe to.
 */

import type { ReactNode } from "react"
import { Outlet } from "@tanstack/react-router"
import { MessageSquare, Plus, Search } from "lucide-react"
import type { OpenerKindDto } from "./api/types"
import Button from "./components/Button"
import OpenerControl from "./components/OpenerControl"
import PhoneSearch from "./components/PhoneSearch"
import EngineStream from "./EngineStream"
import SessionGate from "./features/login/SessionGate"
import NewBuildBand from "./features/new-build/NewBuildBand"
import { type OpenerChoosing, useChooseOpener } from "./hooks/useChooseOpener"
import { type OpenersListing, useOpenerListing } from "./hooks/useOpenerListing"
import { type CheckoutOpening, useOpenProjectCheckout } from "./hooks/useOpenProjectCheckout"
import { paletteChord, setPaletteOpen } from "./hooks/usePalette"
import { useEngineName } from "./hooks/useEngineName"
import { useHostFrame } from "./hooks/useHostFrame"
import { useNotificationOpens } from "./hooks/useNotificationOpens"
import { usePhone } from "./hooks/usePhone"

/** One kind's plate at the project checkout, or nothing where the listing offers none. */
const projectOpener = (
  kind: OpenerKindDto,
  listing: OpenersListing | undefined,
  choosing: OpenerChoosing,
  opening: CheckoutOpening,
): ReactNode =>
  listing === undefined || listing === "unsupported" ? undefined : (
    <OpenerControl
      kind={kind}
      apps={listing[kind].apps}
      chosen={listing[kind].chosen}
      choosing={choosing}
      opening={opening}
      at="the project checkout"
    />
  )

/**
 * A terminal and an editor at the project checkout — the repository the git bar acts
 * on — for the reader with no trak open. A trak's own pair is in its header, which an
 * open drawer puts over this end of the bar.
 *
 * **Not on a phone, and not asked for there**: the window opens on the engine's machine,
 * which a phone is the one viewer known not to be at (`useOpenerListing`). The `max-sm:`
 * on the slot hides the plates too, but only the hook stops the scan behind the listing.
 *
 * **Its own pick mutations, not the header's** — `useOpeners` says why one copy matters,
 * and the drawer covering this end is why two are never pressable side by side. Both
 * write the one machine-wide pick and re-ask the one listing key, so a pick here moves
 * the header's press and the reverse.
 */
const ProjectOpeners = (): ReactNode => {
  const phone = usePhone()
  const listing = useOpenerListing(!phone).data
  const terminal = useChooseOpener("terminal")
  const editor = useChooseOpener("editor")
  const openTerminal = useOpenProjectCheckout("terminal")
  const openEditor = useOpenProjectCheckout("editor")
  if (phone) return undefined
  return (
    <>
      {projectOpener("editor", listing, editor, openEditor)}
      {projectOpener("terminal", listing, terminal, openTerminal)}
    </>
  )
}

const openPalette = (): void => {
  setPaletteOpen(true)
}

/** The ⌘K press on a desk; on a phone a 44px search glyph at the header's right edge. */
const SearchDoor = (): ReactNode => {
  const phone = usePhone()
  if (phone) return <PhoneSearch onSearch={openPalette} />
  return (
    <Button
      size="sm"
      variant="quiet"
      icon={Search}
      kbd={paletteChord.hint}
      onClick={openPalette}
      aria-label="Search traks and files"
    />
  )
}

const AppChrome = (): ReactNode => {
  const phone = usePhone()
  const covered = useHostFrame()
  // Here because it needs the router and must be listening on every screen.
  useNotificationOpens()
  const name = useEngineName(phone && !covered)
  return (
    <SessionGate
      layout={covered ? "covered" : phone ? { name } : undefined}
      action={
        /* The actions slot the round drew and turned off, because nothing in this
         client could start a trak. It can now, two ways — and the gate empties the
         slot again while locked, because both are links to routes the guard refuses.
         New Chat is the quieter of the two: it opens a trak too, but one that is a
         conversation first, so it must not read as the second primary.

         Hidden below the phone breakpoint, where the top bar keeps the mark, the word
         and the search glyph: the list's dock carries both doors there, under the
         thumb, as one split pill. CSS rather than the hook because the chrome holds
         no state and the dock is the list page's own. */
        <span className="flex items-center gap-2">
          <SearchDoor />
          <span className="flex items-center gap-2 max-sm:hidden">
            <ProjectOpeners />
            <Button to="/traks/chat" size="sm" variant="quiet" icon={MessageSquare}>
              New Chat
            </Button>
            <Button to="/traks/new" size="sm" icon={Plus}>
              New Trak
            </Button>
          </span>
        </span>
      }
    >
      <EngineStream />
      <NewBuildBand />
      <Outlet />
    </SessionGate>
  )
}

export default AppChrome
