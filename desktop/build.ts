// `pnpm --filter @orkestra/desktop build` — the main process and the three preloads, as
// the four files Electron loads.
//
// Electron runs JavaScript, not TypeScript, and its main process is not started through
// `tsx`, so the shell is bundled the way the engine is: `esbuild` writes `dist/main.js`
// with `src/app/discovery.ts`, `src/supervisor/` and what they reach folded in. `electron` stays external —
// it is the host, not a dependency to carry. Each preload is a `.cjs`: a sandboxed
// preload is loaded as CommonJS, and an ESM one fails at window creation.
//
// This builds the shell only. The engine it spawns is the root `pnpm build`'s
// `dist/serve.js`, which `src/main.ts` locates and checks for before the first window.

import { mkdir, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, "dist")

await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })

await build({
  entryPoints: [join(HERE, "src", "main.ts")],
  outdir: DIST,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron"],
  // Dependencies written as CommonJS `require("node:…")` are rewritten by esbuild into a
  // shim that throws at runtime under ESM output. A real `require` in scope is what the
  // shim reaches for first.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  logLevel: "warning",
})

await Promise.all(
  ["preload", "page-preload", "rail-preload"].map((preload) =>
    build({
      entryPoints: [join(HERE, "src", `${preload}.ts`)],
      outfile: join(DIST, `${preload}.cjs`),
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      external: ["electron"],
      logLevel: "warning",
    }),
  ),
)

console.log("built desktop/dist/main.js, preload.cjs, page-preload.cjs and rail-preload.cjs")
