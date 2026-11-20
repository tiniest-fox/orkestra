import { describe, expect, it } from "vitest"
import { type BarrelSources, barrelGrows, isBarrel, manifestsAbove } from "./barrel.js"

const BARREL = [
  "// The package's surface.",
  'export { a, b as c } from "./a.js"',
  "export type { A } from './types.js';",
  "",
].join("\n")

const PATH = "packages/domain/src/index.ts"

/** The barrel at `PATH`, whose test ran `a.ts`, `types.ts` and `loaded.ts`, under `manifests`. */
const sources = (manifests: Record<string, string> = {}): BarrelSources => ({
  path: PATH,
  loaded: new Set([
    PATH,
    "packages/domain/src/a.ts",
    "packages/domain/src/types.ts",
    "packages/domain/src/loaded.ts",
  ]),
  manifest: (path) => manifests[path],
})

const PURE = { "packages/domain/package.json": '{ "name": "domain", "sideEffects": false }' }
const IMPURE = { "packages/domain/package.json": '{ "name": "domain" }' }

const grows = (next: string, manifests: Record<string, string> = {}): boolean =>
  barrelGrows(BARREL, next, sources(manifests))

describe("a barrel", () => {
  it("is only named re-exports, with comments between them", () => {
    expect(isBarrel(BARREL)).toBe(true)
    expect(isBarrel('export { default as x, type Y, "a-b" as z } from "./x.js"\n')).toBe(true)
    expect(isBarrel('export * from "./a.js"\n')).toBe(false)
    expect(isBarrel('export { a } from "./a.js"\nexport const b = 1\n')).toBe(false)
    expect(isBarrel('import { a } from "./a.js"\nexport { a }\n')).toBe(false)
    expect(isBarrel('export { a } from "./a.json" with { type: "json" }\n')).toBe(false)
    expect(isBarrel("")).toBe(false)
  })

  it("lists every package.json it may belong to, nearest first", () => {
    expect(manifestsAbove(PATH)).toEqual([
      "packages/domain/src/package.json",
      "packages/domain/package.json",
      "packages/package.json",
      "package.json",
    ])
  })
})

describe("a barrel's edit", () => {
  it("holds when names are added to a block, whatever the package declares", () => {
    const next = BARREL.replace("b as c }", "b as c, d }").replace("{ A }", "{ A, B }")
    expect(grows(next, IMPURE)).toBe(true)
  })

  it("holds for a new block from a module the test ran, whatever the package declares", () => {
    expect(grows(`${BARREL}export { l } from "./loaded.js"\n`, IMPURE)).toBe(true)
    expect(grows(`export { l } from "./loaded"\n${BARREL}`)).toBe(true)
  })

  it("holds for a new block from a module the test never ran only under sideEffects: false", () => {
    const next = `${BARREL}export { n } from "./new.js"\n`
    expect(grows(next, PURE)).toBe(true)
    expect(grows(next, IMPURE)).toBe(false)
    expect(grows(next)).toBe(false)
    // The nearest package.json decides, even where one further up declares none.
    expect(grows(next, { ...PURE, "packages/domain/src/package.json": "{}" })).toBe(false)
  })

  it("vouches for a block of inline-type names that gains a value name, as for a new block", () => {
    const old = 'export { type T } from "./t.js"\n'
    const next = 'export { type T, t } from "./t.js"\n'
    const ran = (loaded: readonly string[], manifests: Record<string, string>): boolean =>
      barrelGrows(old, next, {
        ...sources(manifests),
        loaded: new Set([PATH, ...loaded]),
      })
    expect(ran([], IMPURE)).toBe(false)
    expect(ran(["packages/domain/src/t.ts"], IMPURE)).toBe(true)
    expect(ran([], PURE)).toBe(true)
    expect(barrelGrows(old, 'export { type T, type U } from "./t.js"\n', sources(IMPURE))).toBe(
      true,
    )
  })

  it("vouches for any value name a kept block gains, whatever its names look like", () => {
    // `type as y` exports the value `type` as `y`; `T` may be an interface a compiler dropped.
    const edits = [
      ['export { type T } from "./t.js"\n', 'export { type T, type as y } from "./t.js"\n'],
      ['export { T } from "./t.js"\n', 'export { T, t } from "./t.js"\n'],
    ]
    for (const [old = "", next = ""] of edits) {
      expect(barrelGrows(old, next, sources(IMPURE))).toBe(false)
      const ran = { ...sources(IMPURE), loaded: new Set([PATH, "packages/domain/src/t.ts"]) }
      expect(barrelGrows(old, next, ran)).toBe(true)
    }
  })

  it("holds when an export type block gains a name, though its module never ran", () => {
    const old = 'export type { T } from "./t.js"\n'
    const next = 'export type { T, U } from "./t.js"\n'
    expect(barrelGrows(old, next, { ...sources(IMPURE), loaded: new Set([PATH]) })).toBe(true)
  })

  it("misses for a new block whose source is another package's, under sideEffects: false", () => {
    expect(grows(`${BARREL}export { n } from "other"\n`, PURE)).toBe(false)
    expect(grows(`${BARREL}export { n } from "../../other/src/n.js"\n`, PURE)).toBe(false)
  })

  it("misses for an export *, a declaration, or a removed, renamed or moved name", () => {
    const misses = [
      `${BARREL}export * from "./loaded.js"\n`,
      `${BARREL}export const x = 1\n`,
      BARREL.replace("a, b as c", "a"),
      BARREL.replace("b as c", "b as d"),
      BARREL.replace('"./a.js"', '"./loaded.js"'),
      BARREL.replace("export type { A }", "export { A }"),
    ]
    for (const next of misses) expect(grows(next, PURE)).toBe(false)
  })

  it("misses where its blocks run in another order", () => {
    const [comment = "", first = "", second = ""] = BARREL.split("\n")
    expect(grows([comment, second, first, ""].join("\n"), PURE)).toBe(false)
  })
})
