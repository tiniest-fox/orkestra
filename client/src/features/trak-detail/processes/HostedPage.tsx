/**
 * A running process's page, in whichever of the two ways this window can draw it.
 *
 * **Inside Orkestra.app it is a box the shell's native view is laid over**, which is the
 * person's choice: no page can refuse a native view, and it has real devtools. The box holds
 * a loading state, seen only while the shell holds the view hidden for a new run's page to
 * load — and `useNativePage` keeps the view on it. **Anywhere
 * else it is an `<iframe>`**, the same pane with the browser's own frame in it. A page that
 * forbids framing draws the browser's refusal there, and Open in a browser beside the
 * address is the way past it.
 *
 * **The frame is sandboxed, and at a loopback address its page gets no origin of its own**
 * — scripts, forms, popups and dialogs run, but storage and cookies do not, which
 * `react(iframe-missing-sandbox)` holds every frame to. A page that needs them throws
 * there, and Open in a browser beside the address is the way to see it whole. Orkestra.app's
 * native view has none of this, and is the surface the frame stands in for.
 *
 * **At a host's page-domain hostname the page keeps its origin** (`ownOrigin`). Without
 * it every request the page makes counts as cross-site, so the host's `SameSite=Lax` device
 * cookie stays behind and the host refuses the page its own assets and its live-reload
 * socket. The origin it keeps is its own hostname's, never this window's, so it still
 * cannot reach into the page around it.
 *
 * `reloads` moves once per Reload press: the native view is told, and the frame is
 * remounted under a new key.
 */

import type { ReactNode } from "react"
import EmptyState from "../../../components/EmptyState"
import { useNativePage } from "./useNativePage"

const HostedPage = ({
  name,
  run,
  url,
  ownOrigin,
  reloads,
}: {
  readonly name: string
  /**
   * Which run of which process at which trak this is. The native view loads fresh when it
   * changes — a restart keeps its port, so the address alone cannot say a new run began.
   * The frame is keyed on it too, so a second press of one link loads it again.
   */
  readonly run: string
  readonly url: string
  /** The page is at its own hostname behind a host, and keeps that origin. */
  readonly ownOrigin: boolean
  readonly reloads: number
}): ReactNode => {
  const native = useNativePage(run, url, reloads)
  return native === undefined ? (
    // oxlint-disable-next-line react/iframe-missing-sandbox -- allow-same-origin only at a page-domain hostname, which is the page's own origin and never this window's
    <iframe
      key={`${run} ${String(reloads)}`}
      sandbox={`allow-scripts allow-forms allow-popups allow-modals allow-downloads${ownOrigin ? " allow-same-origin" : ""}`}
      title={`${name}'s page`}
      src={url}
      className="mb-safe-b min-h-0 w-full flex-1 border-0"
    />
  ) : (
    <div
      ref={native}
      role="region"
      aria-label={`${name}'s page`}
      className="flex min-h-0 w-full flex-1 flex-col"
    >
      <EmptyState loading shape="blocks" />
    </div>
  )
}

export default HostedPage
