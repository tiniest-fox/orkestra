/**
 * The `⋯` that holds what will not fit beside a control, and the panel it opens.
 *
 * **Lifted out of `trak-detail`'s finished position, which had the only one.** Its
 * docstring said one call site was not the moment to name a primitive; the header's
 * ending is the second, and `components/README`'s open question 2 was *an overflow menu
 * does not exist, and the destructive guideline above assumes one*. It uses the system's
 * own vocabulary and nothing invented: `shadow-menu` is the token declared for exactly
 * this, over a `surface` with the ordinary border and radius.
 *
 * **The panel is a slot, and the menu never knows what is in it.** A caller puts
 * `MenuItem`s in it, or a `Confirmation` in place of them, or a plain sentence at a state
 * that has nothing to offer — which is why the body is `children` rather than a list of
 * items with a shape this file would have to guess at.
 *
 * **The trigger is the `⋯` unless the caller hands it a `face`.** A readout that opens —
 * the run-mode picker names the current mode and opens the panel that changes it — is the
 * same group, the same panel and the same dismissal rules under a trigger with words on
 * it, so it is one prop here rather than a second copy of the `onBlur` below. With a face
 * the trigger is a `quiet` button carrying `icon`, the face, and a trailing chevron; `label`
 * stays its accessible name, because everything inside a `Button` is `aria-hidden`.
 *
 * **A caller that has to draw the trigger itself hands one in as `trigger`**, and keeps the
 * panel and every dismissal rule below. The opener control is the case: its trigger is
 * the pick half of a plate it shares with another press, sized and welded in a way no
 * `Button` draws, and drawing the panel beside it would be a second copy of `onBlur`. It is
 * a component rather than a render function, so a module-level one keeps its identity
 * across renders where an inline closure would remount the trigger on every one. It is
 * given `open` and `toggle`, and **owes the button its `aria-label`, `aria-expanded` and
 * `aria-haspopup`** — nothing here can reach a node it did not draw.
 *
 * **A body that wants to shut the panel on its own press is given `shut`**, by passing
 * `children` as a function of it. A picker closes on the row that was picked, where the
 * ending's item opens a confirmation in place and must not — so whether a press shuts is
 * the body's decision, and the menu hands over the one thing it cannot make itself.
 *
 * **`relative inline-flex`, not `relative` alone, and the panel hangs off `top-full`.** A
 * bare inline wrapper is one line-height tall rather than one button tall, so `top-full`
 * drops the panel back over the row the trigger sits in — which in the drawer's header
 * covers the sentence saying why a press was refused.
 *
 * **`up` hangs it off `bottom-full` instead**, for a trigger on the scroller's bottom
 * edge. The finished pane's band is always there, so a panel opening down from it opens
 * into the clipped overflow and only its top hairline shows — and opening moves no focus,
 * so nothing scrolls it into view. Opt-in, because the header's `⋯` sits at the top and
 * opens down.
 *
 * **`under` hangs it from the left edge of the nearest positioned ancestor instead of from
 * the trigger**, for a trigger that is one half of a group: the plan gate's agent and model
 * pair both open under the whole pair, so the panel starts where the group does and stays
 * on a phone from either half. The caller owes that ancestor its `relative`.
 *
 * **The body is unmounted while the panel is shut**, so anything the caller renders in it
 * that holds state starts fresh each time it opens. `onDismiss` is for the state that
 * cannot live in there — which of two bodies a caller is showing, since a panel dismissed
 * on a confirmation must reopen at the item that offered it rather than at the question.
 *
 * **No effect and no document listener *in here*.** It shuts on Escape and on focus leaving
 * the group, both of which are plain handlers on its own nodes — a click-anywhere dismissal
 * would need `window`, which is a hook's business and not a presentational component's.
 *
 * **The price of that is that Escape only works while focus is inside the group**, so the
 * body has to hold focus, and a body that unmounts the node holding it drops focus onto
 * `<body>` and takes Escape with it. Opening the panel is safe — the trigger is focused and
 * the panel is inside it — and changing what is *in* the panel is not: pressing a `MenuItem`
 * that the press itself unmounts is exactly that. `Confirmation` is the case, and it takes
 * focus onto its own press on mount for this reason. The ref and the layout effect that do
 * it are there rather than here, because this component never knows what is in its slot; a
 * body that needs focus and does not take it gets a panel Escape cannot shut.
 *
 * **Focus going *nowhere* is not focus leaving**, and telling those apart is what `onBlur`
 * below is mostly made of. Chromium fires a bubbling `focusout` with `relatedTarget: null`
 * for three different things, and the panel wants opposite answers to them: a click onto
 * non-focusable background (dismiss — this is how a menu is normally shut), a focused child
 * being *disabled* by a render, and a focused child being *unmounted* by one. The last two
 * are the group destroying its own focus, and dismissing on them would take the panel down
 * on the press that was made in it — which for `Confirmation` is the destructive press, so
 * the panel would vanish exactly when it is meant to be showing `busy` and then a refusal.
 * Measured in the same Chromium the e2e tier runs, both fire today; React does not deliver
 * either to this handler, because both are raised inside its own commit. That is a fact
 * about React's dispatch rather than a guarantee, so the rule is written down here instead
 * of relied on — see `e2e/app.spec.ts`, which presses through the panel in a real browser.
 *
 * **A press inside the group is not focus leaving either.** Safari on macOS does not focus
 * a button on a mouse press: the mousedown clears focus instead, so pressing the button
 * `Confirmation` focused fires that same `focusout` while the button is attached and
 * enabled — and dismissing on it unmounts the panel before the click lands, which is how
 * Archive came to do nothing in Safari and in a dock web app. So a mousedown anywhere in
 * the group marks a press until its mouseup, and a blur to nowhere during one is ignored.
 * Chromium focuses the pressed button and never raises it, so the browser tier cannot see
 * this; `OverflowMenu.test.tsx` replays WebKit's order instead.
 */

import type { LucideIcon } from "lucide-react"
import type { ComponentType, FocusEvent, KeyboardEvent, ReactNode } from "react"
import { useRef, useState } from "react"
import { ChevronDown, MoreHorizontal } from "lucide-react"
import Button from "./Button"

/** The trigger this component draws: the `⋯`, or a readout with a `face`. */
type Drawn = {
  /** Names the trigger. Everything inside a `Button` is `aria-hidden`, so nothing else can. */
  readonly label: string
  /** The trigger's glyph. The `⋯` unless a face wants the mark of what it reads out. */
  readonly icon?: LucideIcon
  /** Words on the trigger. Given, the trigger is a readout that opens rather than a `⋯`. */
  readonly face?: ReactNode
}

/**
 * The caller's own trigger. Declared on this half only, so `"trigger" in props` narrows —
 * `Button` says why an optional-never on the other half would not.
 */
type Handed = {
  /** Draws the trigger, given whether the panel is open and the press that toggles it. */
  readonly trigger: ComponentType<TriggerProps>
}

export interface TriggerProps {
  readonly open: boolean
  readonly toggle: () => void
}

const OverflowMenu = (
  props: (Drawn | Handed) & {
    /** The panel's body. Rendered only while it is open; a function is handed `shut`. */
    readonly children: ReactNode | ((shut: () => void) => ReactNode)
    /** The panel shut — Escape, focus leaving it, or the trigger again. */
    readonly onDismiss?: () => void
    /** Open above the trigger rather than below it — see the header. */
    readonly up?: boolean
    /** Open under the caller's group, from its left edge — see the header. */
    readonly under?: boolean
  },
): ReactNode => {
  const { children, onDismiss, up = false, under = false } = props
  const [open, setOpen] = useState(false)
  // A mouse button held down inside the group — see the header's last paragraph.
  const pressing = useRef(false)

  const shut = (): void => {
    setOpen(false)
    onDismiss?.()
  }
  const toggle = (): void => {
    if (open) shut()
    else setOpen(true)
  }

  return (
    <span
      className={under ? "inline-flex" : "relative inline-flex"}
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Escape") shut()
      }}
      onMouseDown={() => {
        pressing.current = true
      }}
      onMouseUp={() => {
        pressing.current = false
      }}
      onBlur={(event: FocusEvent<HTMLSpanElement>) => {
        // Moving between the trigger and the panel, which `relatedTarget` is the only
        // thing that can tell apart from leaving.
        if (event.currentTarget.contains(event.relatedTarget)) return
        // Focus landed on something else: it left, whatever that something is.
        if (event.relatedTarget !== null) {
          shut()
          return
        }
        // Focus landed nowhere. Either the background was clicked, or this group just
        // destroyed the node that had focus — see the third paragraph above.
        const left = event.target
        // Pressed inside the group: WebKit clearing focus at the mousedown of the click
        // that is about to land here.
        if (pressing.current) return
        // Disabled by a render: the node is still here and can no longer hold focus.
        if (left.matches(":disabled")) return
        // Unmounted by a render: it is still attached while the event is dispatched, and
        // detached by the time the commit that removed it has finished. A microtask is
        // what puts the question after the commit rather than inside it.
        queueMicrotask(() => {
          if (left.isConnected) shut()
        })
      }}
    >
      {"trigger" in props ? (
        <props.trigger open={open} toggle={toggle} />
      ) : (
        <Button
          variant={props.face === undefined ? "ghost" : "quiet"}
          size="md"
          icon={props.icon ?? MoreHorizontal}
          trailing={props.face === undefined ? undefined : ChevronDown}
          aria-label={props.label}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={toggle}
        >
          {props.face}
        </Button>
      )}
      {open && (
        <span
          role="menu"
          className={`absolute z-10 flex min-w-64 flex-col rounded-surface border border-border bg-surface p-1 shadow-menu ${
            under ? "left-0" : "right-0"
          } ${up ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {typeof children === "function" ? children(shut) : children}
        </span>
      )}
    </span>
  )
}

export default OverflowMenu
