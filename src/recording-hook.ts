// The recording hook: loaded into every Node process under a check that declares
// `fingerprint:`, through `NODE_OPTIONS=--import`, to write down what each test file
// depended on.
//
// **It runs inside the project's processes, not the engine's**, under whatever Node the
// project uses — pnpm, a linter, the test runner and every child a test spawns all load
// it. So it imports nothing of Orkestra's at runtime, only Node's built-ins, and from the
// checkout Node runs a copy the engine stripped of its types. And it does nothing in a
// process that is not one of three:
//
// - **the runner**, vitest's own process, where it records every module it loads or
//   evaluates and the files it reads — the configuration, its plugins and a `globalSetup`,
//   which every test file shares;
// - **a test file**, claimed by `recording-vitest.ts` in the worker that runs it, where it
//   records which functions V8 saw called, every file read and every process spawned,
//   until that file has finished;
// - **a process a test file started**, and every one that process starts in turn — its
//   family — which appends what it reads and doubts to a log the test file folds into its
//   own recording when it finishes. A line at a time, so a child killed mid-test has
//   already said what it read. A Node child is accepted only once it has said it loaded.
//
// What it writes is decoded by `src/recording/types/recording.ts`. **A test file's call it
// cannot account for is written as `unsure`**, and a unit with that is run every time: every
// `fs` function is watched, and one this hook does not know the inputs of is unsure. A doubt
// a machine may accept instead — a write under the temp directory, code a lockfile stands
// for, `ps` — is written as the assumption it names, and only a machine that trusts skips
// the unit.
// Not recorded at all: what a test reads from `process.env`, the clock, and randomness.

import { createHash } from "node:crypto"
import type { Stats } from "node:fs"
import type { Server } from "node:net"
import { Session } from "node:inspector"
import { registerHooks, syncBuiltinESMExports } from "node:module"
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import type {
  Assumption,
  Fact,
  Facet,
  RunnerRecording,
  UnitRecording,
} from "./recording/types/recording.js"

// The built-ins this patches, as the objects `require` returns: a namespace `import * as`
// is frozen, so a function set on it is silently dropped. `syncBuiltinESMExports` then
// carries each patch to the named exports an `import { … }` sees.
const childProcess = process.getBuiltinModule("node:child_process")
const dgram = process.getBuiltinModule("node:dgram")
const fs = process.getBuiltinModule("node:fs")
const net = process.getBuiltinModule("node:net")
const os = process.getBuiltinModule("node:os")
const workerThreads = process.getBuiltinModule("node:worker_threads")

const DIR = process.env["ORKESTRA_RECORDING_DIR"]
const SEALED = new Set((process.env["ORKESTRA_RECORDING_SEALED"] ?? "").split(",").filter(Boolean))

/**
 * The tools a test vouches for, by handing this to the process that runs them: it reads
 * what each one read itself — a bundler's own account of its sources — so its spawn is
 * accepted with only its binary as an input. A read the test leaves out is a wrong skip.
 */
const VOUCHED = new Set(
  (process.env["ORKESTRA_RECORDING_VOUCHED"] ?? "").split(",").filter(Boolean),
)

/** Set in a process a recorded one started: its family's log, and which spawn it is. */
const FAMILY = process.env["ORKESTRA_RECORDING_FAMILY"]
const SPAWN = process.env["ORKESTRA_RECORDING_SPAWN"]

/** The directories the test had made when it started this process, which are its own too. */
const inheritedTemps = (): string[] => {
  try {
    const temps: unknown = JSON.parse(process.env["ORKESTRA_RECORDING_TEMPS"] ?? "[]")
    return Array.isArray(temps) ? temps.filter((t) => typeof t === "string") : []
  } catch {
    return []
  }
}

/**
 * vitest's own process — its command line, or the engine's stage runner, which runs vitest
 * in its own process through the Node API — and a process its pool forked to run test files
 * in.
 */
const isRunner =
  workerThreads.isMainThread &&
  /[\\/](vitest\.mjs|check-stages\.(ts|js))$/.test(process.argv[1] ?? "")

const isWorker = /[\\/]vitest[\\/]dist[\\/]workers[\\/]/.test(process.argv[1] ?? "")

/**
 * The checkout: where a runner and its workers work, and what a child one of them started
 * is handed, since the child may work somewhere else.
 */
const ROOT =
  isRunner || isWorker ? process.cwd() : (process.env["ORKESTRA_RECORDING_ROOT"] ?? process.cwd())

/** How a child is handed this hook, as `NODE_OPTIONS` names it. */
const IMPORT = `--import=${import.meta.url}`

/**
 * The file this hook was made from, where Node runs a copy the engine stripped of its
 * types: what a print names, since the copy is gone once the check has run.
 */
const SOURCE = process.env["ORKESTRA_RECORDING_SOURCE"]

const SELF = fileURLToPath(import.meta.url)

/** Where `recording-vitest.ts` finds this process's recorder. */
const API = Symbol.for("orkestra.recording")

// Taken before anything is patched: the hook's own reads must not record themselves.
const readFileSync = fs.readFileSync
const readdirSync = fs.readdirSync
const statSync = fs.statSync
const writeFileSync = fs.writeFileSync
const renameSync = fs.renameSync
const mkdirSync = fs.mkdirSync
const existsSync = fs.existsSync
const lstatSync = fs.lstatSync
const realpathSync = fs.realpathSync
const openSync = fs.openSync
const readSync = fs.readSync
const writeSync = fs.writeSync
const closeSync = fs.closeSync
const execFileSync = childProcess.execFileSync

const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex")

const codeOf = (cause: unknown): unknown =>
  typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined

const missing = (cause: unknown): boolean => codeOf(cause) === "ENOENT"

/** A file this size or larger is hashed once a run; a smaller one costs less to hash again. */
const SHARED_FROM = 1024 * 1024

/**
 * How long before its hash is read a file must have last changed for the hash to be kept:
 * a write in the same timestamp tick as the read leaves `ctime` where it was, and two
 * seconds outlasts the coarsest filesystem's tick.
 */
const SETTLED_MS = 2000

/** Everything a write to a file changes, `ctime` included, which no call can set back. */
const statKey = (path: string, stat: Stats): string =>
  `${path}\0${String(stat.dev)}:${String(stat.ino)}:${String(stat.size)}:${String(stat.mtimeMs)}:${String(stat.ctimeMs)}`

let hashesMade = false

/**
 * A file's sha-256, shared under the recording directory by every process of the run, so
 * the Node binary thirty test files spawn is read once rather than thirty times. Kept only
 * where the file was unchanged while it was read and had settled before: any later write
 * moves `ctime` past the one the hash is filed under.
 */
const contentOf = (path: string, stat: Stats): string => {
  if (DIR === undefined || stat.size < SHARED_FROM) return sha(readFileSync(path))
  const key = statKey(path, stat)
  const at = join(DIR, "hashes", sha(key))
  try {
    return readFileSync(at, "utf8")
  } catch {
    // Not hashed yet in this run.
  }
  const started = Date.now()
  const value = sha(readFileSync(path))
  if (stat.ctimeMs < started - SETTLED_MS && statKey(path, statSync(path)) === key) {
    if (!hashesMade) mkdirSync(join(DIR, "hashes"), { recursive: true })
    hashesMade = true
    const part = `${at}.${String(process.pid)}-${String(workerThreads.threadId)}.part`
    writeFileSync(part, value)
    renameSync(part, at)
  }
  return value
}

/**
 * One fact about a path, computed the way `passes-file.ts` computes it again in a later
 * checkout. `undefined` where the path is something other than a file or a directory —
 * a device, a socket, a pipe — whose bytes do not stand still.
 */
const factValue = (path: string, facet: Facet): string | undefined => {
  try {
    const stat = statSync(path)
    if (facet === "kind") return stat.isFile() ? "file" : stat.isDirectory() ? "dir" : "other"
    if (facet === "listing")
      return stat.isDirectory() ? sha(readdirSync(path).sort().join("\n")) : "notdir"
    if (stat.isDirectory()) return "dir"
    return stat.isFile() ? contentOf(path, stat) : undefined
  } catch (cause) {
    if (missing(cause) || codeOf(cause) === "ENOTDIR") return "absent"
    return undefined
  }
}

/** A path argument as a path, or `undefined` for one that names no file. */
const pathOf = (arg: unknown): string | undefined => {
  if (typeof arg === "string") return resolve(arg)
  if (Buffer.isBuffer(arg)) return resolve(arg.toString())
  if (arg instanceof URL) return arg.protocol === "file:" ? fileURLToPath(arg) : undefined
  return undefined
}

interface Recorder {
  unsure: string | undefined
  /** The doubts it filed under an assumption a check may accept, rather than as unsure. */
  readonly assumes: Set<Assumption>
  /** Directories the test made with `mkdtemp`: what happens inside them is its own. */
  readonly temps: string[]
  /** Ports and socket paths this process listens on, which it may connect to. */
  readonly listening: Set<string>
}

let recorder: Recorder | undefined

/**
 * The log a claimed test file's children append to, which it folds into its own recording
 * when it finishes. A child that is not one hands its children `FAMILY` instead, the log it
 * appends to itself.
 */
let unitLog: string | undefined

const handedLog = (): string | undefined => unitLog ?? FAMILY

/** One line of a family's log: a fact's facet and path, or what else a member said. */
type Told =
  | readonly [Facet, string]
  | readonly ["unsure" | "assume" | "listen" | "loaded" | "killed", string]
  | readonly ["spawned", string, string]

/** One line, by descriptor: `appendFileSync` writes through the `writeFileSync` patched here. */
const append = (log: string | undefined, entry: Told): void => {
  if (log === undefined) return
  const fd = openSync(log, "a")
  try {
    writeSync(fd, `${JSON.stringify(entry)}\n`)
  } finally {
    closeSync(fd)
  }
}

/** What a child says to its family: every fact and doubt, a test file's inside it included. */
const tell = (entry: Told): void => {
  if (member !== undefined) append(FAMILY, entry)
}

/** In a child, the recorder its family's lines come from, which a claim there leaves in place. */
let member: Recorder | undefined

const doubt = (reason: string): void => {
  if (recorder === undefined || recorder.unsure !== undefined) return
  recorder.unsure = reason
  tell(["unsure", reason])
}

const assume = (name: Assumption): void => {
  if (recorder === undefined || recorder.assumes.has(name)) return
  recorder.assumes.add(name)
  tell(["assume", name])
}

const insideTemp = (path: string): boolean =>
  recorder?.temps.some((t) => path === t || path.startsWith(`${t}${sep}`)) ?? false

const noted = new Map<string, Set<Facet>>()

const note = (arg: unknown, facet: Facet): void => {
  if (recorder === undefined) return
  if (typeof arg === "number") return doubt("read a file by its descriptor")
  const path = pathOf(arg)
  if (path === undefined || insideTemp(path) || transformed(path)) return
  const pinned = pinnedEntry(path)
  if (pinned !== undefined && pinned !== path) return notePinned(pinned)
  const facets = noted.get(path) ?? new Set<Facet>()
  if (facets.has(facet)) return
  facets.add(facet)
  noted.set(path, facets)
  tell([facet, path])
}

/**
 * The workspace package a module's nearest `package.json` names, which a test reaches by
 * that name through a link under `node_modules`; `undefined` for the checkout's own
 * package, for a dependency, and for one with no name.
 */
const workspaceName = (dir: string, manifest: string): string | undefined => {
  if (dir === ROOT || installed(dir)) return undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"))
    const name: unknown =
      typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "name") : undefined
    return typeof name === "string" && name !== "" ? name : undefined
  } catch {
    return undefined
  }
}

/**
 * A module Node or a runner loaded, with what resolved it: every `package.json` from its
 * directory up to the nearest one — a nearer one added changes its `type`, the nearest one's
 * `exports` and `type` decide what an import of it loads — and, for a workspace package,
 * the kind of each `node_modules/<name>` from the checkout up to the one found. Resolution
 * reads these where no patch here sees it: a runner's native resolver, Node's own.
 */
const noteModule = (path: string): void => {
  note(path, "content")
  // Every `package.json` the walk would note is inside the entry, which stands for them.
  if (pinnedEntry(path) !== undefined) return
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    const manifest = join(dir, "package.json")
    // Already walked from here: what is above it is noted too.
    if (noted.get(manifest)?.has("content") === true) return
    note(manifest, "content")
    if (existsSync(manifest)) return noteLinks(workspaceName(dir, manifest))
    if (dirname(dir) === dir) return
  }
}

const noteLinks = (name: string | undefined): void => {
  if (name === undefined) return
  for (let dir = ROOT; ; dir = dirname(dir)) {
    const link = join(dir, "node_modules", name)
    note(link, "kind")
    if (existsSync(link) || dirname(dir) === dir) return
  }
}

/**
 * `replacement` in `owner[name]`, carrying what hangs off the original — `realpath.native`,
 * and the `promisify.custom` that `exists` needs — so code reaching for those still finds them.
 * A `promisify.custom` the replacement already has is its own, and stays.
 */
const replace = (owner: object, name: string, original: object, replacement: object): void => {
  const carried = Object.getOwnPropertyDescriptors(original)
  if (Object.hasOwn(replacement, promisify.custom))
    Reflect.deleteProperty(carried, promisify.custom)
  Object.defineProperties(replacement, carried)
  Reflect.set(owner, name, replacement)
}

/** Replace `owner[name]` with a function that calls `before` with its arguments first. */
const wrap = (owner: object, name: string, before: (args: unknown[]) => void): void => {
  const original: unknown = Reflect.get(owner, name)
  if (typeof original !== "function") return
  replace(owner, name, original, function wrapped(this: unknown, ...args: unknown[]): unknown {
    before(args)
    const result: unknown = Reflect.apply(original, this, args)
    return result
  })
}

/** Replace `owner[name]` with a function that hands what it returned to `after`. */
const wrapResult = (owner: object, name: string, after: (result: unknown) => unknown): void => {
  const original: unknown = Reflect.get(owner, name)
  if (typeof original !== "function") return
  replace(owner, name, original, function wrapped(this: unknown, ...args: unknown[]): unknown {
    return after(Reflect.apply(original, this, args))
  })
}

const writes = (flags: unknown): boolean => typeof flags === "string" && /[wa]/.test(flags)

/** The calls a test reads a path through, by name with `Sync` dropped, and what they read. */
const READS: Readonly<Record<string, Facet>> = {
  readFile: "content",
  createReadStream: "content",
  readdir: "listing",
  opendir: "listing",
  exists: "kind",
  stat: "kind",
  lstat: "kind",
  access: "kind",
}

/** The calls that only write the paths they are handed, every one of them. */
const WRITES = new Set([
  "appendFile",
  "writeFile",
  "createWriteStream",
  "mkdir",
  "rm",
  "rmdir",
  "unlink",
  "truncate",
  "chmod",
  "lchmod",
  "chown",
  "lchown",
  "utimes",
  "lutimes",
  "rename",
])

/** The calls that take a descriptor, already accounted for where it was opened. */
const BY_DESCRIPTOR = /^f|^(?:close|read|readv|write|writev)$/

/** The temp directory both as it is named and as it resolves, since a test may use either. */
const TMP = ((): readonly string[] => {
  const named = resolve(os.tmpdir())
  try {
    return [...new Set([named, realpathSync(named)])]
  } catch {
    return [named]
  }
})()

/**
 * Where `tsx` keeps what it compiled — `tsx-<user>` under the temp directory, and `tsx`
 * there before it — which is neither an input nor a write. An entry is named for a hash of
 * the source, its path, the options and the two tools' versions, so what it holds follows
 * from the source the load hook records and the code the lockfile stands for. Recorded, it
 * failed every print: the listing grows with each file compiled, and another machine's
 * cache does not hold the same entries.
 */
const TRANSFORMS = ((): readonly string[] => {
  const user = process.geteuid?.() ?? os.userInfo().username
  return TMP.flatMap((t) => [join(t, `tsx-${String(user)}`), join(t, "tsx")])
})()

const transformed = (path: string): boolean =>
  TRANSFORMS.some((t) => path === t || path.startsWith(`${t}${sep}`))

/**
 * Under the temp directory and outside the checkout: a checkout that itself sits under the
 * temp directory is still the checkout. A child is handed the checkout, since it may run
 * somewhere else.
 */
const underTmp = (path: string): boolean =>
  TMP.some((t) => path.startsWith(`${t}${sep}`)) && !path.startsWith(`${ROOT}${sep}`)

/**
 * A write outside a directory the test made changes files a later run reads, and a later
 * checkout does not have what this run left, so it is unsure — or, under the temp
 * directory, the `tmpdir` assumption.
 */
const written = (name: string, arg: unknown): void => {
  const path = pathOf(arg)
  if (path === undefined || insideTemp(path) || transformed(path)) return
  if (underTmp(path)) return assume("tmpdir")
  doubt(`called \`${name}\` on ${path}`)
}

/** The files a package manager reads its whole install from: `LOCKFILES` in the types, restated. */
const LOCKFILES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]

const NODE_MODULES = `${sep}node_modules`

const installed = (path: string): boolean =>
  path.includes(`${NODE_MODULES}${sep}`) || path.endsWith(NODE_MODULES)

/** The lockfile nearest each install root or above it, found once a process. */
const lockfiles = new Map<string, string | undefined>()

/** The lockfile nearest the directory holding the outermost `node_modules` of `path`. */
const lockfileOf = (path: string): string | undefined => {
  const root = path.slice(0, path.indexOf(NODE_MODULES))
  if (lockfiles.has(root)) return lockfiles.get(root)
  let found: string | undefined
  for (let dir = root; ; dir = dirname(dir)) {
    found = LOCKFILES.map((name) => join(dir, name)).find((at) => existsSync(at))
    if (found !== undefined || dirname(dir) === dir) break
  }
  lockfiles.set(root, found)
  return found
}

/**
 * Code under `node_modules` this hook cannot see into, standing as the lockfile nearest
 * the directory that holds the outermost `node_modules`: the `lockfile` assumption, with the
 * lockfile's bytes as an input. Unsure where no lockfile is found, since nothing then
 * stands for what was installed.
 */
const fromLockfile = (path: string): void => {
  const lockfile = lockfileOf(path)
  if (lockfile === undefined) return doubt(`depended on ${path}, which no lockfile names`)
  note(lockfile, "content")
  assume("lockfile")
}

/** Where pnpm keeps every package it installed: `PNPM_STORE` in the print, restated. */
const PNPM_STORE = `${NODE_MODULES}${sep}.pnpm${sep}`

/** The store entries whose bytes the lockfile does not pin: `UNPINNED` in the print, restated. */
const UNPINNED = /^(?:node_modules$|.*@(?:file|link)\+)/

/**
 * The entry of pnpm's store holding `path` — `node_modules/.pnpm/<name>@<version>` — where
 * the lockfile pins that entry's bytes; `undefined` for any other path. The print stands
 * the lockfile in for every path under such an entry and never reads what it recorded of
 * them, so the hook records the entry alone: a fact or a script for every file a test
 * loads from it makes the recording several times larger, and hashes each file on every
 * run. `src/recording-hook.test.ts` holds this to the print's rule.
 */
export const storeEntry = (path: string): string | undefined => {
  const at = path.indexOf(PNPM_STORE)
  if (at === -1) return undefined
  const entry = path.slice(at + PNPM_STORE.length).split(sep)[0] ?? ""
  return entry === "" || UNPINNED.test(entry)
    ? undefined
    : path.slice(0, at + PNPM_STORE.length + entry.length)
}

/**
 * `storeEntry` where a lockfile stands for it. Without one, the print keeps each path as an
 * input of its own, so each is recorded as before.
 */
const pinnedEntry = (path: string): string | undefined => {
  const entry = storeEntry(path)
  return entry === undefined || lockfileOf(entry) === undefined ? undefined : entry
}

/** A store entry's marker, with the lockfile the print stands in for everything under it. */
const notePinned = (entry: string): void => {
  const lockfile = lockfileOf(entry)
  if (lockfile !== undefined) note(lockfile, "content")
  note(entry, "kind")
}

/**
 * Every file under a directory copied whole, and every listing, as inputs: the copy holds
 * what they held when it was made. A link inside one is unsure, since a copy may follow it
 * or keep it.
 */
const copiedTree = (name: string, dir: string): void => {
  note(dir, "listing")
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = lstatSync(path)
    if (stat.isDirectory()) copiedTree(name, path)
    else if (stat.isFile()) note(path, "content")
    else doubt(`called \`${name}\` on a directory holding ${path}`)
  }
}

/**
 * A path read whole into somewhere this hook stops watching — a copy, a link — is its
 * content. A directory a `cp` copies is every file under it. A directory linked is
 * unsure, since what is read through the link is read inside the test's own directory,
 * unless it is a dependency's, which the lockfile stands for.
 */
const copied = (name: string, arg: unknown, base?: string): void => {
  const path = typeof arg === "string" && base !== undefined ? resolve(base, arg) : pathOf(arg)
  if (path === undefined || insideTemp(path)) return
  if (factValue(path, "content") !== "dir") return note(path, "content")
  if (installed(path)) return fromLockfile(path)
  if (/^cp(?:Sync)?$/.test(name)) return copiedTree(name, path)
  doubt(`called \`${name}\` on the directory ${path}`)
}

/** What one call through `fs` depends on, from its name and its arguments. */
const fsCall = (name: string, args: unknown[]): void => {
  const [first, second] = args
  const base = name.replace(/Sync$/, "")
  const read = READS[base]
  if (read !== undefined) return note(first, read)
  if (base === "open") return writes(second) ? written(name, first) : note(first, "content")
  if (base === "copyFile" || base === "cp" || base === "link") {
    copied(name, first)
    return written(name, second)
  }
  if (base === "symlink") {
    const at = pathOf(second)
    copied(name, first, at === undefined ? undefined : dirname(at))
    return written(name, second)
  }
  if (base === "realpath") {
    const path = pathOf(first)
    if (path === undefined || insideTemp(path)) return
    // A path no link stands in is its kind; one that resolves elsewhere depends on the link.
    let real: string | undefined
    try {
      real = realpathSync(path)
    } catch {
      real = path
    }
    // A link under `node_modules` is the package manager's layout, and what it leads to is
    // already an input through the files that were read and run from it.
    if (real !== path && !path.includes(`${sep}node_modules${sep}`))
      return doubt(`resolved the link ${path}`)
    note(path, "kind")
    return note(real, "kind")
  }
  if (WRITES.has(base)) {
    written(name, first)
    if (base === "rename") written(name, second)
    return
  }
  if (typeof first === "number" && BY_DESCRIPTOR.test(base)) return
  // Every call nothing above names — a glob, a watch, `readlink`, `statfs`, and whatever a
  // later Node adds — is one whose dependence nobody wrote down.
  const path = pathOf(first)
  if (base === "glob" || path === undefined || !insideTemp(path)) doubt(`called \`${name}\``)
}

const madeTemp = (dir: unknown): void => {
  const path: unknown = typeof dir === "object" && dir !== null ? Reflect.get(dir, "path") : dir
  if (typeof path === "string") recorder?.temps.push(resolve(path))
}

const keepTemp = (made: unknown): unknown => {
  madeTemp(made)
  return made
}

/** The mkdtemp family, which this hook watches for what it returns rather than what it reads. */
const MKDTEMP = /^mkdtemp/

/**
 * Every function `fs` and `fs.promises` export, so a call this hook does not understand is
 * unsure rather than unseen. A directory a test makes with `mkdtemp` is its own, and what
 * happens inside it is not an input.
 */
const patchFs = (): void => {
  for (const owner of [fs, fs.promises]) {
    for (const name of Object.keys(owner)) {
      if (!/^[a-z]/.test(name) || MKDTEMP.test(name)) continue
      wrap(owner, name, (args) => fsCall(name, args))
    }
    for (const name of Object.keys(owner).filter((n) => MKDTEMP.test(n)))
      wrapResult(owner, name, (made) =>
        made instanceof Promise
          ? made.then((dir: unknown) => {
              madeTemp(dir)
              return dir
            })
          : keepTemp(made),
      )
  }
  wrap(fs, "mkdtemp", (args) => {
    const last = args.length - 1
    const callback: unknown = args[last]
    if (typeof callback !== "function") return
    args[last] = (error: unknown, dir: unknown): void => {
      if (error === null) madeTemp(dir)
      Reflect.apply(callback, undefined, [error, dir])
    }
  })
}

/** Where `command` runs from: absolute as given, or the first match on `PATH`. */
const binaryOf = (command: string, cwd: string, env: unknown): string | undefined => {
  if (command.includes("/")) return resolve(cwd, command)
  const path: unknown =
    typeof env === "object" && env !== null ? Reflect.get(env, "PATH") : process.env["PATH"]
  for (const dir of (typeof path === "string" ? path : "").split(delimiter)) {
    const at = join(dir, command)
    if (dir !== "" && existsSync(at) && statSync(at).isFile()) return at
  }
  return undefined
}

/**
 * Where `git` works once it has read the options before its subcommand: each `-C <dir>`
 * moves it, relative to where it was, as `cwd:` would. A `-c` takes a value too.
 */
const gitCwd = (argv: readonly string[], cwd: string): string => {
  const [arg, value, ...rest] = argv
  if (arg === "-C" && value !== undefined) return gitCwd(rest, resolve(cwd, value))
  if (arg === "-c" && value !== undefined) return gitCwd(rest, cwd)
  if (arg?.startsWith("-") === true) return gitCwd(argv.slice(1), cwd)
  return cwd
}

/** `git`'s subcommand and what follows it, past the options before it. */
const gitCommand = (argv: readonly string[]): readonly string[] => {
  const [arg, value, ...rest] = argv
  if ((arg === "-C" || arg === "-c") && value !== undefined) return gitCommand(rest)
  if (arg?.startsWith("-") === true) return gitCommand(argv.slice(1))
  return argv
}

const CONFIG_READS = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l"])

/** A read of the global git config, which the `gitconfig` assumption stands for wherever it runs. */
const readsGlobalConfig = (argv: readonly string[]): boolean => {
  const [command, ...rest] = gitCommand(argv)
  return command === "config" && rest.includes("--global") && rest.some((a) => CONFIG_READS.has(a))
}

/** Each `git` binary's helper directory, which `git --exec-path` names, asked once. */
const execPaths = new Map<string, string | undefined>()

/**
 * Every file under a sealed `git`'s helper directory, and every listing, as inputs beside
 * the binary: a subcommand that is not built in runs from there. A link is left out, since
 * one there leads to `git` itself, and hashing it again would read the binary a hundred
 * times.
 */
const noteExecPath = (binary: string): void => {
  if (!execPaths.has(binary)) {
    let dir: string | undefined
    try {
      dir = execFileSync(binary, ["--exec-path"], { encoding: "utf8" }).trim()
    } catch {
      dir = undefined
    }
    execPaths.set(binary, dir)
  }
  const dir = execPaths.get(binary)
  if (dir === undefined || dir === "") return doubt(`could not ask ${binary} for its exec path`)
  const walk = (at: string): void => {
    note(at, "listing")
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      const stat = lstatSync(path)
      if (stat.isDirectory()) walk(path)
      else if (stat.isFile()) note(path, "content")
    }
  }
  walk(dir)
}

const optionsOf = (arg: unknown): Record<string, unknown> =>
  typeof arg === "object" && arg !== null && !Array.isArray(arg) ? { ...arg } : {}

/**
 * Whether an argument names a path outside the directories the test made: an absolute one,
 * or a relative one climbing out of `cwd`. A `..` inside a flag such as `-C../x` cannot be
 * resolved without knowing the tool's flags, so it escapes.
 */
const escapes = (token: string, cwd: string): boolean => {
  if (isAbsolute(token)) return token !== "/dev/null" && !insideTemp(token)
  if (!token.includes("..")) return false
  return token.startsWith("-") || !insideTemp(resolve(cwd, token))
}

/** How many children this process has handed the hook to, for each one's spawn id. */
let spawns = 0

/** The Node children this test file started, by spawn id, each owed a `loaded` line. */
const started = new Map<string, string>()

/** The interpreter and its first argument a script's `#!` line names, or `[]` for none. */
const shebang = (binary: string): readonly string[] => {
  const head = Buffer.alloc(256)
  let read = 0
  try {
    const fd = openSync(binary, "r")
    try {
      read = readSync(fd, head, 0, head.length, 0)
    } finally {
      closeSync(fd)
    }
  } catch {
    return []
  }
  const [line = ""] = head.toString("utf8", 0, read).split("\n")
  return line.startsWith("#!") ? line.slice(2).trim().split(/\s+/) : []
}

/**
 * A Node binary, a package's `.bin` shim, or a script whose `#!` line runs `node` directly
 * or through `env`: a child that records itself.
 */
const runsNode = (tool: string, binary: string | undefined): boolean => {
  if (tool === "node" || binary === process.execPath) return true
  if (binary === undefined) return false
  if (binary.includes(`${sep}node_modules${sep}.bin${sep}`)) return true
  const [interpreter = "", first] = shebang(binary)
  return basename(interpreter) === "node" || (basename(interpreter) === "env" && first === "node")
}

/**
 * Hand a child this hook and the family's log, through the environment in `args[at]`. Only
 * where it is inherited, already names `NODE_OPTIONS`, or `node` is the child: an
 * environment a test spelled out leaves a shell child as the test wrote it. `undefined`
 * where it was not handed on.
 */
const handOn = (args: unknown[], at: number, node: boolean): string | undefined => {
  const log = handedLog()
  if (log === undefined || recorder === undefined) return undefined
  const options: unknown = args[at]
  const given = typeof options === "function" ? undefined : optionsOf(options)
  const env: unknown = given?.["env"]
  const base: Record<string, unknown> =
    typeof env === "object" && env !== null ? { ...env } : { ...process.env }
  if (env !== undefined && base["NODE_OPTIONS"] === undefined && !node) return undefined
  spawns += 1
  const id = `${String(process.pid)}-${String(workerThreads.threadId)}-${String(spawns)}`
  const hooked = typeof base["NODE_OPTIONS"] === "string" ? base["NODE_OPTIONS"] : ""
  base["NODE_OPTIONS"] = hooked.includes(IMPORT) ? hooked : `${IMPORT} ${hooked}`.trim()
  base["ORKESTRA_RECORDING_FAMILY"] = log
  base["ORKESTRA_RECORDING_SPAWN"] = id
  base["ORKESTRA_RECORDING_TEMPS"] = JSON.stringify(recorder.temps)
  base["ORKESTRA_RECORDING_ROOT"] = ROOT
  if (SOURCE !== undefined) base["ORKESTRA_RECORDING_SOURCE"] = SOURCE
  // A check a test runs names its own sealed tools; a child the test runs has this one's.
  base["ORKESTRA_RECORDING_SEALED"] ??= [...SEALED].join(",")
  base["ORKESTRA_RECORDING_VOUCHED"] ??= [...VOUCHED].join(",")
  const replaced = { ...given, env: base }
  if (given === undefined || options === undefined) args.splice(at, 0, replaced)
  else args[at] = replaced
  return id
}

/**
 * A spawn, accepted where it is sealed: a tool the project lists, run in a directory the
 * test made, and handed no path outside one. Its binary is then an input like any file,
 * and anything else about the call came from code that is already one. A Node child is
 * accepted wherever it runs, since it records what it reads itself, and so is a tool the
 * test vouched for; `ps` and a read of the global git config, under the assumption each
 * names.
 */
const spawned = (kind: "file" | "shell" | "fork", args: unknown[]): string | undefined => {
  if (recorder === undefined) return undefined
  const [first, second] = args
  const listed = Array.isArray(second)
  const at = kind !== "shell" && listed ? 2 : 1
  const options = optionsOf(args[at])
  const shell = kind === "shell" || (options["shell"] !== undefined && options["shell"] !== false)
  const command = kind === "fork" ? process.execPath : shell ? "/bin/sh" : String(first)
  const argv =
    kind === "file" && listed ? second.map(String) : kind === "shell" ? [String(first)] : []
  const tool = shell ? "sh" : kind === "fork" ? "node" : basename(command)
  const given = resolve(pathOf(options["cwd"]) ?? ".")
  const binary = binaryOf(command, given, options["env"])
  const node = !shell && runsNode(tool, binary)
  const id = handOn(args, at, node)
  if (node) return nodeRan(tool, binary, id)
  const script = shell ? undefined : interpreted(binary, given, options["env"])
  // Its bytes are the test's, but what it starts is not: a Node child it runs records itself
  // only where the hook went with it, and nothing else would see that child's reads.
  if (script !== undefined && binary !== undefined)
    if (id === undefined) doubt(`ran \`${tool}\` without handing the hook to what it starts`)
    else sealedRan(script.tool, [binary, ...argv], given, script.binary)
  else if (VOUCHED.has(tool)) vouchedRan(tool, binary)
  else if (tool === "ps") psRan(given, binary)
  else sealedRan(tool, argv, given, binary)
  return undefined
}

/**
 * A script the test wrote, run by its path, as the `#!` interpreter it names running it —
 * directly or through `env` — since `bash <script>` is what the kernel runs, and that is
 * already sealed where `bash` is. Its bytes are the test's own, so the interpreter and the
 * script's arguments are all that is left to judge. `undefined` for any other binary.
 */
const interpreted = (
  binary: string | undefined,
  cwd: string,
  env: unknown,
): { readonly tool: string; readonly binary: string | undefined } | undefined => {
  if (binary === undefined || !insideTemp(binary)) return undefined
  const [interpreter, first] = shebang(binary)
  if (interpreter === undefined) return undefined
  if (basename(interpreter) !== "env") return { tool: basename(interpreter), binary: interpreter }
  if (first === undefined || first.startsWith("-")) return undefined
  // `env` only looks its tool up on the PATH, and reads nothing else this run could change.
  note(interpreter, "content")
  return { tool: first, binary: binaryOf(first, cwd, env) }
}

/** A Node child handed the hook, owed a `loaded` line: its spawn id, or `undefined` if not. */
const nodeRan = (
  tool: string,
  binary: string | undefined,
  id: string | undefined,
): string | undefined => {
  if (binary === undefined) doubt(`ran \`${tool}\`, which is not on the PATH`)
  else if (id === undefined) doubt(`ran \`${tool}\` without handing it the hook`)
  else {
    note(binary, "content")
    started.set(id, tool)
    // Owed to whoever folds the log the child says it loaded in.
    if (unitLog === undefined) append(FAMILY, ["spawned", id, tool])
    return id
  }
  return undefined
}

/** A tool the test vouched for, wherever it runs: its binary, and what the test read. */
const vouchedRan = (tool: string, binary: string | undefined): void => {
  if (binary === undefined) return doubt(`ran \`${tool}\`, which is not on the PATH`)
  note(binary, "content")
}

/** `ps`, from `/` or a directory the test made, which reads no file to depend on. */
const psRan = (cwd: string, binary: string | undefined): void => {
  if (cwd !== "/" && !insideTemp(cwd))
    return doubt("ran `ps` outside `/` or a directory the test made")
  if (binary === undefined) return doubt("ran `ps`, which is not on the PATH")
  note(binary, "content")
  assume("ps")
}

/** A sealed tool's spawn, and the `gitconfig` read, which only the binary stands for. */
const sealedRan = (
  tool: string,
  argv: readonly string[],
  given: string,
  binary: string | undefined,
): void => {
  if (!SEALED.has(tool)) return doubt(`ran \`${tool}\`, which is not sealed`)
  const cwd = tool === "git" ? gitCwd(argv, given) : given
  const global = tool === "git" && readsGlobalConfig(argv)
  if (!global && !insideTemp(cwd))
    return doubt(`ran \`${tool}\` in ${cwd}, outside a directory the test made`)
  for (const token of argv.flatMap((a) => a.split(/[\s=]/)))
    if (escapes(token, cwd)) return doubt(`ran \`${tool}\` on ${token}`)
  if (binary === undefined) return doubt(`ran \`${tool}\`, which is not on the PATH`)
  note(binary, "content")
  if (tool === "git") noteExecPath(binary)
  if (global) assume("gitconfig")
}

/** Each patch once a process, however many of a test file, a runner and a child it is. */
const patched = new Set<string>()

const once = (name: string, patch: () => void): void => {
  if (patched.has(name)) return
  patched.add(name)
  patch()
}

/** The Node children killed by a signal, which owe no `loaded` line: one may die before it. */
const killed = new Set<string>()

const killedBy = (id: string, signal: unknown): void => {
  if (typeof signal !== "string") return
  killed.add(id)
  if (unitLog === undefined) append(FAMILY, ["killed", id])
}

/** Watch what a spawn made — a child, a sync result, a promise's `child` — for a signal. */
const watch = (id: string | undefined, made: unknown): void => {
  if (id === undefined || typeof made !== "object" || made === null) return
  const on: unknown = Reflect.get(made, "once")
  if (typeof on === "function")
    Reflect.apply(on, made, ["exit", (_: unknown, signal: unknown) => killedBy(id, signal)])
  else if (made instanceof Promise) watch(id, Reflect.get(made, "child"))
  else killedBy(id, Reflect.get(made, "signal"))
}

/**
 * `childProcess[name]` with `spawned` before it, and its `promisify.custom` too: `exec` and
 * `execFile` carry one, which calls Node's own function rather than the export, so a
 * promisified call would otherwise spawn unseen.
 */
const wrapSpawn = (name: string, kind: "file" | "shell" | "fork"): void => {
  const original: unknown = Reflect.get(childProcess, name)
  if (typeof original !== "function") return
  const recorded = (call: unknown) =>
    function wrapped(this: unknown, ...args: unknown[]): unknown {
      if (typeof call !== "function") return undefined
      const id = spawned(kind, args)
      const result: unknown = Reflect.apply(call, this, args)
      watch(id, result)
      return result
    }
  const replacement = recorded(original)
  const custom: unknown = Reflect.get(original, promisify.custom)
  if (typeof custom === "function")
    Object.defineProperty(replacement, promisify.custom, { value: recorded(custom) })
  replace(childProcess, name, original, replacement)
}

/**
 * esbuild's own worker, which its `*Sync` calls start once to run its installed binary: the
 * one every `tsx` child starts the first time it compiles a text its cache has no copy of.
 * The worker is not handed this hook, so it is accepted on what it is asked: `transformSync`
 * — all `tsx` calls — compiles the text it is given and reads no file. A `buildSync` would
 * read files through it unseen; nothing here calls one.
 */
const esbuildService = (file: unknown, data: unknown): file is string =>
  typeof file === "string" &&
  installed(file) &&
  file.endsWith(`${sep}esbuild${sep}lib${sep}main.js`) &&
  typeof data === "object" &&
  data !== null &&
  typeof Reflect.get(data, "esbuildVersion") === "string"

const patchProcesses = (): void => {
  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "fork"])
    wrapSpawn(name, name === "fork" ? "fork" : "file")
  for (const name of ["exec", "execSync"]) wrapSpawn(name, "shell")
  const Worker = workerThreads.Worker
  Reflect.set(
    workerThreads,
    "Worker",
    class RecordedWorker extends Worker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        const [file, options] = args
        if (esbuildService(file, options?.workerData)) {
          note(file, "content")
          fromLockfile(file)
        } else doubt("started a worker thread")
        super(...args)
      }
    },
  )
}

/**
 * Every native addon `process.dlopen` loaded into this process, by path — from the moment
 * the hook loaded, not from the claim, since an addon the worker loaded first is cached
 * and the test file's own `require` of it never reaches `dlopen` again.
 */
const addons = new Set<string>()

/**
 * Native code reads and spawns where no patch here sees it. An addon is an input by its
 * bytes, and what it reads is its package's, which only the lockfile can stand for.
 */
const noteAddon = (addon: string): void => {
  note(addon, "content")
  if (installed(addon)) fromLockfile(addon)
  else doubt(`loaded the addon ${addon}, which no lockfile installed`)
}

/** A child says so as it loads one, since nothing waits for its end. */
const patchAddons = (): void => {
  wrap(process, "dlopen", (args) => {
    const path = pathOf(args[1])
    if (path === undefined) return
    addons.add(path)
    if (member !== undefined) noteAddon(path)
  })
}

const LOOPBACK = /^(?:localhost|127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/

/** Whether any process in this one's family — its children, its parent's — listens on `at`. */
const familyListens = (at: string): boolean =>
  [unitLog, FAMILY].some((log) => {
    if (log === undefined) return false
    try {
      return readFileSync(log, "utf8").includes(JSON.stringify(["listen", at]))
    } catch {
      return false
    }
  })

const listens = (at: string): boolean => recorder?.listening.has(at) === true || familyListens(at)

/** A connection is to the network unless it is to a port or socket its family opened. */
const connected = (args: unknown[]): void => {
  const first: unknown = Array.isArray(args[0]) ? args[0][0] : args[0]
  const options = optionsOf(first)
  const path = typeof first === "string" && !/^\d+$/.test(first) ? first : options["path"]
  if (typeof path === "string") {
    // A socket nobody made is refused, and that it is not there is all the test learns.
    if (!listens(resolve(path)))
      if (existsSync(path)) doubt(`connected to ${path}`)
      else note(path, "kind")
    return
  }
  const port = typeof first === "object" ? options["port"] : first
  const host = typeof first === "object" ? options["host"] : args[1]
  const local = host === undefined || (typeof host === "string" && LOOPBACK.test(host))
  if (!local || !listens(String(port)))
    doubt(`connected to ${typeof host === "string" ? host : "localhost"}:${String(port)}`)
}

const patchNetwork = (): void => {
  wrap(net.Socket.prototype, "connect", connected)
  const listen: unknown = Reflect.get(net.Server.prototype, "listen")
  if (typeof listen === "function")
    Reflect.set(
      net.Server.prototype,
      "listen",
      function listening(this: Server, ...args: unknown[]): unknown {
        this.once("listening", () => {
          const address = this.address()
          const at = typeof address === "string" ? resolve(address) : String(address?.port)
          recorder?.listening.add(at)
          append(unitLog, ["listen", at])
          if (member !== undefined) append(FAMILY, ["listen", at])
        })
        const result: unknown = Reflect.apply(listen, this, args)
        return result
      },
    )
  wrap(dgram, "createSocket", () => doubt("opened a UDP socket"))
}

/** Every noted path's facts, hashed now. A path that cannot be hashed is unsure. */
const factsNow = (): Fact[] => {
  const facts: Fact[] = []
  for (const [path, facets] of noted)
    for (const facet of facets) {
      const value = factValue(path, facet)
      if (value === undefined) doubt(`read ${path}, which is not a file or a directory`)
      else facts.push({ path, facet, value })
    }
  return facts
}

/** Write `body` as `name` in the recording directory, whole or not at all. */
const writeRecording = (name: string, body: unknown): void => {
  if (DIR === undefined) return
  mkdirSync(DIR, { recursive: true })
  const at = join(DIR, name)
  writeFileSync(`${at}.part`, JSON.stringify(body))
  renameSync(`${at}.part`, at)
}

// ---- A test file, claimed by the runner adapter in the process that runs it ----

const session = new Session()

/**
 * Every script V8 has parsed in this process since the debugger was on, by id, with the
 * hash V8 reports of its text: the sha-256 of its bytes, where `v8HashesText` holds.
 */
const parsed = new Map<string, string>()

/** What wants each script's path as it is parsed: the runner's list, or a child's log. */
const onParsed: ((path: string) => void)[] = []

/**
 * The debugger on, once a process. `Debugger.enable` reports every script already parsed
 * before it returns, so `parsed` is complete from then on.
 */
const debug = (): void => {
  if (patched.has("debugger")) return
  patched.add("debugger")
  session.connect()
  session.on(
    "Debugger.scriptParsed",
    (message: {
      readonly params: { readonly scriptId: string; readonly url: string; readonly hash: string }
    }) => {
      parsed.set(message.params.scriptId, message.params.hash)
      const path = scriptPath(message.params.url)
      if (path !== undefined) for (const use of onParsed) use(path)
    },
  )
  post("Debugger.enable")
}

/** A synchronous call to this thread's own inspector, which answers before `post` returns. */
const post = (method: string, params?: object): unknown => {
  let answer: unknown
  let failure: unknown
  session.post(method, params ?? {}, (error: unknown, result: unknown) => {
    failure = error
    answer = result
  })
  if (failure instanceof Error) throw failure
  if (failure !== undefined && failure !== null) throw new Error(JSON.stringify(failure))
  return answer
}

interface Covered {
  readonly scriptId: string
  readonly url: string
  readonly functions: readonly {
    readonly functionName: string
    readonly ranges: readonly {
      readonly startOffset: number
      readonly endOffset: number
      readonly count: number
    }[]
  }[]
}

/** The shape of one script's coverage, which this generic `post` cannot type. */
const isCovered = (value: unknown): value is Covered =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "scriptId") === "string" &&
  typeof Reflect.get(value, "url") === "string" &&
  Array.isArray(Reflect.get(value, "functions"))

const coverage = (): readonly Covered[] => {
  const taken = post("Profiler.takePreciseCoverage")
  const result: unknown =
    typeof taken === "object" && taken !== null ? Reflect.get(taken, "result") : []
  return Array.isArray(result) ? result.filter(isCovered) : []
}

/**
 * The file a script came from. Vite names a module it made from a file's data — `?raw`,
 * `?inline`, `?url` — by the file's path and that query, and the runner reads the file
 * without this hook noting it, since it reads compiled source the same way. A path with the
 * query names no file, so a fact about it held over any edit and the test was proven over a
 * changed `styles.css?raw`; the file without the query is the input. Stripped only where
 * the path as written is not a file, so a name that really holds a `?` stays its own.
 */
const scriptPath = (url: string): string | undefined => {
  const named = url.startsWith("file:") ? fileURLToPath(url) : isAbsolute(url) ? url : undefined
  const query = named?.indexOf("?") ?? -1
  const path =
    named !== undefined && query > 0 && !existsSync(named) ? named.slice(0, query) : named
  return path === SELF && SOURCE !== undefined ? SOURCE : path
}

let test: string | undefined
let claims = 0
let before = new Set<string>()

const claim = (path: string): void => {
  claims += 1
  if (claims > 1) {
    // A second file in one process inherits whatever the first left behind.
    recorder = member
    return
  }
  test = path
  // A child that is a test runner's worker noted its own start, under its family's temp
  // directories; the test file's facts are only what it reads from here, under its own.
  noted.clear()
  recorder = { unsure: undefined, assumes: new Set(), temps: [], listening: new Set() }
  if (DIR !== undefined) {
    mkdirSync(join(DIR, "family"), { recursive: true })
    unitLog = join(DIR, "family", `${String(process.pid)}-${String(workerThreads.threadId)}`)
  }
  debug()
  post("Profiler.enable")
  // Binary, not counted: only whether a function ran is read, and counting stops V8
  // optimizing, which made a hot loop fifteen times slower and timed out tests under load.
  post("Profiler.startPreciseCoverage", { callCount: false, detailed: false })
  // Every script already parsed. The coverage V8 hands back is not that list: a script
  // whose functions were compiled before coverage started is missing from it until one of
  // them runs again.
  before = new Set(parsed.keys())
  coverage()
  once("fs", patchFs)
  once("processes", patchProcesses)
  once("network", patchNetwork)
  syncBuiltinESMExports()
}

/** An entry of a family's log, or `undefined` for a line that does not read as one. */
const toldOf = (line: string): readonly string[] | undefined => {
  try {
    const entry: unknown = JSON.parse(line)
    return Array.isArray(entry) && entry.every((e) => typeof e === "string") ? entry : undefined
  } catch {
    return undefined
  }
}

const isFacet = (value: string | undefined): value is Facet =>
  value === "content" || value === "listing" || value === "kind"

/** The names a child may say it assumed: `ASSUMPTIONS`, which this file may not import. */
const NAMES: readonly Assumption[] = ["gitconfig", "lockfile", "ps", "tmpdir"]

const isAssumption = (value: string | undefined): value is Assumption =>
  NAMES.some((n) => n === value)

/**
 * What every process this test file started said, as its own: each path a fact, each doubt
 * its own doubt, and every Node child that never said it loaded unsure. The last line is
 * left out where a child was killed while writing it. A test file inside a child passes
 * what it folds on to its own family, as it does everything else.
 */
const foldFamily = (): void => {
  if (unitLog === undefined) return
  let text = ""
  try {
    text = readFileSync(unitLog, "utf8")
  } catch (cause) {
    if (!missing(cause)) return doubt(`could not read what its children recorded: ${String(cause)}`)
  }
  const loaded = new Set(killed)
  const owed = new Map(started)
  for (const line of text.split("\n").slice(0, -1)) {
    const [kind, value, tool] = toldOf(line) ?? []
    if (value === undefined) doubt(`a child wrote ${line}`)
    else if (isFacet(kind)) note(value, kind)
    else if (kind === "unsure") doubt(`a child ${value}`)
    else if (kind === "assume" && isAssumption(value)) assume(value)
    else if (kind === "loaded" || kind === "killed") loaded.add(value)
    else if (kind === "spawned") owed.set(value, tool ?? "node")
    else if (kind !== "listen") doubt(`a child wrote ${line}`)
  }
  for (const [id, tool] of owed)
    if (!loaded.has(id))
      doubt(`ran \`${tool}\`, which never said it loaded the hook and was not killed`)
}

/**
 * Whether V8's hash of a script is the sha-256 this hook takes of its text: unknown until
 * the first script this process reads, then settled for the process. V8 hashes the text as
 * WTF-8, so the two agree on every text but one holding a lone surrogate, which this hook's
 * UTF-8 replaces — and a V8 hash that names a kept file names that text exactly.
 */
let v8HashesText: boolean | undefined

/**
 * Whether the engine may read a script's text: `eligible` in `src/recording/logic/print.ts`
 * restated, since this file imports nothing of Orkestra's at runtime, and
 * `src/recording-hook.test.ts` fails when the two disagree. The engine also refuses a path
 * outside the checkout, by the root it ran the check in; this process cannot know that root
 * — a runner may work in a directory below it — so it keeps the text of every such path
 * instead. A text kept for nothing costs the copy back; one missing costs only that the
 * file's print matches it whole.
 */
export const keepsText = (path: string): boolean =>
  !path.includes("node_modules/") && /\.[cm]?[jt]s$/.test(path)

/**
 * The sha-256 of a script's text, kept under `scripts/` in `dir`. Every test file reaches
 * most of the same modules, so a script already kept there by V8's hash is not read again.
 */
const keptScript = (dir: string, scriptId: string): string | undefined => {
  const hash = parsed.get(scriptId)
  if (v8HashesText === true && hash !== undefined && existsSync(join(dir, "scripts", hash)))
    return hash
  const source = post("Debugger.getScriptSource", { scriptId })
  const text: unknown =
    typeof source === "object" && source !== null ? Reflect.get(source, "scriptSource") : undefined
  if (typeof text !== "string") return undefined
  const generated = sha(text)
  v8HashesText ??= generated === hash
  const kept = join(dir, "scripts", generated)
  if (!existsSync(kept)) writeFileSync(kept, text)
  return generated
}

const finish = (): void => {
  if (recorder === undefined || test === undefined || DIR === undefined) return
  const scripts: UnitRecording["scripts"][number][] = []
  foldFamily()
  const covered = coverage()
  mkdirSync(join(DIR, "scripts"), { recursive: true })
  for (const script of covered) {
    const path = scriptPath(script.url)
    if (path === undefined) continue
    noteModule(path)
    // Its entry's marker stands for it, and the print reads no script of a pinned entry.
    if (pinnedEntry(path) !== undefined) continue
    if (before.has(script.scriptId)) {
      scripts.push({ path, fresh: false })
      continue
    }
    // Still listed, so that a script whose file was never hashed is still caught.
    if (!keepsText(path)) {
      scripts.push({ path, fresh: true })
      continue
    }
    const generated = keptScript(DIR, script.scriptId)
    if (generated === undefined) {
      doubt(`could not read the code V8 ran for ${path}`)
      continue
    }
    const uncalled = script.functions.flatMap((f): [number, number][] => {
      const [range] = f.ranges
      return range === undefined || range.count > 0 || f.functionName.startsWith("<")
        ? []
        : [[range.startOffset, range.endOffset]]
    })
    scripts.push({ path, fresh: true, generated, uncalled })
  }
  for (const addon of addons) noteAddon(addon)
  const facts = factsNow()
  const recording: UnitRecording = {
    kind: "unit",
    test,
    runner: workerThreads.isMainThread ? process.ppid : process.pid,
    ...(recorder.unsure === undefined ? {} : { unsure: recorder.unsure }),
    ...(recorder.assumes.size === 0 ? {} : { assumes: [...recorder.assumes].sort() }),
    ...(addons.size === 0 ? {} : { addons: [...addons].sort() }),
    scripts,
    facts,
  }
  writeRecording(`unit-${String(process.pid)}-${String(workerThreads.threadId)}.json`, recording)
  recorder = member
  unitLog = undefined
}

// ---- The runner ----

/** Source a module may be compiled from that the runner reads only to hand to a worker. */
const COMPILED = /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|sass|less)$/

/**
 * The engine's list of the files already proven, which the stage runner reads to leave them
 * out. No test reads it, and it is gone once the check ends, so as a fact it would fail
 * every print the run left.
 */
const PROVEN = process.env["ORKESTRA_UNITS_PROVEN"]

/** The modules the runner loaded, and the text of the ones outside any dependency. */
const loaded = new Map<string, string | undefined>()

const INLINE_MAP =
  /^\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([\w+/=]+)$/gm

/**
 * The files a module that is gone was compiled from, by its inline map. A runner compiles
 * its configuration to a file it deletes once loaded; the sources the map names are what
 * stood behind it.
 */
const sourcesOf = (path: string, text: string | undefined): string[] | undefined => {
  const found = text === undefined ? undefined : [...text.matchAll(INLINE_MAP)].at(-1)
  if (found?.[1] === undefined) return undefined
  const map: unknown = JSON.parse(Buffer.from(found[1], "base64").toString("utf8"))
  const sources: unknown =
    typeof map === "object" && map !== null ? Reflect.get(map, "sources") : undefined
  return Array.isArray(sources) ? sources.map((s) => resolve(dirname(path), String(s))) : undefined
}

/**
 * Every script the runner compiled itself, by path. The load hook sees only what Node's own
 * loader loads; a module the runner evaluates through its own module runner — a
 * `globalSetup`, a plugin's helper — reaches V8 without it, and the debugger reports both.
 */
const evaluated = new Set<string>()

const recordRunner = (): void => {
  // Its own, in a child too: the family's temp directories hold the checkout it runs on.
  recorder = { unsure: undefined, assumes: new Set(), temps: [], listening: new Set() }
  onParsed.push((path) => evaluated.add(path))
  debug()
  registerHooks({
    load(url, context, next) {
      const result = next(url, context)
      const path = url.startsWith("file:") ? fileURLToPath(url) : undefined
      if (path !== undefined) {
        const own = !path.includes(`${sep}node_modules${sep}`) || path.includes(".vite-temp")
        const source = result.source
        const text =
          typeof source === "string"
            ? source
            : source instanceof Uint8Array
              ? Buffer.from(source).toString("utf8")
              : undefined
        loaded.set(path, own ? text : undefined)
      }
      return result
    },
  })
  for (const owner of [fs, fs.promises])
    for (const name of ["readFile", "readFileSync"])
      wrap(owner, name, (args) => {
        const path = pathOf(args[0])
        if (typeof path !== "string" || COMPILED.test(path) || path === PROVEN) return
        if (!path.includes(`${sep}node_modules${sep}`)) note(path, "content")
      })
  syncBuiltinESMExports()
  // The stage runner moves into each package to run its suite and back out after, so the
  // directory it exits in is not the one whose compiler options the transform read.
  const entered = new Set<string>()
  const chdir = process.chdir.bind(process)
  process.chdir = (dir: string): void => {
    chdir(dir)
    entered.add(process.cwd())
  }
  process.on("exit", () => {
    for (const path of evaluated) if (!loaded.has(path)) loaded.set(path, undefined)
    for (const [path, text] of loaded) {
      if (existsSync(path)) {
        noteModule(path)
        continue
      }
      const sources = sourcesOf(path, text)
      if (sources === undefined) doubt(`loaded ${path}, which is gone`)
      for (const source of sources ?? [])
        if (existsSync(source)) noteModule(source)
        else doubt(`loaded ${path}, compiled from ${source}, which is not there`)
    }
    note(process.execPath, "content")
    // The compiler options the runner's transform reads off disk where no patch here sees
    // it; one of them changes what a class field is, and so what a test observes.
    note(join(process.cwd(), "tsconfig.json"), "content")
    for (const dir of entered) note(join(dir, "tsconfig.json"), "content")
    const facts = factsNow()
    const recording: RunnerRecording = {
      kind: "runner",
      pid: process.pid,
      ...(recorder?.unsure === undefined ? {} : { unsure: recorder.unsure }),
      facts,
    }
    writeRecording(`runner-${String(process.pid)}.json`, recording)
  })
}

/**
 * A process a recorded one started: it records from its first line, and says so, which is
 * what its parent's test file waits to hear. A worker thread is not one, since starting one
 * is already unsure.
 */
const recordMember = (log: string): void => {
  member = { unsure: undefined, assumes: new Set(), temps: inheritedTemps(), listening: new Set() }
  recorder = member
  append(log, ["loaded", SPAWN ?? ""])
  // Every module Node's loader loads, through the load hook rather than the debugger: a
  // test runner's worker evaluates differently with a debugger on from its start.
  registerHooks({
    load(url, context, next) {
      if (url.startsWith("file:")) noteModule(fileURLToPath(url))
      return next(url, context)
    },
  })
  once("addons", patchAddons)
  // A test runner a test started records by the runner's rules, which its own prints are
  // made of, and its worker from its claim, as any worker does: one patched from its start
  // reads the modules its runner hands it from the temp directory, where a fact about them
  // never holds again. What either reads still reaches the family's log.
  if (isRunner || isWorker) return
  once("fs", patchFs)
  once("processes", patchProcesses)
  once("network", patchNetwork)
  syncBuiltinESMExports()
}

/**
 * The first copy of this hook a process loads is the only one that records. A check a test
 * runs hands its processes its own copy beside the one they inherited, and a second copy
 * would take the first one's patched `fs` for the originals, recording its own log writes.
 */
const LOADED = Symbol.for("orkestra.recording.loaded")
const first = !Reflect.has(globalThis, LOADED)
Reflect.set(globalThis, LOADED, true)

if (first && FAMILY !== undefined && workerThreads.isMainThread) recordMember(FAMILY)

if (first && DIR !== undefined) {
  once("addons", patchAddons)
  Reflect.set(globalThis, API, { claim, finish })
  if (isRunner) recordRunner()
}
