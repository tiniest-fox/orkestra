// `pnpm build`, into a directory of the test's own so a running engine's `dist/` is left
// alone: the bundle holds each entry point beside the engine, and a host calling
// `buildEngine` gets its own bundles and assets beside the engine's.
//
// **esbuild's reads are this file's to name.** Its binary reads every source the bundle
// holds where no recording hook sees it, so the build is handed `ORKESTRA_RECORDING_VOUCHED`
// and this file reads each input esbuild's metafile lists, with every `package.json` that
// decided how one resolved. Without those reads the file would be skipped after an edit to
// a source only the bundle holds.

import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const TSX = join(process.cwd(), "node_modules", ".bin", "tsx")
let out = ""
let host = ""

/** Read the first `name` at or above `from`, unless a directory on the way was walked. */
const readNearest = (from: string, name: string, walked: Set<string>): void => {
  for (let dir = from; !walked.has(dir); dir = dirname(dir)) {
    walked.add(dir)
    const at = join(dir, name)
    if (existsSync(at)) {
      readFileSync(at)
      return
    }
    if (dirname(dir) === dir) return
  }
}

/**
 * Every source esbuild read, with the nearest `package.json` and `tsconfig.json` to each,
 * which decide how it resolved and compiled. The root `tsconfig.json` is recorded for every
 * file; `shared/`'s is not.
 */
const readInputs = (metafile: string): void => {
  const meta: unknown = JSON.parse(readFileSync(metafile, "utf8"))
  const inputs: unknown =
    typeof meta === "object" && meta !== null ? Reflect.get(meta, "inputs") : {}
  const manifests = new Set<string>()
  const tsconfigs = new Set<string>()
  for (const input of Object.keys(typeof inputs === "object" && inputs !== null ? inputs : {})) {
    const path = resolve(input)
    readFileSync(path)
    readNearest(dirname(path), "package.json", manifests)
    readNearest(dirname(path), "tsconfig.json", tsconfigs)
  }
}

/** A host's build script, in the test's own directory, adding one bundle and one asset. */
const hostScript = (dir: string): string => {
  const engine = pathToFileURL(join(process.cwd(), "src", "build.ts")).href
  const root = process.cwd()
  return `import { buildEngine } from ${JSON.stringify(engine)}
await buildEngine({
  out: ${JSON.stringify(join(dir, "dist"))},
  metafile: ${JSON.stringify(join(dir, "meta.json"))},
  entryPoints: [{ in: ${JSON.stringify(join(root, "src", "check-stages.ts"))}, out: "host/stages" }],
  assets: [{ source: ${JSON.stringify(join(dir, "build.mts"))}, at: "host/build.mts" }],
})
`
}

const buildAsScript = async (): Promise<void> => {
  out = await mkdtemp(join(tmpdir(), "orkestra-build-"))
  const metafile = join(out, "meta.json")
  await promisify(execFile)(TSX, ["src/build.ts", "--out", out, "--metafile", metafile], {
    env: { ...process.env, ORKESTRA_RECORDING_VOUCHED: "esbuild" },
  })
  readInputs(metafile)
}

const buildAsHost = async (): Promise<void> => {
  host = await mkdtemp(join(tmpdir(), "orkestra-host-build-"))
  const script = join(host, "build.mts")
  await writeFile(script, hostScript(host))
  await promisify(execFile)(TSX, [script], {
    env: { ...process.env, ORKESTRA_RECORDING_VOUCHED: "esbuild" },
  })
  readInputs(join(host, "meta.json"))
}

beforeAll(async () => {
  await Promise.all([buildAsScript(), buildAsHost()])
}, 120_000)

afterAll(async () => {
  await rm(out, { recursive: true, force: true })
  await rm(host, { recursive: true, force: true })
})

describe("pnpm build", () => {
  it("bundles each entry point beside the engine", () => {
    for (const entry of ["serve.js", "ork.js", "recording-hook.js", "check-stages.js"]) {
      expect(existsSync(join(out, entry))).toBe(true)
    }
  })

  it("builds a host's entry points and assets beside the engine's", () => {
    for (const file of ["serve.js", "host/stages.js", "host/build.mts", "src/prompts/templates"]) {
      expect(existsSync(join(host, "dist", file))).toBe(true)
    }
  })
})
