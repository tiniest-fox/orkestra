// File-backed Passes: one empty file per key under `.orkestra/.database/passes/`, one
// file of units per unit key under `passes/units/`, one file per check and checkout under
// `passes/trees/` naming the tree it last passed on there, and up to `PRINTS_PER_UNIT` prints per
// unit under `passes/prints/<key>/`, beside `prints/texts/` — the source texts a print's
// `Code` and `Barrel` inputs were recorded from, by sha, which a later checkout is diffed against. A
// copy of `prints/` laid out the same way is what `packed` hands out and `adopt` takes in.
//
// The project's `.database`, not a checkout's, so a pass recorded in one trak's worktree
// counts in every other. Records and unit files are never pruned: a record is an empty
// file, a unit file is the lines its checks wrote, and a key nothing will ask for again
// costs one directory entry. Prints are, because every trak shares them.
//
// **A print is named by its unit and its inputs**, so a run on other content — `main`'s,
// or another trak's — adds a print beside the one a branch relies on rather than
// replacing it. A unit is skipped when any of its prints holds. Its least recently used
// print goes first once it has more than `PRINTS_PER_UNIT`, and a print is used when it is
// written, adopted or skipped on: its modified time is that use. A text goes when the
// print evicted last naming it does.
//
// **A print is held against the checkout where it is.** Under a runner a trak's checkout
// is in its sandbox and this machine holds no copy, so every fact a print names is read
// there in one `exec` — and a stopped sandbox, which that read never starts, holds none.

// oxlint-disable-next-line eslint/no-restricted-imports -- this Node's own syntax check of a print, not project work
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import {
  appendFile,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat as statFile,
  utimes,
  writeFile,
} from "node:fs/promises"
import { dirname, isAbsolute, join, relative, sep } from "node:path"
import { Effect, Layer, Option, Schema } from "effect"
import type { Check } from "../../library/types/check.js"
import { orkestraDir } from "../../library/adapters/library-fs.js"
import { platformPart } from "../../library/logic/platform-part.js"
import {
  acceptedOn,
  type Assumption,
  barrelGrows,
  confined,
  type Facet,
  manifestsAbove,
  Print,
  printOf,
  RECORDING_FORMAT,
  Recording,
  RunnerRecording,
  trustsOn,
  type UnitRecording,
} from "../../recording/index.js"
import type { CheckoutPlace } from "../../vcs/logic/paths.js"
import {
  type PathStat,
  Sandboxes,
  type SandboxesShape,
  type StatAsked,
  type Stopped,
} from "../../vcs/ports/sandboxes.js"
import type { ProofPrint } from "../../vcs/ports/vcs.js"
import type { GitFailed } from "../../vcs/types/errors.js"
import { Passes, type PassesShape } from "../ports/passes.js"
import { StoreFailed } from "../ports/store-errors.js"

const why = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const passesDir = (root: string): string => join(root, ".database", "passes")

/**
 * Whose machine a key names, and whether it trusts what a print assumes. This one's,
 * outside a test of a proof made on another or a check run under CI.
 */
export interface Machine {
  readonly platform: string
  readonly arch: string
  readonly trusts: boolean
}

/** Trust read once, as the engine process starts: see `trustsOn`. */
export const THIS_MACHINE: Machine = {
  platform: process.platform,
  arch: process.arch,
  trusts: trustsOn(process.env),
}

/** Each unit once, and none where nothing was ever proven under the key. */
const readUnits = async (path: string): Promise<readonly string[]> => {
  try {
    return [...new Set((await readFile(path, "utf8")).split("\n").filter((u) => u !== ""))]
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return []
    throw cause
  }
}

const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex")

const codeOf = (cause: unknown): unknown =>
  typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined

/** `Passes.lastPassed` and `passedOn`: one file a check and checkout under `dir`, holding the tree. */
const lastTrees = (dir: string): Pick<PassesShape, "lastPassed" | "passedOn"> => {
  const file = (check: Check, cwd: string): string => join(dir, sha(`${check.name}\n${cwd}\n`))
  return {
    lastPassed: (check, cwd) =>
      Effect.tryPromise({
        // None kept is no pass in this checkout yet.
        try: async () => (await printText(file(check, cwd))).trim() || undefined,
        catch: (cause) => new StoreFailed({ reason: why(cause) }),
      }),
    passedOn: (check, cwd, tree) =>
      Effect.tryPromise({
        try: async () => {
          await mkdir(dir, { recursive: true })
          await writeFile(file(check, cwd), `${tree}\n`)
        },
        catch: (cause) => new StoreFailed({ reason: why(cause) }),
      }),
  }
}

/**
 * A print file's text, or `""` — which decodes as no print — where it is gone. Another
 * check's `keepPrints` evicts prints, so one listed a moment ago may be removed before it
 * is read; any other failure is still the store's.
 */
const printText = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf8")
  } catch (cause) {
    if (codeOf(cause) === "ENOENT") return ""
    throw cause
  }
}

/**
 * One fact about a path, computed as `src/recording-hook.ts` computed it when the test ran
 * — the two have to agree byte for byte, and the hook cannot import this. `undefined`
 * where the path is neither a file nor a directory, which no print holds.
 */
const factValue = (path: string, facet: Facet): string | undefined => {
  try {
    const stat = statSync(path)
    if (facet === "kind") return stat.isFile() ? "file" : stat.isDirectory() ? "dir" : "other"
    if (facet === "listing")
      return stat.isDirectory() ? sha(readdirSync(path).sort().join("\n")) : "notdir"
    if (stat.isDirectory()) return "dir"
    return stat.isFile() ? sha(readFileSync(path)) : undefined
  } catch (cause) {
    const code = codeOf(cause)
    return code === "ENOENT" || code === "ENOTDIR" ? "absent" : undefined
  }
}

/**
 * Whether JavaScript compiles as a module, asked of a child `node --check`: Node compiles a
 * module without running it only that way or behind a flag. With no `NODE_OPTIONS`, so the
 * engine's own loader does not compile it instead. Only an edit already confined to
 * uncalled bodies gets this far.
 */
const compiles = (javascript: string): boolean => {
  const { NODE_OPTIONS: _, ...env } = process.env
  const checked = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: javascript,
    env,
    stdio: ["pipe", "ignore", "ignore"],
  })
  return checked.status === 0
}

const textAt = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

const decodePrint = Schema.decodeUnknownOption(Schema.parseJson(Print))
const decodeRecording = Schema.decodeUnknownOption(Schema.parseJson(Recording))

/** What `recordedIn` needs of a recording file: a unit's test, or a runner's whole recording. */
const decodeOutline = Schema.decodeUnknownOption(
  Schema.parseJson(
    Schema.Union(
      Schema.Struct({ kind: Schema.Literal("unit"), test: Schema.String }),
      RunnerRecording,
    ),
  ),
)

/** Where the checkout at `cwd` holds the path a print names: relative inside it, absolute outside. */
const pathIn = (cwd: string, path: string): string => (isAbsolute(path) ? path : join(cwd, path))

/**
 * How a checkout is read: one fact of a path, and its text — where it no longer hashes to
 * `sha`, when one is given.
 */
interface Reading {
  readonly fact: (path: string, facet: Facet) => string | undefined
  readonly text: (path: string, sha?: string) => string | undefined
}

/**
 * Whether every input of `print` agrees with the checkout at `cwd`. `reading` is shared
 * across one lookup's prints, which mostly hold the same files.
 */
const holds = (print: Print, cwd: string, texts: string, reading: Reading): boolean =>
  print.inputs.every((input) => {
    const path = pathIn(cwd, input.path)
    if (input._tag === "Exact") return reading.fact(path, input.facet) === input.value
    if (reading.fact(path, "content") === input.sha) return true
    const old = textAt(join(texts, input.sha))
    const now = reading.text(path, input.sha)
    if (old === undefined || now === undefined) return false
    if (input._tag === "Code") return confined(old, now, input.allowed, compiles)
    return barrelGrows(old, now, {
      path: input.path,
      loaded: new Set(input.loaded),
      manifest: (at) => reading.text(pathIn(cwd, at)),
    })
  })

/** This machine's disk, each fact computed once. */
const readingHere = (): Reading => {
  const facts = new Map<string, string | undefined>()
  return {
    fact: (path, facet) => {
      const key = `${facet}\n${path}`
      if (!facts.has(key)) facts.set(key, factValue(path, facet))
      return facts.get(key)
    },
    text: textAt,
  }
}

/**
 * What `stats` is asked for one input, so the answers are what `holds` reads of it: a
 * barrel's text, and every `package.json` its package may be declared in.
 */
const askedFor = (input: Print["inputs"][number], cwd: string): readonly StatAsked[] => {
  const path = pathIn(cwd, input.path)
  if (input._tag === "Exact")
    return [{ path, read: input.facet === "listing" ? "listing" : "kind" }]
  const text: StatAsked = { path, read: "text", unless: input.sha }
  if (input._tag === "Code") return [text]
  return [
    text,
    ...manifestsAbove(input.path).map((m): StatAsked => ({ path: pathIn(cwd, m), read: "text" })),
  ]
}

const askedKey = (asked: StatAsked): string => `${asked.read}\n${asked.unless ?? ""}\n${asked.path}`

/** One fact of a path a sandbox read, computed as `factValue` computes it from a stat. */
const factOfStat = (stat: PathStat | undefined, facet: Facet): string | undefined => {
  if (stat === undefined || stat.kind === "unreadable") return undefined
  if (stat.kind === "absent") return "absent"
  if (facet === "kind") return stat.kind
  if (facet === "listing")
    return stat.kind !== "dir"
      ? "notdir"
      : stat.entries === undefined
        ? undefined
        : sha(stat.entries.toSorted().join("\n"))
  return stat.kind === "dir" ? "dir" : stat.kind === "file" ? stat.sha : undefined
}

/**
 * A sandbox's answer to `asked` as a reading. Every ask but a listing hashes a file, so
 * `content` and `kind` take whichever of them reached the path.
 */
const readingOf = (asked: readonly StatAsked[], stats: readonly PathStat[]): Reading => {
  const byAsk = new Map(asked.map((a, i) => [askedKey(a), stats[i]]))
  const byPath = new Map<string, PathStat | undefined>()
  for (const [i, a] of asked.entries())
    if (a.read !== "listing" && !byPath.has(a.path)) byPath.set(a.path, stats[i])
  return {
    fact: (path, facet) =>
      factOfStat(
        facet === "listing" ? byAsk.get(askedKey({ path, read: "listing" })) : byPath.get(path),
        facet,
      ),
    text: (path, unless) => {
      const stat = byAsk.get(
        askedKey(unless === undefined ? { path, read: "text" } : { path, read: "text", unless }),
      )
      return stat?.kind === "file" && stat.text !== undefined
        ? Buffer.from(stat.text).toString("utf8")
        : undefined
    },
  }
}

/** A path as a checkout at `cwd` names it in a print: relative inside it, absolute outside. */
const withinOf =
  (cwd: string) =>
  (path: string): string => {
    const inside = relative(cwd, path)
    return inside.startsWith(`..${sep}`) || isAbsolute(inside) ? path : inside
  }

/**
 * What a check's run left to make prints of, without the units' recordings themselves:
 * those are read one at a time by `eachPrintOf`, because a whole suite's can be larger
 * than the heap, and decoding one costs several times its file.
 */
interface Recorded {
  /** Where the hook wrote its recordings. */
  readonly dir: string
  /** Every runner's recording, by its pid: each is small and shared by many units. */
  readonly runners: ReadonlyMap<number, RunnerRecording>
  /** The file of each wanted unit's recording, by the unit, for a unit recorded exactly once. */
  readonly files: ReadonlyMap<string, string>
}

/**
 * What the hook wrote under `dir` for `units` of the checkout at `cwd`, a file at a time. A
 * unit file that is read here and then fails to decode whole still counts against its unit
 * being recorded once, which loses that unit a print and never makes a wrong one.
 */
const recordedIn = async (
  dir: string,
  cwd: string,
  units: readonly string[],
): Promise<Recorded> => {
  const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith(".json"))
  const wanted = new Set(units)
  const runners = new Map<number, RunnerRecording>()
  // `undefined` for a unit recorded more than once, which no file covers surely.
  const files = new Map<string, string | undefined>()
  for (const name of names) {
    // oxlint-disable-next-line no-await-in-loop -- one recording at a time is the bound on the heap
    const outline = decodeOutline(await readFile(join(dir, name), "utf8"))
    if (outline._tag === "None") continue
    const recording = outline.value
    if (recording.kind === "runner") {
      runners.set(recording.pid, recording)
      continue
    }
    const unit = relative(cwd, recording.test)
    if (wanted.has(unit)) files.set(unit, files.has(unit) ? undefined : join(dir, name))
  }
  const once = [...files].flatMap(([unit, file]): [string, string][] =>
    file === undefined ? [] : [[unit, file]],
  )
  return { dir, runners, files: new Map(once) }
}

/** A print made, and the source texts its `Code` inputs name. */
type Made = Extract<ReturnType<typeof printOf>, { readonly _tag: "Printed" }>

/**
 * Hand `each` the print of each unit `recorded` covers once and surely, with the unit's
 * recording, reading a source's text through `text` by the path the checkout names it.
 * One recording is decoded at a time, and `each` keeps only what it needs of it.
 */
const eachPrintOf = async (
  cwd: string,
  recorded: Recorded,
  text: (path: string) => string | undefined,
  each: (made: Made, recording: UnitRecording) => Promise<void> | void,
): Promise<void> => {
  const sources = {
    within: withinOf(cwd),
    generated: (s: string) => textAt(join(recorded.dir, "scripts", s)),
    text,
    sha,
  }
  for (const [unit, file] of recorded.files) {
    // oxlint-disable-next-line no-await-in-loop -- one recording at a time is the bound on the heap
    const decoded = decodeRecording(await readFile(file, "utf8"))
    if (decoded._tag === "None" || decoded.value.kind !== "unit") continue
    const recording = decoded.value
    const printed = printOf(unit, recording, recorded.runners.get(recording.runner), sources)
    // oxlint-disable-next-line no-await-in-loop -- as above: what `each` writes, it writes before the next is read
    if (printed._tag === "Printed") await each(printed, recording)
  }
}

/**
 * How many prints one unit keeps: `main`'s and one for each trak open at once on other
 * content, each still saving reruns, without one busy unit's history growing unbounded.
 */
const PRINTS_PER_UNIT = 10

/**
 * Every file name of `unit`'s prints starts with this. A print named before prints were
 * kept per input, `<sha(unit)>.json`, starts with it too, so it is read and pruned with
 * the rest.
 */
const unitPrefix = (unit: string): string => `${sha(unit)}.`

/**
 * A print's file name: its unit, and its inputs in an order that does not depend on the
 * order the hook happened to record them in, so a rerun on the same content renames
 * nothing.
 */
const printName = (print: Print): string =>
  `${unitPrefix(print.unit)}${sha(JSON.stringify([print.inputs.map((i) => JSON.stringify(i)).toSorted(), print.assumes ?? []]))}.json`

/** The shas of the texts `print`'s `Code` and `Barrel` inputs name. */
const textsOf = (print: Print): readonly string[] =>
  print.inputs.flatMap((input) => (input._tag === "Exact" ? [] : [input.sha]))

/** The prints of `unit` under `at` past the `PRINTS_PER_UNIT` most recently used. */
const leastUsed = async (
  at: string,
  names: readonly string[],
  unit: string,
): Promise<readonly string[]> => {
  const prefix = unitPrefix(unit)
  const own = names.filter((n) => n.startsWith(prefix) && n.endsWith(".json"))
  if (own.length <= PRINTS_PER_UNIT) return []
  const used = await Promise.all(
    own.map(async (name) => ({ name, at: (await statFile(join(at, name))).mtimeMs })),
  )
  return used
    .toSorted((x, y) => y.at - x.at || x.name.localeCompare(y.name))
    .slice(PRINTS_PER_UNIT)
    .map((u) => u.name)
}

/**
 * Hand `each` every print in `paths` that decodes, with its place in `paths`, one at a
 * time, so the heap holds one print however many the store keeps: one key's prints can be
 * larger than the heap, and decoding a print costs several times its file. `each` keeps
 * only what it needs of one.
 */
const eachPrint = async (
  paths: readonly string[],
  each: (print: Print, at: number) => void,
  read: (path: string) => Promise<string> = printText,
): Promise<void> => {
  for (const [at, path] of paths.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- one print at a time is the bound on the heap
    const print = decodePrint(await read(path))
    if (print._tag === "Some") each(print.value, at)
  }
}

/** The shas the prints in `paths` name. A file gone or undecodable names none. */
const textsNamedBy = async (paths: readonly string[]): Promise<ReadonlySet<string>> => {
  const named = new Set<string>()
  await eachPrint(
    paths,
    (print) => {
      for (const s of textsOf(print)) named.add(s)
    },
    (path) => readFile(path, "utf8").catch(() => ""),
  )
  return named
}

/** The shas every print under every key in `prints` names. */
const namedTexts = async (prints: string): Promise<ReadonlySet<string>> => {
  const keys = (await readdir(prints, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name !== "texts")
    .map((e) => join(prints, e.name))
  const paths = await Promise.all(
    keys.map(async (at) =>
      (await readdir(at).catch(() => []))
        .filter((n) => n.endsWith(".json"))
        .map((n) => join(at, n)),
    ),
  )
  return textsNamedBy(paths.flat())
}

/**
 * Keep a print for each unit `recorded` covers once and surely, and drop each such unit's
 * least recently used prints past `PRINTS_PER_UNIT`, with every text no print left names.
 * A unit that ran without a print keeps the prints it had: they may still hold on other
 * content.
 *
 * Another check keeping prints at the same time can lose a text this one removes as
 * unnamed. A `Code` input whose text is gone then matches only the exact content it was
 * recorded on, which costs a rerun and never skips wrongly.
 */
const keepPrints = async (
  stores: Stores,
  key: string,
  cwd: string,
  recorded: Recorded,
  text: (path: string) => string | undefined,
): Promise<void> => {
  const at = join(stores.prints, key)
  await mkdir(at, { recursive: true })
  await mkdir(stores.texts, { recursive: true })
  const kept = new Set<string>()
  await eachPrintOf(cwd, recorded, text, async ({ print, texts }) => {
    await Promise.all([
      ...[...texts].map(([s, t]) => writeFile(join(stores.texts, s), t)),
      writeFile(join(at, printName(print)), JSON.stringify(print)),
    ])
    kept.add(print.unit)
  })
  const names = await readdir(at)
  const dropped = (await Promise.all([...kept].map((u) => leastUsed(at, names, u)))).flat()
  const orphans = await textsNamedBy(dropped.map((name) => join(at, name)))
  await Promise.all(dropped.map((name) => rm(join(at, name), { force: true })))
  if (orphans.size === 0) return
  const named = await namedTexts(stores.prints)
  await Promise.all(
    [...orphans]
      .filter((s) => !named.has(s))
      .map((s) => rm(join(stores.texts, s), { force: true })),
  )
}

/** Whether a machine accepting `accepts` may skip on `print`: it leans on nothing else. */
const accepted = (print: Print, accepts: readonly Assumption[]): boolean =>
  (print.assumes ?? []).every((a) => accepts.includes(a))

/** A print that holds: the file it is kept in, and its unit. */
interface Kept {
  readonly path: string
  readonly unit: string
}

/** Every file under `at`, where the prints of one key are. */
const printsUnder = async (at: string): Promise<readonly string[]> =>
  (await readdir(at).catch(() => [])).map((name) => join(at, name))

/** The prints in `paths` that lean on nothing outside `accepts` and that `held` holds. */
const heldAmong = async (
  paths: readonly string[],
  accepts: readonly Assumption[],
  held: (print: Print) => boolean,
): Promise<readonly Kept[]> => {
  const kept: Kept[] = []
  await eachPrint(paths, (print, at) => {
    if (accepted(print, accepts) && held(print))
      kept.push({ path: paths[at] ?? "", unit: print.unit })
  })
  return kept
}

/**
 * Mark `held` used, so they outlive prints nobody skips on, and answer their units once
 * each. A print pruned meanwhile is left gone: marking it costs nothing it could save.
 */
const used = async (held: readonly Kept[]): Promise<readonly string[]> => {
  const now = new Date()
  await Promise.all(held.map((k) => utimes(k.path, now, now).catch(() => undefined)))
  return [...new Set(held.map((k) => k.unit))]
}

/**
 * Every file of the prints under `key` in the prints directory `prints` — of `units`
 * alone, where given — and every text they name, by the name each has inside that
 * directory. A print that does not decode is left behind, as `printedIn` would ignore it.
 */
const packedIn = async (
  prints: string,
  key: string,
  units: readonly string[] | undefined,
): Promise<{ readonly files: readonly ProofPrint[]; readonly units: readonly string[] }> => {
  const at = join(prints, key)
  const names = (await readdir(at).catch(() => [])).filter((n) => n.endsWith(".json"))
  const unitOf = new Map<number, string>()
  const shas = new Set<string>()
  await eachPrint(
    names.map((name) => join(at, name)),
    (print, i) => {
      if (units !== undefined && !units.includes(print.unit)) return
      unitOf.set(i, print.unit)
      for (const s of textsOf(print)) shas.add(s)
    },
  )
  const files: ProofPrint[] = []
  const found: string[] = []
  for (const [i, name] of names.entries()) {
    const unit = unitOf.get(i)
    if (unit === undefined) continue
    files.push({ name: `${key}/${name}`, path: join(at, name) })
    found.push(unit)
  }
  for (const s of [...shas].sort()) {
    const path = join(prints, "texts", s)
    // A text that is gone leaves its print unable to match an edit, never to match wrongly.
    if (existsSync(path)) files.push({ name: `texts/${s}`, path })
  }
  return { files, units: [...new Set(found)] }
}

/**
 * Copy the prints under `key` in `from`, and their texts, over this store's own. A unit
 * can end up with more than `PRINTS_PER_UNIT`; the next print kept of it trims them.
 */
const adoptInto = async (prints: string, from: string, key: string): Promise<readonly string[]> => {
  const { files, units } = await packedIn(from, key, undefined)
  await Promise.all(
    [...new Set(files.map((f) => dirname(join(prints, f.name))))].map((d) =>
      mkdir(d, { recursive: true }),
    ),
  )
  await Promise.all(files.map((f) => copyFile(f.path, join(prints, f.name))))
  return units
}

/** A checkout in a trak's sandbox, and the sandboxes that reach it. */
interface Sandboxed {
  readonly sandboxes: SandboxesShape
  readonly place: CheckoutPlace
}

/** The trak's sandbox the checkout at `cwd` is in, or nothing for one on this machine. */
const sandboxedIn =
  (sandboxes: Option.Option<SandboxesShape>) =>
  (cwd: string): Effect.Effect<Sandboxed | undefined> =>
    Option.match(sandboxes, {
      onNone: () => Effect.succeed(undefined),
      onSome: (held) =>
        Effect.map(held.placeOf(cwd), (place) =>
          place === undefined ? undefined : { sandboxes: held, place },
        ),
    })

const failedRead = (e: GitFailed) => new StoreFailed({ reason: `${e.op}: ${e.reason}` })

const storeFailed = (cause: unknown) => new StoreFailed({ reason: why(cause) })

/**
 * The prints in `paths` that every file in the sandboxed checkout still agrees with, read
 * in one `exec` that starts nothing: a stopped sandbox holds none of them. The prints are
 * read twice, once for what to ask and once to judge, so neither holds them all. A print
 * written between the two names a path never asked, which reads as no fact and holds not.
 */
const heldInSandbox = (
  sandboxed: Sandboxed,
  texts: string,
  paths: readonly string[],
  accepts: readonly Assumption[],
): Effect.Effect<readonly Kept[], StoreFailed> =>
  Effect.gen(function* () {
    const cwd = sandboxed.place.path
    const asked = new Map<string, StatAsked>()
    yield* Effect.tryPromise({
      try: () =>
        eachPrint(paths, (print) => {
          if (!accepted(print, accepts)) return
          for (const input of print.inputs)
            for (const one of askedFor(input, cwd)) asked.set(askedKey(one), one)
        }),
      catch: storeFailed,
    })
    const list = [...asked.values()]
    const stats = yield* sandboxed.sandboxes
      .stats(sandboxed.place.trak, list)
      .pipe(Effect.mapError(failedRead))
    if (stats === "stopped") return []
    const reading = readingOf(list, stats)
    return yield* Effect.tryPromise({
      try: () => heldAmong(paths, accepts, (print) => holds(print, cwd, texts, reading)),
      catch: storeFailed,
    })
  })

/**
 * The texts a print of `recorded` reads, out of the sandboxed checkout in one `exec`:
 * each source a `Code` input could be made of, sent back only where this store does not
 * already hold the text it was recorded at. A sandbox that answers nothing leaves every
 * input whole, which costs a later run its confined edits and nothing else.
 */
const sourcesInSandbox = (
  sandboxed: Sandboxed,
  texts: string,
  recorded: Recorded,
): Effect.Effect<(path: string) => string | undefined, StoreFailed> =>
  Effect.gen(function* () {
    const cwd = sandboxed.place.path
    const within = withinOf(cwd)
    const wanted = new Set<string>()
    const recordedAt = new Map<string, string>()
    const asking = (path: string) => {
      wanted.add(path)
      return undefined
    }
    yield* Effect.tryPromise({
      try: () =>
        eachPrintOf(cwd, recorded, asking, (_, recording) => {
          for (const f of recording.facts)
            if (f.facet === "content") recordedAt.set(within(f.path), f.value)
        }),
      catch: storeFailed,
    })
    const asked = [...wanted].map((path): StatAsked => {
      const at = recordedAt.get(path)
      return at !== undefined && existsSync(join(texts, at))
        ? { path: pathIn(cwd, path), read: "text", unless: at }
        : { path: pathIn(cwd, path), read: "text" }
    })
    const stats = yield* sandboxed.sandboxes
      .stats(sandboxed.place.trak, asked)
      .pipe(Effect.catchTag("GitFailed", () => Effect.succeed<Stopped>("stopped")))
    const got = new Map<string, string>()
    if (stats !== "stopped")
      for (const [i, path] of [...wanted].entries()) {
        const stat = stats[i]
        const unless = asked[i]?.unless
        if (stat?.kind !== "file") continue
        const text =
          stat.text !== undefined
            ? Buffer.from(stat.text).toString("utf8")
            : unless !== undefined && stat.sha === unless
              ? textAt(join(texts, unless))
              : undefined
        if (text !== undefined) got.set(path, text)
      }
    return (path) => got.get(path)
  })

/** The prints in `paths` every file in the checkout at `cwd`, on this machine's disk, still agrees with. */
const heldHere = (
  cwd: string,
  texts: string,
  paths: readonly string[],
  accepts: readonly Assumption[],
): Promise<readonly Kept[]> => {
  const reading = readingHere()
  return heldAmong(paths, accepts, (print) => holds(print, cwd, texts, reading))
}

/** Where the prints are kept, and the source texts they name. */
interface Stores {
  readonly prints: string
  readonly texts: string
}

/** `Passes.printed`. Under a runner the checkout is in the trak's sandbox, so its files are read there. */
const printedFor = (
  stores: Stores,
  key: string,
  cwd: string,
  accepts: readonly Assumption[],
  sandboxedAt: Effect.Effect<Sandboxed | undefined>,
): Effect.Effect<readonly string[], StoreFailed> =>
  Effect.gen(function* () {
    const paths = yield* Effect.tryPromise({
      try: () => printsUnder(join(stores.prints, key)),
      catch: storeFailed,
    })
    const sandboxed = yield* sandboxedAt
    const held =
      sandboxed === undefined
        ? yield* Effect.tryPromise({
            try: () => heldHere(cwd, stores.texts, paths, accepts),
            catch: storeFailed,
          })
        : yield* heldInSandbox(sandboxed, stores.texts, paths, accepts)
    return yield* Effect.promise(() => used(held))
  })

/** `Passes.print`, reading a sandboxed checkout's sources in its sandbox. */
const printFor = (
  stores: Stores,
  key: string,
  cwd: string,
  recording: string,
  units: readonly string[],
  sandboxedAt: Effect.Effect<Sandboxed | undefined>,
): Effect.Effect<void, StoreFailed> =>
  Effect.gen(function* () {
    const sandboxed = yield* sandboxedAt
    const at = sandboxed?.place.path ?? cwd
    const recorded = yield* Effect.tryPromise({
      try: () => recordedIn(recording, at, units),
      catch: (cause) => new StoreFailed({ reason: why(cause) }),
    })
    const text =
      sandboxed === undefined
        ? (path: string) => textAt(pathIn(cwd, path))
        : yield* sourcesInSandbox(sandboxed, stores.texts, recorded)
    yield* Effect.tryPromise({
      try: () => keepPrints(stores, key, at, recorded, text),
      catch: (cause) => new StoreFailed({ reason: why(cause) }),
    })
  })

/** `startDir` rather than the root itself, mirroring every other file layer. */
export const FilePassesLayer = (
  startDir: string,
  machine: Machine = THIS_MACHINE,
): Layer.Layer<Passes, StoreFailed> =>
  Layer.effect(
    Passes,
    Effect.gen(function* () {
      const root = yield* orkestraDir(startDir).pipe(
        Effect.mapError((e) => new StoreFailed({ reason: `${e.path}: ${e.reason}` })),
      )
      const dir = passesDir(root)
      const unitsDir = join(dir, "units")
      const printsDir = join(dir, "prints")
      const texts = join(printsDir, "texts")
      const part = (check: Check): string => platformPart(check, machine.platform, machine.arch)
      const sandboxes = yield* Effect.serviceOption(Sandboxes)
      const sandboxedAt = sandboxedIn(sandboxes)
      const stores = { prints: printsDir, texts }
      const shape: PassesShape = {
        keyOf: (check, tree) =>
          Effect.tryPromise(() => readFile(check.path)).pipe(
            Effect.map((script) =>
              createHash("sha256")
                .update(`${tree}\n${check.name}\n${part(check)}\n`)
                .update(script)
                .digest("hex"),
            ),
            // A script that cannot be read is one whose text cannot be in the key, so no
            // pass can be said to be its — and the run that follows reports why.
            Effect.orElseSucceed(() => undefined),
          ),
        has: (key) =>
          Effect.try({
            try: () => existsSync(join(dir, key)),
            catch: (cause) => new StoreFailed({ reason: why(cause) }),
          }),
        record: (key) =>
          Effect.tryPromise({
            try: async () => {
              await mkdir(dir, { recursive: true })
              await writeFile(join(dir, key), "")
            },
            catch: (cause) => new StoreFailed({ reason: why(cause) }),
          }),
        ...lastTrees(join(dir, "trees")),
        unitKeyOf: (check, tree) =>
          Effect.succeed(
            check.units === undefined || !check.cache
              ? undefined
              : createHash("sha256")
                  .update(`units\n${tree}\n${check.units}\n${part(check)}\n`)
                  .digest("hex"),
          ),
        proven: (key) =>
          Effect.tryPromise({
            try: () => readUnits(join(unitsDir, key)),
            catch: (cause) => new StoreFailed({ reason: why(cause) }),
          }),
        prove: (key, units) =>
          units.length === 0
            ? Effect.void
            : Effect.tryPromise({
                try: async () => {
                  await mkdir(unitsDir, { recursive: true })
                  await appendFile(join(unitsDir, key), units.map((u) => `${u}\n`).join(""))
                },
                catch: (cause) => new StoreFailed({ reason: why(cause) }),
              }),
        printKeyOf: (check) =>
          Effect.succeed(
            check.fingerprint === undefined || check.units === undefined || !check.cache
              ? undefined
              : // The sealed tools are in the key: a print made trusting a tool is no print
                // for a check that does not. The OS and the architecture are, whatever
                // `cache_across:` says, because a print holds the hashes of binaries. The
                // recording format is, so a print made under looser rules is not read.
                sha(
                  `prints\n${String(RECORDING_FORMAT)}\n${check.units}\n${machine.platform} ${machine.arch}\n${[...check.fingerprint].sort().join(",")}\n`,
                ),
          ),
        printed: (key, cwd) =>
          printedFor(stores, key, cwd, acceptedOn(machine.trusts), sandboxedAt(cwd)),
        packed: (key, units) =>
          Effect.tryPromise({
            try: async () => (await packedIn(printsDir, key, units)).files,
            catch: (cause) => new StoreFailed({ reason: why(cause) }),
          }),
        adopt: (key, from) =>
          Effect.tryPromise({
            try: () => adoptInto(printsDir, from, key),
            catch: (cause) => new StoreFailed({ reason: why(cause) }),
          }),
        print: (key, cwd, recording, units) =>
          printFor(stores, key, cwd, recording, units, sandboxedAt(cwd)),
      }
      return shape
    }),
  )
