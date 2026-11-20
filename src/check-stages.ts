// The stage runner a check script calls, by the path the engine hands every check as
// `ORKESTRA_STAGES`:
//
//   node "$ORKESTRA_STAGES" [--parallel] [--keep-going] [--related [--select <file>]] 'pnpm verify'
//
// Each argument is a command, and the commands run in order. A command of the form
// `pnpm [--filter <pkg> | -r] <script> [words…]` is looked up in that package's
// `package.json` — each workspace package's, for `-r` — and resolved into stages:
//
// - a script joined by ` && ` resolves each part in order, a `pnpm` part through its own
//   package, so a whole chain runs from its name and no copy of it can drift;
// - a script starting with `vitest` is a **test stage**;
// - anything else is a **static stage**, run as written.
//
// Words after the script name pass through as `pnpm` passes them, onto the end of the
// script's text — so onto the last part of a chain — which is how `--shard=1/2` and a
// reporter reach vitest. Any other command is a static stage, run as written with the
// package's `node_modules/.bin` on `PATH`. pnpm and vitest are the only tools this knows.
//
// **The run stops at the first stage that fails.** `--parallel` starts consecutive static
// stages together and reports them in chain order, so a failure reads the same however
// they happened to finish: the first failing one in that order, and nothing after it.
// `--keep-going` runs every test stage after a failure, no static stage, and names every
// failing stage at the end.
//
// **Everything printed is part of a stored failure**, and the engine decides whether an
// agent is repeating itself by comparing one failure's text with the last. So nothing this
// adds differs between two runs of the same failure: no durations, stages in chain order,
// failing files in path order.
//
// A static stage prints `✓ <command>` when it passes, and nothing else of what it said. A
// failing one prints its own output, less pnpm's preamble and lifecycle lines and every
// duration, with the middle cut past a cap: tools disagree on where the verdict is — tsc
// names the first error first, a build its cause last — so both ends are kept.
//
// A test stage runs vitest through its Node API, from the package's own install, in the
// package's directory, with no printing reporter of vitest's unless the words name one.
// Around that run it does what every project's check would otherwise write for itself:
//
// - **It is named as it starts**, `→ <command>`, since a suite takes minutes and a gate's
//   console is otherwise blank meanwhile; **a pass is one line**:
//   `✓ <command> — test files: N ran, M already proven`.
// - **A failure is reported from vitest's structured errors**, never from its printed
//   output: for each failing test, suite or file, the file, the test's name, the error and
//   its diff, the first stack frame in the checkout outside `node_modules`, what it wrote to
//   the console, and the one command that runs it again. Each part is capped, so a deep diff
//   or a chatty test cannot fill the engine's output limit. The console lines are as the
//   test wrote them, so a test that logs a time makes two reports of one failure differ.
// - **What reaches this process's stdout and stderr while it runs is held back**, and
//   printed only under a failure's report, as a failing static stage's output is — trimmed
//   and cut in the middle. That is a child a test starts with inherited stdio, Vite's
//   warnings, and a printing reporter the words name. Like the console lines, it is as
//   written, so a scratch directory's name in it makes two reports of one failure differ.
// - **Proven files are not run again.** The files `ORKESTRA_UNITS_PROVEN` names are left out
//   of the suite before it runs.
// - **Each passing file is recorded** in `ORKESTRA_UNITS_OUT` as that file finishes, one
//   path a line, whole line and newline in one write — so a run that fails, times out or is
//   killed still keeps what it proved, and the engine keeps only complete lines.
// - **Under `fingerprint:` the recording setup file is listed with no project config.** The
//   engine hands the check `ORKESTRA_RECORDING_VITEST`; this puts that file first in each
//   resolved project's `setupFiles`, so it claims a test file before any other setup runs,
//   and adds it alone to that project's `server.fs.allow`. jsdom and happy-dom load a setup
//   file through Vite's server as `/@fs/…`, which refuses a file outside the list, and the
//   file is the engine's, wherever the engine is kept. vitest reads `setupFiles` when it
//   serializes a run and Vite reads `fs.allow` on each request, so a change made after
//   `createVitest` resolves and before anything runs is seen by both.
//
// Paths in both unit files are from the directory the check runs in — the repository root —
// because one `units:` label can cover several packages, and two packages can share a path
// below their own directory.
//
// **`--related` runs only the test files related to what changed** since the tree the check
// last passed on, `ORKESTRA_PASSED_TREE`, or since where the branch began where it has
// passed on no tree here — its merge base with `ORKESTRA_BASE_COMMIT`, the commit the
// checkout was cut from, or with `origin/HEAD` where that is not handed over. Changed is
// what differs from the checkout as it would be committed, less the files `.gitattributes` marks `linguist-generated`; related is what vitest's own `related`
// selection finds from those files. Where git cannot say, vitest's `--changed` chooses.
// `--select <file>` names the project's two tables, as YAML, because they hold its paths:
//
// - `reads:` maps a pattern to the files that read a match off disk rather than import it,
//   so those count as changed too. A `run:<entry>` pattern is a `.ts` file a test starts as
//   a child process: its readers count when the entry or anything it imports changed, as
//   esbuild — the project's, as vitest is — follows the imports.
// - `held_back:` lists `when` patterns and `tests`: a selected test is left out unless a
//   changed file matches one of its entry's patterns or is that test itself.
//
// A pattern is a path from the root where `*` is any run of characters, `/` included.
// `--list-changed` prints what `--related` counts as changed and runs nothing, for a script
// that narrows its own stages by it.
//
// It imports Node's built-ins and `yaml`, which the bundle carries and the checkout
// resolves beside this file: from the checkout Node runs this file with its types stripped,
// and vitest and esbuild are the project's, never Orkestra's — Orkestra's vitest would run a
// suite written for another version.

// oxlint-disable-next-line eslint/no-restricted-imports -- runs inside a check, as a process of that check; it spawns the check's own stages and `pnpm ls`, on the machine the check already runs on
import { execFileSync, spawn } from "node:child_process"
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { stripVTControlCharacters } from "node:util"
import type * as EsbuildModule from "esbuild"
import type { Plugin } from "esbuild"
import type { UserConsoleLog } from "vitest"
import type * as VitestNodeModule from "vitest/node"
import type {
  Reporter,
  SerializedError,
  TestModule,
  TestProject,
  TestSpecification,
} from "vitest/node"
import { parse } from "yaml"

type VitestNode = typeof VitestNodeModule
type Esbuild = typeof EsbuildModule

/**
 * A test stage: what it is named, the package it runs in, vitest's own command, and the
 * command up to the script — what a failing test is run again with.
 */
interface TestStage {
  readonly command: string
  readonly dir: string
  readonly vitest: string
  readonly script: string
}

/** A static stage: what it is named, and the shell text run in `dir`. */
interface StaticStage {
  readonly command: string
  readonly dir: string
  readonly run: string
}

type Stage = TestStage | StaticStage

const isTest = (stage: Stage): stage is TestStage => "vitest" in stage

/** A stage this program cannot run, said in one line. */
class Refused extends Error {}

const ROOT = process.cwd()

/** The environment a static stage runs in: the check's, before a test stage sets vitest's. */
const CHECK_ENV: NodeJS.ProcessEnv = { ...process.env }

/** How long the loop may take to drain once every stage has ended: vitest's own teardown. */
const DRAIN_MS = 10_000

/** How deep one script may call another: past it, a script is calling itself. */
const NESTING = 10

const variable = (name: string): string | undefined => {
  const value = process.env[name]
  return value === undefined || value === "" ? undefined : value
}

const manifestOf = (dir: string): unknown =>
  JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))

const fieldOf = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined

/** Each workspace package `pnpm ls` lists for `selector`, as its directory. */
const listed = (selector: readonly string[]): readonly string[] => {
  const packages: unknown = JSON.parse(
    execFileSync("pnpm", [...selector, "ls", "--depth", "-1", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
    }),
  )
  return (Array.isArray(packages) ? packages : [])
    .map((entry: unknown) => fieldOf(entry, "path"))
    .filter((path): path is string => typeof path === "string")
}

const filtered = new Map<string, string>()

/** The directory of the workspace package `filter` names. */
const packageDir = (filter: string): string => {
  const known = filtered.get(filter)
  if (known !== undefined) return known
  const [path] = listed(["--filter", filter])
  if (path === undefined) throw new Refused(`pnpm --filter ${filter}: no such package`)
  filtered.set(filter, path)
  return path
}

const scriptOf = (dir: string, script: string): string | undefined => {
  const text = fieldOf(fieldOf(manifestOf(dir), "scripts"), script)
  return typeof text === "string" ? text : undefined
}

/**
 * Every package but the root that has `script`, as `pnpm -r` runs it: the root is the
 * workspace, not one of its packages.
 */
const recursiveDirs = (script: string): readonly string[] => {
  const dirs = listed(["-r"]).filter((dir) => dir !== ROOT && scriptOf(dir, script) !== undefined)
  if (dirs.length === 0) throw new Refused(`pnpm -r ${script}: no package has the script`)
  return dirs
}

/** `pnpm [--filter <pkg> | -r] <script> [words…]`, read off its words. */
interface PnpmCall {
  readonly filter: string | undefined
  readonly recursive: boolean
  readonly script: string
  readonly words: readonly string[]
}

const wordsOf = (command: string): readonly string[] =>
  command.split(/\s+/).filter((word) => word !== "")

/** The call a command makes, or undefined where it is not a script a package names. */
const pnpmCall = (command: string): PnpmCall | undefined => {
  const words = wordsOf(command)
  if (words[0] !== "pnpm") return undefined
  const recursive = words[1] === "-r" || words[1] === "--recursive"
  const filter = words[1] === "--filter" || words[1] === "-F" ? words[2] : undefined
  let at = 1
  if (recursive) at = 2
  if (filter !== undefined) at = 3
  const script = words[at]
  if (script === undefined || script.startsWith("-")) return undefined
  return { filter, recursive, script, words: words.slice(at + 1) }
}

const isVitest = (text: string): boolean => /^vitest(\s|$)/.test(text)

/** How a person runs `script` in `dir` from the root: by the package's name, or its path. */
const scriptCommand = (dir: string, script: string): string => {
  if (dir === ROOT) return `pnpm ${script}`
  const name = fieldOf(manifestOf(dir), "name")
  const filter = typeof name === "string" ? name : `./${relative(ROOT, dir)}`
  return `pnpm --filter ${filter} ${script}`
}

const withWords = (text: string, words: readonly string[]): string => [text, ...words].join(" ")

/** A command that names no package's script, as the stage it is. */
const asWritten = (command: string, dir: string): Stage =>
  isVitest(command)
    ? { command, dir, vitest: command, script: command }
    : { command, dir, run: command }

/** The stages a command resolves to, run from `dir`. */
const resolveCommand = (command: string, dir: string, depth: number): readonly Stage[] => {
  if (depth > NESTING) {
    throw new Refused(`${command}: scripts nest more than ${NESTING} deep, so one calls itself`)
  }
  const call = pnpmCall(command)
  if (call === undefined) return [asWritten(command, dir)]
  if (call.recursive) {
    return recursiveDirs(call.script).flatMap((at) => resolveScript(call, at, depth))
  }
  return resolveScript(call, call.filter === undefined ? dir : packageDir(call.filter), depth)
}

/** One package's script as stages: a chain part by part, the words onto the last. */
const resolveScript = (call: PnpmCall, dir: string, depth: number): readonly Stage[] => {
  const script = scriptCommand(dir, call.script)
  const command = withWords(script, call.words)
  const text = scriptOf(dir, call.script)
  // pnpm says it has no such script, as the stage's failure.
  if (text === undefined) return [{ command, dir: ROOT, run: command }]
  const parts = text.split(" && ")
  if (parts.length > 1) {
    const last = parts.length - 1
    return parts.flatMap((part, at) =>
      resolveCommand(at === last ? withWords(part, call.words) : part, dir, depth + 1),
    )
  }
  if (isVitest(text)) return [{ command, dir, vitest: withWords(text, call.words), script }]
  if (pnpmCall(text) !== undefined)
    return resolveCommand(withWords(text, call.words), dir, depth + 1)
  // Through pnpm rather than as its text, so pnpm's own refusals — a `node_modules` that does
  // not match the lockfile — reach the report.
  return [{ command, dir: ROOT, run: command }]
}

/** The files already proven on this tree, from the root. */
const provenFiles = (): ReadonlySet<string> => {
  const file = variable("ORKESTRA_UNITS_PROVEN")
  if (file === undefined || !existsSync(file)) return new Set()
  return new Set(readFileSync(file, "utf8").split("\n"))
}

/**
 * Appends each test file that passes. Only `passed`: a file with a failing or skipped test
 * is not proven, so it runs again.
 */
const unitsReporter = (out: string): Reporter => ({
  onTestModuleEnd: (module: TestModule) => {
    if (module.state() === "passed") appendFileSync(out, `${relative(ROOT, module.moduleId)}\n`)
  },
})

/** The parts of vitest's serialized error the report reads. */
export interface FailedError {
  readonly name?: string
  readonly message: string
  readonly diff?: string
  readonly stacks?: ReadonlyArray<{
    readonly file: string
    readonly line: number
    readonly column: number
  }>
}

/** A failing test, or a file, suite or run that failed outside any one test. */
export interface Failure {
  /** Absolute, as vitest names it; empty for a run's own error. */
  readonly file: string
  /** The test's or suite's full name, empty for a file's or a run's own error. */
  readonly name: string
  readonly errors: ReadonlyArray<FailedError>
  /** What it wrote to stdout and stderr, in order. */
  readonly console: ReadonlyArray<string>
  /** The command that runs it again, or undefined for a run's own error. */
  readonly rerun: string | undefined
}

/** Lines of one error's message and diff kept. */
export const ERROR_LINES = 40
/** Lines of one failure's console output kept. */
export const CONSOLE_LINES = 30
/** Failures shown in full; past this only their names and commands are. */
export const DETAILED = 10

const linesOf = (text: string): readonly string[] =>
  stripVTControlCharacters(text).replace(/\s+$/, "").split("\n")

const capped = (lines: readonly string[], cap: number, what: string): readonly string[] =>
  lines.length <= cap
    ? lines
    : [...lines.slice(0, cap), `(${lines.length - cap} more lines of ${what})`]

const indented = (lines: readonly string[]): readonly string[] =>
  lines.map((line) => (line === "" ? "" : `    ${line}`))

/** The first frame in the checkout's own code, rather than a dependency's or Node's. */
const firstFrame = (root: string, error: FailedError): string | undefined => {
  const frame = error.stacks?.find(
    (stack) => stack.file.startsWith(`${root}/`) && !stack.file.includes("/node_modules/"),
  )
  return frame === undefined
    ? undefined
    : `at ${relative(root, frame.file)}:${frame.line}:${frame.column}`
}

const errorBlock = (root: string, error: FailedError): readonly string[] => {
  const head = error.name === undefined || error.name === "" ? "" : `${error.name}: `
  const body = linesOf(`${head}${error.message}`)
  const diff = error.diff === undefined ? [] : ["", ...linesOf(error.diff)]
  const frame = firstFrame(root, error)
  return [
    ...indented(capped([...body, ...diff], ERROR_LINES, "this error")),
    ...(frame === undefined ? [] : [`    ${frame}`]),
  ]
}

const consoleBlock = (output: readonly string[]): readonly string[] => {
  const lines = output.flatMap(linesOf)
  if (lines.length === 0) return []
  return ["  console:", ...indented(capped(lines, CONSOLE_LINES, "console output"))]
}

const title = (root: string, failure: Failure): string => {
  const file = failure.file === "" ? "(outside any test file)" : relative(root, failure.file)
  return `FAIL ${file}${failure.name === "" ? "" : ` > ${failure.name}`}`
}

const rerunLine = (failure: Failure): readonly string[] =>
  failure.rerun === undefined ? [] : [`  rerun: ${failure.rerun}`]

/** The report on a run's failures, paths from `root`; the empty string where there are none. */
export const failureReport = (root: string, failures: readonly Failure[]): string => {
  const shown = failures.slice(0, DETAILED).flatMap((failure) =>
    [title(root, failure)].concat(
      failure.errors.flatMap((error) => errorBlock(root, error)),
      consoleBlock(failure.console),
      rerunLine(failure),
      [""],
    ),
  )
  const named = failures
    .slice(DETAILED)
    .flatMap((failure) => [title(root, failure)].concat(rerunLine(failure)))
  const rest =
    named.length === 0
      ? []
      : [`${failures.length - DETAILED} more failing, without their errors:`, ...named, ""]
  return [...shown, ...rest].join("\n")
}

const quoted = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`

const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const failedError = (error: SerializedError): FailedError => {
  const diff: unknown = error["diff"]
  return {
    message: error.message,
    ...(error.name === undefined ? {} : { name: error.name }),
    ...(typeof diff === "string" ? { diff } : {}),
    ...(error.stacks === undefined ? {} : { stacks: error.stacks }),
  }
}

/**
 * Every failure in one file: its own errors, its suites' — a failing `beforeAll` lands
 * there — and its tests'. A test is run again by its file and its own name as `-t` reads
 * it; anything else by its file.
 */
const failuresOf = (
  stage: TestStage,
  module: TestModule,
  console: ReadonlyMap<string, readonly string[]>,
): readonly Failure[] => {
  const file = module.moduleId
  const byFile = `${stage.script} ${relative(stage.dir, file)}`
  const own = (
    id: string,
    name: string,
    errors: readonly SerializedError[],
    rerun: string,
  ): Failure => ({
    file,
    name,
    errors: errors.map(failedError),
    console: console.get(id) ?? [],
    rerun,
  })
  const errors = module.errors()
  return [
    ...(errors.length > 0 ? [own(module.id, "", errors, byFile)] : []),
    ...[...module.children.allSuites()]
      .filter((suite) => suite.errors().length > 0)
      .map((suite) => own(suite.id, suite.fullName, suite.errors(), byFile)),
    ...[...module.children.allTests("failed")].map((test) =>
      own(
        test.id,
        test.fullName,
        test.result().errors ?? [],
        `${byFile} -t ${quoted(escaped(test.name))}`,
      ),
    ),
  ]
}

/** What one run of a stage left for the report: its files and its failures. */
interface StageRun {
  readonly ran: number
  readonly failures: readonly Failure[]
}

/** A reporter that keeps what each test wrote and, at the run's end, what failed. */
const failureReporter = (stage: TestStage): { reporter: Reporter; run: () => StageRun } => {
  const console = new Map<string, string[]>()
  let run: StageRun = { ran: 0, failures: [] }
  const reporter: Reporter = {
    onUserConsoleLog: (log: UserConsoleLog) => {
      if (log.taskId === undefined) return
      console.set(log.taskId, [...(console.get(log.taskId) ?? []), log.content])
    },
    onTestRunEnd: (modules, unhandled) => {
      // In path order: vitest finishes files in whatever order its workers do.
      const sorted = [...modules].sort((a, b) => a.moduleId.localeCompare(b.moduleId))
      run = {
        ran: modules.length,
        failures: [
          ...sorted.flatMap((module) => failuresOf(stage, module, console)),
          ...(unhandled.length > 0
            ? [
                {
                  file: "",
                  name: "",
                  errors: unhandled.map(failedError),
                  console: [],
                  rerun: undefined,
                },
              ]
            : []),
        ],
      }
    },
  }
  return { reporter, run: () => run }
}

/**
 * Holds back what this process's stdout and stderr are written while a test stage runs,
 * until `release` hands it over, in the order it was written.
 *
 * vitest pipes each `forks` worker's stdout and stderr into this process's own streams, so a
 * child a test spawns with inherited stdio writes here, past vitest's console capture: git's
 * hints from a test that makes a scratch repository reached the top of every passing check.
 * Held by replacing each stream's `write`, rather than handing vitest streams of its own, so
 * what this process writes meanwhile — a global setup, Vite's warnings — is held as well. A
 * child holding this process's own descriptors — one the main process or a `threads` worker
 * starts — writes past it: Node cannot point a descriptor it holds anywhere else.
 */
const holdOutput = (): { release: () => string } => {
  const chunks: Buffer[] = []
  const restores = [process.stdout, process.stderr].map((stream) => {
    const write = stream.write.bind(stream)
    stream.write = (
      chunk: Uint8Array | string,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      done?: (error?: Error | null) => void,
    ): boolean => {
      chunks.push(
        typeof chunk === "string"
          ? Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8")
          : Buffer.from(chunk),
      )
      const callback = typeof encoding === "function" ? encoding : done
      if (callback !== undefined) process.nextTick(callback)
      return true
    }
    return () => {
      stream.write = write
    }
  })
  return {
    release: () => {
      for (const restore of restores) restore()
      return Buffer.concat(chunks).toString("utf8")
    },
  }
}

/** How a test stage ended once vitest has decided, from what it ran and what was proven. */
const verdict = (stage: TestStage, run: StageRun, proven: number, passed: boolean): Outcome => {
  const counts = `test files: ${run.ran} ran, ${proven} already proven`
  if (passed) return { passed, text: `✓ ${stage.command} — ${counts}\n` }
  const report = failureReport(ROOT, run.failures)
  // Where vitest failed with nothing to name — no test file found, say — what it said
  // about it is below, with the rest of what the run printed.
  return {
    passed,
    text:
      report === ""
        ? `${counts}\n\nvitest failed and named no failing test.\n`
        : `${counts}\n\n${report}`,
  }
}

/** The recording setup file first in each project's `setupFiles`, and allowed by its server. */
const listRecording = (projects: readonly TestProject[], file: string): void => {
  for (const project of projects) {
    const setup = project.config.setupFiles
    if (!setup.includes(file)) setup.unshift(file)
    const allow = project.vite.config.server.fs.allow
    if (!allow.includes(file)) allow.push(file)
  }
}

const isVitestNode = (loaded: unknown): loaded is VitestNode =>
  typeof loaded === "object" &&
  loaded !== null &&
  typeof Reflect.get(loaded, "createVitest") === "function" &&
  typeof Reflect.get(loaded, "parseCLI") === "function"

/**
 * vitest's colors off where nobody reads them as colors. `tinyrainbow`, which vitest colors
 * with, turns them on for any stream whose `TERM` is not `dumb`, a pipe included, and
 * vitest's own command line turns them off only under an agent — so through the Node API
 * the report a check prints carried `\x1b[2m` in every failing test's name. Turned off
 * where vitest turns them, its own `tinyrainbow` resolved beside it, so a person at a
 * terminal keeps them.
 */
const colorless = async (entry: string): Promise<void> => {
  if (process.stdout.isTTY) return
  const colors: unknown = await import(
    pathToFileURL(createRequire(entry).resolve("tinyrainbow")).href
  )
  const disable: unknown =
    typeof colors === "object" && colors !== null
      ? Reflect.get(colors, "disableDefaultColors")
      : undefined
  if (typeof disable === "function") Reflect.apply(disable, undefined, [])
}

/** The project's own `vitest/node`, resolved from the package as its scripts would. */
const vitestOf = async (dir: string): Promise<VitestNode> => {
  const entry = createRequire(join(dir, "package.json")).resolve("vitest/node")
  // Before vitest loads: a module of its colors a separator once, as it is evaluated.
  await colorless(entry)
  const loaded: unknown = await import(pathToFileURL(entry).href)
  if (!isVitestNode(loaded)) throw new Refused(`${entry}: not a vitest this can run`)
  return loaded
}

/** One `reads:` row: a pattern, or `run:<entry>`, and the files that read it. */
interface ReadRow {
  readonly pattern: string
  readonly readers: readonly string[]
}

/** One `held_back:` entry: the tests, and the files whose change lets them run. */
interface HeldRow {
  readonly when: readonly string[]
  readonly tests: readonly string[]
}

/** The project's two tables, from the file `--select` names. */
interface Selection {
  readonly reads: readonly ReadRow[]
  readonly heldBack: readonly HeldRow[]
}

const NO_SELECTION: Selection = { reads: [], heldBack: [] }

const isStrings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** The tables in `file`, from the root; refused, naming the file, where a row is malformed. */
const selectionOf = (file: string): Selection => {
  const parsed: unknown = parse(readFileSync(join(ROOT, file), "utf8"))
  const top = parsed ?? {}
  if (!isRecord(top)) throw new Refused(`${file}: not a mapping of reads: and held_back:`)
  const reads = top["reads"] ?? {}
  if (!isRecord(reads)) throw new Refused(`${file}: reads: is not a mapping`)
  const rows = Object.entries(reads).map(([pattern, readers]): ReadRow => {
    if (!isStrings(readers)) throw new Refused(`${file}: reads: ${pattern} is not a list of files`)
    return { pattern, readers }
  })
  const held = top["held_back"] ?? []
  if (!Array.isArray(held)) throw new Refused(`${file}: held_back: is not a list`)
  const heldBack = held.map((entry: unknown, at): HeldRow => {
    const when = fieldOf(entry, "when")
    const tests = fieldOf(entry, "tests")
    if (!isStrings(when) || !isStrings(tests)) {
      throw new Refused(
        `${file}: held_back: entry ${at + 1} needs a list of files under when: and tests:`,
      )
    }
    return { when, tests }
  })
  return { reads: rows, heldBack }
}

/** A pattern as a test of a path from the root: `*` is any run of characters, `/` included. */
const matcherOf = (pattern: string): RegExp =>
  new RegExp(`^${pattern.split("*").map(escaped).join(".*")}$`)

const matchesAny = (patterns: readonly string[], paths: readonly string[]): boolean =>
  patterns.some((pattern) => {
    const matcher = matcherOf(pattern)
    return paths.some((path) => matcher.test(path))
  })

/** git in the root, its output trimmed; throws where git fails. */
const gitOutput = (args: readonly string[], env: NodeJS.ProcessEnv = {}): string =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...CHECK_ENV, ...env },
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim()

const gitSays = (args: readonly string[]): string | undefined => {
  try {
    return gitOutput(args)
  } catch {
    return undefined
  }
}

/**
 * Where the branch began: where it left the commit its checkout was cut from, which the
 * engine hands over as `ORKESTRA_BASE_COMMIT`. A trak cut from a goal branch or a parent's
 * branch began there, not where that branch left the default branch, so measuring from the
 * default branch would count the whole goal's changes as the trak's own. The merge base
 * rather than the commit itself, so a branch no longer standing on that commit still has an
 * answer. Commits merged in from where the trak lands after it was cut do count, until the
 * check first passes here and `ORKESTRA_PASSED_TREE` takes over.
 *
 * Where no commit is handed over, or this checkout does not hold it, it is where the branch
 * left the default branch, which `origin/HEAD` names — the fresher of the two, since the
 * engine fetches `origin` when it makes a worktree.
 */
const branchBase = (): string => {
  const cut = variable("ORKESTRA_BASE_COMMIT")
  if (cut !== undefined && gitSays(["cat-file", "-e", `${cut}^{commit}`]) !== undefined) {
    const began = gitSays(["merge-base", "HEAD", cut])
    if (began !== undefined) return began
  }
  const remote =
    gitSays(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]) ?? "origin/main"
  return (
    gitSays(["merge-base", "HEAD", remote]) ?? gitSays(["merge-base", "HEAD", "main"]) ?? "HEAD"
  )
}

/**
 * What `--related` measures from: the tree this check last passed on in this checkout,
 * which the engine hands over as `ORKESTRA_PASSED_TREE`, rather than where the branch began.
 * The engine commits after every step, so measured from the branch's start a step that
 * edited one note would select every test file the trak's earlier steps reached. Where
 * there is no such tree — the first run in a checkout, a tree git has since pruned, or no
 * engine — it is where the branch began.
 */
const sinceTree = (): string => {
  const passed = variable("ORKESTRA_PASSED_TREE")
  if (passed !== undefined && gitSays(["cat-file", "-e", `${passed}^{tree}`]) !== undefined) {
    return passed
  }
  return branchBase()
}

/**
 * Every file that differs between `from` and the checkout as it would be committed, from the
 * root. The checkout is hashed through a scratch copy of its index, as the engine hashes it,
 * so edits not yet committed and new files count and ignored ones do not. **Less the files
 * `.gitattributes` marks `linguist-generated`**, which a check with
 * `ignores_linguist_generated:` promises not to read: the tree the engine hands over leaves
 * them out, so every one of them would otherwise read as changed.
 */
const diffedFrom = (from: string): readonly string[] => {
  const index = gitOutput(["rev-parse", "--path-format=absolute", "--git-path", "index"])
  const scratch = join(mkdtempSync(join(tmpdir(), "check-stages-index-")), "index")
  try {
    // With the index's own mtime: git takes an entry whose file is no older than the index
    // as racy and reads its content, which is what sees an edit made in the second of the
    // last commit to a file of the same size. A copy dated now would read it as unchanged.
    if (existsSync(index)) {
      copyFileSync(index, scratch)
      const { atime, mtime } = statSync(index)
      utimesSync(scratch, atime, mtime)
    }
    gitOutput(["add", "-A", "."], { GIT_INDEX_FILE: scratch })
    const tree = gitOutput(["write-tree"], { GIT_INDEX_FILE: scratch })
    const names = gitOutput([
      "diff",
      "--name-only",
      "--no-renames",
      from,
      tree,
      "--",
      ":(exclude,attr:linguist-generated)",
    ])
    return names.split("\n").filter((name) => name !== "")
  } finally {
    rmSync(dirname(scratch), { recursive: true, force: true })
  }
}

const isEsbuild = (loaded: unknown): loaded is Esbuild =>
  typeof loaded === "object" &&
  loaded !== null &&
  typeof Reflect.get(loaded, "build") === "function"

/**
 * Follows a bare import only where it resolves outside `node_modules`: a workspace package
 * such as a shared one is a link into the checkout, and an edit to it reaches a child like
 * any other, while every third-party package resolves inside.
 */
const workspaceOnly: Plugin = {
  name: "workspace-only",
  setup: (build) => {
    build.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (args.pluginData === "inner") return undefined
      const { path, external, errors } = await build.resolve(args.path, {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
        pluginData: "inner",
      })
      if (errors.length > 0) return { errors }
      return external || path.includes("/node_modules/")
        ? { path: args.path, external: true }
        : { path }
    })
  },
}

/** Every file, from the root, a spawned entry imports, the entry among them. */
type Reach = ReadonlySet<string> | "everything"

/**
 * Each `run:` entry's static imports, by an esbuild bundle that writes nothing — esbuild
 * from the project's own install, as vitest is. An entry not on disk reaches nothing, since
 * nothing can start it. **An entry esbuild cannot follow reaches everything**, as does every
 * entry where the project has no esbuild: a failure to list imports must select more tests,
 * never fewer.
 */
const reachOf = async (entries: readonly string[]): Promise<ReadonlyMap<string, Reach>> => {
  const reach = new Map<string, Reach>()
  if (entries.length === 0) return reach
  let esbuild: Esbuild | undefined
  try {
    const loaded: unknown = await import(
      pathToFileURL(createRequire(join(ROOT, "package.json")).resolve("esbuild")).href
    )
    if (isEsbuild(loaded)) esbuild = loaded
  } catch {
    esbuild = undefined
  }
  for (const entry of entries) {
    if (esbuild === undefined) reach.set(entry, "everything")
    else if (!existsSync(join(ROOT, entry))) reach.set(entry, new Set())
    else {
      // oxlint-disable-next-line no-await-in-loop -- one esbuild service, one bundle at a time
      reach.set(entry, await bundleInputs(esbuild, entry))
    }
  }
  await esbuild?.stop()
  return reach
}

const bundleInputs = async (esbuild: Esbuild, entry: string): Promise<Reach> => {
  try {
    const { metafile } = await esbuild.build({
      entryPoints: [entry],
      absWorkingDir: ROOT,
      bundle: true,
      write: false,
      metafile: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
      plugins: [workspaceOnly],
    })
    return new Set(Object.keys(metafile.inputs))
  } catch {
    return "everything"
  }
}

/**
 * The readers `reads:` names for the files that changed: a row's readers when a changed file
 * matches its pattern, or for a `run:<entry>` row, when one is the entry or anything it
 * imports — what a child imports is outside vitest's graph too.
 */
const readersOf = async (
  selection: Selection,
  diffed: readonly string[],
): Promise<readonly string[]> => {
  if (diffed.length === 0) return []
  const entries = selection.reads
    .filter((row) => row.pattern.startsWith("run:"))
    .map((row) => row.pattern.slice("run:".length))
  const reach = await reachOf(entries)
  const paths = new Set(diffed)
  return selection.reads.flatMap((row) => {
    if (!row.pattern.startsWith("run:")) {
      return matchesAny([row.pattern], diffed) ? row.readers : []
    }
    const reached = reach.get(row.pattern.slice("run:".length)) ?? "everything"
    const hit = reached === "everything" || [...reached].some((file) => paths.has(file))
    return hit ? row.readers : []
  })
}

/** What `--related` selects from; `undefined` where git could not say what changed. */
interface Changes {
  /** Every file that differs, from the root. */
  readonly diffed: readonly string[]
  /** `diffed`, then each reader `reads:` names for one of them. */
  readonly changed: readonly string[]
}

const changesOf = async (selection: Selection): Promise<Changes | undefined> => {
  let diffed: readonly string[]
  try {
    diffed = diffedFrom(sinceTree())
  } catch {
    return undefined
  }
  const readers = await readersOf(selection, diffed)
  return { diffed, changed: [...new Set([...diffed, ...readers])] }
}

/**
 * The test files `held_back:` leaves out, from the root: every test of an entry none of
 * whose `when` patterns a changed file matches, less any of those tests that itself changed.
 */
const heldBackFiles = (selection: Selection, diffed: readonly string[]): ReadonlySet<string> => {
  const changed = new Set(diffed)
  return new Set(
    selection.heldBack
      .filter((row) => !matchesAny(row.when, diffed))
      .flatMap((row) => row.tests.filter((test) => !changed.has(test))),
  )
}

/** How a test stage chooses its files under `--related`: the tables, and what changed. */
interface Related {
  readonly selection: Selection
  /** `undefined` where git could not say, and vitest's own `--changed` chooses instead. */
  readonly changes: Changes | undefined
}

/** What a related stage prints where it leaves out a `held_back:` test, before the files. */
export const HELD_BACK = "Test files held back, as no changed file matches their `when`:"

const fromRoot = (spec: TestSpecification): string => relative(ROOT, spec.moduleId)

/** Paths from the root, once each, sorted: vitest's order varies between runs. */
const named = (specs: readonly TestSpecification[]): string =>
  [...new Set(specs.map(fromRoot))].sort().join(" ")

/**
 * The files a related stage runs, less the `held_back:` tests no changed file unlocks, after
 * saying which those are and, where some of the rest are proven, which ran. A held-back file
 * already proven stays, for the count, since it would not run either way.
 */
const relatedSpecs = (
  specs: readonly TestSpecification[],
  selection: Selection,
  changes: Changes,
  proven: ReadonlySet<string>,
): readonly TestSpecification[] => {
  const held = heldBackFiles(selection, changes.diffed)
  const left = specs.filter((spec) => held.has(fromRoot(spec)) && !proven.has(fromRoot(spec)))
  const kept = specs.filter((spec) => !left.includes(spec))
  if (left.length > 0) say(`${HELD_BACK} ${named(left)}\n`)
  const unproven = kept.filter((spec) => !proven.has(fromRoot(spec)))
  // Which files missed, so the next miss can be traced to its files without the database.
  if (unproven.length > 0 && unproven.length < kept.length) say(`  ran: ${named(unproven)}\n`)
  return kept
}

/** vitest's options for what `--related` selects: the changed files, or its own `--changed`. */
const selecting = (related: Related | undefined): Record<string, unknown> => {
  if (related === undefined) return {}
  if (related.changes === undefined) return { changed: branchBase(), passWithNoTests: true }
  return { related: related.changes.changed.map((file) => resolve(ROOT, file)) }
}

const noneSelected = (stage: TestStage): Outcome => ({
  passed: true,
  text: `✓ ${stage.command} — no test file selected\n`,
})

/** One run of vitest for a test stage, passing by the exit code vitest itself decides on. */
const runVitest = async (
  stage: TestStage,
  proven: ReadonlySet<string>,
  related: Related | undefined,
): Promise<Outcome> => {
  const changes = related?.changes
  if (changes?.changed.length === 0) return noneSelected(stage)
  const node = await vitestOf(stage.dir)
  const { filter, options } = node.parseCLI(stage.vitest)
  // `--reporter` arrives under its own name rather than the `reporters` it aliases, so both
  // are read. A reporter the words name runs beside this program's own.
  const { reporters, ...rest } = options
  const asked: unknown[] = [reporters, Reflect.get(rest, "reporter")].flat()
  Reflect.deleteProperty(rest, "reporter")
  const out = variable("ORKESTRA_UNITS_OUT")
  const recording = variable("ORKESTRA_RECORDING_VITEST")
  const failures = failureReporter(stage)
  process.chdir(stage.dir)
  process.exitCode = 0
  const vitest = await node.createVitest("test", {
    ...rest,
    ...selecting(related),
    watch: false,
    run: true,
    root: stage.dir,
    reporters: [
      ...asked.filter((name): name is string => typeof name === "string"),
      failures.reporter,
      ...(out === undefined ? [] : [unitsReporter(out)]),
    ],
  })
  let skipped = 0
  try {
    if (recording !== undefined) listRecording(vitest.projects, recording)
    const all = await vitest.getRelevantTestSpecifications(filter)
    const chosen =
      related === undefined || changes === undefined
        ? all
        : relatedSpecs(all, related.selection, changes, proven)
    if (changes !== undefined && chosen.length === 0) return noneSelected(stage)
    say(`→ ${stage.command}\n`)
    const left = chosen.filter((spec) => !proven.has(fromRoot(spec)))
    skipped = chosen.length - left.length
    if (skipped === 0 && changes === undefined) {
      await vitest.start(filter).catch((error: unknown) => {
        // What `vitest run` does with an empty selection: `passWithNoTests` has already
        // decided the exit code, and its default reporter would say why it failed.
        // Matched by its code: its `name` is the plain `Error` it extends.
        if (!(error instanceof Error && Reflect.get(error, "code") === "VITEST_FILES_NOT_FOUND")) {
          throw error
        }
        if (process.exitCode !== 0) console.log(stripVTControlCharacters(error.message))
      })
    } else if (left.length > 0) {
      await vitest.standalone()
      await vitest.runTestSpecifications([...left], false)
    }
  } finally {
    await vitest.close()
    process.chdir(ROOT)
  }
  return verdict(stage, failures.run(), skipped, process.exitCode === 0)
}

/**
 * One test stage, with what it printed held back: dropped where it passed, and under the
 * report where it failed. Where the run throws, what it printed goes to stderr ahead of the
 * error, so nothing it said is lost to the crash.
 */
const runStage = async (
  stage: TestStage,
  proven: ReadonlySet<string>,
  related: Related | undefined,
): Promise<Outcome> => {
  const held = holdOutput()
  const outcome = await runVitest(stage, proven, related).catch((error: unknown) => {
    process.stderr.write(held.release())
    throw error
  })
  const printed = trimmedOutput(held.release())
  if (outcome.passed || printed.length === 0) return outcome
  return {
    passed: false,
    text: `${outcome.text}\nPrinted outside any test's console output:\n\n${cutMiddle(printed, stage.command).join("\n")}\n`,
  }
}

/** Lines of a failing static stage's output kept from its start, and from its end. */
const HEAD_LINES = 50
const TAIL_LINES = 150

/** A duration in parentheses, or after `in` at a line's end: `(12ms)`, `in 1.2s`. */
const DURATION = /\s*\(\d+(?:\.\d+)?m?s\)|\s+in\s+\d+(?:\.\d+)?m?s\b/g

/**
 * What a failing static stage printed, less what would be there whatever happened: pnpm's
 * preamble and lifecycle lines, every duration, and the blank lines left behind.
 *
 * The preamble is matched on its header shape, `> NAME@VERSION SCRIPT /abs/dir`, and the
 * `> ` line under it, rather than on a bare `> `: that is also the marker a code frame puts
 * against the offending line. A workspace package has no version, so `VERSION` may be
 * empty. pnpm 12 prints its script as `$ SCRIPT` instead, which is dropped only as the
 * first line, before anything the script printed. Of pnpm's own errors only the one
 * repeating a failure is dropped — any other, such as a `node_modules` that does not match
 * the lockfile, is the whole of what failed.
 */
export const trimmedOutput = (output: string): readonly string[] => {
  const kept: string[] = []
  let preamble = false
  for (const raw of stripVTControlCharacters(output).split("\n")) {
    if (/^> [^ ]+@[^ ]* [^ ]+ \//.test(raw)) {
      preamble = true
      continue
    }
    const expansion =
      (preamble && raw.startsWith("> ")) || (kept.length === 0 && raw.startsWith("$ "))
    preamble = false
    if (expansion || /ELIFECYCLE|ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL|^Exit status /.test(raw)) {
      continue
    }
    // The bare directory pnpm names above a recursive run's failure.
    if (/^\/\S*:$/.test(raw)) continue
    kept.push(raw.replace(DURATION, "").trimEnd())
  }
  // Runs of blank lines as one, and none at either end.
  const collapsed = kept.filter((line, at) => line !== "" || (at > 0 && kept[at - 1] !== ""))
  while (collapsed.at(-1) === "") collapsed.pop()
  return collapsed
}

/** The lines past the cap cut from the middle, saying how many and how to see them. */
const cutMiddle = (lines: readonly string[], command: string): readonly string[] =>
  lines.length <= HEAD_LINES + TAIL_LINES
    ? lines
    : [
        ...lines.slice(0, HEAD_LINES),
        "",
        `(${lines.length - HEAD_LINES - TAIL_LINES} lines cut here. Run \`${command}\` to see them.)`,
        "",
        ...lines.slice(lines.length - TAIL_LINES),
      ]

/** How a stage ended: whether it passed, and what is printed for it. */
interface Outcome {
  readonly passed: boolean
  /** The pass line, or the failure's body. */
  readonly text: string
}

const PATH_NAME = "PATH"

/** One static stage, its output kept only to report a failure. */
const runStatic = (stage: StaticStage): Promise<Outcome> =>
  new Promise((done) => {
    const chunks: Buffer[] = []
    const path = [
      join(stage.dir, "node_modules", ".bin"),
      join(ROOT, "node_modules", ".bin"),
      CHECK_ENV[PATH_NAME] ?? "",
    ].join(delimiter)
    const child = spawn("sh", ["-c", stage.run], {
      cwd: stage.dir,
      env: { ...CHECK_ENV, [PATH_NAME]: path },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const keep = (chunk: Buffer): void => {
      chunks.push(chunk)
    }
    child.stdout.on("data", keep)
    child.stderr.on("data", keep)
    child.on("error", (error) => done({ passed: false, text: `${error.message}\n` }))
    child.on("close", (code) => {
      if (code === 0) {
        done({ passed: true, text: `✓ ${stage.command}\n` })
        return
      }
      const lines = trimmedOutput(Buffer.concat(chunks).toString("utf8"))
      done({
        passed: false,
        text:
          lines.length === 0
            ? `It exited ${code ?? "on a signal"} and printed nothing this check could show you.\n`
            : `${cutMiddle(lines, stage.command).join("\n")}\n`,
      })
    })
  })

/** How the stages are run, from the flags ahead of the commands. */
interface Options {
  readonly parallel: boolean
  readonly keepGoing: boolean
  /** Under `--related`, what each test stage selects from. */
  readonly related: Related | undefined
}

/**
 * The stages in the batches they start in: with `--parallel`, each run of consecutive
 * static stages together; every test stage alone, since a suite already takes every core.
 */
const batchesOf = (stages: readonly Stage[], parallel: boolean): readonly (readonly Stage[])[] => {
  const batches: Stage[][] = []
  for (const stage of stages) {
    const last = batches.at(-1)
    const joins = parallel && !isTest(stage) && last !== undefined && !last.some(isTest)
    if (joins) last.push(stage)
    else batches.push([stage])
  }
  return batches
}

/** What one run of the stages has come to: the commands that failed so far. */
interface Tally {
  readonly failed: string[]
}

/** This process's stdout as it is before any test stage holds it back. */
const write = process.stdout.write.bind(process.stdout)

/** Prints a line of this program's own, which a test stage's held output never swallows. */
const say = (text: string): void => {
  write(text)
}

/** Prints how a stage ended. Whether the run carries on past it. */
const reported = (stage: Stage, outcome: Outcome, options: Options, tally: Tally): boolean => {
  if (outcome.passed) {
    say(outcome.text)
    return true
  }
  tally.failed.push(stage.command)
  const after = options.keepGoing ? "." : ", and nothing after it ran."
  say(`\`${stage.command}\` failed${after}\n\n${outcome.text}`)
  return options.keepGoing
}

const notRun = (stage: Stage): void => {
  say(`– ${stage.command}, not run: a stage before it failed\n`)
}

/**
 * One batch of static stages, read in chain order. Past the first failure the rest are
 * waited for, so none outlives the check, and none is reported.
 */
const runStatics = async (
  batch: readonly StaticStage[],
  options: Options,
  tally: Tally,
): Promise<boolean> => {
  const running = batch.map((stage) => ({ stage, outcome: runStatic(stage) }))
  let going = true
  for (const { stage, outcome } of running) {
    // oxlint-disable-next-line no-await-in-loop -- read in chain order, all already started
    const ended = await outcome
    if (tally.failed.length > 0) notRun(stage)
    else going = reported(stage, ended, options, tally)
    if (!going) break
  }
  await Promise.all(running.map(({ outcome }) => outcome))
  return going
}

/** One batch, as the run so far has left it. Whether the run carries on past it. */
const runBatch = async (
  batch: readonly Stage[],
  proven: ReadonlySet<string>,
  options: Options,
  tally: Tally,
): Promise<boolean> => {
  const tests = batch.filter(isTest)
  const statics = batch.filter((stage): stage is StaticStage => !isTest(stage))
  for (const stage of tests) {
    // oxlint-disable-next-line no-await-in-loop -- a batch holds one test stage
    const outcome = await runStage(stage, proven, options.related)
    if (!reported(stage, outcome, options, tally)) return false
  }
  if (statics.length === 0) return true
  if (tally.failed.length === 0) return runStatics(statics, options, tally)
  for (const stage of statics) notRun(stage)
  return true
}

const runStages = async (stages: readonly Stage[], options: Options): Promise<number> => {
  const proven = provenFiles()
  const tally: Tally = { failed: [] }
  for (const batch of batchesOf(stages, options.parallel)) {
    // oxlint-disable-next-line no-await-in-loop -- batches run in order
    if (!(await runBatch(batch, proven, options, tally))) return 1
  }
  if (tally.failed.length === 0) return 0
  say(`\nFailed: ${tally.failed.map((command) => `\`${command}\``).join(", ")}\n`)
  return 1
}

const USAGE =
  "usage: check-stages [--parallel] [--keep-going] [--related [--select <file>]] <command>…, each `pnpm [--filter <pkg> | -r] <script> [words…]` or a command run as written; or check-stages --list-changed [--select <file>]"

const FLAGS = new Set(["--parallel", "--keep-going", "--related", "--list-changed"])

/** The arguments less every flag and `--select`'s file; undefined where one is malformed. */
const commandsOf = (args: readonly string[]): readonly string[] | undefined => {
  const at = args.indexOf("--select")
  const file = at === -1 ? undefined : args[at + 1]
  if (at !== -1 && (file === undefined || file.startsWith("--"))) return undefined
  const rest = args.filter(
    (arg, index) => !FLAGS.has(arg) && (at === -1 || (index !== at && index !== at + 1)),
  )
  return rest.some((arg) => arg.startsWith("--")) ? undefined : rest
}

/** `--list-changed`: what `--related` counts as changed, one a line, and nothing run. */
const listChanged = async (selection: Selection): Promise<number> => {
  const changes = await changesOf(selection)
  if (changes === undefined) {
    console.error("check-stages: git could not say what changed")
    return 1
  }
  say(changes.changed.map((file) => `${file}\n`).join(""))
  return 0
}

const main = async (args: readonly string[]): Promise<number> => {
  const commands = commandsOf(args)
  const listing = args.includes("--list-changed")
  const related = listing || args.includes("--related")
  const select = args.includes("--select") ? args[args.indexOf("--select") + 1] : undefined
  const malformed =
    commands === undefined ||
    (select !== undefined && !related) ||
    (listing ? commands.length > 0 : commands.length === 0)
  if (malformed) {
    console.error(USAGE)
    return 2
  }
  const selection = select === undefined ? NO_SELECTION : selectionOf(select)
  if (listing) return listChanged(selection)
  const stages = commands.flatMap((command) => resolveCommand(command, ROOT, 0))
  const options: Options = {
    parallel: args.includes("--parallel"),
    keepGoing: args.includes("--keep-going"),
    related:
      related && stages.some(isTest)
        ? { selection, changes: await changesOf(selection) }
        : undefined,
  }
  // What `vitest`'s own command line sets before it creates anything. A static stage runs
  // in the environment the check was started in.
  process.env["TEST"] = "true"
  process.env["VITEST"] = "true"
  process.env["NODE_ENV"] ??= "test"
  return runStages(stages, options)
}

/**
 * Run only where Node started this file, so a test can import the report without running
 * a stage: under vitest, `argv[1]` is vitest's own entry.
 */
if (/[\\/]check-stages\.(ts|js)$/.test(process.argv[1] ?? "")) {
  const code = await main(process.argv.slice(2)).catch((error: unknown) => {
    if (!(error instanceof Refused)) throw error
    console.error(`check-stages: ${error.message}`)
    return 2
  })
  // Left to drain, as vitest's own command line leaves, and out after a grace only where
  // something a suite left open holds the loop. Called straight after `close`, `process.exit`
  // sometimes landed while Vite's native transform threads were still winding down, and the
  // process then hung in its own exit, asleep, past the check's result.
  process.exitCode = code
  setTimeout(() => process.exit(code), DRAIN_MS).unref()
}
