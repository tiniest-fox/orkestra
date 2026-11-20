import type { ReactNode } from "react"

/**
 * A project still being cloned: its picture set back, inside a ring filled to how far git
 * has come — the running mark's own track, so a cloning tile reads as busy and the fill as how far.
 *
 * Fills the box it is put in, which is positioned; the sheet's row and the strip
 * each size it. The desktop rail's tile draws its own fill in its ring band instead. The
 * conic fill is computed rather than a utility because it is a figure.
 */
const CloneRing = ({
  progress,
  children,
}: {
  /** 0–100. */
  readonly progress: number
  /** The project's picture. */
  readonly children: ReactNode
}): ReactNode => (
  <span className="absolute inset-0 rounded-control text-tone-working">
    <span
      aria-hidden
      className="absolute inset-0 rounded-control"
      style={{
        background: `conic-gradient(currentColor ${String(progress * 3.6)}deg, var(--color-tone-working-track) 0deg)`,
      }}
    />
    <span className="absolute overflow-hidden rounded-control bg-surface" style={{ inset: 2 }}>
      {/* Faded over an opaque surface: faded straight over the ring, the fill shows through
          the picture and the tile reads as split rather than ringed. */}
      <span className="absolute inset-0 opacity-45 grayscale">{children}</span>
    </span>
  </span>
)

export default CloneRing
