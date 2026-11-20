// The file Passes holds a prints directory, or reads a check's recording, far larger than
// its heap. Each case writes 1 MB prints or unit recordings — each the shape a jsdom test
// leaves, a `kind` and a `content` for thousands of files under `node_modules/.pnpm/` —
// several times the heap a child Node is given, and runs one call there: a store that
// reads them all at once dies of `JavaScript heap out of memory`, as the engine serving a
// project with such a cache, or a suite with such a recording, does.

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

const ENTRY = new URL("../support/prints-heap.ts", import.meta.url).pathname
const TSX = import.meta.resolve("tsx")

/** The child's old-space cap, in MB. Loading the store and Effect takes about 28. */
const HEAP_MB = 64
/** How many 1 MB prints the store holds, or unit recordings a check leaves: four times the cap. */
const PRINTS = 256
const KEY = "prints-key"

const scratch = mkdtempSync(join(tmpdir(), "orkestra-passes-heap-"))
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const sha = (text: string): string => createHash("sha256").update(text).digest("hex")

const project = (): string => {
  const dir = mkdtempSync(join(scratch, "project-"))
  mkdirSync(join(dir, ".orkestra"))
  return dir
}

const printsDir = (dir: string) => join(dir, ".orkestra", ".database", "passes", "prints")

/** The inputs of one 1 MB print: a `kind` and a `content` for each dependency file read. */
const DEPENDENCY_INPUTS = JSON.stringify(
  Array.from({ length: 2900 }, (_, i) => {
    const path = `node_modules/.pnpm/pkg-${i % 300}@1.0.${i % 7}/node_modules/pkg-${i % 300}/lib/file-${i}.js`
    return [
      { _tag: "Exact", path, facet: "kind", value: "file" },
      { _tag: "Exact", path, facet: "content", value: sha(path) },
    ]
  }).flat(),
)

/** `count` 1 MB prints, each of its own unit, under `key`. */
const bigPrints = (dir: string, key: string, count: number, from = 0) => {
  const at = join(printsDir(dir), key)
  mkdirSync(at, { recursive: true })
  for (let i = from; i < from + count; i++) {
    const unit = `src/u${i}.test.ts`
    writeFileSync(
      join(at, `${sha(unit)}.${sha(String(i))}.json`),
      `{"unit":${JSON.stringify(unit)},"inputs":${DEPENDENCY_INPUTS}}`,
    )
  }
}

/**
 * The reads of one 1 MB unit recording in the checkout at `dir`, as JSON fields: a script
 * and a `kind` and `content` fact for each dependency file it loaded.
 */
const unitReads = (dir: string): string => {
  const paths = Array.from(
    { length: 2000 },
    (_, i) =>
      `${dir}/node_modules/.pnpm/pkg-${i % 300}@1.0.${i % 7}/node_modules/pkg-${i % 300}/lib/file-${i}.js`,
  )
  const scripts = paths.map((path) => ({ path, fresh: false }))
  const facts = paths.flatMap((path) => [
    { path, facet: "kind", value: "file" },
    { path, facet: "content", value: sha(path) },
  ])
  return `"scripts":${JSON.stringify(scripts)},"facts":${JSON.stringify(facts)}`
}

/** Run one call in a Node whose heap is capped at `HEAP_MB`. */
const inChild = (args: readonly string[]) => {
  const child = spawnSync(
    process.execPath,
    [`--max-old-space-size=${HEAP_MB}`, "--import", TSX, ENTRY, ...args],
    { encoding: "utf8", env: process.env, timeout: 120_000 },
  )
  const last = child.stdout.trim().split("\n").at(-1) ?? ""
  const out: unknown = last.startsWith("{") ? JSON.parse(last) : last
  return {
    status: child.status,
    // How a child out of heap says so, where it is.
    died: /FATAL ERROR[^\n]*/.exec(child.stderr)?.[0],
    out,
  }
}

describe("Passes: file, a prints directory larger than the heap", () => {
  it("keeps a print and drops an evicted one's text without reading every key's prints at once", () => {
    const dir = project()
    const prints = printsDir(dir)
    // 256 MB of other checks' prints, which only the collection of unnamed texts reads.
    for (let k = 0; k < 8; k++) bigPrints(dir, `other-${k}`, PRINTS / 8, k * (PRINTS / 8))

    // Ten prints of `a.test.ts`, each naming its own text, all used long ago: the next
    // print kept evicts one, so its text is a candidate for removal.
    const unit = "a.test.ts"
    const at = join(prints, KEY)
    const texts = join(prints, "texts")
    mkdirSync(at, { recursive: true })
    mkdirSync(texts, { recursive: true })
    const long = Date.now() / 1000 - 10_000
    for (let i = 0; i < 10; i++) {
      const text = `export const n = ${i}\n`
      writeFileSync(join(texts, sha(text)), text)
      const file = join(at, `${sha(unit)}.${sha(`old-${i}`)}.json`)
      writeFileSync(
        file,
        JSON.stringify({
          unit,
          inputs: [{ _tag: "Code", path: "lib.js", sha: sha(text), allowed: [] }],
        }),
      )
      utimesSync(file, long + i, long + i)
    }

    const lib = "export const n = 10\n"
    writeFileSync(join(dir, "lib.js"), lib)
    const recording = mkdtempSync(join(scratch, "recording-"))
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
        scripts: [],
        facts: [{ path: join(dir, "lib.js"), facet: "content", value: sha(lib) }],
      }),
    )

    const ran = inChild(["print", dir, KEY, recording, unit])
    expect(ran).toMatchObject({ died: undefined, status: 0, out: { answer: [] } })
    expect(readdirSync(at).filter((n) => n.startsWith(`${sha(unit)}.`))).toHaveLength(10)
  }, 180_000)

  it("keeps a print of every unit in a recording larger than the heap", () => {
    const dir = project()
    const recording = mkdtempSync(join(scratch, "recording-"))
    writeFileSync(
      join(recording, "runner.json"),
      JSON.stringify({
        kind: "runner",
        pid: 1,
        facts: [{ path: join(dir, "pnpm-lock.yaml"), facet: "content", value: sha("lock") }],
      }),
    )
    const reads = unitReads(dir)
    const units = Array.from({ length: PRINTS }, (_, i) => `src/u${i}.test.ts`)
    for (const [i, unit] of units.entries())
      writeFileSync(
        join(recording, `unit-${i}.json`),
        `{"kind":"unit","test":${JSON.stringify(join(dir, unit))},"runner":1,${reads}}`,
      )

    const ran = inChild(["print", dir, KEY, recording, ...units])
    expect(ran).toMatchObject({ died: undefined, status: 0, out: { answer: [] } })
    expect(readdirSync(join(printsDir(dir), KEY))).toHaveLength(PRINTS)
  }, 180_000)

  it("answers which units skip without reading every print under the key at once", () => {
    const dir = project()
    // 256 MB of prints under the key asked about, none of which holds in this checkout.
    bigPrints(dir, KEY, PRINTS)
    const ran = inChild(["printed", dir, KEY])
    expect(ran).toMatchObject({ died: undefined, status: 0, out: { answer: [] } })
  }, 180_000)
})
