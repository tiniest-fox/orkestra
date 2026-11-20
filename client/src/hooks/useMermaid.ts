/**
 * A mermaid diagram, rendered to SVG in the client's own colours and type.
 *
 * **Loaded on demand and never at startup.** `mermaid` bundles to roughly 800kB gzipped
 * against a client that is otherwise 229kB, and most documents contain no diagram at all
 * — so the `import()` below is deliberate and must stay dynamic. A static import moves
 * that weight onto every page load to draw nothing.
 *
 * **`securityLevel: "strict"` is the sanitiser, and it is set explicitly rather than
 * inherited.** The source is a string a model wrote, and this is the one place in the
 * client where such a string becomes markup. Strict encodes HTML in labels and refuses
 * click handlers; it is also mermaid's default, which is exactly why it is written out
 * here — a default silently relaxed by a future version would be invisible.
 *
 * **A parse failure is an ordinary result, not an error to swallow.** Models write
 * invalid mermaid, and the useful answer is the source itself, so `failed` is reported
 * and `MermaidBlock` draws the text. Returning nothing would erase what was written.
 *
 * **The look is mermaid's `base` theme with its variables set to the client's tokens**, and
 * the spacing below, so a diagram reads as part of the page rather than mermaid's default.
 * Flowcharts and state diagrams are turned to run left to right before they are drawn.
 */

import type { Mermaid, MermaidConfig } from "mermaid"
import { useEffect, useState } from "react"
import { sideways } from "../format/mermaid"

/** Distinct per render call — mermaid keys its scratch DOM by it and collides on a repeat. */
let seq = 0

const dark = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches

const TOKENS = ["canvas", "surface", "fg", "fg-muted", "fg-subtle", "guide", "accent"] as const
type Palette = Readonly<Record<(typeof TOKENS)[number], string>>

/** Where the tokens cannot be painted — a test environment. Neutral, never the brand. */
const FALLBACK: { readonly light: Palette; readonly dark: Palette } = {
  light: {
    canvas: "#ffffff",
    surface: "#ffffff",
    fg: "#111111",
    "fg-muted": "#444444",
    "fg-subtle": "#666666",
    guide: "#dddddd",
    accent: "#666666",
  },
  dark: {
    canvas: "#111111",
    surface: "#1c1c1c",
    fg: "#eeeeee",
    "fg-muted": "#bbbbbb",
    "fg-subtle": "#999999",
    guide: "#333333",
    accent: "#999999",
  },
}

const hex = (n: number): string => n.toString(16).padStart(2, "0")

/**
 * The tokens as solid hex, or `undefined` where nothing can paint them.
 *
 * Mermaid parses colours itself and reads hex, rgb and hsl only — and `--color-guide` is a
 * translucent `color-mix`, which it can neither parse nor composite. So each token is
 * painted over the canvas on a 1×1 canvas and read back, which is the colour it is on
 * screen inside a figure, whose ground is the canvas.
 */
const solidify = (): Palette | undefined => {
  if (typeof document === "undefined") return undefined
  const board = document.createElement("canvas")
  board.width = 1
  board.height = 1
  const pen = board.getContext("2d", { willReadFrequently: true })
  if (pen === null) return undefined
  const probe = document.createElement("span")
  document.body.append(probe)
  const resolved = (token: string): string => {
    probe.style.color = `var(--color-${token})`
    return getComputedStyle(probe).color
  }
  const ground = resolved("canvas")
  const paint = (token: string): string => {
    for (const fill of ["#ffffff", ground, resolved(token)]) {
      pen.fillStyle = fill
      pen.fillRect(0, 0, 1, 1)
    }
    const [r = 0, g = 0, b = 0] = pen.getImageData(0, 0, 1, 1).data
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }
  const palette = Object.fromEntries(TOKENS.map((token) => [token, paint(token)]))
  probe.remove()
  return { ...FALLBACK.light, ...palette }
}

/** `--font-sans`, so the diagrams follow the stack the stylesheet names. */
const sans = (): string => {
  const stack = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim()
  return stack === "" ? '"IBM Plex Sans", system-ui, sans-serif' : stack
}

/** The figure's measure: `--text-sm`, 11px. Mermaid takes a number, so it is written here. */
const SIZE = 11

/**
 * Every theme variable mermaid reads for flowcharts, state and sequence diagrams.
 *
 * Nodes stand on `surface`, lines are `guide`, ink is `fg`, and every edge, arrowhead and
 * start dot is `accent` — the arrows carry the emphasis. `stateBorder` stays `guide`
 * although mermaid 11 also fills the end state's inner disc from it: the disc is turned to
 * `accent` by the one rule in `styles.css` instead, because no variable reaches it alone.
 */
const themeFor = (p: Palette, isDark: boolean, font: string): Record<string, unknown> => ({
  darkMode: isDark,
  fontFamily: font,
  fontSize: `${String(SIZE)}px`,
  strokeWidth: 1,
  background: p.canvas,
  primaryColor: p.surface,
  secondaryColor: p.canvas,
  tertiaryColor: p.canvas,
  mainBkg: p.surface,
  nodeBkg: p.surface,
  clusterBkg: p.canvas,
  edgeLabelBackground: p.canvas,
  labelBackgroundColor: p.canvas,
  stateBkg: p.surface,
  compositeBackground: p.canvas,
  compositeTitleBackground: p.surface,
  altBackground: p.canvas,
  actorBkg: p.surface,
  labelBoxBkgColor: p.surface,
  noteBkgColor: p.surface,
  activationBkgColor: p.canvas,
  primaryBorderColor: p.guide,
  secondaryBorderColor: p.guide,
  tertiaryBorderColor: p.guide,
  nodeBorder: p.guide,
  stateBorder: p.guide,
  clusterBorder: p.guide,
  compositeBorder: p.guide,
  actorBorder: p.guide,
  actorLineColor: p.guide,
  labelBoxBorderColor: p.guide,
  noteBorderColor: p.guide,
  activationBorderColor: p.guide,
  lineColor: p.accent,
  defaultLinkColor: p.accent,
  arrowheadColor: p.accent,
  transitionColor: p.accent,
  innerEndBackground: p.accent,
  specialStateColor: p.accent,
  signalColor: p.accent,
  primaryTextColor: p.fg,
  secondaryTextColor: p.fg,
  tertiaryTextColor: p.fg,
  textColor: p.fg,
  nodeTextColor: p.fg,
  titleColor: p["fg-subtle"],
  actorTextColor: p.fg,
  labelTextColor: p.fg,
  loopTextColor: p["fg-muted"],
  noteTextColor: p["fg-muted"],
  stateLabelColor: p.fg,
  transitionLabelColor: p.fg,
  signalTextColor: p.fg,
  sequenceNumberColor: p.canvas,
})

/**
 * The whole configuration for one colour scheme.
 *
 * `useMaxWidth: false` on every type: the SVG keeps its natural size, and `MermaidBlock`
 * decides how far to shrink it. Both font sizes are set, and they are not redundant — the
 * top-level key governs layout measurement, while labels take their size from the theme
 * variable, so setting only the first sizes the boxes for text drawn at another size.
 */
const configFor = (isDark: boolean): MermaidConfig => {
  const font = sans()
  const palette = solidify() ?? (isDark ? FALLBACK.dark : FALLBACK.light)
  return {
    startOnLoad: false,
    securityLevel: "strict",
    // Without it a parse failure draws mermaid's full-width bomb diagram into a scratch
    // element on `document.body` and throws before removing it — outside the React root,
    // so nothing ever unmounts it and every bad diagram stacks one more under the app.
    suppressErrorRendering: true,
    theme: "base",
    look: "classic",
    fontFamily: font,
    fontSize: SIZE,
    themeVariables: themeFor(palette, isDark, font),
    flowchart: {
      useMaxWidth: false,
      htmlLabels: true,
      curve: "basis",
      nodeSpacing: 32,
      rankSpacing: 32,
      padding: 10,
      diagramPadding: 4,
      wrappingWidth: 180,
    },
    state: { useMaxWidth: false, nodeSpacing: 32, rankSpacing: 32, padding: 4 },
    sequence: {
      useMaxWidth: false,
      diagramMarginX: 4,
      diagramMarginY: 4,
      actorMargin: 32,
      width: 80,
      height: Math.round(SIZE * 2.6),
      boxMargin: 8,
      noteMargin: 8,
      messageMargin: 32,
      mirrorActors: false,
      wrap: false,
      actorFontSize: SIZE,
      messageFontSize: SIZE,
      noteFontSize: SIZE,
      actorFontFamily: font,
      messageFontFamily: font,
      noteFontFamily: font,
    },
  }
}

/**
 * Resolved once for the life of the tab and shared by every block.
 *
 * Two callers racing the first `import()` would otherwise each load it; holding the
 * promise makes the second caller await the first's work.
 */
let loading: Promise<Mermaid> | undefined

/** The scheme `initialize` was last called for; `undefined` before the first call. */
let initialised: boolean | undefined

/**
 * Mermaid, configured for the colour scheme in force now.
 *
 * `initialize` is global rather than per-render, so the scheme is checked at every draw
 * and mermaid re-initialised only when it differs from the last. The cost of that being
 * global: a diagram already on screen keeps the colours it was drawn in when the scheme
 * flips, until something draws it again — a new source, or the block remounting. Redrawing
 * every diagram on a flip would mean each block subscribing to the media query, for a
 * change that happens a couple of times a day.
 */
const load = async (): Promise<Mermaid> => {
  loading ??= import("mermaid").then(({ default: mermaid }) => mermaid)
  const mermaid = await loading
  const isDark = dark()
  if (initialised !== isDark) {
    mermaid.initialize(configFor(isDark))
    initialised = isDark
  }
  return mermaid
}

/**
 * The SVG, or `undefined` while it loads and if it never parses.
 *
 * One value rather than a state machine, because the caller draws the same thing in both
 * of those cases — the source as written. A flag telling them apart would decide nothing.
 */
export const useMermaid = (source: string): string | undefined => {
  const [svg, setSvg] = useState<string | undefined>(undefined)

  useEffect(() => {
    // Guards the state write rather than the render: a diagram whose block unmounted
    // mid-parse would otherwise set state on a component that is gone.
    let live = true
    setSvg(undefined)
    seq += 1
    const id = `mermaid-${String(seq)}`
    const draw = async (): Promise<void> => {
      try {
        const mermaid = await load()
        const { svg: drawn } = await mermaid.render(id, sideways(source))
        if (live) setSvg(drawn)
      } catch {
        // The draw-failure path leaves the same scratch element behind, which the flag
        // above does not cover — it is keyed `d` + the id passed to `render`.
        document.getElementById(`d${id}`)?.remove()
        // Every failure is the same answer — no diagram — and the caller draws the source
        // for it. Narrowing them would distinguish a syntax error from a chunk that never
        // arrived, which changes nothing about what is put on the screen.
        if (live) setSvg(undefined)
      }
    }
    void draw()
    return () => {
      live = false
    }
  }, [source])

  return svg
}
