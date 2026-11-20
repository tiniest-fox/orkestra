/**
 * A ```mermaid block from an agent's markdown, drawn as a diagram inside the settled
 * figure, its header band naming the diagram's type.
 *
 * **Three states, and the third is the one that matters.** Loading holds the source in the
 * figure, so the block does not jump from empty to a diagram; drawn replaces it; failed
 * keeps the source visible. A model that wrote invalid mermaid still wrote something a
 * reader wants, and a component that showed nothing would be hiding it.
 *
 * **The one `dangerouslySetInnerHTML` in the client, and it is bounded.** `Markdown`
 * escapes markup precisely because model text is untrusted, which is the right default
 * and unchanged everywhere else. Here the string is not the model's — it is SVG that
 * `mermaid.render` produced from the model's source under `securityLevel: "strict"`,
 * which encodes HTML in labels and refuses click handlers. The trust is in mermaid's
 * sanitiser, stated at `useMermaid`, not in the agent.
 *
 * **Placed, not stretched.** The drawing keeps its natural size; one wider than the figure
 * is shrunk to fit, but never below 0.8 (`fitScale`), and past that scrolls sideways. A
 * narrower one is centred. A transform leaves the layout at full size, so the box is given
 * the scaled height itself — otherwise a shrunk diagram leaves its full height behind as
 * empty space.
 *
 * **A control in the header band rather than the block itself being the press**, which is
 * how a picture opens. The block keeps its sideways scroller, and in Chromium a scrollbar
 * drag ends in a `click` on the ancestors — so a pressable block would open the view every
 * time somebody nudged a wide diagram along. The cost is that the two shapes open two
 * different ways, and it is the cheaper of the two costs.
 *
 * **In the band, never over the drawing.** A diagram wider than the figure is shrunk to its
 * full width, so a control laid over a corner covers a node or the end dot on every wide one.
 * On a phone the press keeps the 44px touch floor by growing the band, not by reaching past
 * it: the figure clips at its edge, so a target grown beyond the band would measure 44 in CSS
 * and less on glass. The band stays 22px at a desk, where the press is pulled into the
 * band's own padding.
 *
 * **Open, it fills the window where a picture does not.** It is line art with a viewBox, so
 * it is sharp at any size and a diagram too wide to read in a pane as narrow as 780px is
 * the reason the control is there at all.
 */

import type { ReactNode } from "react"
import { useLayoutEffect, useRef, useState } from "react"
import { Maximize2 } from "lucide-react"
import Button from "./Button"
import Figure from "./Figure"
import Lightbox from "./Lightbox"
import { CODE } from "./PseudoCode"
import { diagramKind, fitScale, svgWidth } from "../format/mermaid"
import { useMermaid } from "../hooks/useMermaid"

const MermaidBlock = ({ source }: { readonly source: string }): ReactNode => {
  const svg = useMermaid(source)
  const [open, setOpen] = useState(false)
  const press = useRef<HTMLButtonElement>(null)
  const room = useRef<HTMLDivElement>(null)
  const drawing = useRef<HTMLDivElement>(null)
  const [roomWidth, setRoomWidth] = useState(0)
  const [height, setHeight] = useState(0)

  // The width the drawing has to sit in, and the drawing's own height at full size. Both
  // nodes exist only once there is an SVG, so it re-runs when one arrives.
  useLayoutEffect(() => {
    const roomNode = room.current
    const drawingNode = drawing.current
    if (roomNode === null || drawingNode === null) return undefined
    const watching = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // `contentRect` is the content box: the room's padding is not room to draw in, and
        // the drawing's height is its layout size, which its transform does not change.
        if (entry.target === roomNode) setRoomWidth(entry.contentRect.width)
        else setHeight(entry.contentRect.height)
      }
    })
    watching.observe(roomNode)
    watching.observe(drawingNode)
    return () => watching.disconnect()
  }, [svg])

  const kind = diagramKind(source)
  // Loading and never-parsed draw the same thing, and it is the right thing for both.
  if (svg === undefined)
    return (
      <Figure label={kind}>
        <pre className={`${CODE} m-0`}>{source}</pre>
      </Figure>
    )

  const natural = svgWidth(svg)
  const scale = fitScale(natural, roomWidth)
  const shrunk = scale !== 1

  return (
    // The view sits beside the figure rather than in it: the figure is a size container,
    // which makes it the containing block of a `fixed` descendant — see `Lightbox`.
    <>
      <Figure
        label={kind}
        end={
          // 24px at a desk in a 16px line, pulled 4px each side into the band's 3px padding;
          // 44px on a phone, where the band grows to hold it exactly.
          <span className="-my-1 -mr-1.5 flex max-sm:-my-0.75">
            <Button
              ref={press}
              variant="ghost"
              size="sm"
              icon={Maximize2}
              aria-label="Open the diagram"
              onClick={() => {
                setOpen(true)
              }}
            />
          </span>
        }
      >
        {/* `mermaid-figure` is what the end-dot rule in `styles.css` is scoped to. */}
        <div ref={room} className="mermaid-figure min-w-0 overflow-x-auto p-2.5">
          <div
            className="mx-auto overflow-hidden"
            style={{
              width: natural > 0 ? Math.ceil(natural * scale) : undefined,
              height: shrunk && height > 0 ? Math.ceil(height * scale) : undefined,
            }}
          >
            <div
              ref={drawing}
              role="img"
              aria-label="diagram"
              className="origin-top-left leading-0 [&_svg]:max-w-none"
              style={{
                width: natural > 0 ? natural : undefined,
                transform: shrunk ? `scale(${String(scale)})` : undefined,
              }}
              // See the file comment: mermaid's output under strict, never the agent's string.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      </Figure>
      {open && (
        <Lightbox
          label="diagram"
          onClose={() => {
            setOpen(false)
            // Back onto the control that opened it — the caller's node, so the caller's job.
            press.current?.focus()
          }}
        >
          {/* The same string a second time. The two copies share mermaid's generated ids,
              which is why this is safe rather than merely tidy: an id selector matches every
              element carrying it, so the SVG's own embedded stylesheet dresses both, and a
              `url(#…)` marker reference resolves to an identical definition either way.

              `pointer-events-none` is what leaves the wash pressable underneath: a drawing
              scaled to fit letterboxes inside its own box, so without it every press on the
              dark margin around the diagram would land on the SVG and shut nothing.

              `max-w-none!` beats mermaid's own inline `max-width`, which is the natural
              width it measured — the one thing standing between a diagram and the window it
              was opened to fill.

              `mermaid-figure` carries the end-dot rule here too. */}
          <span
            role="img"
            aria-label="diagram"
            // A `span` because `Lightbox` is one — see its own comment on why.
            className="mermaid-figure pointer-events-none flex size-full items-center justify-center [&_svg]:size-full [&_svg]:max-w-none!"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </Lightbox>
      )}
    </>
  )
}

export default MermaidBlock
