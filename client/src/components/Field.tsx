import type { ChangeEvent, KeyboardEvent, ReactNode } from "react"
import { useLayoutEffect, useRef } from "react"
import { useFontsStatus } from "../hooks/useFontsStatus"

/**
 * Set the box to exactly what is in it.
 *
 * Measure, then set. Collapsing it first is what makes it shrink as well as grow:
 * `scrollHeight` of an element already tall enough is its own height, so reading it
 * without clearing the last one gives a field that only ratchets upward.
 *
 * **`0px` and not `auto`, which is the whole of why this was drawing two rows.** A
 * `textarea` at `height: auto` does not shrink to its content the way a `div` does — it
 * falls back to the `rows` attribute, and nothing here sets one, so the browser's default
 * of 2 is what got measured no matter what was in it. `min-height` is what stops the
 * collapse from being visible, and it is a floor the measurement respects.
 */
const fit = (node: HTMLTextAreaElement): void => {
  node.style.height = "0px"
  // `scrollHeight` counts the content and the padding and not the border, and the box
  // is `border-box` — so setting it straight leaves the hairline eating two pixels of
  // content, and a field that is permanently scrolled by exactly one border.
  node.style.height = `${String(node.scrollHeight + node.offsetHeight - node.clientHeight)}px`
}

/**
 * Somewhere to type.
 *
 * **A region, not a recess** — an edge on the surface, the same mechanism a bar takes.
 * The alternative was tried: recessing it says *inside and subordinate to its
 * container*, which is true of the chip inside a button and false of the thing the
 * whole screen is waiting for.
 *
 * **`rounded-control`, the same radius every button takes, and never a pill.** This
 * control grows, and a pill is one shape: `9999px` on something holding three lines is a
 * lozenge whose curve runs through the first and last of them, and half the one-line
 * height only avoids that by being a number somebody has to keep in step with the height
 * it is half of. A control radius has neither problem — three lines and one line are the
 * same corners.
 *
 * **Radius is therefore not what separates a field from a quiet button**, which is
 * `components/README`'s open question 1: measure, alignment and cursor separate them, and
 * they never appear at the same width anyway. One radius across every call site — a
 * primitive with two appearances is a primitive the next caller has to choose between.
 *
 * A `textarea` rather than an `input`, always: what goes in one of these is a sentence
 * to an agent, and a control that cannot show the second line of what you typed makes
 * you write less than you meant to.
 *
 * **It grows with what is in it, and `rows` is the floor rather than the size.** Two
 * things follow from that and neither is optional. The grip goes — a handle that fights
 * the height the content just set is a control arguing with itself — and the growing is
 * done in layout rather than in an effect, because a frame painted at the old height is
 * a visible jump on every keystroke that wraps.
 *
 * **This control says nothing about the wheel, and the empty space where it used to is
 * the point.** It carried `overscroll-contain`, which was a dead spot: `contain` latches
 * a gesture to the box under the cursor whether or not that box has anywhere to go —
 * measured in Chromium against a `textarea` whose content fits exactly, and the ancestor
 * did not move by a pixel. Since a field is always exactly the height of what is in it,
 * that was every field, and a question card with four answers is mostly field.
 *
 * **Making it conditional on being capped was the wrong repair and it shipped once.**
 * Where a field sits decides what catches the gesture it hands on, and the five call sites
 * do not agree: three are inside the drawer's scrolling pane, and the two chat bars are
 * that pane's siblings — so an uncontained chat field scrolled the trak list behind the
 * drawer. `components/Drawer` draws the boundary instead, at the one edge that is true of
 * every control in it, which is why there is nothing to say here.
 *
 * **`bare` gives the edge and the ground up to a box around it, and it is the one call
 * site that may.** `ChatBar` draws the send *inside* the field's edge — one box, holding
 * the field and the one control that acts on what is typed — so the box takes the edge,
 * the ground, the focus ring and the outer inset, and the field inside it is ink on
 * nothing. *A region, not a recess* survives that: the box is the region, and it still
 * holds exactly one control. Everywhere the field stands on its own it keeps its own edge,
 * which is every other caller.
 */
const Field = ({
  id,
  value,
  onChange,
  onKeyDown,
  placeholder,
  rows = 2,
  disabled = false,
  autoFocus = false,
  bare = false,
  unzoomed = false,
  onBlur,
  label,
}: {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  readonly placeholder: string
  /** How many lines it starts at, and never shrinks below. It grows past this on its own. */
  readonly rows?: number
  readonly disabled?: boolean
  /**
   * Take the cursor on mount. For a screen whose only control is this field — the
   * New Chat drawer — where anything else would be a click before the first word.
   */
  readonly autoFocus?: boolean
  /** No edge, no ground and no ring of its own: the box around it draws all three. */
  readonly bare?: boolean
  /**
   * 16px type below the breakpoint, on the base line height. iOS zooms the page onto a
   * focused field set any smaller, which carries a card away from under the thumb that
   * opened it — the plan gate's instruction field is the caller.
   */
  readonly unzoomed?: boolean
  /** Focus left the field — where a field that opens in place closes again. */
  readonly onBlur?: () => void
  /** Names the control where nothing visible does. */
  readonly label: string
}): ReactNode => {
  const box = useRef<HTMLTextAreaElement>(null)
  const fonts = useFontsStatus()

  /**
   * Keyed on `value`, which is what changes what the box has to hold — and on the fonts,
   * which change what the same value measures. A field fitted in the fallback face before
   * the web font swapped in keeps the fallback's height, and nothing else would refit it:
   * the swap resizes no box, so the observer below never hears of it.
   */
  useLayoutEffect(() => {
    const node = box.current
    if (node === null) return
    fit(node)
  }, [value, fonts])

  /**
   * The other thing that changes what it has to hold: its own width.
   *
   * **Typing is not the only way a field gains a line, and a height measured at the old
   * width is exactly the scrollbar this component is not supposed to have.** The drawer's
   * width follows the window at every width but the band where its own 780px floor holds it
   * still, so narrowing the window re-wraps every field on screen — and a question card long
   * enough to give the pane a classic scrollbar takes that scrollbar's width out of every
   * field inside it, which is the case with four answers in it that started this.
   *
   * The observer fires on the height `fit` itself sets, so it would drive itself round
   * forever without the width guard. Width is also the only thing it is watching for:
   * height is this component's own output, never its input.
   */
  useLayoutEffect(() => {
    const node = box.current
    if (node === null) return
    let width = node.clientWidth
    const watch = new ResizeObserver(() => {
      if (node.clientWidth === width) return
      width = node.clientWidth
      fit(node)
    })
    watch.observe(node)
    return () => {
      watch.disconnect()
    }
  }, [])

  return (
    <textarea
      ref={box}
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
        onChange(event.target.value)
      }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      // `minHeight` rather than the `rows` attribute: `rows` counts lines in the font the
      // browser picks, and this one is set by the type scale. 20 is `--text-base`'s line
      // height, the padding above and below is `--spacing-field-pad` — read as a var here
      // and as `py-field-pad` below, one value on both paths, which is what lets it grow
      // to the 44px touch floor on a phone without the floor and the measurement
      // disagreeing — and **2px is the border, which the box being `border-box` means
      // this has to carry itself.** Leaving the border out is what made the floor and the
      // measurement disagree by exactly a hairline: a three-row field pinned at 76 held
      // 2px less than three rows, where a one-row field measured at 38 held exactly one.
      //
      // The height is the only thing that has to be computed here. The radius is
      // `rounded-control` below — a token, derived from nothing, with nothing to drift from.
      //
      // **A `bare` field keeps the 2px it no longer draws.** The hairline is the box's
      // there, but the height is what puts one line on the 44px touch floor below the
      // breakpoint, and the field is the thing a thumb lands on whichever of the two draws
      // the edge — `phone.spec.ts` measures it. Two pixels taller than its text is the
      // price, and it is invisible inside the box's own padding.
      style={{ minHeight: `calc(${String(rows * 20)}px + 2 * var(--spacing-field-pad) + 2px)` }}
      className={[
        // **The cap is what keeps growing from being a defect.** The bar is `shrink-0`
        // in a column with the transcript, so a pasted essay grows the field at the
        // pane's expense until there is no pane. Past it the field scrolls, which is the
        // one place a scrollbar here is right. Below the cap `overflow-y-auto` has nothing
        // to show and nothing to catch: a box with no scrollable overflow passes the wheel
        // straight up, and the drawer is what stops it.
        "block max-h-48 w-full resize-none overflow-y-auto",
        "cursor-text rounded-control py-field-pad text-base text-fg placeholder:text-fg-subtle",
        bare
          ? // Inside a box that draws the edge, the ground and the ring — see `bare`. The
            // inset is the control's own `px-2.5`, because the box's padding already stands
            // the text off the edge the way `px-4` would against a bare one.
            "border-0 bg-transparent px-2.5 outline-none"
          : [
              "border border-border bg-surface",
              // `px-4` rather than the control's `px-2.5`: it is `Button`'s own `lg` inset,
              // and `lg` is the size of the send in both chat bars — so a field on its own
              // starts its text where a button beside it would. The vertical inset is the
              // token the `minHeight` above also reads: 8px, and 11px below the phone
              // breakpoint, where one line then measures exactly the send button's 44px
              // floor.
              "px-4",
              // `Button`'s treatment at **offset 0**, where the button itself uses offset 2
              // — the one thing about the focus ring not shared with it. This control runs
              // the whole measure of a bar that is already inset, so a ring standing off it
              // eats into the gutter where an intrinsic-width button's has room. On the
              // border it thickens the edge that is already there.
              "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent",
            ].join(" "),
        "disabled:cursor-not-allowed disabled:opacity-45",
        unzoomed ? "max-sm:text-lg max-sm:leading-5" : "",
      ].join(" ")}
    />
  )
}

export default Field
