// `pnpm --filter @orkestra/desktop package` — `Orkestra.app` and a `.dmg` of it, for
// macOS, ad-hoc signed and not notarized.
//
// Two inputs, both built first and reported by name when missing: the shell (this
// package's `dist/`, its `build` — `main.js` and the two windows' preloads) and
// the engine (the root's `dist/`, `pnpm build`, which carries the built client and so the
// launch window's page). The engine lands whole at `Contents/Resources/engine/`, which is
// where `src/main.ts` looks once `app.isPackaged`; the app itself is the shell's `dist/`
// and a `package.json` and nothing else, since `electron` is the host and everything
// else is folded into the bundles.
//
// Ad-hoc signing (`codesign --sign -`) is what "unsigned" means on Apple silicon: a
// binary with no signature at all does not launch. It needs no account, and it still
// leaves the recipient one step — System Settings → Privacy & Security → Open Anyway
// on first launch, since macOS 15 removed the right-click bypass.

import { execFile } from "node:child_process"
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { packager } from "@electron/packager"

const run = promisify(execFile)

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..")
const BUILD = join(HERE, "build")

const SHELL_DIST = join(HERE, "dist")
const SHELL = join(SHELL_DIST, "main.js")
const PRELOAD = join(SHELL_DIST, "preload.cjs")
const PAGE_PRELOAD = join(SHELL_DIST, "page-preload.cjs")
const ENGINE = join(ROOT, "dist", "serve.js")

const NAME = "Orkestra"
const BUNDLE_ID = "dev.orkestra.desktop"

// The client's PWA artwork is the icon, converted here rather than committed twice.
const ICON_SOURCE = join(ROOT, "client", "public", "icon-512.png")

/**
 * The `.iconset` members and the pixels each holds. 512 is the largest the artwork
 * has, so the set stops at `icon_512x512` — upscaling to the 1024 that
 * `icon_512x512@2x` wants would only blur it, and macOS scales from the sizes present.
 */
const ICONSET: Readonly<Record<string, number>> = {
  "icon_16x16.png": 16,
  "icon_16x16@2x.png": 32,
  "icon_32x32.png": 32,
  "icon_32x32@2x.png": 64,
  "icon_128x128.png": 128,
  "icon_128x128@2x.png": 256,
  "icon_256x256.png": 256,
  "icon_256x256@2x.png": 512,
  "icon_512x512.png": 512,
}

/** `sips` and `iconutil` are macOS's own, like `hdiutil` below. */
const buildIcon = async (): Promise<string> => {
  const iconset = join(BUILD, "icon.iconset")
  await mkdir(iconset, { recursive: true })
  await Promise.all(
    Object.entries(ICONSET).map(([name, pixels]) => {
      const edge = String(pixels)
      return run("sips", ["-z", edge, edge, ICON_SOURCE, "--out", join(iconset, name)])
    }),
  )
  const icon = join(BUILD, "icon.icns")
  await run("iconutil", ["-c", "icns", iconset, "-o", icon])
  return icon
}

const manifestOf = (text: string): { version: string; electron: string } => {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== "object" || parsed === null)
    throw new Error("package.json is not an object")
  const version =
    "version" in parsed && typeof parsed.version === "string" ? parsed.version : undefined
  const dev =
    "devDependencies" in parsed && typeof parsed.devDependencies === "object"
      ? parsed.devDependencies
      : undefined
  const electron =
    dev !== null && dev !== undefined && "electron" in dev && typeof dev.electron === "string"
      ? dev.electron
      : undefined
  return { version: version ?? "0.0.0", electron: electron ?? "" }
}

const present = async (path: string, writtenBy: string): Promise<void> => {
  await readFile(path).catch(() => {
    throw new Error(`${path} is missing — \`${writtenBy}\` writes it`)
  })
}

await present(SHELL, "pnpm --filter @orkestra/desktop build")
await present(PRELOAD, "pnpm --filter @orkestra/desktop build")
await present(PAGE_PRELOAD, "pnpm --filter @orkestra/desktop build")
await present(ENGINE, "pnpm build")
await present(ICON_SOURCE, "git checkout -- client/public")

const { version } = manifestOf(await readFile(join(ROOT, "package.json"), "utf8"))
const { electron } = manifestOf(await readFile(join(HERE, "package.json"), "utf8"))
if (electron === "") throw new Error("desktop/package.json does not pin electron")
const arch = process.arch === "arm64" ? "arm64" : "x64"

await rm(BUILD, { recursive: true, force: true })

// The app's own contents: the shell's `dist/` whole — the main bundle and the preload
// beside it, which `main.ts` finds at `dist/preload.cjs` off the app path in both layouts
// — and a manifest naming `main`. The directory rather than one named file, so a second
// output is not something the dev run has and the installed app is missing.
const app = join(BUILD, "app")
await mkdir(app, { recursive: true })
await cp(SHELL_DIST, join(app, "dist"), { recursive: true })
await writeFile(
  join(app, "package.json"),
  `${JSON.stringify({ name: NAME, version, private: true, type: "module", main: "dist/main.js" }, undefined, 2)}\n`,
)

// The engine, copied under the name `main.ts` expects; `extraResource` keeps a
// directory's basename when it lands under `Contents/Resources`.
const engine = join(BUILD, "engine")
await cp(dirname(ENGINE), engine, { recursive: true })

const icon = await buildIcon()

const [bundle] = await packager({
  dir: app,
  out: BUILD,
  name: NAME,
  appBundleId: BUNDLE_ID,
  appVersion: version,
  platform: "darwin",
  arch,
  electronVersion: electron,
  icon,
  extraResource: [engine],
  overwrite: true,
  prune: false,
  quiet: true,
})
if (bundle === undefined) throw new Error("packager produced nothing")
const appBundle = join(bundle, `${NAME}.app`)

await run("codesign", ["--force", "--deep", "--sign", "-", appBundle])

// A folder holding the app beside a link to /Applications is the ordinary drag-to-install
// image; `hdiutil` is macOS's own and needs nothing installed. The volume icon has to be
// flagged on the mounted volume — a Finder flag on the source folder does not survive
// `-srcfolder` — so the image is created read-write, flagged, and converted to the
// compressed one that ships.
const image = join(BUILD, "image")
await mkdir(image, { recursive: true })
await cp(appBundle, join(image, `${NAME}.app`), { recursive: true, verbatimSymlinks: true })
await symlink("/Applications", join(image, "Applications"))
await cp(icon, join(image, ".VolumeIcon.icns"))
const rw = join(BUILD, "rw.dmg")
await run("hdiutil", [
  "create",
  "-volname",
  NAME,
  "-srcfolder",
  image,
  "-ov",
  "-format",
  "UDRW",
  rw,
])
const mount = join(BUILD, "mnt")
await run("hdiutil", ["attach", rw, "-nobrowse", "-mountpoint", mount])
// `kHasCustomIcon` in the volume root's Finder flags; every other byte stays zero.
const CUSTOM_ICON = "0000000000000000040000000000000000000000000000000000000000000000"
await run("xattr", ["-wx", "com.apple.FinderInfo", CUSTOM_ICON, mount])
await run("hdiutil", ["detach", mount])
const dmg = join(BUILD, `${NAME}-${version}-${arch}.dmg`)
await run("hdiutil", ["convert", rw, "-format", "UDZO", "-o", dmg])
await rm(rw)

console.log(`packaged ${appBundle}`)
console.log(`wrote ${dmg}`)
