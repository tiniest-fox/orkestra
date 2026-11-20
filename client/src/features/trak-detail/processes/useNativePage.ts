/**
 * Orkestra.app's native page view, kept over one box on the page — or `undefined` outside
 * the app, where the caller draws an `<iframe>` instead.
 *
 * **The view is drawn by the shell above every element of the window**, so the page has to
 * tell it three things, and this hook is all of them:
 *
 * - **Where the box is.** The box's own size changes reach it through a `ResizeObserver`,
 *   and the window's through its `resize` event; both are read on the next frame and sent
 *   only when something moved, so a drag is one message a frame rather than one an event.
 * - **When to get out of the way.** A menu, a sheet or a dialog of the page's own drawn
 *   where the view is would open *underneath* it. Every overlay this client draws carries
 *   `role="dialog"` or `role="menu"`, so the hook watches the document for one and hides the
 *   view while any of them overlaps the box. One that opens elsewhere leaves it showing.
 * - **When it is gone.** Unmounting hides it — switching to the Log view, shutting the
 *   panel, leaving the trak — because nothing else on the page knows the view is there.
 *
 * Kind `hook`: it reaches `window`, the document and the shell's bridge, which no
 * presentational file may.
 */

import { useEffect, useRef, useState } from "react"
import { pageBridge } from "../../../api/page"

/** The page's own overlays — each one is drawn with one of these roles. */
const OVERLAY = '[role="dialog"], [role="menu"]'

const overlaps = (a: DOMRect, b: DOMRect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** Whether any overlay of the page's own is drawn over `box`. */
const covered = (box: DOMRect): boolean =>
  [...document.querySelectorAll(OVERLAY)].some((node) =>
    overlaps(box, node.getBoundingClientRect()),
  )

export const useNativePage = (
  /** The run being shown — a new one makes the shell load the page fresh. */
  run: string,
  url: string,
  /** Moves once per Reload press; the view reloads when it does. */
  reloads: number,
): ((node: HTMLElement | null) => void) | undefined => {
  const bridge = pageBridge()
  const [node, setNode] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (bridge === undefined || node === null) return
    let frame = 0
    let sent = ""
    const place = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = node.getBoundingClientRect()
        const said = covered(box)
          ? "hidden"
          : `${run} ${url} ${String(box.left)} ${String(box.top)} ${String(box.width)} ${String(box.height)}`
        if (said === sent) return
        sent = said
        if (said === "hidden") bridge.hide()
        else
          bridge.show(run, url, { x: box.left, y: box.top, width: box.width, height: box.height })
      })
    }
    const resized = new ResizeObserver(place)
    resized.observe(node)
    const overlays = new MutationObserver(place)
    overlays.observe(document.body, { childList: true, subtree: true })
    window.addEventListener("resize", place)
    place()
    return () => {
      cancelAnimationFrame(frame)
      resized.disconnect()
      overlays.disconnect()
      window.removeEventListener("resize", place)
      bridge.hide()
    }
  }, [bridge, node, run, url])

  // The count it mounted at is not a press: a view that comes back after a reload must not
  // reload again.
  const seen = useRef(reloads)
  useEffect(() => {
    if (reloads === seen.current) return
    seen.current = reloads
    bridge?.reload()
  }, [bridge, reloads])

  return bridge === undefined ? undefined : setNode
}
