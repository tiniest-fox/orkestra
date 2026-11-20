/**
 * Terminal output, cut into spans this design system can draw.
 *
 * A check runs with `FORCE_COLOR` inherited, so some of what reaches the log is coloured.
 * The escapes are *translated*: the sixteen terminal colours land on the tone and ink tokens
 * `styles.css` already names, so a coloured log reads in the app's palette.
 *
 * **Class names are whole literals, never built.** Tailwind finds classes by scanning
 * source text, so a template string emits no CSS and the span renders uncoloured. That
 * is why the maps below are spelled out rather than derived from a tone name.
 */

import Anser from "anser"

/**
 * What anser hands back, as it actually arrives.
 *
 * Its own `.d.ts` types the four colour fields as `string` and does not mention
 * `isInverted` at all; at runtime an unstyled run carries `null` in all four and every
 * run carries the flag.
 */
interface Segment {
  readonly content: string
  readonly fg: string | null | undefined
  readonly bg: string | null | undefined
  readonly fg_truecolor: string | null | undefined
  readonly bg_truecolor: string | null | undefined
  readonly isInverted?: boolean
  readonly decorations: readonly string[]
}

/** One run of text with one appearance. */
export interface AnsiSpan {
  readonly text: string
  /** Whole Tailwind class names, space-joined. Empty where the run is unstyled. */
  readonly className: string
  /**
   * A literal colour, set only where an extended sequence named one outside the base
   * sixteen. Indices 0–15 route through the tone map, so only 16–255 and truecolor
   * arrive here.
   */
  readonly style?: { readonly color?: string; readonly backgroundColor?: string }
}

/**
 * The sixteen colours, as ink.
 *
 * **Bright folds onto its base tone** rather than reading as a step of its own. The two
 * exceptions are the ends of the scale, where bright is not a brighter hue but a different
 * ink: black is the darkest text and bright black is the grey a terminal writes its asides
 * in.
 *
 * **Every token here is borrowed for its ink and never for what it means**, which is worth
 * saying at `ansi-cyan`: it takes `source-human`, an indigo, while the palette's actual
 * cyan is `source-machine` — the colour that means *the engine did this*. A terminal
 * writing cyan is not saying that, so swapping it to the token whose hue matches would put
 * a meaning on a byte the program never gave one. The sixteen are inks.
 */
const INK: Readonly<Record<string, string>> = {
  "ansi-black": "text-fg",
  "ansi-red": "text-tone-bad",
  "ansi-green": "text-tone-good",
  "ansi-yellow": "text-tone-waiting",
  "ansi-blue": "text-tone-working",
  "ansi-magenta": "text-accent",
  "ansi-cyan": "text-source-human",
  "ansi-white": "text-fg-muted",
  "ansi-bright-black": "text-fg-subtle",
  "ansi-bright-red": "text-tone-bad",
  "ansi-bright-green": "text-tone-good",
  "ansi-bright-yellow": "text-tone-waiting",
  "ansi-bright-blue": "text-tone-working",
  "ansi-bright-magenta": "text-accent",
  "ansi-bright-cyan": "text-source-human",
  "ansi-bright-white": "text-fg",
}

/**
 * The same sixteen as a background — a chip, never a painted fill.
 *
 * The tone's own `-bg`, which is the tinted plate the rest of the system already uses. The
 * colours with no plate of their own take the recess.
 */
const CHIP: Readonly<Record<string, string>> = {
  "ansi-black": "bg-surface-2",
  "ansi-red": "bg-tone-bad-bg",
  "ansi-green": "bg-tone-good-bg",
  "ansi-yellow": "bg-tone-waiting-bg",
  "ansi-blue": "bg-tone-working-bg",
  "ansi-magenta": "bg-surface-2",
  "ansi-cyan": "bg-surface-2",
  "ansi-white": "bg-surface-2",
  "ansi-bright-black": "bg-surface-2",
  "ansi-bright-red": "bg-tone-bad-bg",
  "ansi-bright-green": "bg-tone-good-bg",
  "ansi-bright-yellow": "bg-tone-waiting-bg",
  "ansi-bright-blue": "bg-tone-working-bg",
  "ansi-bright-magenta": "bg-surface-2",
  "ansi-bright-cyan": "bg-surface-2",
  "ansi-bright-white": "bg-surface-2",
}

/**
 * Fourteen of the sixteen as a solid fill, which only reverse video asks for.
 *
 * `ESC[7m` after a colour means *this tone is the ground*, so the tone fills and `surface`
 * becomes the ink.
 *
 * **`ansi-white` and `ansi-bright-white` are left out on purpose, and the gap is what
 * does the work.** anser fills the terminal's own defaults for reverse video that carries
 * no colour, so a bare `ESC[7m` arrives with `ansi-white` as its ground — which is how
 * `tsc` draws the gutter of the line it quotes. Missing from this map it falls to
 * `classesFor`'s `bg-surface-2 text-fg` branch; complete the sixteen and that gutter
 * becomes a solid block instead, which `ansi.test.ts`'s reverse-video-with-no-colour
 * assertion catches.
 */
const FILL: Readonly<Record<string, string>> = {
  "ansi-black": "bg-fg",
  "ansi-red": "bg-tone-bad",
  "ansi-green": "bg-tone-good",
  "ansi-yellow": "bg-tone-waiting",
  "ansi-blue": "bg-tone-working",
  "ansi-magenta": "bg-accent",
  "ansi-cyan": "bg-source-human",
  "ansi-bright-black": "bg-fg-subtle",
  "ansi-bright-red": "bg-tone-bad",
  "ansi-bright-green": "bg-tone-good",
  "ansi-bright-yellow": "bg-tone-waiting",
  "ansi-bright-blue": "bg-tone-working",
  "ansi-bright-magenta": "bg-accent",
  "ansi-bright-cyan": "bg-source-human",
}

/**
 * What each attribute draws as.
 *
 * `dim` is 0.75 and knowingly under the contrast bar. It was measured against vitest's
 * timings, which were written green *and* dim: the opacity landed on `tone-good` and came
 * out at 3.64:1 on the white box, and 0.85 was where the last of them cleared 4.5. The
 * value was chosen with that measurement on the table — **a contrast pass must not raise
 * it without asking.**
 *
 * `blink` and `hidden` are deliberately absent: anser reports them.
 */
const ATTRIBUTE: Readonly<Record<string, string>> = {
  bold: "font-semibold",
  dim: "opacity-75",
  italic: "italic",
  underline: "underline",
  strikethrough: "line-through",
}

/** The base sixteen, in the order an extended palette indexes them. */
const PALETTE_16 = [
  "ansi-black",
  "ansi-red",
  "ansi-green",
  "ansi-yellow",
  "ansi-blue",
  "ansi-magenta",
  "ansi-cyan",
  "ansi-white",
  "ansi-bright-black",
  "ansi-bright-red",
  "ansi-bright-green",
  "ansi-bright-yellow",
  "ansi-bright-blue",
  "ansi-bright-magenta",
  "ansi-bright-cyan",
  "ansi-bright-white",
]

/** The six levels each channel of xterm's colour cube takes. */
const CUBE = [0, 95, 135, 175, 215, 255]

const level = (step: number): number => CUBE[step] ?? 0

/**
 * An xterm palette index, as either one of the sixteen or a literal colour.
 *
 * Computed rather than tabulated: 16–231 is a 6×6×6 cube and 232–255 an even grey ramp.
 */
const palette = (index: number): string => {
  const named = PALETTE_16[index]
  if (named !== undefined) return named
  if (index >= 232) {
    const grey = 8 + (index - 232) * 10
    return `rgb(${String(grey)}, ${String(grey)}, ${String(grey)})`
  }
  const n = index - 16
  return `rgb(${String(level(Math.floor(n / 36)))}, ${String(level(Math.floor(n / 6) % 6))}, ${String(level(n % 6))})`
}

/**
 * What anser called a colour, as one of the sixteen or as a literal.
 *
 * `undefined` means the run took the terminal's default, which here is whatever ink the
 * caller is standing in.
 */
const colour = (
  name: string | null | undefined,
  truecolor: string | null | undefined,
): string | undefined => {
  if (name === undefined || name === null || name === "") return undefined
  if (name === "ansi-truecolor")
    return truecolor === undefined || truecolor === null ? undefined : `rgb(${truecolor})`
  const extended = /^ansi-palette-(\d+)$/.exec(name)
  const index = extended?.[1]
  return index === undefined ? name : palette(Number(index))
}

/** A literal is anything the sixteen do not name. */
const isLiteral = (value: string): boolean => !value.startsWith("ansi-")

const styleFor = (
  ink: string | undefined,
  ground: string | undefined,
): AnsiSpan["style"] | undefined => {
  const color = ink !== undefined && isLiteral(ink) ? ink : undefined
  // A foreground and a background that resolved to the same literal draw nothing at all.
  // The ground is what goes.
  const backgroundColor =
    ground !== undefined && isLiteral(ground) && ground !== color ? ground : undefined
  if (color === undefined && backgroundColor === undefined) return undefined
  return { color, backgroundColor }
}

/**
 * The classes one run wears.
 *
 * `isInverted` means anser has already swapped the pair and filled the terminal's own
 * defaults, so reverse with no foreground of its own arrives as black-on-white.
 */
const classesFor = (
  entry: Segment,
  ink: string | undefined,
  ground: string | undefined,
): string => {
  const marks = entry.decorations.flatMap((d) => {
    const mark = ATTRIBUTE[d]
    return mark === undefined ? [] : [mark]
  })

  if (entry.isInverted === true) {
    const fill = ground === undefined ? undefined : FILL[ground]
    return [fill === undefined ? "bg-surface-2 text-fg" : `${fill} text-surface`, ...marks].join(
      " ",
    )
  }

  const chip = ground === undefined ? undefined : CHIP[ground]
  return [
    ink === undefined ? undefined : INK[ink],
    chip === undefined ? undefined : `${chip} rounded-tile px-px`,
    ...marks,
  ]
    .filter((c) => c !== undefined)
    .join(" ")
}

/**
 * The escapes anser leaves behind, taken out before it sees them.
 *
 * It reads `ESC [ … letter` and drops what it cannot draw, which covers the colour and
 * the cursor moves. It does not know the `ESC ] … BEL|ST` family — a window title, an
 * OSC-8 hyperlink — and passes those through as text. A stray `ESC` with nothing valid
 * after it goes the same way.
 */
// oxlint-disable-next-line eslint/no-control-regex -- matching control characters is the job
const OSC = /\x1B\][\S\s]*?(?:\x07|\x1B\\)/g
// oxlint-disable-next-line eslint/no-control-regex -- as above
const STRAY = /\x1B(?!\[)[@-Z\\-_]?/g

/**
 * Terminal output as spans, in order.
 *
 * A string with no escapes at all — `verify timed out after 300s.`, which the engine
 * writes itself — comes back as one unstyled span, so a caller needs no special case for
 * it. An empty string comes back as no spans.
 */
export const ansiSpans = (text: string): readonly AnsiSpan[] => {
  const segments: readonly Segment[] = Anser.ansiToJson(
    text.replaceAll(OSC, "").replaceAll(STRAY, ""),
    { use_classes: true, remove_empty: true },
  )
  return segments.map((entry) => {
    const ink = colour(entry.fg, entry.fg_truecolor)
    const ground = colour(entry.bg, entry.bg_truecolor)
    return {
      text: entry.content,
      className: classesFor(entry, ink, ground),
      style: styleFor(ink, ground),
    }
  })
}
