/**
 * One view in its frame: the server's own document, sandboxed, at the height it reports,
 * with whatever Orkestra has to say about it drawn over or under.
 *
 * **`sandbox="allow-scripts"` and nothing else is the isolation.** Without
 * `allow-same-origin` the frame's origin is opaque: its script cannot read this page,
 * its storage or its cookies, and cannot call the engine. It is fed by `srcdoc` because
 * the engine and this page share an origin — a view at an address of its own would be a
 * server's script running as the app. What it may reach on the network, and that its
 * frame may go nowhere else, is written into the document by the engine — which holds
 * the server's HTML in a frame of its own inside it — and nothing here adds to it.
 *
 * **The height is the view's, up to a cap.** Past the cap the view is cut, with a press
 * over its foot that grows it in place — never a scroller inside the transcript, which
 * would trap the wheel half-way down a conversation. A view wider than the pane scrolls
 * sideways inside its own frame, and the card does not grow.
 *
 * Three states, each drawn so the view under it stays readable: a veil while the CLI a
 * press needs is starting, a band over the top where it did not start, and a dimmed
 * view with a line under it once the trak's checkout is gone and no press can land.
 */

import type { ReactNode } from "react"
import { useRef, useState } from "react"
import type { ViewDto, ViewResultDto } from "../../../../api/types"
import Button from "../../../../components/Button"
import { useViewHost } from "./useViewHost"

/** How tall a view may draw before it is cut, at a desk and on a phone. */
const CAP = 720
const CAP_PHONE = 320
/** A view's height before it has reported one — a line or two of content. */
const UNMEASURED = 120

const REMOVED =
  "This trak’s checkout is removed. The view shows its last result and its buttons send nothing."

const ViewFrame = ({
  view,
  press,
  running,
  phone,
}: {
  readonly view: ViewDto
  readonly press: (tool: string, args: unknown) => Promise<ViewResultDto>
  readonly running: boolean
  readonly phone: boolean
}): ReactNode => {
  const frame = useRef<HTMLIFrameElement>(null)
  const [all, setAll] = useState(false)
  const { height, starting, failed, loaded } = useViewHost(frame, view, press, running)
  const natural = height ?? UNMEASURED
  const cap = phone ? CAP_PHONE : CAP
  const cut = natural > cap && !all

  return (
    <div className="flex min-w-0 flex-col">
      <div className="relative min-w-0 overflow-hidden">
        {failed === undefined ? undefined : (
          <p role="alert" className="bg-tone-bad-bg px-3 py-1.5 font-mono text-xs text-tone-bad">
            {failed}
          </p>
        )}
        <div
          style={{ maxHeight: cut ? cap : undefined }}
          className={`overflow-hidden ${view.answers ? "" : "opacity-50 grayscale"}`}
        >
          <iframe
            ref={frame}
            title={`${view.server}/${view.tool}`}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={view.html}
            onLoad={loaded}
            style={{ height: natural }}
            className="block w-full border-0 bg-surface"
          />
        </div>
        {cut ? (
          <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-canvas via-canvas/90 to-transparent pt-10 pb-2">
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setAll(true)
              }}
            >
              {`Show all · ${String(natural)}px`}
            </Button>
          </div>
        ) : undefined}
        {starting ? (
          <div className="absolute inset-0 flex items-center justify-center bg-canvas/70">
            <span
              role="status"
              className="flex items-center gap-1.5 rounded-pill bg-surface px-3 py-1 font-mono text-xs text-tone-working ring-1 ring-border"
            >
              <span
                aria-hidden
                className="size-1.25 shrink-0 animate-breathe rounded-pill bg-tone-working motion-reduce:animate-none"
              />
              {`Starting ${view.cli ?? "the CLI"} to send your press`}
            </span>
          </div>
        ) : undefined}
      </div>
      {view.answers ? undefined : (
        <p className="px-3 py-1 font-mono text-xs text-fg-subtle">{REMOVED}</p>
      )}
    </div>
  )
}

export default ViewFrame
