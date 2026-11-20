// The first boot of an engine over a `.database/` that still holds file logs: every log its
// store lacks — the SQLite file beside them, or the store a host's entry point opens instead —
// is moved in, read back and replayed, and the files are set aside — before anything is
// built over the store, so nothing reads a project half-moved. Each trak's `run.json` stays
// where it is, so a turn still running is reattached as after any restart. With no file logs
// it does nothing, opens nothing and spawns nothing.
//
// **A log the store holds differently, or one that will not decode, does not stop the
// boot.** Nothing of it is written, the store's copy is the one served, and its directory is
// set aside under `refused/` beside the moved ones, where a person can read it. A log that
// went in and did not read back the same does stop it: the files stay where they are, and the
// next boot plans again, writing nothing a log already holds.
//
// **Setting the files aside finishes on the next boot when this one stops partway** — killed,
// or a rename that failed. Every log is in the store and read back by then, so the boot
// after finishes the moves into the same `imported-<time>/` before it plans anything, and a
// project never ends with its files split across two.
//
// Retired once every machine has booted on the store: the deferred entry *the first boot migration of file logs goes once every machine has booted*.

import { dirname, join } from "node:path"
import { Effect, type Scope } from "effect"
import { MIGRATING } from "./discovery.js"
import {
  type AsidePlan,
  asideAt,
  databaseOf,
  finishAside,
  heldUnder,
  type LeftOut,
  moveLogsLeavingOut,
  movedLines,
  type OpenStoreSide,
  type Progress,
  setAside,
  storeSides,
  unfinishedAside,
} from "./store-move.js"

/**
 * The longest a phase goes without a progress line while it makes progress — well inside the
 * supervisor's stall limit, which a boot that prints nothing for that long fails.
 */
const PROGRESS_MS = 5000

/** `say` paced: a line as each phase starts and ends, and between, one each `PROGRESS_MS`. */
const paced = (say: (line: string) => void): Progress => {
  let phase: string | undefined
  let at = 0
  return (now, done, total) => {
    const time = Date.now()
    if (now === phase && done < total && time - at < PROGRESS_MS) return
    phase = now
    at = time
    say(`store: ${now}, ${String(done)} of ${String(total)}`)
  }
}

const dirOf = (of: LeftOut["of"]): string => (of === "trak" ? "traks" : "goals")

/** Each of `held` moved to the same place under the aside directory, or under `refused/` for a log left out. */
const asidePlan = (now: number, held: readonly string[], left: readonly LeftOut[]): AsidePlan => {
  const refused = new Set(left.map(({ of, key }) => join(dirOf(of), key)))
  return {
    aside: asideAt(now),
    moves: held.map((from) => ({
      from,
      to: refused.has(dirname(from)) ? join("refused", from) : from,
    })),
  }
}

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

/**
 * The set-aside a boot was stopped partway through, finished into the directory it began,
 * before anything else: the logs it moves were already in the store and read back, and a
 * plan over a log half aside would read it as a different log.
 */
const finishUnfinished = (database: string, plan: AsidePlan | undefined, progress: Progress) =>
  Effect.gen(function* () {
    if (plan === undefined) return []
    yield* Effect.tryPromise({ try: () => finishAside(database, plan, progress), catch: asError })
    return [
      `store: the files are set aside in ${join(database, plan.aside)}, finishing a boot that stopped partway`,
    ]
  })

/**
 * The project at `root`'s file logs moved into its store at boot — the one `open` opens, or
 * the SQLite file where there is none — and the lines the boot prints about it, none where
 * there was nothing to move. `say` is handed `MIGRATING` before
 * the store is opened, and progress lines while the move runs, as they happen; nothing where
 * there is nothing to move. Fails, naming every log that did not read back, where the boot
 * must not go on.
 */
export const migrateAtBoot = (
  root: string,
  open: OpenStoreSide | undefined,
  now: number,
  say: (line: string) => void,
): Effect.Effect<readonly string[], Error, Scope.Scope> =>
  Effect.gen(function* () {
    const database = yield* databaseOf(root)
    const unfinished = yield* unfinishedAside(database)
    if (unfinished === undefined && heldUnder(database).length === 0) return []
    say(MIGRATING)
    const progress = paced(say)
    const finished = yield* finishUnfinished(database, unfinished, progress)
    const held = heldUnder(database)
    if (held.length === 0) return finished
    const sides = yield* storeSides(root, open)
    const { moved, left } = yield* moveLogsLeavingOut(sides.files, sides.store, progress).pipe(
      Effect.mapError((e) => new Error(e.reason)),
    )
    const report = [...finished, ...movedLines("migration", moved).map((line) => `store: ${line}`)]
    if (moved.failed.length > 0)
      return yield* Effect.fail(
        new Error(
          [
            ...report,
            `store: the files stay in ${database}, and the engine does not boot; the next boot tries again`,
          ].join("\n"),
        ),
      )
    const plan = asidePlan(now, held, left)
    yield* Effect.tryPromise({ try: () => setAside(database, plan, progress), catch: asError })
    const aside = join(database, plan.aside)
    return [
      ...report,
      `store: the files are set aside in ${aside}`,
      ...(left.length === 0
        ? []
        : [
            `store: ${String(left.length)} not moved, and the store's copy is served — set aside in ${join(aside, "refused")}:`,
            ...left.flatMap((l) => l.reasons.map((r) => `  ${r}`)),
          ]),
    ]
  })
