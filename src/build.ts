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

import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { build } from "esbuild"
import { CLIENT_DIST, PACKAGE_ROOT, SHIPPED_AGENTS, TEMPLATES, version } from "./app/packaged.js"

// `--out <dir>` builds somewhere else, so a test can build without replacing the `dist/` a
// running engine serves from.
const out = process.argv.indexOf("--out")
const DIST = out < 0 ? join(PACKAGE_ROOT, "dist") : resolve(process.argv[out + 1] ?? "dist")

// `--metafile <file>` writes esbuild's account of the build there: every source the bundle
// read, which a test that builds has to name as its inputs, since no hook sees esbuild read.
const meta = process.argv.indexOf("--metafile")
const METAFILE = meta < 0 ? undefined : resolve(process.argv[meta + 1] ?? "meta.json")

/** Everything the bundle reads at runtime, and where each lands under `dist/`. */
const ASSETS = [TEMPLATES, SHIPPED_AGENTS, CLIENT_DIST]

const copyAsset = async (source: string): Promise<string> => {
  const at = relative(PACKAGE_ROOT, source)
  const present = await stat(source).catch(() => undefined)
  if (present === undefined) return `${at}: missing — not copied`
  await cp(source, join(DIST, at), { recursive: true })
  return `${at}: copied`
}

await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })

const built = await build({
  metafile: METAFILE !== undefined,
  entryPoints: [
    join(PACKAGE_ROOT, "src", "serve.ts"),
    join(PACKAGE_ROOT, "src", "ork.ts"),
    join(PACKAGE_ROOT, "src", "recording-hook.ts"),
    join(PACKAGE_ROOT, "src", "recording-vitest.ts"),
    join(PACKAGE_ROOT, "src", "check-stages.ts"),
  ],
  outdir: DIST,
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

if (METAFILE !== undefined) {
  await writeFile(
    METAFILE,
    JSON.stringify({ inputs: built.metafile?.inputs, outputs: built.metafile?.outputs }),
  )
}

// `type: module` is what makes `dist/*.js` run as ESM; `version` is what `packaged.ts`
// reads back for `/api/health`.
await writeFile(
  join(DIST, "package.json"),
  `${JSON.stringify({ name: "orkestra", version: version(), private: true, type: "module" }, undefined, 2)}\n`,
)

for (const line of await Promise.all(ASSETS.map(copyAsset))) console.log(line)
console.log(
  `built serve.js, ork.js, the recording hook and check-stages.js in ${relative(process.cwd(), DIST) || "."}, version ${version()}`,
)
