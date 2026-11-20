// logic: one test file's recording, and its runner's, turned into the print the engine
// keeps — or the reason it keeps none.
//
// A print holds every path as the checkout names it, so the paths are rewritten on the way
// in by `within`, which the adapter supplies: this file builds no path.

import { allowedSpans, type Span } from "./allowance.js"
import { isBarrel } from "./barrel.js"
import { inlineMap } from "./source-map.js"
import {
  type Assumption,
  type Barrel,
  type Code,
  type Fact,
  type Input,
  LOCKFILES,
  type Print,
  type RunnerRecording,
  type UnitRecording,
} from "../types/recording.js"

/** What building a print reads beyond the recording itself. */
export interface PrintSources {
  /** A path as the checkout names it: relative inside it, absolute outside. */
  readonly within: (path: string) => string
  /** The text the hook kept under `scripts/` by its sha-256. */
  readonly generated: (sha: string) => string | undefined
  /** A file's text now, by the path the checkout names it. */
  readonly text: (path: string) => string | undefined
  readonly sha: (text: string) => string
}

export type Printed =
  | { readonly _tag: "Printed"; readonly print: Print; readonly texts: ReadonlyMap<string, string> }
  | { readonly _tag: "Unsure"; readonly reason: string }

/**
 * The files whose edits may be judged function by function: source in the checkout, not a
 * dependency's. JSX is left out because the lexer reads its text as code. `keepsText` in
 * `src/recording-hook.ts` restates this rule, to keep only the texts this reads.
 */
const BY_FUNCTION = /\.[cm]?[jt]s$/

export const eligible = (path: string): boolean =>
  !path.startsWith("/") && !path.includes("node_modules/") && BY_FUNCTION.test(path)

/** Every fact once by path and facet, or the path two facts disagree about. */
const merged = (facts: readonly Fact[]): Map<string, Fact> | string => {
  const byKey = new Map<string, Fact>()
  for (const fact of facts) {
    const key = `${fact.facet}\n${fact.path}`
    const held = byKey.get(key)
    if (held !== undefined && held.value !== fact.value) return fact.path
    byKey.set(key, fact)
  }
  return byKey
}

/** The spans every script of `path` leaves uncalled: a span called in any one is not. */
const spansFor = (
  scripts: readonly UnitRecording["scripts"][number][],
  original: string,
  sources: PrintSources,
): readonly Span[] => {
  let common: readonly Span[] | undefined
  for (const script of scripts) {
    const generated =
      script.generated === undefined ? undefined : sources.generated(script.generated)
    if (!script.fresh || generated === undefined || script.uncalled === undefined) return []
    const map = generated === original ? undefined : inlineMap(generated, original)
    // A compiled file with no map of its own cannot be followed back, and is kept whole.
    if (generated !== original && map === undefined) return []
    if (map?.sourceContent !== undefined && map.sourceContent !== original) return []
    const spans = allowedSpans(generated, script.uncalled, map)
    common =
      common === undefined
        ? spans
        : common.filter(([a, b]) => spans.some(([c, d]) => a === c && b === d))
  }
  return common ?? []
}

/**
 * The input a source file becomes: a barrel where it is one, by function where it can be,
 * whole otherwise. `loaded` is every source in the checkout the test ran.
 */
const codeOf = (
  fact: Fact,
  scripts: readonly UnitRecording["scripts"][number][],
  loaded: readonly string[],
  sources: PrintSources,
): { readonly input: Input; readonly text?: string } => {
  const exact: Input = { _tag: "Exact", ...fact }
  if (fact.facet !== "content" || scripts.length === 0 || !eligible(fact.path))
    return { input: exact }
  const original = sources.text(fact.path)
  // The file moved on after the test read it, so the recording is not of these bytes.
  if (original === undefined || sources.sha(original) !== fact.value) return { input: exact }
  if (isBarrel(original)) {
    const barrel: Barrel = { _tag: "Barrel", path: fact.path, sha: fact.value, loaded }
    return { input: barrel, text: original }
  }
  const allowed = spansFor(scripts, original, sources)
  if (allowed.length === 0) return { input: exact }
  const code: Code = { _tag: "Code", path: fact.path, sha: fact.value, allowed }
  return { input: code, text: original }
}

/**
 * Whether a `kind` fact says nothing a fact beside it does not: a recorded `content` is a
 * file, a directory or absent, and a listing other than `notdir` is a directory or absent.
 */
const impliedKind = (fact: Fact, facts: ReadonlyMap<string, Fact>): boolean => {
  if (fact.facet !== "kind") return false
  if (facts.has(`content\n${fact.path}`)) return true
  const listing = facts.get(`listing\n${fact.path}`)
  return listing !== undefined && listing.value !== "notdir"
}

/** Where pnpm keeps every package it installed, which its lockfile stands for. */
const PNPM_STORE = "/node_modules/.pnpm/"

/**
 * A store entry whose bytes the lockfile does not pin: a `file:` or `link:` dependency, whose
 * entry the lockfile names by path alone and which holds the project's own files, and the
 * links pnpm hoists under `.pnpm/node_modules/`, which may lead to a workspace's source.
 * `storeEntry` in `src/recording-hook.ts` restates this, to record one marker for an entry
 * this pins rather than every file under it.
 */
const UNPINNED = /^(?:node_modules$|.*@(?:file|link)\+)/

/**
 * The directory `fromLockfile` in `src/recording-hook.ts` walks up from: the one holding the
 * outermost `node_modules` of a path pnpm installed and its lockfile pins, by the path the
 * hook recorded. `undefined` for any other path, which stays an input of its own.
 */
const installRoot = (path: string): string | undefined => {
  const at = path.indexOf(PNPM_STORE)
  if (at === -1) return undefined
  const entry = path.slice(at + PNPM_STORE.length).split("/")[0] ?? ""
  return UNPINNED.test(entry) ? undefined : path.slice(0, path.indexOf("/node_modules"))
}

/**
 * The lockfile nearest `root` or above it, as `fromLockfile` finds it, as an input: its
 * recorded content where the test read it, and its content now where it did not.
 */
const lockfileFrom = (
  root: string,
  facts: ReadonlyMap<string, Fact>,
  sources: PrintSources,
): Fact | undefined => {
  for (let dir = root; ; dir = dir.slice(0, dir.lastIndexOf("/"))) {
    for (const name of LOCKFILES) {
      const path = sources.within(`${dir}/${name}`)
      const held = facts.get(`content\n${path}`)
      if (held !== undefined && held.value !== "absent") return held
      const text = sources.text(path)
      if (text !== undefined) return { path, facet: "content", value: sources.sha(text) }
    }
    if (dir === "") return undefined
  }
}

/**
 * Every recorded path pnpm installed, by the path the print names, standing as the lockfile
 * its install root leads to: the `lockfile` assumption, which a hand edit inside
 * `node_modules` gets past. A path no lockfile is found for stays an input of its own.
 */
const lockfilesOf = (
  raw: readonly Fact[],
  facts: ReadonlyMap<string, Fact>,
  sources: PrintSources,
): Map<string, Fact> => {
  const byRoot = new Map<string, Fact | undefined>()
  const standing = new Map<string, Fact>()
  for (const fact of raw) {
    const root = installRoot(fact.path)
    if (root === undefined) continue
    if (!byRoot.has(root)) byRoot.set(root, lockfileFrom(root, facts, sources))
    const lockfile = byRoot.get(root)
    if (lockfile !== undefined) standing.set(sources.within(fact.path), lockfile)
  }
  return standing
}

/**
 * The print of `unit`, or why there is none. `texts` is every recorded source text a
 * `Code` or `Barrel` input names by sha, which the store keeps to diff a later checkout against.
 */
export const printOf = (
  unit: string,
  recording: UnitRecording,
  runner: RunnerRecording | undefined,
  sources: PrintSources,
): Printed => {
  if (recording.unsure !== undefined) return { _tag: "Unsure", reason: recording.unsure }
  if (runner === undefined)
    return { _tag: "Unsure", reason: "the runner that ran it left no recording" }
  if (runner.unsure !== undefined) return { _tag: "Unsure", reason: runner.unsure }
  const raw = [...recording.facts, ...runner.facts]
  const facts = merged(
    raw.map((f): Fact => ({ path: sources.within(f.path), facet: f.facet, value: f.value })),
  )
  if (typeof facts === "string")
    return { _tag: "Unsure", reason: `${facts} changed while the test ran` }
  const runnerPaths = new Set(runner.facts.map((f) => sources.within(f.path)))
  const scriptsOf = new Map<string, UnitRecording["scripts"][number][]>()
  for (const script of recording.scripts) {
    const path = sources.within(script.path)
    scriptsOf.set(path, [...(scriptsOf.get(path) ?? []), script])
  }
  // A script is an input only through its file's fact, so one without is an input lost.
  for (const path of scriptsOf.keys())
    if (!facts.has(`content\n${path}`))
      return { _tag: "Unsure", reason: `${path} ran and was never hashed` }
  const loaded = [...scriptsOf.keys()]
    .filter((path) => !path.startsWith("/") && !path.includes("node_modules/"))
    .toSorted()
  const lockfiles = lockfilesOf(raw, facts, sources)
  const inputs: Input[] = []
  const texts = new Map<string, string>()
  const added = new Set<string>()
  for (const fact of facts.values()) {
    const lockfile = lockfiles.get(fact.path) ?? fact
    const key = `${lockfile.facet}\n${lockfile.path}`
    if (impliedKind(fact, facts) || added.has(key)) continue
    added.add(key)
    // A file the runner depends on is matched whole: what its own code called is not in
    // the test's coverage, so a body the test never called may be one the runner did.
    const scripts = runnerPaths.has(fact.path) ? [] : (scriptsOf.get(fact.path) ?? [])
    const { input, text } = codeOf(lockfile, lockfile === fact ? scripts : [], loaded, sources)
    inputs.push(input)
    if (text !== undefined && input._tag !== "Exact") texts.set(input.sha, text)
  }
  const leaned: readonly Assumption[] = lockfiles.size === 0 ? [] : ["lockfile"]
  const assumes = [...new Set([...(recording.assumes ?? []), ...leaned])].toSorted()
  const print: Print = assumes.length === 0 ? { unit, inputs } : { unit, inputs, assumes }
  return { _tag: "Printed", print, texts }
}
