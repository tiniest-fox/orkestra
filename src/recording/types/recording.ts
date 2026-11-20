// types: what the recording hook writes while a test runner runs, and what the engine
// keeps of it — a print of each test file it recorded surely.
//
// The hook writes JSON into the directory `ORKESTRA_RECORDING_DIR` names. It runs inside
// the project's runner, under whatever Node the project uses, and imports nothing of
// Orkestra's at runtime: these Schemas are what the engine decodes its files with, and the
// hook's own interfaces are written against the same names. A field one side adds and the
// other does not know is a file that fails to decode, which the engine reads as unsure.

import { Schema } from "effect"

/**
 * One fact about one path, as the hook saw it once the test file had finished.
 *
 * - `content` — the sha-256 of the file's bytes, `absent`, or `dir`
 * - `listing` — the sha-256 of a directory's sorted entry names, `absent` or `notdir`
 * - `kind` — `file`, `dir`, `other` or `absent`, for a `stat` or an existence check
 *
 * The engine computes the same value for the same path in a later checkout; the two
 * agreeing is what an input being unchanged means.
 */
export const FACETS = ["content", "listing", "kind"] as const
export type Facet = (typeof FACETS)[number]

export const Fact = Schema.Struct({
  path: Schema.String,
  facet: Schema.Literal(...FACETS),
  value: Schema.String,
})
export type Fact = typeof Fact.Type

/**
 * A script V8 ran in the test file's process.
 *
 * `fresh` is a script parsed after the test file was claimed, so every call to its
 * functions happened on this test file's behalf. A script that was already loaded keeps
 * whatever its earlier calls left behind, so only its whole text can stand for it.
 *
 * `generated` is the sha-256 of the text V8 compiled, kept under `scripts/` beside the
 * manifest, and `uncalled` the `[start, end)` offsets in that text of every function V8
 * counted no call to. Both are only on a fresh script.
 */
export const Script = Schema.Struct({
  path: Schema.String,
  fresh: Schema.Boolean,
  generated: Schema.optional(Schema.String),
  uncalled: Schema.optional(Schema.Array(Schema.Tuple(Schema.Number, Schema.Number))),
})
export type Script = typeof Script.Type

/**
 * The doubts a trusting machine accepts, each a promise about the machine that no
 * recording can check. A recording that leaned on one names it, and its print counts only
 * on a machine that accepts every name the print carries — see `trustsOn`.
 *
 * - `gitconfig` — a `git config --global` read answers what it answered before: the
 *   global file, or under a runner that pins `GIT_CONFIG_GLOBAL`, nothing
 * - `lockfile` — what a package manager installed is its lockfile: a native addon's own
 *   reads, a dependency's directory linked or copied whole, and in a print every file
 *   under `node_modules/.pnpm/`, are the lockfile's bytes — except in the print a `file:`
 *   or `link:` dependency's entry and `.pnpm/node_modules/`, whose bytes it does not pin
 * - `ps` — `ps` reports processes, never files, so its binary is all of it that can change
 * - `tmpdir` — a write anywhere under `os.tmpdir()` belongs to the test, not only one
 *   inside a directory it made
 *
 * The floor every machine accepts is never named: that the clock, the environment and
 * randomness do not matter, that Node is its binary, and that the kernel and libc stay
 * the same.
 */
export const ASSUMPTIONS = ["gitconfig", "lockfile", "ps", "tmpdir"] as const
export type Assumption = (typeof ASSUMPTIONS)[number]

/**
 * The rules the hook records by, as a number in every print key. **Raise it whenever the
 * hook starts doubting or assuming something it used to let pass**: a print made under
 * the looser rules carries nothing that says so, and without a new key a doubting check
 * would still skip on it. A print under an old number is never read again.
 */
export const RECORDING_FORMAT = 6

/**
 * The files a package manager reads its whole install from, in the order it prefers.
 * `LOCKFILES` in `src/recording-hook.ts` restates this list, since the hook imports nothing
 * of Orkestra's at runtime.
 */
export const LOCKFILES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const

/**
 * One test file's recording. `runner` is the pid of the runner process that ran it, whose
 * own recording covers the configuration every test file shares. `unsure` is the first
 * thing the hook could not account for, and a unit with one is never skipped. `assumes`
 * is every assumption it leaned on instead. `addons` is every native addon its process
 * loaded, whose own reads no hook sees; each is also a `content` fact.
 */
export const UnitRecording = Schema.Struct({
  kind: Schema.Literal("unit"),
  test: Schema.String,
  runner: Schema.Number,
  unsure: Schema.optional(Schema.String),
  assumes: Schema.optional(Schema.Array(Schema.Literal(...ASSUMPTIONS))),
  addons: Schema.optional(Schema.Array(Schema.String)),
  scripts: Schema.Array(Script),
  facts: Schema.Array(Fact),
})
export type UnitRecording = typeof UnitRecording.Type

/** What the runner process itself loaded and read: its configuration, plugins and code. */
export const RunnerRecording = Schema.Struct({
  kind: Schema.Literal("runner"),
  pid: Schema.Number,
  unsure: Schema.optional(Schema.String),
  facts: Schema.Array(Fact),
})
export type RunnerRecording = typeof RunnerRecording.Type

export const Recording = Schema.Union(UnitRecording, RunnerRecording)

/**
 * A source file whose text may differ from the recorded one and still match: every edit
 * has to fall inside one of `allowed`, the `[start, end)` offsets in the recorded text of
 * the body of a function that was never called. The recorded text is kept by `sha`.
 */
export const Code = Schema.TaggedStruct("Code", {
  path: Schema.String,
  sha: Schema.String,
  allowed: Schema.Array(Schema.Tuple(Schema.Number, Schema.Number)),
})
export type Code = typeof Code.Type

/**
 * A barrel — top level only `export { … } from` and `export type { … } from` — whose text
 * may grow names and still match: see `barrelGrows`. `loaded` is every source in the
 * checkout the test ran, which a new block's source may be one of. The recorded text is
 * kept by `sha`.
 */
export const Barrel = Schema.TaggedStruct("Barrel", {
  path: Schema.String,
  sha: Schema.String,
  loaded: Schema.Array(Schema.String),
})
export type Barrel = typeof Barrel.Type

export const Exact = Schema.TaggedStruct("Exact", Fact.fields)
export type Exact = typeof Exact.Type

export const Input = Schema.Union(Exact, Code, Barrel)
export type Input = typeof Input.Type

/**
 * What a test file's last pass depended on. A path inside the checkout is relative to
 * it, so a print made in one trak's worktree is checked against another's files.
 * `assumes` is what its recording leaned on, which a check has to accept to skip on it.
 */
export const Print = Schema.Struct({
  unit: Schema.String,
  inputs: Schema.Array(Input),
  assumes: Schema.optional(Schema.Array(Schema.Literal(...ASSUMPTIONS))),
})
export type Print = typeof Print.Type
