import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import type { Tone } from "../format/tone"
import { toneFill, toneInk } from "../format/tone"
import type { Shape } from "./Skeleton"
import Skeleton, { shapePad } from "./Skeleton"

/**
 * A region with nothing in it, saying why — the same shell for every reason.
 *
 * Three of the four view states in `client-style` come out of here: the first load,
 * the empty result, and the failure with no data to fall back on. They differ by a
 * tone, an icon and a sentence, and in nothing else, which is the point — a list that
 * is loading and a list that is empty follow each other within a second, and a page
 * that redraws between them reads as a flicker.
 *
 * The fourth state — a refetch that failed while data is still on screen — is
 * deliberately **not** this. The rows are still true and must not be covered or pushed
 * down, so it stays a one-line strip at its call site.
 *
 * **The message interrupts the ghosts rather than floating over them**, so the shape is
 * visibly continuing past the thing that says the region is empty. The band takes
 * `canvas` and a rule top and bottom: it is not a card, and giving it a surface would
 * make it one.
 *
 * **The graphic is the only thing that carries the tone.** Title and sentence stay in
 * the text colours, so an error is legible before it is red — and `role="alert"` rather
 * than the colour is what actually reports it.
 *
 * The action is a **slot**: this component never knows what a button does, and there is
 * nothing here that could spend money on its own. Pass one `<Button>`, or two.
 *
 * **Two of its frames move, because on those two something is coming.** The first load,
 * and `tone="working"` — the engine running a `git` or a setup script with no agent at the
 * position. Both run a segment along the band's top rule and the working one turns its
 * glyph; the still frames — nothing yet, nothing here, could not load — gain none of it,
 * because nothing is on its way to them. Motion is the only thing that says the wait is
 * still going: no elapsed count and no "longer than usual" wording, by decision.
 *
 * **A stated band always carries a sentence under its heading.** A heading on its own
 * looked awkward at every width it was tried at, so `children` is required rather than
 * optional, and a command keeps its place under the sentence.
 */

type Shared = {
  /** Which region this is filling. The ghosts and the gutter both follow it. */
  readonly shape?: Shape
}

/**
 * `loading` is required on this half and absent from the other, which is what lets
 * `"loading" in props` narrow — the same reason `Button` declares `to` this way. An
 * optional flag on both halves narrows nothing, and `title` stops resolving.
 */
type Loading = Shared & { readonly loading: true }

type Stated = Shared & {
  readonly tone?: Tone
  /** A `lucide-react` component, not a name. */
  readonly icon: LucideIcon
  readonly title: string
  /**
   * The explanation. One or two sentences — this is not a place for a paragraph, and
   * never nothing: a heading alone is the shape the two-line rule above was written
   * against.
   */
  readonly children: ReactNode
  /** Shown on its own line, set in mono on a plate: something to type or to copy. */
  readonly command?: string
  /** A `<Button>`, or two. Nothing is wired from here. */
  readonly action?: ReactNode
  /**
   * A block under the presses — what a failed start printed — at the band's full width
   * rather than the words' measure, which a log line would wrap at every few words.
   */
  readonly under?: ReactNode
}

/**
 * The band's top rule: a hairline, or — while something is coming — a 2px track with a
 * segment running it. The bottom rule stays the hairline either way.
 *
 * **The segment is `w-1/3` and `styles.css`'s `travel` keyframe ends at `300%`, and those
 * are one number** — see the token. Under `motion-reduce` nothing is missing, only
 * stopped: the track keeps its weight and the segment its colour, parked at the middle of
 * the track rather than at either end. An edge is where a cycle begins and ends, so a
 * segment resting there reads as an animation that stalled instead of one that was never
 * asked to run. `33.5%` is what centres a third.
 */
const Rule = ({ live }: { readonly live: boolean }): ReactNode =>
  live ? (
    <div aria-hidden className="relative h-0.5 overflow-hidden bg-border">
      <span className="absolute inset-y-0 w-1/3 animate-advance bg-taper text-tone-working opacity-55 motion-reduce:left-[33.5%] motion-reduce:animate-none" />
    </div>
  ) : (
    <div aria-hidden className="border-t border-border" />
  )

/**
 * The band before its words are known: a disc with nothing in it, and one heavier bar over
 * two lighter ones. Two weights rather than three bars of one, because the band it stands
 * for has two weights of word — a heading and the sentence under it — and a placeholder
 * that does not say so sets the reader up for the wrong shape.
 *
 * **The bars are percentages of a column that mirrors the stated band's** — `min-w-0
 * flex-1`, capped at the same `56ch` the words get — rather than fixed widths. Fixed
 * widths shipped first, with `max-w-full` meant to cut them down on a phone, and the cap
 * never bound: a percentage `max-width` resolves against the *containing block*, and a
 * shrink-to-fit flex item is as wide as its content, so the cap equalled the thing it was
 * capping. The band stayed 396px wide at 375 and the list scrolled sideways by the
 * difference. `Skeleton`'s `DecisionGhost` carries the same rule from the other direction.
 *
 * Percentages rather than `min-w-0` alone, because a fixed bar still contributes its
 * width to every ancestor's min-content size — a grid item or a `max-content` box above
 * it grows to fit and the overrun comes back one level up. A percentage contributes
 * nothing, so nothing above can be pushed. `phone.spec.ts` measures the list.
 */
const WordsGhost = (): ReactNode => (
  <span aria-hidden className="flex min-w-0 max-w-[56ch] flex-1 flex-col gap-3 py-1 opacity-60">
    <span className="block h-3 w-[57%] rounded-control bg-surface-2" />
    <span className="flex flex-col gap-2">
      <span className="block h-2 w-[71%] rounded-control bg-surface-2" />
      <span className="block h-2 w-[43%] rounded-control bg-surface-2" />
    </span>
  </span>
)

export default function EmptyState(props: Loading | Stated) {
  const shape = props.shape ?? "rows"
  /** Two rows of ghosts read as a list; one block reads as a turn. */
  const head = shape === "rows" ? 2 : 1

  if ("loading" in props)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* The ghosts are `aria-hidden`, so without this the state is silent. */}
        <span role="status" className="sr-only">
          Loading…
        </span>
        <Skeleton shape={shape} count={head} pulse />
        {/* The band exists before its words do, or a trak you just started runs one idiom
            for a second and a different one after the first poll lands. */}
        <div className="bg-canvas">
          <Rule live />
          <div className={`flex items-start gap-3 py-14 ${shapePad[shape]}`}>
            <span aria-hidden className="size-10 shrink-0 rounded-pill bg-surface-2 opacity-60" />
            <WordsGhost />
          </div>
          <Rule live={false} />
        </div>
        <Skeleton shape={shape} count={2} offset={head} fade pulse />
      </div>
    )

  const { tone = "neutral", icon: Icon, title, command, action, under, children } = props
  /** The one stated frame where something is on its way — the engine's own work. */
  const live = tone === "working"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Skeleton shape={shape} count={head} />
      <div
        // An alert announces itself the moment it appears, which is exactly what a
        // failure owes a reader who is not looking at the colour.
        role={tone === "bad" ? "alert" : undefined}
        className="bg-canvas"
      >
        <Rule live={live} />
        <div className={`flex items-start gap-3 py-14 ${shapePad[shape]}`}>
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-pill ${toneFill[tone]} ${toneInk[tone]}`}
          >
            {/* Every act's glyph turns, the ones with an up included — put on the panel
                as a setting and kept by looking at it. */}
            <Icon
              size={16}
              aria-hidden
              className={live ? "animate-turn motion-reduce:animate-none" : undefined}
            />
          </span>
          {/* The column takes the band's width so `under` can; the sentence keeps its own
              measure, which is what the column's cap used to give it. */}
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="max-w-[56ch] text-balance text-base text-fg-muted">{children}</p>
            {command === undefined ? null : (
              <code className="rounded-control bg-surface-2 px-2 py-1 font-mono text-sm text-fg">
                {command}
              </code>
            )}
            {action === undefined ? null : (
              // Wrapping, so two presses wider than a phone's column stack rather than widen it.
              <div className="flex flex-wrap items-center gap-2 pt-1">{action}</div>
            )}
            {under}
          </div>
        </div>
        <Rule live={false} />
      </div>
      <Skeleton shape={shape} count={2} offset={head} fade />
    </div>
  )
}
