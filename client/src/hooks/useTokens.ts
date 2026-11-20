/**
 * Strings tokenised for colour, in one language.
 *
 * **Loaded on demand and never at startup**, the rule `useMermaid` sets for a heavy
 * dependency: every `import()` below stays dynamic, the grammars are one chunk each and
 * arrive only for a language actually on screen, and a client that never opens Changes or
 * a labelled fence pays nothing. A static import would move a highlighter and two themes
 * onto every page load to colour nothing. The two themes are lazy the same way: each is
 * fetched the first time its scheme is on screen.
 *
 * **The regex engine is the JavaScript one, not oniguruma.** The wasm build is half a
 * megabyte to do the same job for the grammars `format/grammar` names, and it is a second
 * asset to serve. `forgiving` is on: a grammar with a pattern the JS engine cannot compile
 * drops that pattern rather than throwing, so the worst case is a construct that misses its
 * colour instead of a file that draws nothing.
 *
 * **The theme follows the OS scheme while the tab is open**, as every colour in `styles.css`
 * does. A theme fixed at the first paint left a tab opened in daylight drawing github-light's
 * near-black ink on the dark plates once the scheme flipped — identifiers and punctuation
 * vanished while keywords and strings still showed. A flip loads the other theme into the
 * same highlighter rather than building a new one, which would throw away every grammar
 * loaded since, and repaints.
 *
 * **Colour arrives as an inline value rather than a class, and that is not the styling rule
 * being bent.** A syntax palette is data the theme carries, not a name the design system
 * owns; nothing here spells a colour, and there is no set of tokens `styles.css` could hold
 * that would not be a second copy of a TextMate theme.
 *
 * Kind `hook`: no JSX, and it reaches nothing but the strings it was handed.
 */

import type { HighlighterCore, LanguageInput } from "@shikijs/core"
import { useEffect, useState, useSyncExternalStore } from "react"
import type { Grammar } from "../format/grammar"

/** One run of same-coloured text within a line. `color` is a CSS colour from the theme. */
export interface Tok {
  readonly text: string
  readonly color: string
}

/** One string's lines, each as its runs of colour. */
export type Lines = readonly (readonly Tok[])[]

/** No `matchMedia` reads as light, the scheme a headless browser reports too. */
const darkQuery = (): MediaQueryList | undefined =>
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : undefined

const subscribe = (onChange: () => void): (() => void) => {
  const query = darkQuery()
  if (query === undefined) return () => undefined
  query.addEventListener("change", onChange)
  return () => {
    query.removeEventListener("change", onChange)
  }
}

const dark = (): boolean => darkQuery()?.matches ?? false

/**
 * The one highlighter, resolved once for the life of the tab, with no theme until one is
 * asked for.
 *
 * Held as the promise rather than the value so two callers racing the first `import()`
 * both await the first one's work — a second `createHighlighterCore` would be a second copy
 * of every grammar.
 */
let core: Promise<HighlighterCore> | undefined

const load = async (): Promise<HighlighterCore> => {
  core ??= Promise.all([import("@shikijs/core"), import("@shikijs/engine-javascript")]).then(
    ([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
      createHighlighterCore({
        themes: [],
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      }),
  )
  return core
}

/** Each scheme's theme, by the name shiki registers it under. */
const THEMES = {
  dark: { name: "github-dark", load: () => import("@shikijs/themes/github-dark") },
  light: { name: "github-light", load: () => import("@shikijs/themes/github-light") },
} as const

/** Themes already asked for, so every block on screen shares one fetch of each. */
const themes = new Map<keyof typeof THEMES, Promise<string>>()

/** Loads the scheme's theme into the highlighter if it is not there yet, and names it. */
const theme = async (highlighter: HighlighterCore, key: keyof typeof THEMES): Promise<string> => {
  const fetching =
    themes.get(key) ??
    (async (): Promise<string> => {
      await highlighter.loadTheme((await THEMES[key].load()).default)
      return THEMES[key].name
    })()
  themes.set(key, fetching)
  return fetching
}

/**
 * Every grammar this build will fetch, one chunk each.
 *
 * Written out rather than taken from shiki's own bundled map: that map holds an `import()`
 * for every grammar shiki ships, so referencing it emits two hundred chunks to colour the
 * handful of languages `format/grammar` claims. Keyed on `Grammar` so the two cannot drift:
 * a name there with no importer here is a type error, and so is an importer nothing names.
 */
const GRAMMARS: Readonly<Record<Grammar, () => Promise<LanguageInput>>> = {
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  css: () => import("@shikijs/langs/css"),
  html: () => import("@shikijs/langs/html"),
  markdown: () => import("@shikijs/langs/markdown"),
  shell: () => import("@shikijs/langs/shellscript"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  rust: () => import("@shikijs/langs/rust"),
  python: () => import("@shikijs/langs/python"),
  go: () => import("@shikijs/langs/go"),
  sql: () => import("@shikijs/langs/sql"),
}

/** Grammars already asked for, so twenty TypeScript files fetch one chunk between them. */
const grammars = new Map<Grammar, Promise<void>>()

const grammar = async (highlighter: HighlighterCore, lang: Grammar): Promise<void> => {
  const fetching =
    grammars.get(lang) ??
    (async (): Promise<void> => {
      await highlighter.loadLanguage(await GRAMMARS[lang]())
    })()
  grammars.set(lang, fetching)
  await fetching
}

/**
 * The strings travel as one string, and the effect keys on that rather than on the array.
 *
 * A caller builds its array on every render, and an effect keyed on the array would run on
 * every render — each run clearing what the last one painted, forever. A NUL is the joint
 * because no text a model wrote or a file holds carries one.
 */
const JOINT = "\u0000"

/**
 * `undefined` while it loads, for no language, and if the chunk never arrives.
 *
 * One value rather than a state machine, because the caller draws the same thing in all
 * three cases — the text as written. A flag telling them apart would decide nothing, and a
 * block that failed to colour is still the block.
 *
 * Each string is tokenised whole rather than a row at a time: a grammar restarted at every
 * line loses a template literal or a block comment after its first row. The answer is one
 * `Lines` per string, in the order they were given. A flip of the OS scheme paints them again
 * in the other theme.
 */
export const useTokens = (
  lang: Grammar | undefined,
  texts: readonly string[],
): readonly Lines[] | undefined => {
  const [painted, setPainted] = useState<readonly Lines[] | undefined>(undefined)
  const joined = texts.join(JOINT)
  const scheme = useSyncExternalStore(subscribe, dark) ? "dark" : "light"

  useEffect(() => {
    setPainted(undefined)
    if (lang === undefined || joined === "") return

    // Guards the state write rather than the render: a card unmounted mid-fetch would
    // otherwise set state on a component that is gone.
    let live = true
    const paint = async (): Promise<void> => {
      try {
        const highlighter = await load()
        const [named] = await Promise.all([theme(highlighter, scheme), grammar(highlighter, lang)])
        const done = joined
          .split(JOINT)
          .map((text) =>
            highlighter
              .codeToTokens(text, { lang, theme: named })
              .tokens.map((line) =>
                line.map((token) => ({ text: token.content, color: token.color ?? "" })),
              ),
          )
        if (live) setPainted(done)
      } catch {
        // Every failure is the same answer — no colour — and the caller draws the text for
        // it. Telling a missing chunk apart from a grammar that would not compile would
        // change nothing about what reaches the screen.
        if (live) setPainted(undefined)
      }
    }
    void paint()
    return () => {
      live = false
    }
  }, [lang, joined, scheme])

  return painted
}
