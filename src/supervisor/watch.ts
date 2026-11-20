// One `/api/stream` subscriber per engine, for a notice when a trak parks, finishes or
// fails — the job `src/app/push.ts` does for a phone, done from outside the engine
// because the supervisor is a client of it.
//
// A fresh connection gets live frames only, so the notice is for what happens from now
// on: the traks already parked are on the window. A reconnect quotes `Last-Event-ID`,
// so a gate reached while the stream was down is still told — and a `Resync`, which
// says the engine could not replay the gap, is answered by reading the list and
// telling any trak whose state moved.
//
// The same subscriber keeps the caller's view of the project level with the engine: the list
// is read on every connection and again after any frame that can change what a row says,
// and handed to `listed`. Read whole each time, `client-style`'s rule for the list — a
// summary's fields are projections the engine computes.
//
// **A 401 is a settled answer, not a dropped stream.** The bearer off `daemon.json` goes
// on every request; an engine that still refuses it will refuse the next try too, so the
// watch stops and says so once rather than retrying on the drop timer for ever.

import { setTimeout as sleep } from "node:timers/promises"
import { Schema } from "effect"
import {
  AppendedFrameDto,
  DriveFrameDto,
  RemovedFrameDto,
  ResyncFrameDto,
} from "@orkestra/shared/dto/trak-frames"
import { TrakListDto, type TrakStateDto, type TrakSummaryDto } from "@orkestra/shared/dto/trak"
import { credential, type Engine } from "./engine.js"
import { changed, type Notice, noticeFor, phaseOf, type Wait } from "./notice.js"
import { parseSse } from "./sse.js"

const RECONNECT_MS = 2000
const LIST_TIMEOUT_MS = 3000
/** How long frames are gathered before the list is read for them: a busy turn writes many. */
const RELIST_MS = 300

/** What a refused credential means for the watch: it ends, and the person is told. */
export const REFUSED =
  "the engine refused the app's credential, so notifications for this project are off. " +
  "It is read off `.orkestra/.database/daemon.json`; restart the engine and reopen the project."

class Refused extends Error {}

/**
 * The frames the watch acts on, out of the whole stream: the ones after which a row of the
 * list may read differently. Any other frame fails to decode and is skipped, as a frame
 * this build cannot read is.
 * Not `EngineFrameDto`: that union pulls in every slice a frame carries, so an edit to
 * the usage frame would rerun every host test.
 */
const WatchedFrameDto = Schema.Union(
  AppendedFrameDto,
  RemovedFrameDto,
  ResyncFrameDto,
  DriveFrameDto,
)
type WatchedFrameDto = Schema.Schema.Type<typeof WatchedFrameDto>

const decodeFrame = Schema.decodeUnknownEither(WatchedFrameDto)
const decodeList = Schema.decodeUnknownEither(TrakListDto)

/** A pause the stop cuts short; an abort is the answer wanted, not an error. */
const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  sleep(ms, undefined, { signal }).catch(() => undefined)

/** The live rows of `/api/traks`, or `undefined` when the engine cannot be asked — never
 *  a throw. An archived trak is not among them; the notice names such a trak by its id. */
const summaries = async (w: Watching): Promise<readonly TrakSummaryDto[] | undefined> => {
  const { engine } = w
  try {
    const response = await fetch(`${engine.url}api/traks`, {
      headers: credential(engine),
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const decoded = decodeList(await response.json())
    if (decoded._tag === "Left") {
      w.log(`the trak list from ${engine.root} cannot be read: ${decoded.left.message}`)
      return undefined
    }
    return decoded.right.traks
  } catch {
    return undefined
  }
}

/** The words a person knows the trak by, or its id when the list cannot be read. */
const nameOf = (list: readonly TrakSummaryDto[] | undefined, trak: string): string => {
  const found = list?.find((t) => t.id === trak)
  return found === undefined ? trak : (found.title ?? found.description)
}

/** Who hears what the watch learns. */
export interface WatchListeners {
  /** A trak parked, finished, failed or gave up on its condition. */
  readonly notify: (notice: Notice) => void
  /** The engine refused the credential; the watch has ended. Told once. */
  readonly refused: (reason: string) => void
  /** The engine's list, on every connection and after every frame that can change it. */
  readonly listed: (traks: readonly TrakSummaryDto[]) => void
  /** A line for the operator: a dropped stream, or a list this build cannot read. */
  readonly log: (line: string) => void
}

/** What one engine's watcher holds between frames. */
interface Watching extends WatchListeners {
  readonly engine: Engine
  /** The list read a frame has asked for and that has not run yet. */
  relisting: ReturnType<typeof setTimeout> | undefined
  /** Each trak's last seen phase (`phaseOf`); a transition is a change of it. */
  readonly last: Map<string, string>
  readonly signal: AbortSignal
  lastId: string | undefined
}

const moved = (
  w: Watching,
  trak: string,
  state: TrakStateDto,
  held: Wait | undefined,
  name: () => Promise<string>,
) =>
  (async (): Promise<void> => {
    const previous = w.last.get(trak)
    w.last.set(trak, phaseOf(state, held))
    if (!changed(previous, state, held)) return
    const notice = noticeFor(trak, state, await name(), held)
    if (notice !== undefined && !w.signal.aborted) w.notify(notice)
  })()

/** The list's wait, as `notice.ts` reads it — the same name and give-up the frame carries. */
const waitOf = (trak: TrakSummaryDto): Wait | undefined =>
  trak.waiting === undefined
    ? undefined
    : { name: trak.waiting.name, stopped: trak.waiting.stopped }

/**
 * Bring `last` level with the list. On the first connection nothing is told — those
 * traks are on screen already. After a `Resync` every trak whose state moved is,
 * since the frames that would have said so are the ones the engine dropped.
 */
const level = async (w: Watching, tell: boolean): Promise<void> => {
  const list = await summaries(w)
  if (list === undefined) return
  if (!tell) {
    for (const trak of list) w.last.set(trak.id, phaseOf(trak.state, waitOf(trak)))
    return
  }
  await Promise.all(
    list.map((trak) =>
      moved(w, trak.id, trak.state, waitOf(trak), () => Promise.resolve(nameOf(list, trak.id))),
    ),
  )
}

/** Read the list and hand it on. A list that cannot be read leaves the last one standing. */
const relist = async (w: Watching): Promise<void> => {
  const list = await summaries(w)
  if (list !== undefined && !w.signal.aborted) w.listed(list)
}

/** Ask for a list read soon; a read already asked for covers this frame too. */
const relistSoon = (w: Watching): void => {
  w.relisting ??= setTimeout(() => {
    w.relisting = undefined
    void relist(w)
  }, RELIST_MS)
}

const arrived = async (w: Watching, frame: WatchedFrameDto): Promise<void> => {
  // Every watched frame is one after which a row of the list may read differently: its
  // state, or who holds it.
  relistSoon(w)
  if (frame._tag === "Resync") return level(w, true)
  if (frame._tag === "Removed") {
    w.last.delete(frame.trak)
    return
  }
  if (frame._tag !== "Appended") return
  // The list read runs on every tag transition, notifiable or not — a handful per step,
  // each after an agent turn, so a cache would save nothing worth its staleness rules.
  // The frame carries the projection whole, so the wait here is the real one — the
  // condition's name and whether it gave up — where the list can only say held.
  return moved(w, frame.trak, frame.state, frame.waiting, async () =>
    nameOf(await summaries(w), frame.trak),
  )
}

/**
 * Every complete frame in `chunk`, decoded and applied. `last` is set synchronously
 * in `moved` before anything is awaited, so two frames for one trak in a chunk still
 * see each other in order.
 */
const chunkArrived = (w: Watching, carried: string, chunk: string): Promise<string> => {
  const parsed = parseSse(carried, chunk)
  const applied: Promise<void>[] = []
  for (const event of parsed.events) {
    if (event.id !== undefined) w.lastId = event.id
    const decoded = decodeFrame(JSON.parse(event.data))
    if (decoded._tag === "Right") applied.push(arrived(w, decoded.right))
  }
  return Promise.all(applied).then(() => parsed.rest)
}

/**
 * Read the body to its end. Recursive rather than a loop for `engine.ts`'s reason:
 * the next read is worth making only once this one has come back.
 */
const drain = async (
  w: Watching,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  carried: string,
): Promise<void> => {
  const { done, value } = await reader.read()
  if (done) return
  const rest = await chunkArrived(w, carried, decoder.decode(value, { stream: true }))
  return drain(w, reader, decoder, rest)
}

/** One connection, read to its end. Returns when the engine closes it or the watch stops. */
const connection = async (w: Watching): Promise<void> => {
  const response = await fetch(`${w.engine.url}api/stream`, {
    headers: {
      accept: "text/event-stream",
      ...credential(w.engine),
      ...(w.lastId === undefined ? {} : { "last-event-id": w.lastId }),
    },
    signal: w.signal,
  })
  const body: ReadableStream<Uint8Array> | null = response.body
  if (response.status === 401) throw new Refused(REFUSED)
  if (!response.ok || body === null) {
    throw new Error(`the stream answered ${String(response.status)}`)
  }
  if (w.lastId === undefined) await level(w, false)
  void relist(w)
  return drain(w, body.getReader(), new TextDecoder(), "")
}

/** Connect, and reconnect after a pause, until the watch is stopped or refused. */
const keepWatching = async (w: Watching): Promise<void> => {
  if (w.signal.aborted) return
  const failure = await connection(w).then(
    () => undefined,
    (e: unknown) => e,
  )
  // A call rather than the property: the control flow above narrowed it to `false`,
  // and an `await` has been crossed since.
  const stopped = (): boolean => w.signal.aborted
  if (stopped()) return
  if (failure instanceof Refused) {
    w.refused(failure.message)
    return
  }
  if (failure !== undefined) {
    const said = failure instanceof Error ? failure.message : JSON.stringify(failure)
    w.log(`the stream for ${w.engine.root} dropped: ${said}`)
  }
  await wait(RECONNECT_MS, w.signal)
  return keepWatching(w)
}

/**
 * Watch `engine` until the returned stop is called, telling `listeners` what it learns.
 * A dropped stream is reopened after a pause, quoting the last id seen; a frame this
 * build cannot read is skipped rather than fatal. A refused credential ends the watch.
 */
export const watchEngine = (engine: Engine, listeners: WatchListeners): (() => void) => {
  const controller = new AbortController()
  const w: Watching = {
    ...listeners,
    engine,
    relisting: undefined,
    last: new Map(),
    signal: controller.signal,
    lastId: undefined,
  }
  void keepWatching(w)
  return () => {
    clearTimeout(w.relisting)
    controller.abort()
  }
}
