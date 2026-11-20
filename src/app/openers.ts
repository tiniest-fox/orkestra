// The person's terminal and editor, opened at a trak's checkout — macOS only. Every other
// platform gets the service too, and it refuses each press as `unsupported` without
// running anything, so a headless engine on Linux answers the routes rather than failing.
//
// Here rather than in `workflow/` for `records.ts`'s reason: it drives nothing, takes no
// custody and touches no trak's state. It answers three questions per kind — which
// openers this machine has, which one to open, and open it *here* — with tools macOS
// already ships: `plutil` reads each application's `Info.plist`, `sips` converts its icon
// to PNG, and `open -b <bundle-id> <dir>` starts a login shell, or a window on the folder,
// at the directory. No native code and nothing spent. A checkout in a sandbox has no
// directory here, so its terminal runs a command instead — `launchInTerminal`.
//
// **Two kinds behind one sweep.** A terminal and an editor differ only in the claim the
// scan keeps them for, and every other part — the plist read, the icon, the walk up the
// process tree, the stored pick — is one fact about one machine. Two modules would be two
// copies of it, drifting.
//
// **Which opener is preferred is Orkestra's own record, because macOS has none.** The
// system keeps a default browser and a default mail client and no terminal or editor
// equivalent, and its shell-role fallback names Apple's Terminal whatever the person
// actually runs. So each pick is stored once per machine — not per project — and written
// only by an explicit choice. With nothing stored, a guess runs per request: the opener
// the engine was started from, else the list's best.
//
// The scan keeps a bundle as a terminal only when it declares the `Shell` role on
// `public.unix-executable` — the role alone is not enough (Slack declares `Shell` for
// its `.slacktoken` files), and the pair is exactly what Launch Services' own shell-role
// query filters on. It keeps a bundle as an editor when it declares the `Editor` role on
// `public.folder` in an entry that names no image or audiovisual type — QuickTime Player
// claims folders beside JPEG, PNG, TIFF and HEIF, as an image sequence to play, and that
// is the shape the media check drops. **QuickTime itself is out of reach**: it lives in
// `/System/Applications`, which `applicationDirs` does not read, so the check answers a
// media player installed alongside a person's editors rather than one already found. The
// sweep sees only the standard application folders where the system API sees every
// registered app; the API needs a compiled helper, and the sweep returned the identical
// list, so the helper lost.

// oxlint-disable-next-line eslint/no-restricted-imports -- a terminal or editor a person pressed for, and ps
import { execFile, spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { basename, isAbsolute, join } from "node:path"
import { promisify } from "node:util"
import { type Cause, Context, Effect, Layer, Schema } from "effect"
import { environmentBlock } from "../agent/logic/spawn-env.js"

const run = promisify(execFile)

/** What an opener opens a checkout as: a shell in it, or a window on it. */
export type OpenerKind = "terminal" | "editor"

const KINDS: readonly OpenerKind[] = ["terminal", "editor"]

// ============================================================================
// The scan — pure over one plist, I/O over the application folders
// ============================================================================

/**
 * The slice of an `Info.plist` the scan reads. Excess keys are ignored by the decode,
 * which is the point: a plist is a large document and these six answers are the whole
 * of what an opener has to say for itself.
 */
const DocumentType = Schema.Struct({
  CFBundleTypeRole: Schema.optional(Schema.String),
  LSItemContentTypes: Schema.optional(Schema.Array(Schema.String)),
})
type DocumentType = Schema.Schema.Type<typeof DocumentType>

const InfoPlist = Schema.Struct({
  CFBundleIdentifier: Schema.optional(Schema.String),
  CFBundleName: Schema.optional(Schema.String),
  CFBundleDisplayName: Schema.optional(Schema.String),
  CFBundleIconFile: Schema.optional(Schema.String),
  CFBundleDocumentTypes: Schema.optional(Schema.Array(DocumentType)),
})

/** One installed opener, as the scan sees it. `icon` waits for `iconDataUrl`. */
export interface OpenerApp {
  /** The bundle identifier — what is stored, compared and handed to `open -b`. */
  readonly id: string
  readonly name: string
  /** The application bundle on disk — what the parent-process walk is matched against. */
  readonly path: string
  /** The icon's filename inside `Contents/Resources`, or none declared. */
  readonly iconFile: string | undefined
  /** Which kinds the bundle declares — at least one, or the scan would have dropped it. */
  readonly kinds: readonly OpenerKind[]
}

/**
 * The content types a folder claim shares its entry with when the app is a media
 * player rather than an editor. Rejecting on a named media type rather than accepting
 * only on a named text type errs long on purpose: a silly extra row in a menu costs one
 * glance, and a missing editor is the feature failing — VS Code's folder entry names no
 * text type at all.
 */
const MEDIA_TYPES: ReadonlySet<string> = new Set([
  "public.image",
  "public.jpeg",
  "public.png",
  "public.tiff",
  "public.heif",
  "public.heic",
  "public.camera-raw-image",
  "public.audiovisual-content",
  "public.movie",
  "public.video",
  "public.audio",
  "public.mpeg-4",
  "com.apple.quicktime-movie",
])

const isTerminalClaim = (t: DocumentType): boolean =>
  t.CFBundleTypeRole === "Shell" && (t.LSItemContentTypes ?? []).includes("public.unix-executable")

const isEditorClaim = (t: DocumentType): boolean => {
  const types = t.LSItemContentTypes ?? []
  return (
    t.CFBundleTypeRole === "Editor" &&
    types.includes("public.folder") &&
    !types.some((type) => MEDIA_TYPES.has(type))
  )
}

const CLAIMS: Readonly<Record<OpenerKind, (t: DocumentType) => boolean>> = {
  terminal: isTerminalClaim,
  editor: isEditorClaim,
}

/**
 * The opener a bundle's `Info.plist` declares, or `undefined` for everything else — an
 * app with neither claim, a claim on another content type, a plist missing its
 * identifier, and a document this schema cannot read at all, which for a scan over
 * every installed application is an app to skip rather than a failure to report.
 */
export const openerFromPlist = (bundlePath: string, plist: unknown): OpenerApp | undefined => {
  const decoded = Schema.decodeUnknownEither(InfoPlist)(plist)
  if (decoded._tag === "Left") return undefined
  const info = decoded.right
  const types = info.CFBundleDocumentTypes ?? []
  const kinds = KINDS.filter((kind) => types.some(CLAIMS[kind]))
  if (kinds.length === 0 || info.CFBundleIdentifier === undefined) return undefined
  return {
    id: info.CFBundleIdentifier,
    name: info.CFBundleDisplayName ?? info.CFBundleName ?? basename(bundlePath, ".app"),
    path: bundlePath,
    iconFile: info.CFBundleIconFile,
    kinds,
  }
}

/**
 * Where applications live. `/System/Applications/Utilities` is load-bearing: Apple's
 * Terminal is there and nowhere else.
 */
const applicationDirs = (): readonly string[] => [
  "/Applications",
  "/System/Applications/Utilities",
  join(homedir(), "Applications"),
]

/**
 * The `.app` bundles in one folder. A folder that cannot be listed — absent on this
 * machine, or unreadable — contributes nothing rather than failing the scan: the safe
 * direction is a shorter list, which at worst hides an opener from the dropdown.
 */
const bundlesIn = async (dir: string): Promise<readonly string[]> => {
  try {
    const entries = await readdir(dir)
    return entries.filter((entry) => entry.endsWith(".app")).map((entry) => join(dir, entry))
  } catch {
    return []
  }
}

/** `plutil` converts the plist — XML or binary — to JSON; rejects where it cannot. */
const plistJson = async (bundle: string): Promise<unknown> => {
  const { stdout } = await run("plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    join(bundle, "Contents", "Info.plist"),
  ])
  return JSON.parse(stdout)
}

/**
 * Every opener in the standard folders, sorted by name so the dropdown is stable.
 * A bundle whose plist will not read is skipped for `bundlesIn`'s reason.
 */
const scan = async (): Promise<readonly OpenerApp[]> => {
  const bundles = (await Promise.all(applicationDirs().map(bundlesIn))).flat()
  const apps = await Promise.all(
    bundles.map(async (bundle) => {
      try {
        return openerFromPlist(bundle, await plistJson(bundle))
      } catch {
        return undefined
      }
    }),
  )
  return apps
    .flatMap((app) => (app === undefined ? [] : [app]))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const ofKind = (apps: readonly OpenerApp[], kind: OpenerKind): readonly OpenerApp[] =>
  apps.filter((app) => app.kinds.includes(kind))

// ============================================================================
// The icon — `sips` to PNG, inlined as a data URL
// ============================================================================

/**
 * The bundle's icon as a `data:image/png;base64,…` URL, or `undefined` where there is
 * nothing to draw — no declared icon file, or one `sips` cannot read, which is what an
 * app shipping its artwork only inside a compiled asset catalogue looks like. The
 * surface draws a plain glyph and the name for those, so absent is an answer.
 */
const iconDataUrl = async (app: OpenerApp): Promise<string | undefined> => {
  if (app.iconFile === undefined) return undefined
  // The plist may name the icon with or without its extension; on disk it has one.
  const named = app.iconFile.includes(".") ? app.iconFile : `${app.iconFile}.icns`
  const icns = join(app.path, "Contents", "Resources", named)
  const scratch = await mkdtemp(join(tmpdir(), "orkestra-icon-"))
  try {
    const out = join(scratch, "icon.png")
    await run("sips", ["-s", "format", "png", "-Z", "64", icns, "--out", out])
    const bytes = await readFile(out)
    return `data:image/png;base64,${bytes.toString("base64")}`
  } catch {
    return undefined
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

// ============================================================================
// The guess — the opener the engine came from, else the list's best
// ============================================================================

/** The application bundle an executable path is inside, or `undefined` for a bare one. */
export const bundleOf = (executable: string): string | undefined => {
  const at = executable.indexOf(".app/")
  return at === -1 ? undefined : executable.slice(0, at + ".app".length)
}

/** One `ps -o ppid=,comm=` line: the parent pid and the executable's path. */
export const psLine = (line: string): { ppid: number; command: string } | undefined => {
  // No `$` anchor: `ps` ends its line with a newline, which `$` refuses and `.` stops at.
  const match = /^\s*(\d+)\s+(.+)/.exec(line)
  if (match === null) return undefined
  const ppid = Number(match[1])
  const command = (match[2] ?? "").trim()
  return Number.isFinite(ppid) && command !== "" ? { ppid, command } : undefined
}

/**
 * The first application bundle above this process, or `undefined` — the walk from a
 * shell ends at the terminal that started it, from an editor's own terminal at that
 * editor, and from the Orkestra app at `Orkestra.app`, which `guessFrom` then declines
 * to match. Recursive for the reason `discovery.ts`'s `pickPair` is: each `ps` is only
 * worth running once the one below it has answered. A pid that vanishes mid-walk, or
 * output that will not parse, ends the walk with no answer — the guess has more rules
 * behind this one.
 */
const startedFromBundle = async (pid: number, left: number): Promise<string | undefined> => {
  if (left === 0 || pid <= 1) return undefined
  let line: string
  try {
    line = (await run("ps", ["-o", "ppid=,comm=", "-p", String(pid)])).stdout
  } catch {
    return undefined
  }
  const parsed = psLine(line)
  if (parsed === undefined) return undefined
  return bundleOf(parsed.command) ?? startedFromBundle(parsed.ppid, left - 1)
}

const APPLE_TERMINAL = "com.apple.Terminal"

/** How far up the process tree the walk goes before giving up. */
const WALK_DEPTH = 40

/**
 * The guess, given the openers of one kind and where the engine came from: the one the
 * engine was started from, else — for a terminal — the first that is not Apple's, else
 * whatever is first.
 *
 * Apple's Terminal is last by design: it is the one terminal always installed, so
 * preferring it would make the guess constant — and the person who installed another
 * terminal did not install it to see Apple's open. An editor has no such constant —
 * Xcode is a legitimate pick — so nothing is demoted there.
 */
export const guessFrom = (
  kind: OpenerKind,
  apps: readonly OpenerApp[],
  startedFrom: string | undefined,
): OpenerApp | undefined =>
  apps.find((app) => app.path === startedFrom) ??
  (kind === "terminal" ? apps.find((app) => app.id !== APPLE_TERMINAL) : undefined) ??
  apps[0]

// ============================================================================
// The preference — one bundle identifier per kind, once per machine
// ============================================================================

/**
 * Where the once-per-machine picks live. On macOS, `~/Library/Application Support/Orkestra/`
 * — the same directory the desktop shell computes through Electron for `recents.json`
 * (`desktop/src/main.ts`). The engine has no Electron, so the spelling lives here too; the
 * two must keep agreeing, and each file says so at its site. Everywhere else,
 * `$XDG_CONFIG_HOME/orkestra`, or `~/.config/orkestra` where that is unset — a relative
 * value is ignored, as the XDG specification says it must be.
 */
export const preferenceDirOn = (
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string => {
  if (platform === "darwin") return join(home, "Library", "Application Support", "Orkestra")
  const xdg = env["XDG_CONFIG_HOME"]
  return join(xdg !== undefined && isAbsolute(xdg) ? xdg : join(home, ".config"), "orkestra")
}

const preferenceDir = (): string => preferenceDirOn(process.platform, process.env, homedir())

const preferencePath = (): string => join(preferenceDir(), "openers.json")

const StoredChoices = Schema.Struct({
  terminal: Schema.optional(Schema.String),
  editor: Schema.optional(Schema.String),
})
type StoredChoices = Schema.Schema.Type<typeof StoredChoices>

/**
 * The stored picks, or none — absent, unreadable and undecodable all mean the same
 * thing here, unlike `push.json`: with no pick the guess runs, and nothing ever
 * regenerates this file behind the person's back, so a wrong read costs one guessed
 * open rather than anything durable.
 */
const storedChoices = async (): Promise<StoredChoices> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(preferencePath(), "utf8"))
    const decoded = Schema.decodeUnknownEither(StoredChoices)(parsed)
    return decoded._tag === "Right" ? decoded.right : {}
  } catch {
    return {}
  }
}

/** Writes one kind's pick and keeps the other's — the file is one record of both. */
const writeChoice = async (kind: OpenerKind, id: string): Promise<void> => {
  const next: StoredChoices = { ...(await storedChoices()), [kind]: id }
  await mkdir(preferenceDir(), { recursive: true })
  await writeFile(preferencePath(), `${JSON.stringify(next)}\n`, "utf8")
}

/**
 * Everything a request needs, asked once: the scan, the stored picks and the walk up
 * the process tree. The walk runs whether or not a pick is stored, so that a listing
 * of two kinds costs one walk rather than two — it is a handful of `ps` beside the
 * scan's `plutil` per installed application.
 */
interface Machine {
  readonly apps: readonly OpenerApp[]
  readonly stored: StoredChoices
  readonly startedFrom: string | undefined
}

const machine = async (): Promise<Machine> => {
  const [apps, stored, startedFrom] = await Promise.all([
    scan(),
    storedChoices(),
    startedFromBundle(process.pid, WALK_DEPTH),
  ])
  return { apps, stored, startedFrom }
}

/**
 * The opener a press opens for one kind: the stored pick where it still names an
 * installed opener of that kind, else the guess — and a stored pick naming nothing
 * leaves the file alone, so reinstalling the picked app brings the pick back.
 */
const effectiveOf = (kind: OpenerKind, m: Machine): OpenerApp | undefined => {
  const apps = ofKind(m.apps, kind)
  return apps.find((app) => app.id === m.stored[kind]) ?? guessFrom(kind, apps, m.startedFrom)
}

// ============================================================================
// A command in a terminal — a launcher, and its environment through a pipe
// ============================================================================

/** One word quoted for `bash`: inside single quotes, each `'` closed, escaped and reopened. */
const quoted = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`

/**
 * The launcher a terminal runs: it reads `NAME=value` records, each ended by a NUL and
 * then an empty one, from the pipe beside it into its own environment, removes its
 * directory, and becomes `command` in `cwd`. `read` takes a pipe a byte at a time, so it
 * stops at the block's end. The text names no value, so nothing secret is on disk.
 */
export const launcherScript = (
  dir: string,
  cwd: string,
  command: readonly [string, ...string[]],
): string =>
  [
    "#!/bin/bash",
    `dir=${quoted(dir)}`,
    `while IFS= read -r -d '' rec && [ -n "$rec" ]; do export "$rec"; done <"$dir/env"`,
    `rm -rf "$dir"`,
    `cd ${quoted(cwd)} || exit 1`,
    `exec ${command.map(quoted).join(" ")}`,
    "",
  ].join("\n")

/** How long the pipe waits for the terminal to read it before the launcher is taken away. */
const LAUNCH_WAIT_MS = 120_000

/**
 * `command` run in `cwd` by a terminal `open` starts on the launcher, with `env` in its
 * environment. **No value of `env` touches a disk or a command line**: the launcher and a
 * named pipe sit in a fresh `0700` directory, a writer blocks on the pipe until the
 * launcher opens it, and the launcher deletes the directory once it has read it. A
 * terminal that never runs the launcher has `waitMs` to, and then the writer is killed and
 * the directory removed. Answers once `open` has, and leaves the writer running.
 */
export const launchInTerminal = async (
  open: (launcher: string) => Promise<void>,
  command: readonly [string, ...string[]],
  env: Readonly<Record<string, string>>,
  cwd: string,
  waitMs: number = LAUNCH_WAIT_MS,
): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "orkestra-shell-"))
  const removed = (): Promise<void> => rm(dir, { recursive: true, force: true })
  try {
    await run("mkfifo", ["-m", "600", join(dir, "env")])
    const launcher = join(dir, "launch")
    await writeFile(launcher, launcherScript(dir, cwd, command), { mode: 0o700 })
    await chmod(launcher, 0o700)
    // `cat` opens the pipe for writing, which blocks until the launcher opens it to read.
    const writer = spawn("sh", ["-c", 'exec cat >"$1"', "sh", join(dir, "env")], {
      stdio: ["pipe", "ignore", "ignore"],
      timeout: waitMs,
    })
    const ended = new Promise<void>((resolve) => {
      writer.once("close", () => resolve())
      writer.once("error", () => resolve())
    })
    void ended.then(removed)
    writer.stdin.end(environmentBlock(env))
    try {
      await open(launcher)
    } catch (error) {
      writer.kill()
      throw error
    }
  } catch (error) {
    await removed()
    throw error
  }
}

// ============================================================================
// The service
// ============================================================================

/** One kind's half of what `GET /api/openers` sends: the scan with icons, and the effective choice. */
export interface OpenerListing {
  readonly apps: readonly { id: string; name: string; icon: string | undefined }[]
  readonly chosen: string | undefined
}

export type OpenersListing = Readonly<Record<OpenerKind, OpenerListing>>

export type ChooseOutcome = "stored" | "unknown" | "unsupported"
export type OpenOutcome = "opened" | "no-opener" | "no-directory" | "unsupported"
export type RunOutcome = "opened" | "no-opener" | "unsupported"

export interface OpenersShape {
  /** Both listings, or `undefined` on any platform but macOS — nothing is detected there. */
  readonly list: Effect.Effect<OpenersListing | undefined, Cause.UnknownException>
  /** Store an explicit pick. `unknown` is an id the scan did not return for that kind. */
  readonly choose: (
    kind: OpenerKind,
    id: string,
  ) => Effect.Effect<ChooseOutcome, Cause.UnknownException>
  /**
   * Open the effective opener of `kind` at `directory`. `no-directory` is a checkout
   * that is not there — `Trak.worktree` keeps naming a checkout the archive deleted, so
   * the route cannot assume the path resolves. `unsupported` is every platform but macOS.
   */
  readonly openAt: (
    kind: OpenerKind,
    directory: string,
  ) => Effect.Effect<OpenOutcome, Cause.UnknownException>
  /**
   * Run `command` in `cwd` in the effective terminal, with `env` laid over the shell's
   * environment and never written down — `launchInTerminal`. For a checkout that is not
   * on this machine, where the terminal runs whatever reaches it. `unsupported` is every
   * platform but macOS.
   */
  readonly runInTerminal: (
    command: readonly [string, ...string[]],
    env: Readonly<Record<string, string>>,
    cwd: string,
  ) => Effect.Effect<RunOutcome, Cause.UnknownException>
}

export class Openers extends Context.Tag("app/Openers")<Openers, OpenersShape>() {}

const list = async (): Promise<OpenersListing> => {
  const m = await machine()
  // Icons once per bundle, not per kind: an app claiming both is one `sips`.
  const icons = new Map(
    await Promise.all(
      m.apps.map(
        async (app): Promise<[string, string | undefined]> => [app.id, await iconDataUrl(app)],
      ),
    ),
  )
  const listingOf = (kind: OpenerKind): OpenerListing => ({
    apps: ofKind(m.apps, kind).map((app) => ({
      id: app.id,
      name: app.name,
      icon: icons.get(app.id),
    })),
    chosen: effectiveOf(kind, m)?.id,
  })
  return { terminal: listingOf("terminal"), editor: listingOf("editor") }
}

const choose = async (kind: OpenerKind, id: string): Promise<ChooseOutcome> => {
  if (!ofKind(await scan(), kind).some((app) => app.id === id)) return "unknown"
  await writeChoice(kind, id)
  return "stored"
}

const openAt = async (kind: OpenerKind, directory: string): Promise<OpenOutcome> => {
  // A directory the engine cannot stat is one `open` cannot open; the refusal is the
  // same either way, so the two failures share an answer.
  const present = await stat(directory).then(
    (s) => s.isDirectory(),
    () => false,
  )
  if (!present) return "no-directory"
  const opener = effectiveOf(kind, await machine())
  if (opener === undefined) return "no-opener"
  await run("open", ["-b", opener.id, directory])
  return "opened"
}

const runInTerminal = async (
  command: readonly [string, ...string[]],
  env: Readonly<Record<string, string>>,
  cwd: string,
): Promise<RunOutcome> => {
  const terminal = effectiveOf("terminal", await machine())
  if (terminal === undefined) return "no-opener"
  // A terminal claims `public.unix-executable` as a shell, so `open` hands it the
  // launcher to run — the same claim the scan kept it for.
  await launchInTerminal(
    async (launcher) => {
      await run("open", ["-b", terminal.id, launcher])
    },
    command,
    env,
    cwd,
  )
  return "opened"
}

/**
 * The service on `platform`. Everything is asked per request rather than cached at boot —
 * a scan is a handful of `plutil` reads on a route a person presses, and per request is
 * what makes a newly installed opener appear with nothing restarted. Off macOS every
 * answer is a refusal that runs nothing: `plutil`, `sips` and `open -b` are not there.
 */
export const openersOn = (platform: NodeJS.Platform): OpenersShape =>
  platform === "darwin"
    ? {
        list: Effect.tryPromise(list),
        choose: (kind, id) => Effect.tryPromise(() => choose(kind, id)),
        openAt: (kind, directory) => Effect.tryPromise(() => openAt(kind, directory)),
        runInTerminal: (command, env, cwd) =>
          Effect.tryPromise(() => runInTerminal(command, env, cwd)),
      }
    : {
        list: Effect.succeed(undefined),
        choose: () => Effect.succeed("unsupported"),
        openAt: () => Effect.succeed("unsupported"),
        runInTerminal: () => Effect.succeed("unsupported"),
      }

/** The layer `pnpm serve` runs on: the service on this machine's platform. */
export const MachineOpenersLayer: Layer.Layer<Openers> = Layer.succeed(
  Openers,
  openersOn(process.platform),
)
