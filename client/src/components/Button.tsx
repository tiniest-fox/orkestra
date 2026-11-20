import type { LucideIcon } from "lucide-react"
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react"
import { Loader2 } from "lucide-react"
import type { LinkComponentProps } from "@tanstack/react-router"
import { Link } from "@tanstack/react-router"

/**
 * One button, three elements.
 *
 * Pass `to` and it renders the router's `Link`; pass `href` and it renders an `<a>` that
 * opens another site in a new tab; pass neither and it renders a `<button>`.
 * The appearance is identical either way, because the difference is not visual — it is
 * whether the thing *does* something or *goes* somewhere, and that is a question about
 * semantics, focus order, middle-click and bookmarking rather than about styling.
 *
 * The list's row action is the case that forced this: `rowAction` returns a destination —
 * "Review", "Answer", "Reply" — worded on purpose differently from the control you press
 * once you arrive. It had grown its own outlined-amber appearance that the design system
 * never described; it is a `primary` button now, and the row's status line keeps the tone.
 *
 * Wrapping the router's `Link` rather than a bare `<a href>` keeps `to` and `params`
 * checked against the route tree — a string href would give that up and reload the app.
 * So `href` is for a page off the app alone, such as GitHub's, and never an in-app path.
 *
 * Four variants. There is no fifth: one existed — `spend`, for a button that starts a
 * real `claude` — and it drew exactly like `primary`, differing only by a cost estimate
 * nobody would trust. A variant that is another variant plus a suffix is not a variant.
 *
 * **An icon with nothing beside it is a square, and that is inferred rather than asked
 * for.** No `iconOnly` prop: a button with a glyph, no children, no `kbd` and no trailing
 * glyph is already unambiguous, and a flag beside those four would be a second way to say
 * the same thing that can disagree with them. It goes square at the size's own height and
 * draws the glyph a step heavier — see `BOX_ICON` and `ICON_ONLY`. **Pass `aria-label`**:
 * everything inside is `aria-hidden`, so nothing else can name it.
 */

export type Variant = "primary" | "quiet" | "ghost" | "danger"
export type Size = "sm" | "md" | "lg"

/* Whole literal class names, always. Tailwind finds classes by scanning source text, so
 * an assembled one (`text-${size}`) emits no CSS at all and the element renders
 * unstyled — which is why these are tables rather than interpolation. */

const BOX: Record<Size, string> = {
  sm: "h-6 gap-1 rounded-control px-2 text-sm",
  md: "h-[30px] gap-1.5 rounded-control px-3 text-base",
  lg: "h-9 gap-2 rounded-control px-4 text-lg",
}

/**
 * Icon-only: square at the size's own height, and no horizontal padding, because a glyph
 * with nothing beside it wants a box around it rather than a label's box with the label
 * taken out. The gap goes with the padding — there is nothing to hold apart.
 */
const BOX_ICON: Record<Size, string> = {
  sm: "size-6 rounded-control",
  md: "size-[30px] rounded-control",
  lg: "size-9 rounded-control",
}

/* A shortcut chip carries its own plate, so the trailing padding comes in — otherwise it
 * floats in the middle of a gap it did not ask for. */
const BOX_KBD: Record<Size, string> = { sm: "pr-1", md: "pr-1.5", lg: "pr-2" }

const LOOK: Record<Variant, string> = {
  // Hover darkens the fill rather than tinting it: a filled button has no ground to show
  // through.
  primary: "border border-transparent bg-accent text-accent-ink hover:bg-accent-hover",
  // A quiet button already has a plate, so its hover draws the *edge* and leaves the
  // plate alone — and an edge does not depend on the ground under it, which is why one
  // treatment works on the page, in a panel and in a recess with no special-casing.
  quiet: "border border-border bg-surface text-fg hover:border-accent/60",
  // The only variant with no resting surface, so its hover has to build one.
  ghost: "border border-transparent text-fg-muted hover:bg-hover-bare hover:text-fg",
  // Weight rather than hue — see `--color-destructive`. Ink · red is what a destructive
  // control looks like; it is not permission to put one beside the primary action.
  // Prefer destructive actions isolated, or in a dropdown, in secondary positions.
  danger: "border border-transparent bg-destructive text-destructive-ink hover:brightness-110",
}

/** The shortcut chip: a recess inside the button, so a plate and no border. */
const KBD_LOOK: Record<Variant, string> = {
  primary: "bg-accent-ink/20 text-accent-ink",
  quiet: "bg-surface-2 text-fg-muted",
  ghost: "bg-surface-2 text-fg-muted",
  danger: "bg-destructive-ink/20 text-destructive-ink",
}

const ICON: Record<Size, number> = { sm: 11, md: 13, lg: 16 }

/**
 * A step heavier when the glyph is alone: beside a label it is an ornament on something
 * the words already name, and by itself it is the whole of what the control says. The four
 * squares this replaced had all reached the same numbers by hand.
 */
const ICON_ONLY: Record<Size, number> = { sm: 14, md: 15, lg: 18 }

type Shared = {
  variant?: Variant
  size?: Size
  /** Leading glyph. A `lucide-react` component, not a name. */
  icon?: LucideIcon
  /** Trailing glyph — a chevron on something that opens, an arrow on something that goes. */
  trailing?: LucideIcon
  /** A shortcut, shown inset: `⌘N`. */
  kbd?: string
  block?: boolean
  children?: ReactNode
}

/**
 * `to` is declared on the link half and nowhere else, which is what lets `"to" in props`
 * narrow the union. Declaring it as `to?: never` on this half reads like it would do the
 * same and does not: an optional-never is still present on both, so nothing narrows and
 * every link-only prop leaks into the button branch.
 */
type AsButton = Shared & {
  /** Swaps the leading glyph for a spinner and makes the button non-submittable. */
  busy?: boolean
  /**
   * The element itself — the only prop here that is not about appearance. It has to be
   * declared: `ButtonHTMLAttributes` carries no `ref` (`ClassAttributes` does, and these
   * props are not one), and without it a caller wanting the node writes its own `<button>`
   * and the appearance leaves the system. It reaches the element through `...rest`, which
   * React 19 reads as the ref. `Confirmation` is the caller — it moves focus onto its own
   * destructive press as the panel opens.
   */
  ref?: Ref<HTMLButtonElement>
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">

/**
 * `to` is **required** here, and that is load-bearing rather than tidy: `in` narrowing
 * only works in both directions when the property is optional on neither side. Left
 * optional — which is how the router declares it — `"to" in props` narrows the link
 * branch and leaves the button branch as the whole union, so `busy` and `type` stop
 * resolving. A link with no destination is meaningless anyway.
 */
type AsLink = Shared &
  Omit<LinkComponentProps, "className" | "children"> & {
    to: NonNullable<LinkComponentProps["to"]>
  }

/**
 * A page off the app, opened in a new tab: the tab holding the app is the one a person comes
 * back to, and `noreferrer` keeps this machine's address from the other site.
 */
type AsAnchor = Shared & {
  href: string
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href" | "target">

/** What reaches the element: every prop but the appearance's own. */
const elementProps = <P extends Shared>({
  variant: _v,
  size: _s,
  icon: _i,
  trailing: _t,
  kbd: _k,
  block: _b,
  children: _c,
  ...rest
}: P): Omit<P, keyof Shared> => rest

export default function Button(props: AsButton | AsLink | AsAnchor) {
  const {
    variant = "primary",
    size = "md",
    icon: Icon,
    trailing: Trailing,
    kbd,
    block = false,
    children,
  } = props

  const busy = !("to" in props) && !("href" in props) && props.busy === true
  const Glyph = busy ? Loader2 : Icon

  /**
   * A glyph and nothing else. **`aria-label` is then the only thing naming this control**,
   * and there is no fallback to give it: everything inside is `aria-hidden`, so a caller
   * that omits it ships a button a screen reader can only call *button*.
   */
  const alone =
    Glyph !== undefined && children === undefined && kbd === undefined && Trailing === undefined

  const className = [
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium no-underline",
    /* The touch floor: 44px minimum below the phone breakpoint for anything that acts,
       and a minimum rather than a size — a control already past it keeps its height.
       `min-*` beats the fixed `h-*`/`size-*` in the size tables, which is the whole
       mechanism. An icon-only button takes the floor on both axes or it would stretch
       out of square. */
    alone ? "max-sm:min-h-11 max-sm:min-w-11" : "max-sm:min-h-11",
    "transition-[background-color,border-color,color] duration-100",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-border",
    alone ? BOX_ICON[size] : BOX[size],
    kbd === undefined ? "" : BOX_KBD[size],
    LOOK[variant],
    block ? "flex w-full" : "",
  ].join(" ")

  const inner = (
    <>
      {Glyph === undefined ? null : (
        <Glyph
          size={alone ? ICON_ONLY[size] : ICON[size]}
          aria-hidden
          className={busy ? "animate-spin" : undefined}
        />
      )}
      {children}
      {kbd === undefined ? null : (
        <span
          className={`ml-1 rounded-control px-1.5 py-0.5 font-mono text-2xs ${KBD_LOOK[variant]}`}
        >
          {kbd}
        </span>
      )}
      {Trailing === undefined ? null : <Trailing size={ICON[size]} aria-hidden />}
    </>
  )

  if ("to" in props) {
    return (
      <Link className={className} {...elementProps(props)}>
        {inner}
      </Link>
    )
  }

  if ("href" in props) {
    return (
      <a className={className} target="_blank" rel="noreferrer" {...elementProps(props)}>
        {inner}
      </a>
    )
  }

  const {
    variant: _v,
    size: _s,
    icon: _i,
    trailing: _t,
    kbd: _k,
    block: _b,
    children: _c,
    busy: _busy,
    disabled,
    // `button`, not the HTML default. A `<button>` with no type inside a `<form>` submits
    // it, so a generic component that omits this turns every button in a form into a
    // submit — silently, and only when someone puts one there. Forms pass `type="submit"`.
    type = "button",
    ...rest
  } = props

  return (
    <button
      type={type}
      // `disabled` rather than a spinner alone: the server cannot tell a deliberate click
      // from a double one, and an action here spends real money.
      disabled={disabled === true || busy}
      className={className}
      {...rest}
    >
      {inner}
    </button>
  )
}
