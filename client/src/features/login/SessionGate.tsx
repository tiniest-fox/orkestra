/**
 * The door the whole app is behind, and the bar above it.
 *
 * The bar is on screen at every route and the login keeps it, with the form under the
 * bar, so the gate draws it, and decides what its slot holds
 * and what goes under it. Three states, and the order they are checked in is the point:
 *
 *   · **not yet known** — the bar with its slot empty, and nothing under it. The first
 *     answer arrives within a frame on a loopback engine, and a list that drew and was
 *     then replaced by a login would be a flicker at every cold load on a phone;
 *   · **refused** — the bar with its slot empty, and the login under it. The slot's one
 *     occupant is a link to a route the guard refuses. The children are not drawn, so
 *     the stream among them is not mounted — an `EventSource` answered 401 closes for
 *     good;
 *   · **in, or could not ask** — the slot filled, and the children. An engine that cannot
 *     be reached is every screen's own failure to draw, in the words it already has for
 *     it; the gate must not turn *I could not tell* into a login screen that no
 *     passphrase can get past.
 *
 * Kind `gate` in `client-style`'s admission table: one feature's hooks and views, the
 * bar, and nothing about a trak. It sits under the router rather than around it because
 * the slot holds a `Link`.
 */

import type { ReactNode } from "react"
import AppBar from "../../components/AppBar"
import type { BarLayout } from "../../components/AppBar"
import LoginView from "./LoginView"
import { useLogin } from "./useLogin"
import { useSession } from "./useSession"

const SessionGate = ({
  action,
  layout,
  children,
}: {
  /** What the bar's slot holds once this browser is in. Empty until then. */
  readonly action: ReactNode
  /** Which bar to draw other than the desk's; absent for the desk's. */
  readonly layout?: BarLayout | undefined
  readonly children: ReactNode
}): ReactNode => {
  const session = useSession()
  const login = useLogin()
  const unknown = session.data === undefined && !session.isError
  const refused = session.data === false

  let under: ReactNode
  if (refused)
    under = (
      <LoginView
        onSubmit={login.submit}
        busy={login.isPending}
        disabled={login.disabled}
        problem={login.problem}
      />
    )
  else if (!unknown) under = children

  return (
    <>
      <AppBar action={unknown || refused ? undefined : action} layout={layout} />
      {under}
    </>
  )
}

export default SessionGate
