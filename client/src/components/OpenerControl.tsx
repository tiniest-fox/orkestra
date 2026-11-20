/**
 * A terminal in, or an editor on, a checkout — a trak's, or the project's from the top
 * bar — as one plate with two halves:
 * the bound app's icon as the press that opens it, its name on hover, and past a
 * hairline the chevron listing the other installed apps of that kind, where a pick
 * writes the machine's preference. It sits level with the run-mode picker beside it.
 * Each band that draws it draws it twice, once per `kind`; only the glyph the
 * fallback draws and the words in the accessible names differ between the two.
 *
 * **The press opens a window on the engine's machine**, which is why the page never
 * draws this below the phone breakpoint — the one viewer known not to be at that
 * machine — and withholds it where there is no checkout to open. The press that loses
 * that race anyway (an archive between poll and press) earns the sentence, drawn the
 * way the run-mode picker draws its refusal.
 *
 * **The plate's edge lifts for either half; only the half under the pointer fills.** The
 * enclosing edge has to outrank the seam at the one moment the two halves are being told
 * apart, or the control reads as two buttons touching — which is what it replaced. So the
 * hover edge is on the plate and the `bare` fill is on each half, and the halves are drawn
 * by hand rather than as two `Button`s: a `Button` carrying an `<img>` as its child and
 * `busy` draws the spinner *beside* the icon, reflowing the row, where here the spinner
 * takes the mark's place inside a press whose width does not depend on what is in it. The
 * weld is the one `GatePresses` draws, and `components/README` carries whether a
 * two-target group becomes a primitive.
 *
 * **The menu lists the rest, not the lot.** The bound app is already the press beside
 * it, and a pick is not real on screen until the listing re-answers with `chosen` moved
 * — so the rows are presses, not a radio group with a current member. One app installed
 * means nothing to switch to, and the pick half goes with it; the plate stays.
 *
 * **An icon the engine could not read draws the plain glyph** — absence on the wire is
 * the engine saying so — and the name still travels on hover and in the accessible
 * name, so the fallback loses nothing but the artwork.
 */

import type { ComponentType, ReactNode } from "react"
import { ChevronDown, Loader2, SquareCode, SquareTerminal, type LucideIcon } from "lucide-react"
import type { OpenerDto, OpenerKindDto } from "../api/types"
import MenuItem from "./MenuItem"
import OverflowMenu, { type TriggerProps } from "./OverflowMenu"
import type { OpenerChoosing } from "../hooks/useChooseOpener"
import type { CheckoutOpening } from "../hooks/useOpenProjectCheckout"

/** What a hand-drawn half shares with `Button`: its focus ring and its disabled face. */
const HALF =
  "flex items-center justify-center transition-colors duration-100 hover:bg-hover-bare focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"

/**
 * The pick half: the chevron that opens the list, drawn to the plate's settled width.
 * Built once per kind at module scope, because `OverflowMenu` renders its trigger as a
 * component and a closure made per render would remount it on every one.
 */
const pickNamed = (label: string): ComponentType<TriggerProps> => {
  const Pick = ({ open, toggle }: TriggerProps): ReactNode => (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={toggle}
      className={`${HALF} w-[26px] rounded-r-control text-fg-muted hover:text-fg`}
    >
      <ChevronDown size={13} aria-hidden className="shrink-0" />
    </button>
  )
  return Pick
}

/** The two ways the kinds differ on screen: the fallback glyph, and the pick half's name. */
const KIND: Readonly<
  Record<OpenerKindDto, { readonly Glyph: LucideIcon; readonly Pick: ComponentType<TriggerProps> }>
> = {
  terminal: { Glyph: SquareTerminal, Pick: pickNamed("Choose a terminal") },
  editor: { Glyph: SquareCode, Pick: pickNamed("Choose an editor") },
}

/** The app's own mark: its icon, or the kind's plain glyph where the engine read none. */
const OpenerMark = ({
  app,
  kind,
  size,
}: {
  readonly app: OpenerDto
  readonly kind: OpenerKindDto
  readonly size: number
}): ReactNode => {
  const { Glyph } = KIND[kind]
  return app.icon === undefined ? (
    // A step under the raster: a stroke glyph reads heavier than a tile at the same box.
    <Glyph size={size - 1} aria-hidden className="shrink-0 text-fg-muted" />
  ) : (
    <img src={app.icon} alt="" aria-hidden width={size} height={size} className="shrink-0" />
  )
}

const OpenerControl = ({
  kind,
  apps,
  chosen,
  choosing,
  opening,
  at,
  withheld,
}: {
  readonly kind: OpenerKindDto
  readonly apps: readonly OpenerDto[]
  /** The id a press opens right now — `OpenerListDto.chosen`. */
  readonly chosen: string | undefined
  readonly choosing: OpenerChoosing
  readonly opening: CheckoutOpening
  /** Where the press opens, as its accessible name ends: "this trak's checkout". */
  readonly at: string
  /**
   * Why the press opens nothing here, drawn disabled with this as its name and tooltip —
   * an editor on a checkout that is not on the engine's machine. The pick half stays.
   */
  readonly withheld?: string
}): ReactNode => {
  const bound = apps.find((app) => app.id === chosen)
  // `chosen` absent means the scan found nothing of this kind, so there is nothing to press.
  if (bound === undefined) return undefined
  const rest = apps.filter((app) => app.id !== bound.id)
  // Whichever hook last refused speaks; the two never refuse on the same press.
  const said = opening.said ?? choosing.said

  return (
    <>
      {/* Capped, because it sits in a band's group of controls and nothing there may grow —
          `TrakHeader` says why: the name is the only elastic thing in either row. */}
      {said !== undefined && (
        <span role="alert" className="min-w-0 max-w-56 truncate text-sm text-tone-bad">
          {said}
        </span>
      )}
      {/* `Button`'s `md` height, which is what puts it level with the picker beside it.
          **No `overflow-hidden`, though the settled design has it**: the pick half's panel
          hangs from inside the plate, and a clip here cuts it at the plate's edge — the
          scar `PieceBand` carries. Each half rounds its own outer corners instead. */}
      <span className="flex h-[30px] shrink-0 items-stretch rounded-control border border-border bg-surface transition-colors duration-100 hover:border-accent/60">
        <button
          type="button"
          title={withheld ?? bound.name}
          aria-label={
            withheld === undefined ? `Open ${bound.name} at ${at}` : `${bound.name}: ${withheld}`
          }
          // Non-submittable while opening, not merely spinning: the route runs `open` on
          // the engine's machine, and a second press is a second window.
          disabled={withheld !== undefined || opening.disabled || opening.isPending}
          onClick={opening.open}
          className={`${HALF} px-2.5 text-fg ${rest.length > 0 ? "rounded-l-control" : "rounded-control"}`}
        >
          {opening.isPending ? (
            <Loader2 size={20} aria-hidden className="shrink-0 animate-spin" />
          ) : (
            <OpenerMark app={bound} kind={kind} size={20} />
          )}
        </button>
        {rest.length > 0 && (
          <>
            <span aria-hidden className="w-px shrink-0 bg-border" />
            <OverflowMenu trigger={KIND[kind].Pick}>
              {(shut) =>
                rest.map((app) => (
                  <MenuItem
                    key={app.id}
                    disabled={choosing.disabled}
                    onClick={() => {
                      choosing.choose(app.id)
                      shut()
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      <OpenerMark app={app} kind={kind} size={16} />
                      <span className="whitespace-nowrap">{app.name}</span>
                    </span>
                  </MenuItem>
                ))
              }
            </OverflowMenu>
          </>
        )}
      </span>
    </>
  )
}

export default OpenerControl
