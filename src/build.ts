// `pnpm build` — the engine as one file that runs without this checkout.
//
// `esbuild` bundles `src/serve.ts`, `src/ork.ts`, the two recording files and
// `src/check-stages.ts` to `dist/`, dependencies included,
// and the assets `app/packaged.ts` names are copied beside them **at the path each has
// in the checkout** — that file's walk-up finds `dist/package.json` and reads every
// asset under it by the same relative path it uses from `src/`. So `dist/` is a
// package: `node dist/serve.js --dir <repo>` is `pnpm serve --dir <repo>` with nothing
// installed.
//
// `@effect/platform-node` is imported by submodule everywhere for `serve.ts`'s reason —
// its root index reaches `@effect/cluster`, a peer this project declined — and a bundler
// follows the same submodule files, so the peer is never resolved. A future import of
// the package root would fail here, at build time, rather than at the user's machine.
//
// The client is copied as found: `client/dist` is a build artefact of its own (`pnpm --filter @orkestra/client build`), and a missing one is
// reported rather than built, so this step does one thing and the person running it knows which half is old.
//
// `buildEngine` is the same build as a function, so a host can add bundles and assets of its
// own on top of the engine's without copying this file. Run as a script, this file calls it
// with none.

import { realpathSync } from "node:fs"
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { CLIENT_DIST, PACKAGE_ROOT, SHIPPED_AGENTS, TEMPLATES, version } from "./app/packaged.js"

/**
 * One bundle: `in` is the source file, `out` its name under `dist/` without `.js`. A host
 * names `out` itself, because esbuild otherwise places each output by the entry points'
 * common ancestor, and an entry outside `src/` would move every bundle the engine writes.
 */
export interface BuildEntry {
  readonly in: string
  readonly out: string
}

/**
 * Something a bundle reads at runtime: `source` is copied to `at` under `dist/`. `at` is the
 * path the reader resolves from its own package root, which is what it finds walking up from
 * `dist/` once bundled.
 */
export interface BuildAsset {
  readonly source: string
  readonly at: string
}

export interface BuildOptions {
  /** Where the build lands; `dist/` under the engine's package root when absent. */
  readonly out?: string
  /** Writes esbuild's inputs and outputs here, for a caller that must name what it read. */
  readonly metafile?: string
  /** Bundles built beside the engine's, with the same settings. */
  readonly entryPoints?: readonly BuildEntry[]
  /** Copied beside the engine's assets. */
  readonly assets?: readonly BuildAsset[]
}

const engineEntry = (name: string): BuildEntry => ({
  in: join(PACKAGE_ROOT, "src", `${name}.ts`),
  out: name,
})

const ENTRY_POINTS = ["serve", "ork", "recording-hook", "recording-vitest", "check-stages"].map(
  engineEntry,
)

const engineAsset = (source: string): BuildAsset => ({
  source,
  at: relative(PACKAGE_ROOT, source),
})

/** Everything the bundle reads at runtime, and where each lands under `dist/`. */
const ASSETS = [TEMPLATES, SHIPPED_AGENTS, CLIENT_DIST].map(engineAsset)

const copyAsset = async (dist: string, asset: BuildAsset): Promise<string> => {
  const present = await stat(asset.source).catch(() => undefined)
  if (present === undefined) return `${asset.at}: missing — not copied`
  await cp(asset.source, join(dist, asset.at), { recursive: true })
  return `${asset.at}: copied`
}

/** Bundle the engine to `dist/` with its assets, and with whatever a host adds. */
export const buildEngine = async (options: BuildOptions = {}): Promise<void> => {
  const dist = options.out ?? join(PACKAGE_ROOT, "dist")
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })

  const built = await build({
    metafile: options.metafile !== undefined,
    entryPoints: [...ENTRY_POINTS, ...(options.entryPoints ?? [])],
    outdir: dist,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Dependencies written as CommonJS `require("node:…")` are rewritten by esbuild into a
    // shim that throws at runtime under ESM output. A real `require` in scope is what the
    // shim reaches for first.
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
    logLevel: "warning",
  })

  if (options.metafile !== undefined) {
    await writeFile(
      options.metafile,
      JSON.stringify({ inputs: built.metafile?.inputs, outputs: built.metafile?.outputs }),
    )
  }

  // `type: module` is what makes `dist/*.js` run as ESM; `version` is what `packaged.ts`
  // reads back for `/api/health`.
  await writeFile(
    join(dist, "package.json"),
    `${JSON.stringify({ name: "orkestra", version: version(), private: true, type: "module" }, undefined, 2)}\n`,
  )

  const assets = [...ASSETS, ...(options.assets ?? [])]
  for (const line of await Promise.all(assets.map((asset) => copyAsset(dist, asset)))) {
    console.log(line)
  }
  console.log(
    `built serve.js, ork.js, the recording hook and check-stages.js in ${relative(process.cwd(), dist) || "."}, version ${version()}`,
  )
}

/** The value after `flag` on the command line, resolved; `fallback` when it has none. */
const flagPath = (flag: string, fallback: string): string | undefined => {
  const at = process.argv.indexOf(flag)
  return at < 0 ? undefined : resolve(process.argv[at + 1] ?? fallback)
}

// Only when run as `pnpm build`: a host importing `buildEngine` must not start a build by
// importing it.
const entry = process.argv[1]
if (entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  // `--out <dir>` builds somewhere else, so a test can build without replacing the `dist/` a
  // running engine serves from. `--metafile <file>` writes esbuild's account of the build
  // there: every source the bundle read, which a test that builds has to name as its inputs,
  // since no hook sees esbuild read.
  const out = flagPath("--out", "dist")
  const metafile = flagPath("--metafile", "meta.json")
  await buildEngine({
    ...(out === undefined ? {} : { out }),
    ...(metafile === undefined ? {} : { metafile }),
  })
}
