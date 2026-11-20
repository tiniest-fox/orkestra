/**
 * The images a person sent to a trak, as thumbnails in a right-aligned row just above
 * their bubble rather than inside it, so the words keep the bubble's whole width.
 *
 * Drawn out of the trak's checkout through the page's own image route, where the engine
 * placed each file. A checkout that has gone answers 404, and the browser draws the alt
 * text — the file's name — in the thumbnail's place.
 */

import type { ReactNode } from "react"
import type { AttachmentDto } from "../../../../api/types"
import type { ResolveImage } from "../../../../components/Markdown"

const SentThumbs = ({
  images,
  resolve,
}: {
  readonly images: readonly AttachmentDto[]
  readonly resolve: ResolveImage
}): ReactNode => (
  <ul aria-label="Sent images" className="flex flex-wrap justify-end gap-1.5">
    {images.map((f) => (
      <li key={f.path}>
        <img
          src={resolve(f.path)}
          alt={f.name}
          className="h-22.5 w-36 rounded-control border border-border object-cover text-2xs text-fg-subtle max-sm:h-18.75 max-sm:w-30"
        />
      </li>
    ))}
  </ul>
)

export default SentThumbs
