/**
 * Tells the shell where the pane is, so the selected project's view sits exactly on it.
 *
 * The project is the engine's own client in a native view the shell lays over this page,
 * and the shell cannot see the page's layout — so the page measures the pane and says.
 * `useNativePage`'s mechanism, one level out: the box's own size through a
 * `ResizeObserver`, the window's through its `resize` event — a zoom moves the box
 * without resizing it — read on the next frame and sent only when something moved.
 *
 * Kind `hook`: it reaches `window` and the shell's bridge.
 */

import { useEffect, useState } from "react"
import { placePane } from "../../api/rail"

export const usePane = (): ((node: HTMLElement | null) => void) => {
  const [node, setNode] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (node === null) return
    let frame = 0
    let sent = ""
    const place = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = node.getBoundingClientRect()
        const said = `${String(box.left)} ${String(box.top)} ${String(box.width)} ${String(box.height)}`
        if (said === sent) return
        sent = said
        placePane({ x: box.left, y: box.top, width: box.width, height: box.height })
      })
    }
    const resized = new ResizeObserver(place)
    resized.observe(node)
    window.addEventListener("resize", place)
    place()
    return () => {
      cancelAnimationFrame(frame)
      resized.disconnect()
      window.removeEventListener("resize", place)
    }
  }, [node])

  return setNode
}
