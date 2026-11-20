import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { RunnerRecording, UnitRecording } from "../types/recording.js"
import { type PrintSources, printOf } from "./print.js"
import { inlineMap } from "./source-map.js"

const sha = (text: string): string => createHash("sha256").update(text).digest("hex")

const LIB = "export function unused(x) {\n  return x * 2\n}\n"

/** A file compiled to itself behind a one-line wrapper, with a map an identity over it. */
const wrapped = (text: string): string => {
  const lines = text.split("\n").length
  const mappings = ["", ...Array.from({ length: lines }, (_, i) => (i === 0 ? "AAAA" : "AACA"))]
  const map = {
    version: 3,
    sources: ["lib.js"],
    sourcesContent: [text],
    mappings: mappings.join(";"),
  }
  const encoded = Buffer.from(JSON.stringify(map)).toString("base64")
  return `wrap(() => {\n${text}//# sourceMappingURL=data:application/json;base64,${encoded}\n})`
}

const GENERATED = wrapped(LIB)

const sources = (files: Record<string, string>): PrintSources => ({
  within: (path) => path.replace(/^\/repo\//, ""),
  generated: (s) => (s === sha(GENERATED) ? GENERATED : undefined),
  text: (path) => files[path],
  sha,
})

const runner: RunnerRecording = { kind: "runner", pid: 1, facts: [] }

const unit = (over: Partial<UnitRecording> = {}): UnitRecording => {
  const start = GENERATED.indexOf("function unused")
  return {
    kind: "unit",
    test: "/repo/a.test.js",
    runner: 1,
    scripts: [
      {
        path: "/repo/lib.js",
        fresh: true,
        generated: sha(GENERATED),
        uncalled: [[start, GENERATED.indexOf("}\n//#") + 1]],
      },
    ],
    facts: [{ path: "/repo/lib.js", facet: "content", value: sha(LIB) }],
    ...over,
  }
}

describe("a recording turned into a print", () => {
  it("carries the assumptions its recording leaned on, and none where it leaned on none", () => {
    const files = sources({ "lib.js": LIB })
    const leaned = printOf("a.test.js", unit({ assumes: ["tmpdir"] }), runner, files)
    expect(leaned._tag === "Printed" ? leaned.print.assumes : "unsure").toEqual(["tmpdir"])
    const plain = printOf("a.test.js", unit(), runner, files)
    expect(plain._tag === "Printed" ? plain.print : "unsure").not.toHaveProperty("assumes")
  })

  it("allows the body of a function never called, mapped back to the original text", () => {
    const printed = printOf("a.test.js", unit(), runner, sources({ "lib.js": LIB }))
    expect(printed._tag).toBe("Printed")
    const [input] = printed._tag === "Printed" ? printed.print.inputs : []
    expect(input?._tag).toBe("Code")
    const [span] = input?._tag === "Code" ? input.allowed : []
    expect(span === undefined ? undefined : LIB.slice(...span)).toBe("  return x * 2\n")
  })

  it("keeps a file the runner depends on whole, whatever the test left uncalled", () => {
    const config: RunnerRecording = {
      ...runner,
      facts: [{ path: "/repo/lib.js", facet: "content", value: sha(LIB) }],
    }
    const printed = printOf("a.test.js", unit(), config, sources({ "lib.js": LIB }))
    expect(printed._tag === "Printed" ? printed.print.inputs[0]?._tag : printed._tag).toBe("Exact")
  })

  it("keeps a file whole when the file changed after the test read it", () => {
    const printed = printOf("a.test.js", unit(), runner, sources({ "lib.js": `${LIB}// edited\n` }))
    expect(printed._tag === "Printed" ? printed.print.inputs[0]?._tag : printed._tag).toBe("Exact")
  })

  it("keeps none where the hook was unsure, the runner left nothing, or a script was never hashed", () => {
    const files = sources({ "lib.js": LIB })
    expect(printOf("a.test.js", unit({ unsure: "ran `docker`" }), runner, files)).toEqual({
      _tag: "Unsure",
      reason: "ran `docker`",
    })
    expect(printOf("a.test.js", unit(), undefined, files)._tag).toBe("Unsure")
    expect(printOf("a.test.js", unit({ facts: [] }), runner, files)).toEqual({
      _tag: "Unsure",
      reason: "lib.js ran and was never hashed",
    })
  })
})

const LOCK = "lockfileVersion: '9.0'\n"

/** A recording of a test that read `count` files in pnpm's store, as a jsdom test does. */
const jsdom = (count: number): UnitRecording => {
  const store = "/repo/node_modules/.pnpm/jsdom@26.1.0/node_modules/jsdom/lib/jsdom/living"
  const deps = Array.from({ length: count }, (_, i) => `${store}/nodes/Element${String(i)}-impl.js`)
  return unit({
    facts: [
      { path: "/repo/lib.js", facet: "content", value: sha(LIB) },
      { path: "/repo/lib.js", facet: "kind", value: "file" },
      { path: "/repo/gone.json", facet: "kind", value: "absent" },
      ...deps.flatMap((path) => [
        { path, facet: "content" as const, value: sha(path) },
        { path, facet: "kind" as const, value: "file" },
      ]),
    ],
  })
}

/** The print as it was before dependency files folded into the lockfile: a fact each. */
const unfolded = (recording: UnitRecording): string =>
  JSON.stringify({
    unit: "a.test.js",
    inputs: recording.facts.map((f) => ({ _tag: "Exact", ...f, path: f.path.slice(6) })),
  })

const printOfJsdom = (count: number, lock: string | undefined) => {
  const files = lock === undefined ? { "lib.js": LIB } : { "lib.js": LIB, "pnpm-lock.yaml": lock }
  const printed = printOf("a.test.js", jsdom(count), runner, sources(files))
  return printed._tag === "Printed" ? printed.print : undefined
}

describe("a print of a test that read dependency files", () => {
  it("names the lockfile once in place of every file in pnpm's store, and assumes it", () => {
    const print = printOfJsdom(3, LOCK)
    expect(print?.assumes).toEqual(["lockfile"])
    expect(print?.inputs.map((i) => i.path)).toEqual(["lib.js", "gone.json", "pnpm-lock.yaml"])
    expect(print?.inputs[2]).toEqual({
      _tag: "Exact",
      path: "pnpm-lock.yaml",
      facet: "content",
      value: sha(LOCK),
    })
  })

  it("differs once the lockfile does, and once a project file does", () => {
    const before = printOfJsdom(3, LOCK)
    expect(printOfJsdom(3, "lockfileVersion: '9.1'\n")).not.toEqual(before)
    const edited = printOf(
      "a.test.js",
      jsdom(3),
      runner,
      sources({ "lib.js": `${LIB}// edited\n`, "pnpm-lock.yaml": LOCK }),
    )
    expect(edited._tag === "Printed" ? edited.print.inputs[0] : undefined).toEqual({
      _tag: "Exact",
      path: "lib.js",
      facet: "content",
      value: sha(LIB),
    })
  })

  it("keeps each file as an input of its own where no lockfile stands above it", () => {
    const print = printOfJsdom(3, undefined)
    expect(print).not.toHaveProperty("assumes")
    expect(print?.inputs).toHaveLength(5)
  })

  it.each([
    ["a `file:` dependency", "/repo/node_modules/.pnpm/foo@file+..+foo/node_modules/foo/index.js"],
    [
      "a `link:` dependency",
      "/repo/node_modules/.pnpm/@s+foo@link+..+foo/node_modules/@s/foo/a.js",
    ],
    ["a link pnpm hoisted", "/repo/node_modules/.pnpm/node_modules/foo/index.js"],
  ])("keeps a file under %s an input of its own, so an edit behind it reruns", (_, path) => {
    const read = (text: string) => {
      const recording = unit({
        facts: [...unit().facts, { path, facet: "content", value: sha(text) }],
      })
      const files = sources({ "lib.js": LIB, "pnpm-lock.yaml": LOCK })
      const printed = printOf("a.test.js", recording, runner, files)
      return printed._tag === "Printed" ? printed.print : undefined
    }
    const before = read("export const foo = 1\n")
    expect(before).not.toHaveProperty("assumes")
    expect(before?.inputs).toContainEqual({
      _tag: "Exact",
      path: path.slice(6),
      facet: "content",
      value: sha("export const foo = 1\n"),
    })
    expect(read("export const foo = 2\n")?.inputs).not.toEqual(before?.inputs)
  })

  it("drops `kind` where `content` says it, and keeps it for a path that was absent", () => {
    expect(printOfJsdom(3, undefined)?.inputs.filter((i) => i._tag === "Exact")).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ facet: "kind", value: "file" })]),
    )
    expect(printOfJsdom(3, undefined)?.inputs).toContainEqual({
      _tag: "Exact",
      path: "gone.json",
      facet: "kind",
      value: "absent",
    })
  })

  it("is a small fraction of the size it was for a jsdom test reading 3000 of them", () => {
    const before = unfolded(jsdom(3000)).length
    const after = JSON.stringify(printOfJsdom(3000, LOCK)).length
    expect(before).toBeGreaterThan(800_000)
    expect(after).toBeLessThan(1_000)
  })
})

describe("a print of a test that ran a barrel", () => {
  const BARREL = 'export { unused } from "./lib.js"\n'
  const barrelUnit = (path: string): UnitRecording =>
    unit({
      scripts: [
        ...unit().scripts,
        { path, fresh: false },
        { path: "/repo/node_modules/x/i.js", fresh: false },
      ],
      facts: [
        ...unit().facts,
        { path, facet: "content", value: sha(BARREL) },
        { path: "/repo/node_modules/x/i.js", facet: "content", value: sha("") },
      ],
    })

  it("keeps it as a barrel with its text and every checkout source the test ran", () => {
    const printed = printOf(
      "a.test.js",
      barrelUnit("/repo/index.ts"),
      runner,
      sources({ "lib.js": LIB, "index.ts": BARREL }),
    )
    expect(printed._tag === "Printed" ? printed.print.inputs[1] : printed).toEqual({
      _tag: "Barrel",
      path: "index.ts",
      sha: sha(BARREL),
      loaded: ["index.ts", "lib.js"],
    })
    expect(printed._tag === "Printed" ? printed.texts.get(sha(BARREL)) : printed).toBe(BARREL)
  })

  it("keeps a barrel the test never ran, or one under node_modules, whole", () => {
    const read = unit({
      facts: [...unit().facts, { path: "/repo/index.ts", facet: "content", value: sha(BARREL) }],
    })
    const files = sources({ "lib.js": LIB, "index.ts": BARREL, "node_modules/x/index.ts": BARREL })
    const kept = printOf("a.test.js", read, runner, files)
    expect(kept._tag === "Printed" ? kept.print.inputs[1]?._tag : kept._tag).toBe("Exact")
    const dependency = printOf(
      "a.test.js",
      barrelUnit("/repo/node_modules/x/index.ts"),
      runner,
      files,
    )
    expect(
      dependency._tag === "Printed" ? dependency.print.inputs.map((i) => i._tag) : dependency._tag,
    ).not.toContain("Barrel")
  })
})

describe("an inline map", () => {
  it("drops the first generated line, where a wrapper shifts every column", () => {
    const map = inlineMap(GENERATED, LIB)
    expect(map?.mappings.map((m) => m.original)).toEqual(
      LIB.split("\n").map(
        (_, i) => LIB.split("\n").slice(0, i).join("\n").length + (i === 0 ? 0 : 1),
      ),
    )
  })

  it("is none for a map of several sources", () => {
    const map = { version: 3, sources: ["a.js", "b.js"], mappings: "AAAA" }
    const text = `x\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}`
    expect(inlineMap(text, "x")).toBeUndefined()
  })
})
