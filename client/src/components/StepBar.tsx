/**
 * The drawer's whole navigator: where you are, how to move, and the way up.
 *
 * **The arrows stay, beside a rail that can also be pressed, and that redundancy is the
 * decision.** The arrows look vestigial once every position is on screen as its own
 * press, but a piece's tile in the rail is 14px, far under a comfortable target, so a
 * rail that was the *only* way to move would make stepping through a spawn harder. The
 * two do different jobs. **The rail is for seeing where you are; the arrows are for
 * stepping.** Neither is a worse copy of the other.
 *
 * **One fixed layout at both altitudes.** A wide segment for the position and one for each
 * of the trak's surfaces — flush and ruled, with only the lit one changing when the altitude
 * does. **Do not rebuild it per level** — tabs that cross from right to left and a position
 * counter that vanishes are a layout change dressed as a state change, and read as the app
 * flinching. Every segment holds its rect to 0.0px across the switch.
 *
 * **One bar for a trak with a map behind it and one without.** The New Trak drawer and the
 * detail page's cold open draw the same three segments, `disabled`, so that nothing moves
 * when the map arrives — where a second, inert copy of this geometry drifted from it
 * instead. It lives in `components/` because both features draw it and neither may import
 * the other, which is the rule that already moved `ChatBar` here.
 *
 * **`mark` is a slot, which is what let the bar leave the feature.** What a position looks
 * like is `StepMark`'s job and it reads a `StepStatus` and a `MapRow` — two types this
 * cannot see from here. So the caller hands in the plate, and a bar with nothing behind it
 * takes the default: a compose entry that has not run.
 *
 * **The position segment names what runs it and then says what it is** — the same two facts
 * the map's rows carry, on one line. The caption alone was the earlier decision, on the
 * grounds that the composer's sentence answers *what is this* better than an agent's name
 * does; what it left out is *whose turn am I reading*, which is the question a reader deep
 * in a transcript actually has, and the map is a surface away.
 */

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight, FileText, GitBranch, GitCompare, ListTree } from "lucide-react"
import Button from "./Button"
import Marker from "./Marker"
import Plate from "./Plate"
import Tab from "./Tab"
import TabBar from "./TabBar"

/** Which surface the drawer is showing. `step` is the agent's own turns. */
export type Level = "step" | "map" | "trak" | "changes"

const SURFACES: readonly {
  readonly key: Level
  readonly label: string
  readonly glyph: LucideIcon
}[] = [
  { key: "map", label: "Map", glyph: GitBranch },
  { key: "trak", label: "Trak", glyph: FileText },
  // Last of the three, and beside them rather than among the position's controls: what the
  // work did to the files is a fact about the trak, like its map and its details, not about
  // the row a reader is standing on. Which slice of it is the picker's question, one line
  // further down.
  { key: "changes", label: "Changes", glyph: GitCompare },
]

const StepBar = ({
  level,
  name,
  caption,
  mark,
  place,
  prev,
  next,
  onLevel,
  onStep,
  disabled = false,
}: {
  readonly level: Level
  /**
   * What runs the position — the agent's name, or what the row is where it is not one
   * agent's turn: `composer`, `5 pieces`, the ending's own word. The map row's `title`,
   * straight across, so the bar and the map name a position identically.
   *
   * Absent on a bar with nothing behind it, which is the New Trak drawer and the cold
   * open: neither knows a position, and a stand-in would be naming one.
   */
  readonly name?: string
  /** The composer's own sentence for the position — what it is *for*, where `name` is what
   *  runs it. */
  readonly caption: string | undefined
  /** The position's plate. Defaults to the mark for an entry that has not run. */
  readonly mark?: ReactNode
  /**
   * Where the position's newest turn ran, at the segment's end — `PlacePill`, a slot for
   * `mark`'s reason. Absent, or drawing nothing, for work on the engine's own host.
   */
  readonly place?: ReactNode
  /** The rows either side, `undefined` at the ends. The map decides what is adjacent. */
  readonly prev?: string
  readonly next?: string
  readonly onLevel?: (to: Level) => void
  readonly onStep?: (to: string) => void
  /** Nothing behind the bar yet: the shape is drawn and none of it can be pressed. */
  readonly disabled?: boolean
}): ReactNode => (
  <TabBar label="Trak navigator">
    <div
      className={`relative flex min-w-0 flex-1 items-center gap-1 pl-1 pr-2 transition-colors ${
        disabled ? "" : "hover:bg-hover-row"
      } ${level === "step" ? "text-fg" : "text-fg-muted"}`}
    >
      {level === "step" && <Marker />}

      {/* The arrows stay live at every altitude: stepping while you are on the map moves
          the position this segment names — the map draws no *you are here* mark and the
          rail is slid out beside it, so this segment is the one thing saying where a
          reader stands. Beside the label rather than inside it, because a button inside a
          button is not markup.

          No arithmetic: the rows are not a contiguous range once the composer's runs sit
          among them, so what is adjacent is the map's to say and not this one's. */}
      <span className="flex shrink-0 items-center">
        {[
          { Glyph: ChevronLeft, to: prev, label: "Previous step" },
          { Glyph: ChevronRight, to: next, label: "Next step" },
        ].map(({ Glyph, to, label }) => (
          <Button
            key={label}
            variant="ghost"
            size="sm"
            icon={Glyph}
            aria-label={label}
            disabled={disabled || to === undefined}
            onClick={() => {
              if (to !== undefined) onStep?.(to)
            }}
          />
        ))}
      </span>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onLevel?.("step")}
        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
      >
        {/* **No position counter.** It read `step 0 of 6`, which is two facts fighting: a
            step's number is the engine's own and 0-based, and *of N* is an ordinal, so the
            first of six read as the zeroth. Neither spelling was worth the room — the mark
            says how this position is going, the name says what runs it and the caption says
            what it is for, which is what a reader came for. Counting is the map's job. */}
        {mark ?? (
          <Plate tone="neutral">
            <ListTree size={14} aria-hidden />
          </Plate>
        )}
        {/* Weight against the caption's grey, with no dash or rule between them: the two
            are the map row's two lines flattened onto one, and there they are told apart by
            exactly this difference and nothing else.

            **No colour of its own, so it takes the segment's** — which is what keeps *lit
            is ink* true of the one thing in here that inherits it. Full ink on an unlit
            segment would be the bar saying you are on the step surface when you are on the
            map.

            **Shrinkable, and the caption's `flex-1` is what makes it shrink last.** A
            `basis: 0` sibling takes no share of a negative free space, so the name keeps
            its full measure until it alone is wider than the segment — which is the right
            way round: an agent's name is a slug and a caption is a sentence. */}
        {name !== undefined && <span className="min-w-0 truncate text-sm font-medium">{name}</span>}
        {caption !== undefined && (
          <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{caption}</span>
        )}
      </button>
      {place}
    </div>

    {SURFACES.map(({ key, label, glyph }) => (
      <Tab
        key={key}
        label={label}
        icon={glyph}
        current={level === key}
        disabled={disabled}
        onClick={() => onLevel?.(key)}
      />
    ))}
  </TabBar>
)

export default StepBar
