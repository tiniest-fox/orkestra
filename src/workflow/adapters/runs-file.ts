// File-backed Runs: `run.json` beside a trak's `log.jsonl`, one process's
// custody plus whatever turn was in flight when it wrote last.
//
// The only place anything gets killed. `claim` only ever checks the HOLDER's
// liveness — the CLI session driving the trak — never the agent's: an agent
// that is still alive under a dead holder is exactly the stray `reap` exists
// to find, and identity there is not optional. The hazard is the operating
// system reissuing a process number, so a live pid is verified by when it
// started: `spawned` reads the child's start time back from `Process` the
// moment the pid is recorded, and `reap` kills only where the live process
// reports the same one. Nothing about that is per-CLI — a `codex app-server`
// carries no session id anywhere, which is why the argument line is not what
// is matched. A pid that is alive but unverifiable — a different start, or
// one that could not be read on either side — is left alone and reported as
// declined: a wrong kill is worse than a leaked process billing a few more
// minutes. The holder is verified by its start too — see `holderAlive` — because a
// shutdown leaving a detached turn leaves its holder on the record, and the next
// process to get that pid is often the next engine; there an unreadable start is dead.
//
// Same directory layout as `store-file.ts` by convention, not by dependency:
// this file resolves its own root via `orkestraDir` and lists traks by
// reading the filesystem itself, so a `Runs` implementation never has to
// know anything about `Store`'s internals.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer, Option, Schema } from "effect"
import { Process, type ProcessShape } from "../../agent/ports/process.js"
import { orkestraDir } from "../../library/adapters/library-fs.js"
import { TrakId } from "../domain/trak.js"
import { Leaving, type LeavingShape } from "../ports/leaving.js"
import {
  type Holder,
  type InFlightTurn,
  Reaped,
  RunRecord,
  Runs,
  type RunsShape,
} from "../ports/runs.js"
import { StoreFailed } from "../ports/store-errors.js"

const BASE = ".database"

const why = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const isErrnoException = (e: unknown): e is NodeJS.ErrnoException =>
  e instanceof Error && "code" in e

const traksDir = (root: string): string => join(root, BASE, "traks")
const trakDir = (root: string, id: TrakId): string => join(traksDir(root), id)
const runPath = (root: string, id: TrakId): string => join(trakDir(root, id), "run.json")

const emptyRecord: RunRecord = {}

type TurnField = NonNullable<RunRecord["turn"]>

/** Only the keys that are present, never a key set to `undefined`. */
const buildTurn = (t: InFlightTurn): TurnField => {
  const base =
    t.minted === undefined
      ? { sessionId: t.sessionId }
      : { sessionId: t.sessionId, minted: t.minted }
  const withStep = t.step === undefined ? base : { ...base, step: t.step }
  const withPid = t.agentPid === undefined ? withStep : { ...withStep, agentPid: t.agentPid }
  const withStart = t.agentStart === undefined ? withPid : { ...withPid, agentStart: t.agentStart }
  const withUsage = t.usage === undefined ? withStart : { ...withStart, usage: t.usage }
  const withEstimate = t.estimate === undefined ? withUsage : { ...withUsage, estimate: t.estimate }
  if (t.rejoin !== undefined) return { ...withEstimate, execId: t.rejoin, detached: true as const }
  return t.execId === undefined ? withEstimate : { ...withEstimate, execId: t.execId }
}

const asInFlight = (t: TurnField | undefined): InFlightTurn | undefined =>
  t === undefined
    ? undefined
    : {
        step: t.step,
        sessionId: t.sessionId,
        ...(t.minted === undefined ? {} : { minted: t.minted }),
        agentPid: t.agentPid,
        agentStart: t.agentStart,
        usage: t.usage,
        estimate: t.estimate,
        ...(t.execId === undefined ? {} : { execId: t.execId }),
        ...(t.detached === true && t.execId !== undefined ? { rejoin: t.execId } : {}),
      }

const buildRecord = (holder: RunRecord["holder"], turn: RunRecord["turn"]): RunRecord => {
  const base: RunRecord = holder === undefined ? {} : { holder }
  return turn === undefined ? base : { ...base, turn }
}

const withHolder = (r: RunRecord, holder: RunRecord["holder"]): RunRecord =>
  buildRecord(holder, r.turn)
const withTurn = (r: RunRecord, turn: RunRecord["turn"]): RunRecord => buildRecord(r.holder, turn)

const listTrakIds = (root: string): Effect.Effect<readonly TrakId[], StoreFailed> =>
  Effect.tryPromise({ try: () => readdir(traksDir(root)), catch: (cause) => cause }).pipe(
    Effect.map((names) => names.map((name) => TrakId.make(name))),
    Effect.catchAll((cause) =>
      isErrnoException(cause) && cause.code === "ENOENT"
        ? Effect.succeed<readonly TrakId[]>([])
        : Effect.fail(
            new StoreFailed({ reason: `could not list ${traksDir(root)}: ${why(cause)}` }),
          ),
    ),
  )

/** No `run.json` yet is the common case — every trak starts with none. */
const readRecord = (root: string, id: TrakId): Effect.Effect<RunRecord, StoreFailed> =>
  Effect.tryPromise({
    try: () => readFile(runPath(root, id), "utf8"),
    catch: (cause) => cause,
  }).pipe(
    Effect.catchAll((cause) =>
      isErrnoException(cause) && cause.code === "ENOENT"
        ? Effect.succeed<string | undefined>(undefined)
        : Effect.fail(
            new StoreFailed({ reason: `trak ${id}: could not read run.json: ${why(cause)}` }),
          ),
    ),
    Effect.flatMap((text) => {
      if (text === undefined) return Effect.succeed(emptyRecord)
      return Effect.try({
        try: (): unknown => JSON.parse(text),
        catch: (cause) => new StoreFailed({ reason: `trak ${id}: bad run.json: ${why(cause)}` }),
      }).pipe(
        Effect.flatMap((parsed) =>
          Schema.decodeUnknown(RunRecord)(parsed).pipe(
            Effect.mapError(
              (e) => new StoreFailed({ reason: `trak ${id}: bad run.json: ${e.message}` }),
            ),
          ),
        ),
      )
    }),
  )

/**
 * Written to a temp file and renamed over the target, so a reader never sees
 * a half-written `run.json` — the one atomicity guarantee this format needs. The temp
 * file is this write's own: two engine copies on one checkout share the directory, and
 * a fixed name lets one copy's rename take the other's file away mid-write.
 */
const writeRecord = (root: string, id: TrakId, rec: RunRecord): Effect.Effect<void, StoreFailed> =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => {
        // Same trick as `store-file.ts`'s `ensureTrakDir`: a `*` gitignore beside
        // the runtime data, written once, so a `run.json` from a repo whose root
        // `.gitignore` does not already cover `.database/` never shows up as
        // untracked noise.
        mkdirSync(traksDir(root), { recursive: true })
        const ignore = join(root, BASE, ".gitignore")
        if (!existsSync(ignore)) writeFileSync(ignore, "*\n")
        mkdirSync(trakDir(root, id), { recursive: true })
      },
      catch: (cause) =>
        new StoreFailed({ reason: `could not prepare ${trakDir(root, id)}: ${why(cause)}` }),
    })
    const encoded = yield* Schema.encode(RunRecord)(rec).pipe(
      Effect.mapError(
        (e) => new StoreFailed({ reason: `trak ${id}: could not encode run.json: ${e.message}` }),
      ),
    )
    const path = runPath(root, id)
    yield* Effect.tryPromise({
      try: async () => {
        const tmp = `${path}.${String(process.pid)}.${randomUUID()}.tmp`
        try {
          await writeFile(tmp, JSON.stringify(encoded))
          await rename(tmp, path)
        } finally {
          await rm(tmp, { force: true })
        }
      },
      catch: (cause) =>
        new StoreFailed({ reason: `trak ${id}: could not write run.json: ${why(cause)}` }),
    })
  })

const update = (
  root: string,
  id: TrakId,
  f: (rec: RunRecord) => RunRecord,
): Effect.Effect<void, StoreFailed> =>
  Effect.flatMap(readRecord(root, id), (rec) => writeRecord(root, id, f(rec)))

/**
 * Whether this process may write a trak's record now: under an external store, whether it
 * holds the trak's lease at the fence its drive took. Two engine copies on one checkout
 * share this file, and the record is the lease holder's — a copy unwinding a drive whose
 * lease another copy took would otherwise clear the holder and the turn of the copy that
 * took it, and that copy's orphan would never be reaped.
 */
export type Owns = (id: TrakId) => Effect.Effect<boolean>

/** `update`, writing nothing where `owns` says the record is not this process's. */
const updateOwn = (
  owns: Owns | undefined,
  root: string,
  id: TrakId,
  f: (rec: RunRecord) => RunRecord,
): Effect.Effect<void, StoreFailed> =>
  owns === undefined
    ? update(root, id, f)
    : Effect.flatMap(owns(id), (mine) => (mine ? update(root, id, f) : Effect.void))

/**
 * Whether a release should leave the record standing: the engine is shutting down around a
 * turn whose command runs on detached, which the next boot rejoins from this record.
 */
const keptFor = (leaving: LeavingShape | undefined, r: RunRecord): Effect.Effect<boolean> =>
  r.turn?.detached === true && leaving !== undefined ? leaving.now : Effect.succeed(false)

/**
 * Whether a turn's release should leave its record standing: `keptFor`, or the turn's
 * command is one the engine left running for the trak's Resume to rejoin — see
 * `Leaving.keep` — or for a stop's kill to end.
 *
 * **An exec the record names before its spawn reported** is not marked detached yet, and
 * is kept only where a stop asked: the kill that ends it reads this record. The engine
 * leaving keeps none of those — they are not known to outlive their `runner.sh`.
 */
const turnKeptFor = (leaving: LeavingShape | undefined, r: RunRecord): Effect.Effect<boolean> => {
  const execId = r.turn?.execId
  if (leaving === undefined || execId === undefined) return Effect.succeed(false)
  if (r.turn?.detached === true) return leaving.keeps(execId)
  return Effect.zipWith(leaving.keeps(execId), leaving.now, (kept, now) => kept && !now)
}

/**
 * Write this process in as the holder, and report what the last one left running.
 *
 * **No liveness check, and nothing to refuse.** It used to read the record, ask
 * whether the holder was still alive, and fail `TrakHeld` if so — a read followed
 * by a write with no compare-and-swap across the gap, so two processes finding the
 * same dead holder could both take it. With one writer there is nobody to lose that
 * race to, and the exclusion that mattered is a permit rather than a file.
 *
 * The record itself is what stays, and the release is why: a scope that closes for
 * any reason clears the holder, so a record still standing means a process died
 * without unwinding — which is exactly the trak `reap` has to look at.
 */
const adopt =
  (
    root: string,
    proc: ProcessShape,
    own: Own,
    leaving: LeavingShape | undefined,
    owns: Owns | undefined,
  ): RunsShape["adopt"] =>
  (id) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const rec = yield* readRecord(root, id)
        // Read back from the source `holderAlive` reads, for `spawned`'s reason.
        const start = yield* proc.startTime(process.pid)
        if (start !== undefined) own.start = start
        yield* updateOwn(owns, root, id, (r) =>
          withHolder(r, {
            pid: process.pid,
            startedAt: Date.now(),
            ...(start === undefined ? {} : { start }),
          }),
        )
        return asInFlight(rec.turn)
      }),
      // A shutdown leaving a detached command keeps the holder too: `reap` looks only at a
      // record naming a dead one.
      () =>
        Effect.gen(function* () {
          if (yield* keptFor(leaving, yield* readRecord(root, id))) return
          yield* updateOwn(owns, root, id, (r) => withHolder(r, undefined))
        }).pipe(Effect.ignoreLogged),
    )

/**
 * Whether the process that wrote `held` is still alive: its pid is, and it started when the
 * record says. A live pid that started at another time is a later process given the same
 * number — after a redeploy, which leaves a holder standing on purpose, the likely one.
 * **A start that cannot be read now counts as dead.** It is what `ps` answers for a number
 * that is no process — a thread id, which `kill` passes and which a restarted container's
 * dense pids make the likely reissue — and reading that as alive left ten detached turns
 * undriven after the 2026-11-07 restart. The holder this process wrote itself is
 * recognised by `own` without asking `ps`, so a `ps` that fails once never clears a
 * live drive's record. A record with no start is judged by its pid alone.
 */
const holderAlive = (
  proc: ProcessShape,
  own: Own,
  held: NonNullable<RunRecord["holder"]>,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (held.pid === process.pid && held.start !== undefined && held.start === own.start) {
      return true
    }
    if (!(yield* proc.isAlive(held.pid))) return false
    if (held.start === undefined) return true
    return (yield* proc.startTime(held.pid)) === held.start
  })

/** This process's start as `adopt` last read and wrote it. */
interface Own {
  start: string | undefined
}

/**
 * Read-only for the reason `holder` is, and the record `adopt` leaves alone: taking
 * custody rewrites the holder and never the turn, so this answers the same after a
 * pick-up as before it — which is what lets the append stamp a restart with it.
 */
const inFlight =
  (root: string): RunsShape["inFlight"] =>
  (id) =>
    Effect.map(readRecord(root, id), (rec) => asInFlight(rec.turn))

/**
 * Read-only, and every line of it has to stay that way: a read that wrote would
 * make looking at a trak a way of changing what is driving it.
 *
 * `readRecord` is the whole implementation apart from the liveness check, and that
 * check is a second opinion rather than the mechanism: `reap()` has already cleared
 * every dead holder by the time anything reads this. It earns its place on the
 * holder that died in the gap between the two — which is a daemon that was killed
 * and has not restarted, so the answer *nobody* is the true one.
 */
const holder =
  (root: string, proc: ProcessShape, own: Own): RunsShape["holder"] =>
  (id) =>
    Effect.gen(function* () {
      const rec = yield* readRecord(root, id)
      if (rec.holder === undefined) return undefined
      const live = yield* holderAlive(proc, own, rec.holder)
      const held: Holder | undefined = live
        ? { pid: rec.holder.pid, startedAt: rec.holder.startedAt }
        : undefined
      return held
    })

const turn =
  (
    root: string,
    proc: ProcessShape,
    leaving: LeavingShape | undefined,
    owns: Owns | undefined,
  ): RunsShape["turn"] =>
  (id, t) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        // A detached command the record names and this turn does not rejoin would go on
        // beside it in the same checkout, with nothing left that knows its exec id.
        const before = (yield* readRecord(root, id)).turn
        if (
          before?.detached === true &&
          before.execId !== undefined &&
          before.execId !== t.rejoin
        ) {
          yield* proc.killExec(id, before.execId)
        }
        yield* updateOwn(owns, root, id, (r) => withTurn(r, buildTurn(t)))
      }),
      () =>
        Effect.gen(function* () {
          if (yield* turnKeptFor(leaving, yield* readRecord(root, id))) return
          yield* updateOwn(owns, root, id, (r) => withTurn(r, undefined))
        }).pipe(Effect.ignoreLogged),
    )

/**
 * The pid, and its start time read back from the same source `reap` will read —
 * never the wall clock here, which `ps` reports in whole seconds and would never
 * match. A read that fails records the pid alone, which `reap` then declines.
 */
const spawned =
  (root: string, proc: ProcessShape, owns: Owns | undefined): RunsShape["spawned"] =>
  (id, pid, execId, detached) =>
    Effect.gen(function* () {
      const start = yield* proc.startTime(pid)
      yield* updateOwn(owns, root, id, (r) =>
        r.turn === undefined
          ? r
          : withTurn(r, {
              ...r.turn,
              agentPid: pid,
              ...(start === undefined ? {} : { agentStart: start }),
              ...(execId === undefined ? {} : { execId }),
              ...(detached === true ? { detached: true as const } : {}),
            }),
      )
    })

/** The session the provider announced, with the minted one kept beside it; nothing to write to is a no-op. */
const announced =
  (root: string, owns: Owns | undefined): RunsShape["announced"] =>
  (id, sessionId) =>
    updateOwn(owns, root, id, (r) =>
      r.turn === undefined
        ? r
        : withTurn(r, { ...r.turn, sessionId, minted: r.turn.minted ?? r.turn.sessionId }),
    )

/** The whole total, over whatever the last report left; nothing to write to is a no-op. */
const spent =
  (root: string, owns: Owns | undefined): RunsShape["spent"] =>
  (id, usage, estimate) =>
    updateOwn(owns, root, id, (r) =>
      r.turn === undefined ? r : withTurn(r, { ...r.turn, usage, estimate }),
    )

/**
 * One sweep, every trak. Each dead holder is cleared whatever happens to its turn
 * after — unless a drive has taken the trak since it was read — and only a live, *verified* agent
 * pid is killed locally. A recorded exec id is stopped through the runner either way,
 * unless it is detached: that command is the turn still running, and the record is left
 * for the trak's next drive to rejoin it by.
 */
const reap =
  (root: string, proc: ProcessShape, own: Own): RunsShape["reap"] =>
  () =>
    Effect.gen(function* () {
      const ids = yield* listTrakIds(root)
      const results: Reaped[] = []
      for (const id of ids) {
        const rec = yield* readRecord(root, id)
        const held = rec.holder
        if (held === undefined || (yield* holderAlive(proc, own, held))) continue

        // Cleared only while it is still the holder read dead: the sweep runs this beside
        // live drives, and one that adopted the trak in between holds it now.
        const same = (r: RunRecord) =>
          r.holder?.pid === held.pid && r.holder.startedAt === held.startedAt
        if (!same(yield* readRecord(root, id))) continue
        yield* update(root, id, (r) => (same(r) ? withHolder(r, undefined) : r))

        const agentPid = rec.turn?.agentPid
        if (agentPid !== undefined) {
          results.push(yield* reapLocal(proc, id, agentPid, rec.turn?.agentStart))
        }

        // A sandboxed turn's remote command outlives its local `runner.sh`, and a dead
        // holder says that script is gone or going whatever the pid check found: after a
        // reboot the number is as likely reissued as free. The exec id is unique and the
        // kill idempotent, so it can never stop anything else — which is why it does not
        // wait on the verification the local kill needs. An id written before the spawn
        // has no pid beside it, and the command may have started all the same.
        const execId = rec.turn?.execId
        if (execId === undefined) continue
        if (rec.turn?.detached === true) results.push(Reaped.Rejoining({ id, execId }))
        else yield* proc.killExec(id, execId)
      }
      return results
    })

/** The local half of one stray: killed only where it started when the recorded agent did. */
const reapLocal = (
  proc: ProcessShape,
  id: TrakId,
  pid: number,
  recorded: string | undefined,
): Effect.Effect<Reaped> =>
  Effect.gen(function* () {
    if (!(yield* proc.isAlive(pid))) return Reaped.AlreadyGone({ id, pid })
    const start = yield* proc.startTime(pid)
    if (start === undefined || recorded === undefined || start !== recorded) {
      return Reaped.Declined({ id, pid })
    }
    yield* proc.kill(pid)
    return Reaped.Killed({ id, pid })
  })

/**
 * `startDir` rather than the root itself, mirroring every other file layer:
 * which project's traks we are looking at is runtime input. `owns` is given under a store
 * file, where engine copies sharing a checkout share this file: every write a drive makes
 * then lands only while this copy holds the trak's lease — see `Owns`. `reap` is not a
 * drive's write, and clears a dead holder whoever holds the lease.
 */
export const FileRunsLayer = (
  startDir: string,
  owns?: Owns,
): Layer.Layer<Runs, StoreFailed, Process> =>
  Layer.effect(
    Runs,
    Effect.gen(function* () {
      const proc = yield* Process
      const root = yield* orkestraDir(startDir).pipe(
        Effect.mapError((e) => new StoreFailed({ reason: `${e.path}: ${e.reason}` })),
      )
      // Optional, as it is for the runner's Process layer: with none, a release always clears.
      const leaving = Option.getOrUndefined(yield* Effect.serviceOption(Leaving))
      const own: Own = { start: undefined }
      const shape: RunsShape = {
        adopt: adopt(root, proc, own, leaving, owns),
        inFlight: inFlight(root),
        holder: holder(root, proc, own),
        turn: turn(root, proc, leaving, owns),
        spawned: spawned(root, proc, owns),
        announced: announced(root, owns),
        spent: spent(root, owns),
        reap: reap(root, proc, own),
        // `run.json` is this machine's alone: a copy elsewhere leaves its exec on a lease
        // row, which `LeaseRunsLayer` stops.
        stopLeft: () => Effect.void,
        ended: (id, execId) =>
          updateOwn(owns, root, id, (r) =>
            r.turn?.execId === execId ? withTurn(r, undefined) : r,
          ),
      }
      return shape
    }),
  )
