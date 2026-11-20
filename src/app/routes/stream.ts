// The stream — every append, as it lands. Answers with `@orkestra/shared/dto/stream`.

import { Effect, Stream } from "effect"
import * as Headers from "@effect/platform/Headers"
import * as Router from "@effect/platform/HttpRouter"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import * as ServerRequest from "@effect/platform/HttpServerRequest"
import type { EngineFrameDto } from "@orkestra/shared/dto/stream"
import { ResyncFrameDto } from "@orkestra/shared/dto/trak-frames"
import type { TrakId } from "../../workflow/domain/trak.js"
import { Feed, Frame, type Framed } from "../../workflow/ports/feed.js"
import type { StoreFailed } from "../../workflow/ports/store-errors.js"
import { libraryNow } from "../../workflow/ports/project-files.js"
import { People, type Watching } from "../people.js"
import { toFrameDto } from "../dto.js"
import { pressedBy } from "../guard.js"
import { runnersNow } from "../../vcs/ports/runners.js"

/** Sent before anything else, so the headers reach the client rather than waiting. */
const OPEN = ": open\n\n"

/**
 * A comment, on a timer.
 *
 * Two jobs. It keeps an idle connection from being closed by anything between here and
 * the browser, and it is how a client that vanished without a FIN is noticed: the write
 * fails, the stream fails, and the subscription's scope closes. Without it a dead tab
 * holds a subscription until the process exits.
 */
const BEAT = Stream.repeatEffect(Effect.as(Effect.sleep("15 seconds"), ": beat\n\n"))

const framed = (id: number, frame: EngineFrameDto): string =>
  `id: ${String(id)}\nevent: ${frame._tag}\ndata: ${JSON.stringify(frame)}\n\n`

/**
 * Whether a subscriber is sent `frame`. One about a trak or a goal goes to whoever sees that
 * item; one about neither — a CLI's plan, a process on the project checkout — to everyone.
 */
const shown = (watch: Watching): ((frame: Frame) => Effect.Effect<boolean, StoreFailed>) => {
  const trak = (f: { readonly id: TrakId }) => watch.trak(f.id)
  const onProject = (f: { readonly id: TrakId | undefined }) =>
    f.id === undefined ? Effect.succeed(true) : watch.trak(f.id)
  return Frame.$match({
    Appended: (f) => watch.appended(f.id, f.trak),
    Activity: trak,
    Removed: trak,
    CheckStarted: trak,
    CheckOutput: trak,
    CheckEnded: trak,
    Drive: trak,
    InFlight: trak,
    Process: onProject,
    ProcessOutput: onProject,
    Goal: (f) => watch.goal(f.goal),
    Usage: () => Effect.succeed(true),
    Preparing: trak,
    SeamStatus: trak,
  })
}

/**
 * Every append this daemon makes, to everyone watching who sees what it is about.
 *
 * **`Last-Event-ID` is the resume point, and it is not a `seq`.** One stream carries
 * every trak, so the id a reconnect quotes is the feed's own counter; `seq` on a frame
 * counts lines in one trak's file and is what tells a watcher it has missed something
 * about *that* trak. Two numbers because they answer two questions. A subscriber skips the
 * frames about items it does not see, so its ids have gaps, and they are harmless: the id
 * only ever says where to resume.
 *
 * A subscriber that asked from before the buffer gets one `Resync` ahead of the rest —
 * nothing it holds is known to be contiguous, and a stream that silently began in the
 * middle looks exactly like one that is complete.
 *
 * `no-transform` and `x-accel-buffering` are there so correctness does not depend on
 * what sits in front of this: a proxy that buffers turns a live stream into a batch
 * delivered on the heartbeat, which reads as an engine that has stopped.
 */
const streamRoute = Router.get(
  "/api/stream",
  Effect.gen(function* () {
    const feed = yield* Feed
    // For the model each plan entry resolves to, the same as the detail — the two are one
    // projection, and a drawer patching itself from frames would otherwise lose the field.
    // Read per frame, not once: this request lives as long as the tab, and a library taken
    // at connect would draw the models a reload replaced until the page was reloaded.
    const library = yield* libraryNow
    const runners = yield* runnersNow
    const request = yield* ServerRequest.HttpServerRequest
    const quoted = Number(request.headers["last-event-id"])
    const replay = yield* feed.since(Number.isFinite(quoted) ? quoted : 0)
    const sees = shown(yield* (yield* People).watching(yield* pressedBy))
    // A frame whose item cannot be looked up is not sent: nobody can say whose it is.
    const visible = (f: Framed) =>
      sees(f.frame).pipe(
        Effect.catchTag("StoreFailed", (e) =>
          Effect.as(
            Effect.logWarning(`stream: frame ${String(f.id)} withheld: ${e.reason}`),
            false,
          ),
        ),
      )

    const opening = replay.complete ? OPEN : `${OPEN}${framed(0, ResyncFrameDto.make({}))}`
    const body = Stream.make(opening).pipe(
      Stream.concat(
        Stream.merge(
          Stream.mapEffect(Stream.filterEffect(replay.frames, visible), (f) =>
            Effect.map(Effect.zip(library, runners), ([lib, files]) =>
              framed(f.id, toFrameDto(f.frame, lib, files.runner?.description)),
            ),
          ),
          BEAT,
        ),
      ),
      Stream.map((text) => new TextEncoder().encode(text)),
    )

    return ServerResponse.stream(body, {
      contentType: "text/event-stream",
      headers: Headers.fromInput({
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      }),
    })
  }),
)

export const streamRoutes = Router.empty.pipe(streamRoute)
