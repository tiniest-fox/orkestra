// `ork proofs publish`, `ork proofs read --check <name>` and `ork proofs run --check <name>`:
// a checkout's unit proofs and prints, carried to another machine through `origin`, and a
// check run there on them.
//
// None touches a trak, so none needs an engine — which is what lets CI, where none runs,
// read what the host proved. Publishing reads the project's Passes and writes only git
// refs; reading writes nothing of the project's at all; running keeps prints in the
// checkout's own passes store, which on CI is the only one there is.
//
// The published text is one line per unit, `<label>\t<platform part>\t<unit>`, under
// `refs/passes/<HEAD^{tree}>`, with the project's prints beside it under `prints/`. The
// commit's tree names it rather than the working tree's hash, so a merge commit CI builds
// finds the units with no Orkestra code: when the base has not moved, the merge of a pull
// request holds the tree its head does. The prints hold for any tree, so CI finds them by
// the head's tree whatever the base did.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Data, Effect, Layer, Logger, LogLevel } from "effect"
import { NodeProcessLayer } from "../agent/adapters/process-node.js"
import type { Check } from "../library/types/check.js"
import { Lib } from "../library/ports/library.js"
import { loadLibrary } from "../library/adapters/library-fs.js"
import { platformPart } from "../library/logic/platform-part.js"
import { GitCliLayer } from "../vcs/adapters/git-cli.js"
import { type ProofPrint, Vcs } from "../vcs/ports/vcs.js"
import { ShellChecksLayer } from "../workflow/adapters/checks-shell.js"
import { ShellEnvironmentLayer } from "../workflow/adapters/environment-shell.js"
import { PubSubFeedLayer } from "../workflow/adapters/feed-pubsub.js"
import { FilePassesLayer, type Machine, THIS_MACHINE } from "../workflow/adapters/passes-file.js"
import { Checks } from "../workflow/ports/checks.js"
import { Passes } from "../workflow/ports/passes.js"
import { CHECK_STAGES, RECORDING, SHIPPED_AGENTS } from "./packaged.js"

/** Why a proofs command did nothing, in a sentence for the person who ran it. */
export class ProofsRefused extends Data.TaggedError("ProofsRefused")<{
  readonly reason: string
}> {}

const refused = (reason: string) => new ProofsRefused({ reason })

/** What a command prints: `out` to stdout, `note` to stderr. `failed` is a check that ran and failed. */
export interface ProofsAnswer {
  readonly out: readonly string[]
  readonly note?: string
  readonly failed?: true
}

const partHere = (check: Check): string => platformPart(check, process.platform, process.arch)

/**
 * The directory whose `.orkestra/.database/` holds the project's Passes: the nearest one
 * at or above `start` that has one. A trak's checkout sits inside the project's
 * `.orkestra/.worktrees/` and carries an `.orkestra/` of its own with no database, so the
 * ordinary walk-up would stop at the checkout and find nothing proven.
 */
const projectHolding = (start: string): string => {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".orkestra", ".database"))) return dir
    if (dirname(dir) === dir) return start
  }
}

const publish = (dir: string) =>
  Effect.gen(function* () {
    const vcs = yield* Vcs
    const passes = yield* Passes
    const dirty = yield* vcs.dirty()
    // The ref is named by the commit's tree and the proofs were made on the working tree:
    // with anything uncommitted, the two are different files.
    if (dirty.length > 0)
      return yield* refused(
        `commit first — the proofs are published for the commit, and these are not in it:\n${dirty.join("\n")}`,
      )
    const lib = yield* loadLibrary(dir, SHIPPED_AGENTS)
    const lines = new Set<string>()
    const prints = new Map<string, ProofPrint>()
    for (const check of lib.checks.values()) {
      if (check.units === undefined || !check.cache) continue
      const tree = yield* vcs.workingTree(undefined, check.ignoresLinguistGenerated)
      const key = yield* passes.unitKeyOf(check, tree)
      if (key === undefined) continue
      for (const unit of yield* passes.proven(key))
        lines.add(`${check.units}\t${partHere(check)}\t${unit}`)
      const printKey = yield* passes.printKeyOf(check)
      if (printKey !== undefined)
        for (const file of yield* passes.packed(printKey)) prints.set(file.name, file)
    }
    const head = yield* vcs.headTree()
    if (lines.size === 0 && prints.size === 0)
      return { out: [], note: `nothing proven or printed on ${head}; published nothing.` }
    yield* vcs.publishProofs(head, [...lines].map((l) => `${l}\n`).join(""), [...prints.values()])
    const printCount = [...prints.keys()].filter((n) => n.endsWith(".json")).length
    return {
      out: [],
      note: `published ${String(lines.size)} unit(s) and ${String(printCount)} print(s) for ${head}.`,
    }
  })

/** The units `text` holds for `check`'s label on this machine's platform part. */
const provenIn = (text: string | undefined, check: Check): readonly string[] => {
  const part = partHere(check)
  return (text ?? "").split("\n").flatMap((line) => {
    const [label, linePart, ...unit] = line.split("\t")
    return label === check.units && linePart === part && unit.length > 0 ? [unit.join("\t")] : []
  })
}

const read = (dir: string, name: string) =>
  Effect.gen(function* () {
    const vcs = yield* Vcs
    const lib = yield* loadLibrary(dir, SHIPPED_AGENTS)
    const check = lib.checks.get(name)
    if (check === undefined) return yield* refused(`no check named \`${name}\`.`)
    if (check.units === undefined)
      return yield* refused(`\`${name}\` declares no \`units:\`, so nothing is proven for it.`)
    return { out: provenIn(yield* vcs.readProofs(yield* vcs.headTree()), check) }
  })

/** Where `run` was told to write its skip list, and whose tree to take the host's prints from. */
interface RunAsked {
  readonly name: string
  readonly skipped: string
  readonly printsFrom: string | undefined
}

/**
 * Write the skip list of a run: `units`, every unit it skipped, a line each, and under
 * `prints/` the print each one skipped on a print was skipped on.
 */
const writeSkipped = (at: string, units: readonly string[], prints: readonly ProofPrint[]) => {
  mkdirSync(join(at, "prints"), { recursive: true })
  writeFileSync(join(at, "units"), units.map((u) => `${u}\n`).join(""))
  for (const file of prints) {
    const to = join(at, "prints", file.name)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(file.path, to)
  }
}

/**
 * One check with `fingerprint:` run as the engine runs it, on another machine: the units
 * proven on this exact tree are skipped, and so is every unit whose print — this store's,
 * or one the host published beside the units of `printsFrom` — leans on nothing this
 * machine does not trust and still holds. Under CI that is the floor alone. The prints the run makes are kept in this store.
 */
const run = (dir: string, asked: RunAsked) =>
  Effect.gen(function* () {
    const vcs = yield* Vcs
    const passes = yield* Passes
    const lib = yield* loadLibrary(dir, SHIPPED_AGENTS)
    const check = lib.checks.get(asked.name)
    if (check === undefined) return yield* refused(`no check named \`${asked.name}\`.`)
    const printKey = yield* passes.printKeyOf(check)
    if (printKey === undefined || check.fingerprint === undefined)
      return yield* refused(
        `\`${asked.name}\` keeps no prints: it needs \`units:\`, \`fingerprint:\` and a cache.`,
      )
    const head = yield* vcs.headTree()
    const from = asked.printsFrom ?? head
    const hostDir = mkdtempSync(join(tmpdir(), "orkestra-host-prints-"))
    const byTree = new Set(
      provenIn(yield* vcs.readProofs(head, from === head ? hostDir : undefined), check),
    )
    if (from !== head) yield* vcs.readProofs(from, hostDir)
    const host = new Set(yield* passes.adopt(printKey, hostDir))
    rmSync(hostDir, { recursive: true, force: true })
    const printed = (yield* passes.printed(printKey, dir)).filter((u) => !byTree.has(u))
    const skipped = [...byTree, ...printed].sort()
    writeSkipped(asked.skipped, skipped, yield* passes.packed(printKey, printed))
    const outcome = yield* (yield* Checks).run(check, dir, undefined, [], {
      proven: skipped,
      sealed: check.fingerprint,
      // A print that could not be kept costs the next run that unit, and nothing else.
      finished: (units, recording) =>
        recording === undefined
          ? Effect.void
          : passes.print(printKey, dir, recording, units).pipe(Effect.ignore),
    })
    const fromHost = printed.filter((u) => host.has(u)).length
    return {
      out: outcome.output.split("\n"),
      note: `Skipped ${String(skipped.length)} test file(s): ${String(byTree.size)} proven on this tree, ${String(fromHost)} on the host's prints, ${String(printed.length - fromHost)} on CI's own.`,
      ...(outcome.passed ? {} : { failed: true as const }),
    }
  })

/** What `run` needs beyond the passes store and git: the check runner, as the engine builds it. */
const checksLayer = (dir: string) =>
  Effect.gen(function* () {
    const lib = Layer.succeed(Lib, yield* loadLibrary(dir, SHIPPED_AGENTS))
    const environment = ShellEnvironmentLayer().pipe(
      Layer.provide(Layer.merge(NodeProcessLayer, lib)),
    )
    return ShellChecksLayer(RECORDING, CHECK_STAGES).pipe(
      Layer.provide(Layer.mergeAll(NodeProcessLayer, PubSubFeedLayer, environment)),
    )
  })

/** `--check <name> --skipped <dir>`, then `--prints-from <tree>` if given, in that order. */
const runAsked = (args: readonly string[]): RunAsked | undefined => {
  const [check, name, skippedFlag, skipped, fromFlag, from, ...rest] = args
  if (check !== "--check" || name === undefined || skippedFlag !== "--skipped") return undefined
  if (skipped === undefined || rest.length > 0) return undefined
  if (fromFlag === undefined) return { name, skipped, printsFrom: undefined }
  return fromFlag === "--prints-from" && from !== undefined
    ? { name, skipped, printsFrom: from }
    : undefined
}

const USAGE =
  "usage: ork proofs publish | ork proofs read --check <name> | ork proofs run --check <name> --skipped <dir> [--prints-from <tree>]"

/**
 * One proofs command against the checkout at `dir`. Every failure is a `ProofsRefused`,
 * because the person running it needs the reason and nothing downstream branches on it.
 * `machine` is this one outside a test, whose process cannot change what it trusts.
 */
export const proofsCommand = (
  dir: string,
  args: readonly string[],
  machine: Machine = THIS_MACHINE,
): Effect.Effect<ProofsAnswer, ProofsRefused> => {
  const [verb, flag, name] = args
  const asked = verb === "run" ? runAsked(args.slice(1)) : undefined
  const command =
    verb === "publish" && args.length === 1
      ? publish(dir)
      : verb === "read" && flag === "--check" && name !== undefined && args.length === 3
        ? read(dir, name)
        : asked !== undefined
          ? Effect.flatMap(checksLayer(dir), (checks) => Effect.provide(run(dir, asked), checks))
          : Effect.fail(refused(USAGE))
  return command.pipe(
    // The library logs how its roles are layered, and `read`'s stdout is a list CI reads.
    Logger.withMinimumLogLevel(LogLevel.None),
    Effect.provide(
      Layer.mergeAll(
        GitCliLayer(dir).pipe(Layer.provide(NodeProcessLayer)),
        FilePassesLayer(projectHolding(dir), machine),
      ),
    ),
    Effect.catchTags({
      GitFailed: (e) => Effect.fail(refused(`git could not ${e.op}: ${e.reason}`)),
      LoadFailed: (e) => Effect.fail(refused(`${e.path}: ${e.reason}`)),
      StoreFailed: (e) => Effect.fail(refused(`the passes store: ${e.reason}`)),
    }),
  )
}
