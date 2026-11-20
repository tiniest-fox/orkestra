/**
 * atelier — the control manifest.
 *
 * Generated file. `atelier dev` rewrites it, so put nothing of your own here.
 * Designs import it by bare specifier:  import { defineControls } from 'atelier'
 *
 * A manifest is one level deep. Its root is the thing you are designing; a
 * nested object is a *scope* — a part of it that needs its own values for the
 * same knobs. Values reach the component as props and nothing else.
 */

/**
 * Injection — `inject`, the conditions (`text`, `when`, `all`/`any`/`not`), the
 * decorations (`around`, `inside`) and the tree helpers.
 *
 * Defined in the atelier package rather than here, and re-exported so a design
 * has one import. `export *` rather than a named list on purpose: this file is
 * outside tsconfig and outside the linter, so a curated list is a hand-kept
 * duplicate that would drift silently and break every host repo on a rename.
 *
 * It is also why this file no longer resolves outside `atelier dev` — the
 * specifier below is one the dev server provides. Keep `.atelier` out of the
 * host's tsconfig; `atelier init` says so, and this is the reason.
 */
export * from 'atelier/inject'

/**
 * `useTweak` — the knob a design writes to itself.
 *
 * Props are one-way: the panel decides, the design draws. That is the right
 * default and it is what makes a design comparable to the one beside it. But a
 * design with a real control *in* it — a tab strip, a segmented switch — has a
 * second way of saying the same thing, and without this the two are separate:
 * clicking the tab does nothing, or it moves local state the panel cannot see
 * and the saved handoff does not record.
 *
 *   import { defineControls, useTweak, type Props } from 'atelier'
 *
 *   export const controls = defineControls({
 *     view: { type: 'enum', options: { list: 'list', grid: 'grid' }, default: 'list' },
 *   })
 *
 *   export default function Design({ view }: Props<typeof controls>) {
 *     const setView = useTweak('view')
 *     return (
 *       <Tabs value={view} onSelect={setView}>…</Tabs>
 *     )
 *   }
 *
 * The knob stays the single source of truth — the design holds no state, the
 * panel follows the click, `--set view=grid` still reaches the same state
 * without one, and the saved JSON says what was on screen. Which is also the
 * rule for what you pass it: **the option's name, not the value it resolves
 * to.** State records `grid`; the design received whatever `grid` maps to.
 * Writing the resolved value throws rather than rendering something subtly
 * wrong.
 *
 * A scope takes a dotted path — `useTweak('solid.bg')` — one level deep, like
 * the manifest.
 *
 * Re-exported here, and resolved by `atelier dev`, for the same reason
 * injection is: one import in a design, and one module instance behind it.
 */
export * from 'atelier/tweak'

/**
 * `RemoteComponent` — a component the host's own server renders.
 *
 * For the part of a repo atelier cannot import: a Rails ViewComponent, a Phoenix
 * function component, anything whose markup only a running server can produce.
 * The design stays a React function of its props; this is the one element in
 * it whose HTML comes from elsewhere.
 *
 *   import { defineControls, RemoteComponent, type Props } from 'atelier'
 *
 *   export default function Design({ size, label }: Props<typeof controls>) {
 *     return <RemoteComponent component="Admin::ButtonComponent" props={{ size, label }} />
 *   }
 *
 * **Say what goes across.** `props` is exactly what the server receives — nothing
 * is forwarded on your behalf — so a knob the server should see is one you name
 * here, with the value the server expects. An enum whose option *names* are
 * `sm` / `md` / `lg` should map them to those same strings, because the design
 * is handed the mapped value and that is what travels.
 *
 * Every change to `props` renders again on the server, and `atelier check`
 * waits for the answer before deciding whether a knob moved anything — so a
 * parameter the server ignores is reported the way an unread prop is. It needs
 * `remoteComponent` in `.atelier/atelier.config.json`: the endpoint's `url`, the
 * `command` that starts it, and the `stylesheets` the fragment is styled by —
 * plus, for a host whose port differs per checkout, the `port` command that
 * prints it, with `{port}` written into `url` where it goes.
 *
 * Re-exported here, and resolved by `atelier dev`, for the reason `atelier/inject`
 * and `atelier/tweak` are: one module instance, because the frame waits on its
 * count of requests still in flight.
 */
export * from 'atelier/remote'

export type ControlBase = {
  /** Panel label. Defaults to a title-cased round of the key. */
  label?: string
  /** Small print under the control. */
  hint?: string
  /**
   * A *state knob*: where you were standing rather than a decision about the
   * output. Which screen a prototype is on, whether its drawer is open, which tab
   * is showing. It stays a knob so `?s=`, the saved file and `atelier shot --set`
   * can name it. What reads the flag: the panel, which draws the root ones in a
   * pane of their own and marks a scoped one in place; the copied `json`, which
   * leaves it out, because nobody implements `screen: "cart"`; and `atelier pick`,
   * which keeps it live in the settled file rather than freezing it with the
   * decisions.
   *
   * Unrelated to whether the design writes it back through `useTweak`. A
   * prototype's spine can be panel-only, and a real control in the design can
   * write an output knob.
   */
  state?: boolean
  /**
   * What has to be true elsewhere for this knob to mean anything.
   *
   *   showIcon: { type: 'toggle', default: true },
   *   iconType: { type: 'enum', options: {…}, when: { showIcon: true } },
   *
   * Unsatisfied, the knob is **not drawn**. The panel lists it at the foot of its
   * section against what it is waiting on, so a knob that has gone is still
   * findable and still says what would bring it back.
   *
   * **The key is a path, read exactly as `useTweak` reads one** — a bare key is a
   * root knob, `scope.key` is a scoped one. A knob inside a scope that depends on
   * a sibling names it in full.
   *
   * The value is compared against **state** — an option's *name*, not what it
   * resolves to. `when: { size: 'lg' }`, never `when: { size: 'text-lg' }`.
   *
   * **A list means any of them.** `when: { as: ['AsButton', 'AsLink'] }` is a knob that
   * applies under either, which is what a prop shared by two branches of a union props
   * type needs and what a single value cannot say. One value stays the common case and
   * reads better for it, so both are allowed rather than everything becoming a list.
   *
   * Every entry must hold, and a dependency whose own `when` fails counts as
   * failed, so a chain resolves to its first unmet link.
   *
   * Ask first whether it should be one control. `icon: { type: 'enum', options:
   * ['none', 'chevron', 'arrow'] }` makes the dependency impossible rather than
   * merely handled, costs a knob rather than a field, and adds no concept. It is
   * the cheaper fix where it fits, and it loses only "remember my choice while it
   * is switched off".
   */
  when?: Record<string, Primitive | Primitive[]>
}

export type RangeControl = ControlBase & {
  type: 'range'
  min: number
  max: number
  step?: number
  /**
   * Display-only: the suffix the panel shows beside the number. The component
   * receives a bare number and composes its own units — `` `${size}px` ``.
   */
  unit?: string
  default: number
}

export type Primitive = string | number | boolean

/**
 * A *fat* option — one name carrying several values that travel together:
 *
 *   face: {
 *     type: 'enum',
 *     options: {
 *       rockwell: { family: 'Rockwell, Georgia, serif', size: 34, tracking: -0.02 },
 *       xenon:    { family: "'Monaspace Xenon', monospace", size: 30, tracking: 0.01 },
 *     },
 *     default: 'rockwell',
 *   }
 *
 * The design receives the whole bundle — `face.family`, `face.size` — while
 * saved state still records `"rockwell"`. Use it where the values genuinely
 * travel together: a typeface and its optical numbers, a density and the four
 * spacings it implies. It locks what it carries, so a design that needs to nudge
 * one of them afterwards declares that override as its own knob.
 *
 * Every option of one enum must carry the same keys; `atelier shot` says so
 * otherwise, because a bundle missing one hands the design `undefined` and the
 * design draws anyway.
 */
export type Bundle = Record<string, Primitive>

/**
 * `name: value` — the name is what saved JSON records and what the panel shows,
 * the value is what the component receives.
 *
 * In a closed design space the value is a class name from the real system
 * (`{ sm: 'text-sm', lg: 'text-lg' }`), which is why it must be written out in
 * full: Tailwind's scanner cannot see a class assembled at runtime.
 */
export type EnumOption = string | Bundle
export type Options = Record<string, EnumOption>

/**
 * A colour option carries its own swatch when the value is not itself a colour.
 * The panel has no access to the host repo's theme, so `bg-brand-600` can only
 * be drawn if the design says what it looks like.
 *
 * A record here is that pair and never a bundle: colour is the one type with a
 * preview, and the design receives `value` alone. Fat options are `enum` only.
 */
export type ColorOption = string | { value: string; swatch: string }
export type ColorOptions = Record<string, ColorOption>

export type ColorControl = ControlBase & {
  type: 'color'
  /** Present → a fixed palette. Absent → a free picker. */
  options?: ColorOptions
  /**
   * With `options`, whether the palette also admits an arbitrary colour — an
   * "Other" row on the end of the list that opens the OS picker.
   *
   * Declare it only when the options resolve to colours. A palette of
   * `bg-brand-600` hands the design a class name, and an arbitrary hex reaching
   * the same prop is a broken class rather than a custom colour. The manifest
   * check objects to `free` on such a palette — `atelier shot` prints it — rather
   * than letting the design render unstyled with nothing said anywhere.
   */
  free?: boolean
  /** A colour, or — when `options` are present — one of their names. */
  default: string
}

export type EnumControl = ControlBase & {
  type: 'enum'
  options: Options
  /** One of the option names. Defaults to the first declared. */
  default?: string
}

export type ToggleControl = ControlBase & { type: 'toggle'; default: boolean }

/** The panel's text field is always two lines, growing to fit what you type. */
export type TextControl = ControlBase & {
  type: 'text'
  default: string
  placeholder?: string
}

export type Control = RangeControl | ColorControl | EnumControl | ToggleControl | TextControl

/**
 * A named part of the design. Every scope must appear in the markup as
 * `data-atelier="<name>"`, so the panel section and the thing on screen are the
 * same thing.
 */
export type Scope = Record<string, Control>

export type Controls = Record<string, Control | Scope>

/** Identity function that preserves literal types so `Props` can infer from them. */
export function defineControls<const T extends Controls>(controls: T): T {
  return controls
}

/**
 * A design's `meta` export — what the design *is*, as opposed to what it can be
 * tweaked to. The gallery is built around it: the name titles the tile, the
 * claim sits under it, and the reasoning fills the rest of the cell.
 *
 *   export const meta = defineMeta({
 *     name: 'Quiet Ledger',
 *     claim: 'One column, receipt-like',
 *     why: 'Totals are the only thing anyone checks twice, so nothing competes with them. Costs you the at-a-glance comparison a table would give.',
 *     desktopOnly: true,
 *   })
 */
export type Meta = {
  /** What the design is called — "Bureau", not "Option A". Defaults to the filename. */
  name?: string
  /** One line: the position this design takes. A headline, not a sentence. */
  claim?: string
  /** Two or three sentences arguing for it, including what it gives up. */
  why?: string
  /** Page or widget, and if a widget, how wide and on what. Defaults to a page. */
  frame?: Frame
  /** Narrowest viewport this design is meant for. Pages only. */
  minWidth?: number
  /** Shorthand for `minWidth: 1024`. */
  desktopOnly?: boolean
}

/**
 * A widget's frame: what it is, and what it is judged on.
 *
 * A page's width comes from the chrome — it gets the viewport presets, zoom and
 * fit, and no caption, because it fills its frame. A widget's width comes from
 * the design, and it gets paper, a ground, a caption and siblings on one sheet.
 * That is the whole difference; which one a design wants is a judgement about
 * what is being looked at rather than a fact about the component. Responsiveness
 * is one reason to want a page, not the definition of one.
 *
 *   export const meta = defineMeta({
 *     name: 'Gauge',
 *     claim: 'The value rides the track',
 *     why: '…',
 *     frame: { width: 296, ground: '#ffffff' },
 *   })
 *
 * The ground belongs to the *design*. A harness that picks the surface changes
 * what it is showing you: a control whose argument is pale text on white is a
 * different control on grey, and it would have been the harness that decided so.
 */
export type WidgetFrame = {
  /**
   * The width to show it at, in px. **A choice about the exhibit rather than a
   * measurement of the component** — plenty of real UI is fluid, and picking 900
   * for a row that stretches is the same kind of decision as picking its ground.
   * Nothing measures it for you: shrink-wrapping needs a two-pass measure and
   * stops meaning anything the moment a design says `width: 100%`. Defaults
   * to 360. Static, so it cannot be a knob — a part shown at three widths is
   * three specimens.
   */
  width?: number
  /** The mini canvas behind it. Omit for the themed product ground. */
  ground?: string
  /** Space between the widget and its canvas edge. Defaults to 24. */
  pad?: number
}

/**
 * How a design is sized. `'page'` is the default: it fills the viewport.
 *
 * **`'fit'` is the third answer, and it is the one that needs no number.** The
 * design is laid out at the full viewport, exactly as a page is, and only the
 * *picture* is cropped to what it actually painted. So a 64px mark comes back
 * 64px wide, a header row that fills its bar comes back at the bar's width, and
 * neither had to say so.
 *
 * That makes the width a question you answer *while looking* — the Viewport cell
 * in the gallery, `--width` on `atelier shot` — rather than one the file answers
 * in advance.
 *
 * **What it cannot do is invent a container.** A component whose width comes
 * from the pane holding it — a 316px panel row — has no width of its own to
 * measure, so the proof has to reproduce that pane, exactly as it reproduces the
 * class names its layout is keyed to. Sizing the mount `max-content` was tried
 * instead and is the wrong answer: it only ever shrinks, so every internal `1fr`
 * collapses and a 316px row came out at 241, wrapping a line that does not wrap
 * in the app.
 *
 * A specimen may not be `'fit'` any more than it may be `'page'`: the sheet lays
 * its papers out on a declared track, and a measurement arrives too late.
 *
 * The trade against `'widget'`: fit gets no paper, no ground and no caption,
 * because those belong to an exhibit and this is a measurement.
 */
export type Frame = 'page' | 'fit' | 'widget' | WidgetFrame

export function defineMeta<const T extends Meta>(meta: T): T {
  return meta
}

/**
 * Several widgets from one design — the layer below a design.
 *
 * A design's default export is one widget: one frame, one width, one ground, one
 * page of paper. A design that wants four — a field at rest, focused, in error
 * and disabled, each judged on its own ground — can draw all four inside that
 * one frame, but then it is a small *page* containing four things rather than
 * four widgets. One frame means one width and one ground, and the chrome cannot
 * lay the parts out, caption them or measure them apart.
 *
 * `specimens` makes each one its own framed thing. Export it *instead of* a
 * default export:
 *
 *   export const specimens = defineSpecimens(controls, {
 *     rest:  { claim: 'Nothing happening',   render: (v) => <Field v={v} /> },
 *     focus: { claim: 'Reaching for it',     render: (v) => <Field v={v} focus /> },
 *     error: { claim: 'With the message',    render: (v) => <Field v={v} bad /> },
 *   })
 *
 * Each gets its own iframe, its own paper and its own caption, laid out by the
 * chrome — the same machinery that lays out the round's bench, because at that
 * point they are the same thing from two sides: N designs compared, and one
 * design seen N ways.
 *
 * A specimen inherits the design's `meta.frame` unless it declares its own, so a
 * design that is 260px wide says so once.
 *
 * `controls` is passed as the first argument only to tie the props type: the
 * manifest cannot be inferred from the specimens, and passing it is cheaper than
 * writing `defineSpecimens<typeof controls>` at every call.
 */
export function defineSpecimens<const C extends Controls, const T extends SpecimensOf<C>>(
  controls: C,
  specimens: T,
): T {
  void controls
  return specimens
}

export type Specimen<C extends Controls> = {
  /** What this one is called. Defaults to a title-cased key. */
  name?: string
  /** One line: what this specimen is showing. */
  claim?: string
  /** Two or three sentences arguing for it, including what it gives up. */
  why?: string
  /**
   * Its own frame. Falls back to the design's `meta.frame`, and then to the
   * widget defaults — **a specimen is a widget.** Not because a page is too
   * big: a page takes its width from the chrome, so there is no number for the
   * sheet to lay it out at. Candidates that are whole pages want to be separate
   * designs, where each gets its own claim and its own reasoning.
   *
   * Width is a viewing condition, so a wide set is fine — the sheet wraps, and
   * specimens too wide to sit beside each other fall into a column with their
   * papers and captions intact.
   */
  frame?: 'widget' | WidgetFrame
  /**
   * The scopes belonging to this specimen alone — what the handoff carries when
   * you copy *this one* off the bench.
   *
   * Specimens change the render, never the manifest: one file is one `controls`
   * export and one saved file, so a knob only one specimen needs still sits in
   * the shared manifest and still reaches the artifact. Which of them apply
   * cannot be inferred from any render — that `framed` owns `edge` and `shadow`
   * is only knowable here.
   *
   * Most sets need none: four states of one field are drawn from the same knobs,
   * so there is nothing to attribute. Declare it when the specimens are
   * *competing* rather than co-existing.
   */
  scopes?: readonly string[]
  /** Rendered with exactly the props a default export would receive. */
  render: (props: Props<C>) => unknown
}

export type SpecimensOf<C extends Controls> = Record<string, Specimen<C>>

/**
 * An enum's props type is read off its own options, so a fat one arrives as the
 * bundle it declared — `face.size` is a number because the manifest said so.
 */
type ValueOf<C> = C extends { type: 'range' }
  ? number
  : C extends { type: 'toggle' }
    ? boolean
    : C extends { type: 'enum'; options: infer O }
      ? O[keyof O]
      : string

/**
 * The props a design receives, derived from its own manifest. A scope arrives
 * as a nested object:
 *
 *   export default function Design({ pad, solid }: Props<typeof controls>) {
 *     return <button className={`${pad} ${solid.bg}`} data-atelier="solid" />
 *   }
 */
/**
 * A knob that may decline to send its prop hands the design `undefined` for it.
 *
 * Which is the honest type: the panel can withhold it, so the design has to be able to
 * be handed nothing. Note the *rendering* omits the key rather than passing undefined —
 * see `ControlBase.optional` — but from inside the component the two are the same thing,
 * and this is the type of what it receives.
 */
type Held<C extends Control> = C extends { optional: true } ? ValueOf<C> | undefined : ValueOf<C>

export type Props<T extends Controls> = {
  [K in keyof T]: T[K] extends Control
    ? Held<T[K]>
    : { [J in keyof T[K]]: T[K][J] extends Control ? Held<T[K][J]> : never }
}

/* ------------------------------------------------------------------------- *
 * Colour arithmetic — `contrast`, `blend`, `mix`, `alpha`, `luminance`,
 * `readableOn`, and `parseHex`/`parseComputed` under them.
 *
 * Here because every round re-derives it and gets it wrong quietly. The WCAG
 * luminance formula was hand-written for `2026-08/palette-exhibit` and shipped a
 * bug — the blue channel skipped the gamma transform, so white came out at
 * luminance 19.34 instead of 1, and every ratio on the sheet was inverted. It
 * rendered. It looked plausible. Nothing failed.
 *
 * Defined in the atelier package rather than in this file, and re-exported so a
 * design has one import — the same arrangement as `atelier/inject` above, and for
 * a related but weaker reason. Those two must resolve to the module the chrome
 * itself loaded, because a second copy of the injection registry or the tweak
 * context is silently inert. Nothing here is stateful; what it cannot afford is a
 * second *implementation*. `atelier read` measures contrast over computed colours
 * and prints a number an agent acts on, so an arithmetic that disagrees with this
 * one by a rounding is a discrepancy nobody would ever find.
 *
 * `export *` for the same reason as `atelier/inject`: this file is outside
 * tsconfig and outside the linter, so a curated list is a hand-kept duplicate that
 * would drift silently.
 *
 * What is deliberately *not* in there is anything with a taste in it — no
 * `lighten`/`darken`, which mean nothing without naming a colour space and an
 * amount convention; no scale generator, because a modular scale breaks downward
 * and every mature system hand-tunes the small end, so shipping one would make the
 * generated version the path of least resistance.
 * ------------------------------------------------------------------------- */
export * from 'atelier/colour'

/**
 * The wireframe kit — `Wireframe`, `WireOverlay`, `WireSteps`, `WirePicker`,
 * `WireCheck`, `WireField`, `WireButton`, `WireBox`, `WireDevice`, plus `WireNote`
 * and `WireAsk` for annotation and the `wireOverlay`/`wireSteps`/`wirePicker`/
 * `wireNotes` manifest fragments.
 *
 * Re-exported here for the same one-import reason as the rest, and aliased by
 * `atelier dev` for a reason of its own: the components import their stylesheet,
 * and the vendored borders and font resolve relative to it.
 *
 * **A wireframe is a fidelity, not a shortcut.** Reach for it when the round's
 * question is structure, flow or hierarchy and the treatment is the control you
 * are holding still — and not when the treatment *is* the question, where a
 * detail left rough reads as the direction being wrong rather than as unfinished.
 * `references/wireframe.md` in the skill is the whole of when to use it.
 *
 * The kit is deliberately smaller than the twenty-odd parts a mature wireframe
 * tool ships, because **every part here absorbs a silent failure** — a state the
 * harness cannot see, a platform default a utility layer deleted, a specificity
 * collision. A part with no gotcha behind it is a `<div>` and some Tailwind, and
 * wrapping that trades an API every agent knows for one it does not.
 */
export * from 'atelier/wire'
