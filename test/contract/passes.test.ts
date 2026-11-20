// The Passes port's contract, run against both adapters: a key is the same for the same
// tree and script, different when either moves, and absent for a script nobody can read;
// a key recorded is one `has` finds, in any later layer over the same project for the
// file adapter. A unit key is shared by every check with the label, and its units come
// back once each. The file adapter's prints are bounded per unit, least recently used out.

import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, type Layer, Schema } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import type { Check } from "../../src/library/types/check.js"
import { Print } from "../../src/recording/index.js"
import { FilePassesLayer, type Machine } from "../../src/workflow/adapters/passes-file.js"
import { MemoryPassesLayer } from "../../src/workflow/adapters/passes-memory.js"
import { Passes } from "../../src/workflow/ports/passes.js"
import type { StoreFailed } from "../../src/workflow/ports/store-errors.js"

const scratch = mkdtempSync(join(tmpdir(), "orkestra-passes-contract-"))
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** A project with an `.orkestra/`, so the file adapter finds its root. */
const project = (): string => {
  const dir = mkdtempSync(join(scratch, "project-"))
  mkdirSync(join(dir, ".orkestra"))
  return dir
}

const script = (dir: string, text: string): Check => {
  const path = join(dir, "verify.sh")
  writeFileSync(path, text)
  return {
    name: "verify",
    description: "d",
    timeoutSeconds: 60,
    askedEverySeconds: undefined,
    exclusive: false,
    cache: true,
    ignoresLinguistGenerated: false,
    units: undefined,
    cacheAcross: "platform" as const,
    path,
  }
}

const run = <A>(
  layer: Layer.Layer<Passes, StoreFailed>,
  body: Effect.Effect<A, StoreFailed, Passes>,
) => Effect.runPromise(Effect.provide(body, layer))

describe.each([
  { label: "file", layer: (dir: string) => FilePassesLayer(dir) },
  { label: "memory", layer: () => MemoryPassesLayer },
])("Passes contract: $label", ({ layer }) => {
  it("keys the same tree and script the same way, and either moving changes it", async () => {
    const dir = project()
    const keys = await run(
      layer(dir),
      Effect.gen(function* () {
        const passes = yield* Passes
        const check = script(dir, "pnpm verify\n")
        const first = yield* passes.keyOf(check, "tree-a")
        const same = yield* passes.keyOf(check, "tree-a")
        const otherTree = yield* passes.keyOf(check, "tree-b")
        const edited = yield* passes.keyOf(script(dir, "pnpm verify --strict\n"), "tree-a")
        return { first, same, otherTree, edited }
      }),
    )
    expect(keys.first).toBeDefined()
    expect(keys.same).toBe(keys.first)
    expect(new Set([keys.first, keys.otherTree, keys.edited]).size).toBe(3)
  })

  it("has no key for a script that cannot be read", async () => {
    const dir = project()
    const missing = { ...script(dir, "x\n"), path: join(dir, "gone.sh") }
    expect(
      await run(
        layer(dir),
        Effect.flatMap(Passes, (p) => p.keyOf(missing, "tree-a")),
      ),
    ).toBe(undefined)
  })

  it("finds a key once it is recorded, and only that key", async () => {
    const dir = project()
    const found = await run(
      layer(dir),
      Effect.gen(function* () {
        const passes = yield* Passes
        const before = yield* passes.has("k1")
        yield* passes.record("k1")
        return [before, yield* passes.has("k1"), yield* passes.has("k2")]
      }),
    )
    expect(found).toEqual([false, true, false])
  })

  it("keys units by tree and label, so two checks sharing a label share them", async () => {
    const dir = project()
    const keys = await run(
      layer(dir),
      Effect.gen(function* () {
        const passes = yield* Passes
        const light = { ...script(dir, "light\n"), name: "verify-light", units: "vitest" }
        const full = { ...script(dir, "full\n"), units: "vitest" }
        return {
          light: yield* passes.unitKeyOf(light, "tree-a"),
          full: yield* passes.unitKeyOf(full, "tree-a"),
          moved: yield* passes.unitKeyOf(full, "tree-b"),
          other: yield* passes.unitKeyOf({ ...full, units: "jest" }, "tree-a"),
          none: yield* passes.unitKeyOf(script(dir, "x\n"), "tree-a"),
          uncached: yield* passes.unitKeyOf({ ...full, cache: false }, "tree-a"),
        }
      }),
    )
    expect(keys.light).toBeDefined()
    expect(keys.full).toBe(keys.light)
    expect(new Set([keys.full, keys.moved, keys.other]).size).toBe(3)
    expect([keys.none, keys.uncached]).toEqual([undefined, undefined])
  })

  it("hands back each unit proven under a key once, and none under another", async () => {
    const dir = project()
    const proven = await run(
      layer(dir),
      Effect.gen(function* () {
        const passes = yield* Passes
        const before = yield* passes.proven("u1")
        yield* passes.prove("u1", ["a.test.ts", "b.test.ts"])
        yield* passes.prove("u1", ["b.test.ts", "c.test.ts"])
        return [before, yield* passes.proven("u1"), yield* passes.proven("u2")]
      }),
    )
    expect(proven).toEqual([[], ["a.test.ts", "b.test.ts", "c.test.ts"], []])
  })
})

describe.each([
  { label: "file", layer: (dir: string) => FilePassesLayer(dir) },
  { label: "memory", layer: () => MemoryPassesLayer },
])("Passes contract, the tree a check last passed on: $label", ({ layer }) => {
  it("keeps the tree a check last passed on per checkout, whatever its script says", async () => {
    const dir = project()
    const trees = await run(
      layer(dir),
      Effect.gen(function* () {
        const passes = yield* Passes
        const check = script(dir, "light\n")
        const before = yield* passes.lastPassed(check, "/a")
        yield* passes.passedOn(check, "/a", "tree-a")
        yield* passes.passedOn(check, "/a", "tree-b")
        return {
          before,
          kept: yield* passes.lastPassed(script(dir, "edited\n"), "/a"),
          elsewhere: yield* passes.lastPassed(check, "/b"),
          other: yield* passes.lastPassed({ ...check, name: "other" }, "/a"),
        }
      }),
    )
    expect(trees).toEqual({
      before: undefined,
      kept: "tree-b",
      elsewhere: undefined,
      other: undefined,
    })
  })
})

describe("Passes: file", () => {
  it("keeps a record for the next layer over the same project", async () => {
    const dir = project()
    await run(
      FilePassesLayer(dir),
      Effect.flatMap(Passes, (p) => p.record("k1")),
    )
    expect(
      await run(
        FilePassesLayer(dir),
        Effect.flatMap(Passes, (p) => p.has("k1")),
      ),
    ).toBe(true)
  })
})

describe("Passes: file, across machines", () => {
  const unitKey = (dir: string, machine: Machine, cacheAcross: "os" | "platform") =>
    run(
      FilePassesLayer(dir, machine),
      Effect.flatMap(Passes, (p) =>
        p.unitKeyOf({ ...script(dir, "x\n"), units: "vitest", cacheAcross }, "tree-a"),
      ),
    )
  const arm = { platform: "linux", arch: "arm64", trusts: true }
  const x64 = { platform: "linux", arch: "x64", trusts: true }
  const mac = { platform: "darwin", arch: "arm64", trusts: true }

  it("finds a proof made on another architecture under `cache_across: os`", async () => {
    const dir = project()
    expect(await unitKey(dir, arm, "os")).toBe(await unitKey(dir, x64, "os"))
    expect(await unitKey(dir, arm, "os")).not.toBe(await unitKey(dir, mac, "os"))
  })

  it("keeps the architectures apart by default", async () => {
    const dir = project()
    expect(await unitKey(dir, arm, "platform")).not.toBe(await unitKey(dir, x64, "platform"))
  })

  it("keeps units for the next layer over the same project", async () => {
    const dir = project()
    await run(
      FilePassesLayer(dir),
      Effect.flatMap(Passes, (p) => p.prove("u1", ["a.test.ts"])),
    )
    expect(
      await run(
        FilePassesLayer(dir),
        Effect.flatMap(Passes, (p) => p.proven("u1")),
      ),
    ).toEqual(["a.test.ts"])
  })
})

// The file store's prints, from recordings written here rather than by the hook: a unit
// keeps a print per content it passed on, at most `PRINTS_PER_UNIT`, the least recently
// used going first, and a source text goes once no print names it.
const KEY = "prints-key"
const hash = (text: string): string => createHash("sha256").update(text).digest("hex")
const lib = (n: number) => `export function unused(x) {\n  return x * ${n}\n}\n`
const printsDir = (dir: string) => join(dir, ".orkestra", ".database", "passes", "prints")
const upTo = (n: number) => Array.from({ length: n }, (_, i) => i)
const decodePrint = Schema.decodeUnknownSync(Schema.parseJson(Print))

/**
 * Keep a print of `unit` run on `lib.js` holding `lib(n)`. With `code`, the recording says
 * V8 ran `unused` uncalled, so the input is `Code` and its text is kept; without, `Exact`.
 */
const printOn = (dir: string, unit: string, n: number, code = false) => {
  const text = lib(n)
  writeFileSync(join(dir, "lib.js"), text)
  const recording = mkdtempSync(join(scratch, "recording-"))
  mkdirSync(join(recording, "scripts"))
  writeFileSync(join(recording, "scripts", hash(text)), text)
  const scripts = code
    ? [
        {
          path: join(dir, "lib.js"),
          fresh: true,
          generated: hash(text),
          uncalled: [[text.indexOf("function"), text.length - 1]],
        },
      ]
    : []
  writeFileSync(
    join(recording, "runner.json"),
    JSON.stringify({ kind: "runner", pid: 1, facts: [] }),
  )
  writeFileSync(
    join(recording, "unit.json"),
    JSON.stringify({
      kind: "unit",
      test: join(dir, unit),
      runner: 1,
      scripts,
      facts: [{ path: join(dir, "lib.js"), facet: "content", value: hash(text) }],
    }),
  )
  return run(
    FilePassesLayer(dir),
    Effect.flatMap(Passes, (p) => p.print(KEY, dir, recording, [unit])),
  )
}

/** The units skipped with `lib.js` holding `lib(n)`, marking the prints that hold used. */
const printedOn = (dir: string, n: number) => {
  writeFileSync(join(dir, "lib.js"), lib(n))
  return run(
    FilePassesLayer(dir),
    Effect.flatMap(Passes, (p) => p.printed(KEY, dir)),
  )
}

/** `unit`'s print files, by the `lib(n)` each was recorded on. */
const printsOf = (dir: string, unit: string): Map<number, string> => {
  const at = join(printsDir(dir), KEY)
  const byN = new Map<number, string>()
  for (const name of readdirSync(at)) {
    const print = decodePrint(readFileSync(join(at, name), "utf8"))
    const input = print.inputs[0]
    if (print.unit !== unit || input === undefined) continue
    const value = input._tag === "Exact" ? input.value : input.sha
    for (let n = 0; n < 20; n++) if (hash(lib(n)) === value) byN.set(n, join(at, name))
  }
  return byN
}

/** Make `unit`'s prints last used in the order of `ns`, the first longest ago, all in the past. */
const age = (dir: string, unit: string, ns: readonly number[]) => {
  const files = printsOf(dir, unit)
  const start = Date.now() / 1000 - 10_000
  for (const [i, n] of ns.entries()) {
    const file = files.get(n)
    if (file === undefined) throw new Error(`no print of ${unit} on ${n}`)
    utimesSync(file, start + i, start + i)
  }
}

/** One print of `unit` per `ns`, in order: each run rewrites `lib.js`. */
const printEach = (dir: string, unit: string, ns: readonly number[], code = false) =>
  ns.reduce<Promise<void>>(
    (before, n) => before.then(() => printOn(dir, unit, n, code)),
    Promise.resolve(),
  )

describe("Passes: file, prints", () => {
  it("skips a unit that passed on two contents on either, whichever ran last", async () => {
    const dir = project()
    await printOn(dir, "a.test.ts", 1)
    await printOn(dir, "a.test.ts", 2)
    expect(await printedOn(dir, 1)).toEqual(["a.test.ts"])
    expect(await printedOn(dir, 2)).toEqual(["a.test.ts"])
    expect(await printedOn(dir, 3)).toEqual([])
  })

  it("drops the least recently used print past ten, and a print skipped on counts as used", async () => {
    const dir = project()
    await printEach(dir, "a.test.ts", upTo(10))
    age(dir, "a.test.ts", upTo(10))
    // The oldest print is skipped on, so the second oldest is now the least recently used.
    expect(await printedOn(dir, 0)).toEqual(["a.test.ts"])
    await printOn(dir, "a.test.ts", 10)
    expect([...printsOf(dir, "a.test.ts").keys()].sort((x, y) => x - y)).toEqual([
      0, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
    expect(await printedOn(dir, 1)).toEqual([])
    expect(await printedOn(dir, 0)).toEqual(["a.test.ts"])
  })

  it("keeps another unit's prints whatever one unit evicts", async () => {
    const dir = project()
    await printOn(dir, "b.test.ts", 0)
    await printEach(
      dir,
      "a.test.ts",
      upTo(11).map((n) => n + 1),
    )
    expect(printsOf(dir, "b.test.ts").size).toBe(1)
    expect(printsOf(dir, "a.test.ts").size).toBe(10)
  })

  it("removes a text once no print names it, and keeps one another print still names", async () => {
    const dir = project()
    const texts = join(printsDir(dir), "texts")
    await printOn(dir, "b.test.ts", 0, true)
    await printEach(dir, "a.test.ts", upTo(10), true)
    expect(existsSync(join(texts, hash(lib(0))))).toBe(true)
    age(dir, "a.test.ts", upTo(10))

    // `a`'s print on 0 goes, but `b`'s still names that text.
    await printOn(dir, "a.test.ts", 10, true)
    expect(printsOf(dir, "a.test.ts").has(0)).toBe(false)
    expect(existsSync(join(texts, hash(lib(0))))).toBe(true)

    // `a`'s print on 1 goes, and nothing else names that text.
    await printOn(dir, "a.test.ts", 11, true)
    expect(printsOf(dir, "a.test.ts").has(1)).toBe(false)
    expect(existsSync(join(texts, hash(lib(1))))).toBe(false)
    expect(existsSync(join(texts, hash(lib(2))))).toBe(true)
  })

  it("answers the other prints when one is evicted between the listing and the read", async () => {
    const dir = project()
    await printOn(dir, "a.test.ts", 1)
    // Listed and gone: what a print another check evicts mid-read looks like to `readFile`.
    symlinkSync(join(dir, "evicted"), join(printsDir(dir), KEY, `${hash("b.test.ts")}.gone.json`))
    expect(await printedOn(dir, 1)).toEqual(["a.test.ts"])
    const packed = await run(
      FilePassesLayer(dir),
      Effect.flatMap(Passes, (p) => p.packed(KEY)),
    )
    expect(packed.map((f) => f.name)).toEqual([expect.stringMatching(/^prints-key\//)])
  })
})

const BARREL = 'export { a } from "./a.js"\n'

/**
 * Keep a print of `a.test.ts` that ran the barrel `index.ts` and `a.ts`, under a
 * `package.json` reading `manifest`.
 */
const barrelPrinted = (dir: string, manifest: string) => {
  writeFileSync(join(dir, "package.json"), manifest)
  writeFileSync(join(dir, "index.ts"), BARREL)
  writeFileSync(join(dir, "a.ts"), "export const a = 1\n")
  const recording = mkdtempSync(join(scratch, "recording-"))
  writeFileSync(
    join(recording, "runner.json"),
    JSON.stringify({ kind: "runner", pid: 1, facts: [] }),
  )
  const ran = ["index.ts", "a.ts"]
  writeFileSync(
    join(recording, "unit.json"),
    JSON.stringify({
      kind: "unit",
      test: join(dir, "a.test.ts"),
      runner: 1,
      scripts: ran.map((f) => ({ path: join(dir, f), fresh: false })),
      facts: ran.map((f) => ({
        path: join(dir, f),
        facet: "content",
        value: hash(readFileSync(join(dir, f), "utf8")),
      })),
    }),
  )
  return run(
    FilePassesLayer(dir),
    Effect.flatMap(Passes, (p) => p.print(KEY, dir, recording, ["a.test.ts"])),
  )
}

/** The units skipped once `index.ts` reads `text`. */
const printedWithBarrel = (dir: string, text: string) => {
  writeFileSync(join(dir, "index.ts"), text)
  return run(
    FilePassesLayer(dir),
    Effect.flatMap(Passes, (p) => p.printed(KEY, dir)),
  )
}

describe("Passes: file, a barrel's print", () => {
  it("holds when the barrel grows a name, and a new block only under sideEffects: false", async () => {
    const grown = 'export { a, b } from "./a.js"\n'
    const added = `${BARREL}export { n } from "./new.js"\n`
    const impure = project()
    await barrelPrinted(impure, '{ "name": "x" }\n')
    expect(await printedWithBarrel(impure, grown)).toEqual(["a.test.ts"])
    expect(await printedWithBarrel(impure, added)).toEqual([])
    const pure = project()
    await barrelPrinted(pure, '{ "name": "x", "sideEffects": false }\n')
    expect(await printedWithBarrel(pure, added)).toEqual(["a.test.ts"])
    expect(await printedWithBarrel(pure, `export * from "./new.js"\n${BARREL}`)).toEqual([])
  })
})
