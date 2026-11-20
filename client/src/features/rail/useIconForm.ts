/**
 * Whether a project's found icon is a tile or a glyph, judged in the browser by drawing it.
 *
 * **In the client, not the host.** The host would need a PNG decoder to read a pixel, and
 * could not judge an SVG at all: what an SVG paints is only known once something renders
 * it. Here the icon is already a `data:` URL, so it is drawn onto a small canvas and its
 * four corners read back — `formOfCorners` decides from those.
 *
 * **`undefined` until it is known, and wherever it cannot be.** The picture draws today's
 * treatment for that, so nothing jumps while the read is in flight and nothing breaks
 * where a canvas is refused.
 *
 * **Remembered per icon for the life of the tab.** The rail redraws every tile on each
 * poll and the same icon sits in up to three places, so the answer is kept per data URL
 * and every mount after it starts with that answer. Mounts that start before the first read
 * settles each make their own read.
 */

import { useEffect, useState } from "react"
import { formOfCorners, type IconForm } from "./tile"

/** The canvas side. Small, because only the corners are read. */
const SIDE = 16

const known = new Map<string, IconForm>()

/** Draws `src` and reads its corners, or resolves `undefined` where it cannot. */
export const readIconForm = (src: string): Promise<IconForm | undefined> =>
  new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(undefined)
      return
    }
    const image = new Image()
    image.addEventListener("error", () => {
      resolve(undefined)
    })
    image.addEventListener("load", () => {
      const board = document.createElement("canvas")
      board.width = SIDE
      board.height = SIDE
      const pen = board.getContext("2d", { willReadFrequently: true })
      if (pen === null) {
        resolve(undefined)
        return
      }
      // The explicit size scales an SVG with no width or height of its own, as clinicail's
      // has, which would otherwise draw at the browser's default of 300×150.
      pen.drawImage(image, 0, 0, SIDE, SIDE)
      let data: Uint8ClampedArray
      try {
        data = pen.getImageData(0, 0, SIDE, SIDE).data
      } catch {
        // A canvas the browser counts as tainted refuses to be read. A `data:` URL should
        // never taint one, and if one does, the answer is the same as having no canvas.
        resolve(undefined)
        return
      }
      const last = SIDE - 1
      const alphaAt = (x: number, y: number): number => data[(y * SIDE + x) * 4 + 3] ?? 0
      resolve(
        formOfCorners([alphaAt(0, 0), alphaAt(last, 0), alphaAt(0, last), alphaAt(last, last)]),
      )
    })
    image.src = src
  })

/** The icon's form, or `undefined` for no icon and while it is read. */
export const useIconForm = (
  icon: string | undefined,
  read: (src: string) => Promise<IconForm | undefined> = readIconForm,
): IconForm | undefined => {
  const [form, setForm] = useState(() => (icon === undefined ? undefined : known.get(icon)))

  useEffect(() => {
    // Guards the state write: a tile that unmounted mid-read must not be set.
    let live = true
    const cached = icon === undefined ? undefined : known.get(icon)
    setForm(cached)
    if (icon === undefined || cached !== undefined) return undefined
    const settle = async (): Promise<void> => {
      const found = await read(icon)
      if (found !== undefined) known.set(icon, found)
      if (live) setForm(found)
    }
    void settle()
    return () => {
      live = false
    }
  }, [icon, read])

  return form
}
