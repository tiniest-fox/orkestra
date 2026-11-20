// What a project window's page asked the native page view to do, checked before the shell
// acts on it. Pure, so the checks are testable without Electron; `page-view.ts` acts.

/** A rectangle in the window's own points, which is what a native view is placed in. */
export interface Placement {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const FIELDS = ["x", "y", "width", "height"] as const

/**
 * The pane's box as the page sent it, in CSS pixels, turned into the window's points.
 *
 * **Scaled by the page's zoom**: at ⌘+ a CSS pixel is more than a point, and a view
 * placed at the CSS numbers would sit up and left of its pane and fall short of its edges.
 * Rounded outward to whole points, so the view covers the pane rather than leaving a
 * hairline of it showing. Anything that is not four finite numbers, or a box with no
 * area, is `undefined` — the page can send anything, and the view then stays hidden.
 */
export const placement = (raw: unknown, zoom: number): Placement | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined
  const box: Partial<Record<(typeof FIELDS)[number], unknown>> = raw
  const [x, y, width, height] = FIELDS.map((field) => box[field])
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  )
    return undefined
  const left = Math.floor(x * zoom)
  const top = Math.floor(y * zoom)
  return {
    x: left,
    y: top,
    width: Math.ceil((x + width) * zoom) - left,
    height: Math.ceil((y + height) * zoom) - top,
  }
}
