// Where this build of Orkestra keeps what it ships: the prompt templates, the shipped
// agent file, the built client and its own version.
//
// Two layouts, one root. From the checkout, every entry point runs `src/` under `tsx`;
// from `pnpm build`, one `dist/serve.js` runs with every asset copied beside it at the
// path it has in the checkout. A module cannot find an asset by its distance from
// itself — the bundle collapses every module into one file, so `import.meta.url` names
// `dist/serve.js` for all of them — and `process.cwd()` is the repository being driven,
// which never holds these. So the root is found the way Node finds a package: walk up
// from this module to the nearest `package.json`. That is the checkout from `src/app/`,
// and `dist/` from the bundle, where `build.ts` writes one for exactly this purpose.
//
// **Every path here is the same relative path in both layouts**, because `build.ts`
// copies each asset to where it sits in the checkout. It copies the list its own
// `ASSETS` names, though — so a path added here must be added there as well. Miss it
// and `pnpm build` still succeeds; the bundle is simply short an asset, which an
// eagerly-read one turns into a boot that fails and a lazily-read one into a request
// that does, once.

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The nearest directory at or above `from` holding a `package.json`. Throws rather
 * than guessing: a module with no package above it is a broken install, and every
 * read below would fail one turn later with a path that explains nothing.
 */
export const packageRoot = (from: string): string => {
  let dir = from
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir
    const up = dirname(dir)
    if (up === dir) throw new Error(`no package.json at or above ${from}`)
    dir = up
  }
}

export const PACKAGE_ROOT = packageRoot(dirname(fileURLToPath(import.meta.url)))

/** The prompt templates, one `<name>.md` per `TemplateName`. */
export const TEMPLATES = join(PACKAGE_ROOT, "src", "prompts", "templates")

/**
 * What Orkestra ships of policy: `generic.md`, and `agents/` and `checks/` — the fleet and
 * the scripts every project starts from, written as a `.orkestra/` would write them.
 */
export const SHIPPED_AGENTS = join(PACKAGE_ROOT, "src", "library", "shipped")

/** Where `pnpm --filter @orkestra/client build` writes, and what the engine serves at `/`. */
export const CLIENT_DIST = join(PACKAGE_ROOT, "client", "dist")

/**
 * The `ork` entry point, which a session's tool server runs as `orkestra trak-tools` or
 * `orkestra goal-tools`: `src/ork.ts` in the checkout and `ork.js` in the bundle. Not an
 * asset `build.ts` copies — the bundle is where `ork.js` is built — so it is the one path
 * here that differs between the two layouts, and the source file being present is what
 * says which one this is.
 */
export const ORK_ENTRY = existsSync(join(PACKAGE_ROOT, "src", "ork.ts"))
  ? join(PACKAGE_ROOT, "src", "ork.ts")
  : join(PACKAGE_ROOT, "ork.js")

/**
 * The version in the package's own `package.json` — what `/api/health` reports and
 * `ork --version` prints. `build.ts` writes the same number into `dist/package.json`.
 */
export const version = (): string => {
  const parsed: unknown = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"))
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) return "unknown"
  return typeof parsed.version === "string" ? parsed.version : "unknown"
}

/**
 * The recording hook a check with `fingerprint:` loads into every Node process it starts,
 * and the setup file its test runner lists: `src/recording-*.ts` in the checkout — the
 * hook run as a copy `checks-shell.ts` strips of its types, the setup file by the project's
 * runner — and `recording-*.js` in the bundle. Told apart as `ORK_ENTRY` is.
 */
export const RECORDING = existsSync(join(PACKAGE_ROOT, "src", "recording-hook.ts"))
  ? {
      hook: join(PACKAGE_ROOT, "src", "recording-hook.ts"),
      vitest: join(PACKAGE_ROOT, "src", "recording-vitest.ts"),
    }
  : {
      hook: join(PACKAGE_ROOT, "recording-hook.js"),
      vitest: join(PACKAGE_ROOT, "recording-vitest.js"),
    }

/**
 * The stage runner every check is handed as `ORKESTRA_STAGES`: `src/check-stages.ts` in the
 * checkout, which Node runs with its types stripped, and `check-stages.js` in the bundle.
 * Told apart as `ORK_ENTRY` is.
 */
export const CHECK_STAGES = existsSync(join(PACKAGE_ROOT, "src", "check-stages.ts"))
  ? join(PACKAGE_ROOT, "src", "check-stages.ts")
  : join(PACKAGE_ROOT, "check-stages.js")
