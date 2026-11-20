import type { ReactNode } from "react"

/**
 * A section of a reading surface — the trak's Trak tab and the goal's Goal tab. Its
 * header sits on a hairline running to the right edge, and is **the accent at semibold**.
 *
 * The accent is the app's one non-status colour, so spending it on five headers spends
 * the thing that means *act on this*. It won anyway: the Trak tab is the densest reading
 * surface in the drawer and the headers were the only place with room to carry
 * structure. Re-opened when the fifth section arrived and kept — a quiet fifth read as
 * a section that mattered less, and none in the accent left the hairlines carrying the
 * structure alone.
 */
const Section = ({
  label,
  note,
  children,
}: {
  readonly label: string
  readonly note?: string
  readonly children: ReactNode
}): ReactNode => (
  <section className="flex flex-col gap-2.5">
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2.5">
        <h2 className="shrink-0 font-mono text-2xs font-semibold uppercase tracking-wider text-accent">
          {label}
        </h2>
        <span className="h-px min-w-0 flex-1 bg-border" aria-hidden />
      </div>
      {note !== undefined && <span className="font-mono text-2xs text-fg-subtle">{note}</span>}
    </div>
    {children}
  </section>
)

export default Section
