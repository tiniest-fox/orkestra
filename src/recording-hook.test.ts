// The hook's copies of the engine's rules — which script texts it reads, and which files
// in pnpm's store the lockfile stands for — held to the engine's own. Importing the hook
// here does nothing else: it records only in a process handed a recording directory or a
// family log, and only for the first copy it loads.

import { createHash } from "node:crypto"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { keepsText, storeEntry } from "./recording-hook.js"
import { eligible, printOf } from "./recording/logic/print.js"
import type { Fact, UnitRecording } from "./recording/types/recording.js"

const ROOT = "/repo"

/** A path as `within` names it for a check run at `root`. */
const withinOf =
  (root: string) =>
  (path: string): string =>
    path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path

const INSIDE = [
  "lib/a.ts",
  "lib/a.js",
  "lib/a.mts",
  "lib/a.cts",
  "lib/a.mjs",
  "lib/a.cjs",
  "lib/a.tsx",
  "lib/a.jsx",
  "lib/a.d.ts",
  "lib/a.json",
  "lib/a.vue",
  "lib/a.ts.map",
  "lib/node_modules.ts",
  "node_modules/effect/dist/esm/index.js",
  "packages/app/node_modules/wsp/a.js",
].map((p) => join(ROOT, p))

const OUTSIDE = [
  "/tmp/orkestra-x/fixture.ts",
  "/home/u/.cache/tsx/a.mjs",
  "/usr/lib/node_modules/corepack/dist/lib.js",
  "/opt/engine/src/recording-hook.ts",
]

describe("keepsText", () => {
  it("keeps the text of exactly the scripts in the checkout the engine reads", () => {
    const within = withinOf(ROOT)
    expect(INSIDE.filter(keepsText)).toEqual(INSIDE.filter((p) => eligible(within(p))))
  })

  it.each(["/repo", "/repo/packages/app", "/opt/engine", "/tmp/orkestra-x"])(
    "keeps every text the engine reads when the check ran at %s",
    (root) => {
      const within = withinOf(root)
      const read = [...INSIDE, ...OUTSIDE].filter((p) => eligible(within(p)))
      expect(read.filter((p) => !keepsText(p))).toEqual([])
    },
  )
})

const sha = (text: string): string => createHash("sha256").update(text).digest("hex")

const LOCK = "lockfileVersion: '9.0'\n"

/** The print of a unit that recorded `facts`, in a checkout at `/repo` holding a lockfile. */
const printOfFacts = (facts: readonly Fact[]) => {
  const recording: UnitRecording = {
    kind: "unit",
    test: "/repo/a.test.ts",
    runner: 1,
    scripts: [],
    facts,
  }
  const files: Record<string, string> = { "pnpm-lock.yaml": LOCK }
  return printOf(
    "a.test.ts",
    recording,
    { kind: "runner", pid: 1, facts: [] },
    {
      within: (path) => path.replace(/^\/repo\//, ""),
      generated: () => undefined,
      text: (path) => files[path],
      sha,
    },
  )
}

const STORE = [
  "/repo/node_modules/.pnpm/jsdom@26.1.0/node_modules/jsdom/lib/api.js",
  "/repo/node_modules/.pnpm/jsdom@26.1.0/node_modules/jsdom/package.json",
  "/repo/node_modules/.pnpm/@s+foo@1.0.0_bar@2.0.0/node_modules/@s/foo/index.js",
  "/repo/packages/app/node_modules/.pnpm/baz@3.0.0/node_modules/baz/a.js",
  "/repo/node_modules/.pnpm/foo@file+..+foo/node_modules/foo/index.js",
  "/repo/node_modules/.pnpm/@s+foo@link+..+foo/node_modules/@s/foo/a.js",
  "/repo/node_modules/.pnpm/node_modules/foo/index.js",
  "/repo/node_modules/foo/index.js",
  "/repo/lib/a.ts",
]

describe("storeEntry", () => {
  it.each(STORE)("records %s as the print reads it", (path) => {
    const file: Fact = { path, facet: "content", value: sha(path) }
    const entry = storeEntry(path)
    const marker: Fact[] =
      entry === undefined ? [file] : [{ path: entry, facet: "kind", value: "dir" }]
    // A path the lockfile pins prints as the lockfile, whether its entry or it was recorded.
    expect(printOfFacts(marker)).toEqual(printOfFacts([file]))
    const printed = printOfFacts([file])
    const leans = printed._tag === "Printed" && printed.print.assumes?.includes("lockfile") === true
    expect(leans).toBe(entry !== undefined)
  })

  it("names the entry a package's files are under", () => {
    expect(storeEntry(STORE[2] ?? "")).toBe("/repo/node_modules/.pnpm/@s+foo@1.0.0_bar@2.0.0")
  })
})
