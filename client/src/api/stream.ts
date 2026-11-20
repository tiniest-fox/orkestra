/** The `stream` slice's route: every append the engine makes, as it lands. */

import { Schema } from "effect"
import { ENGINE_FRAME_TAGS, EngineFrameDto as EngineFrameSchema } from "@orkestra/shared/dto/stream"
import { url } from "./http"
import type { EngineFrameDto } from "./types"

/**
 * `Either` rather than `Sync` for the stream, and the difference is where the failure
 * can go.
 *
 * A `queryFn` reports a bad response by throwing, which is why every other decoder in
 * `api/` is `Sync`. A frame arrives inside an `EventSource` listener, where a throw is unhandled
 * — it reaches no promise and no error boundary, so the frame would simply vanish and
 * the stream would carry on looking healthy. This hands the failure back as a value
 * instead, and the caller decides.
 */
const decodeFrame = Schema.decodeUnknownEither(EngineFrameSchema)

/**
 * `GET /api/stream`. Every append the engine makes, as it lands.
 *
 * Returns the unsubscribe, which is the whole of the lifecycle a caller has to manage:
 * an `EventSource` reconnects on its own and quotes `Last-Event-ID` for us, so nothing
 * above this has to know how resuming works. What it cannot do on its own is stop.
 *
 * **Listeners are per event name, not a single `onmessage`.** The server names each
 * frame after its `_tag`, so `onmessage` — which only fires for unnamed events — would
 * receive nothing at all and the stream would look permanently idle. The names come off
 * the union in `@orkestra/shared` rather than from a list here, because a name missing
 * from such a list is a kind of frame that silently never arrives — which is what
 * happened to `Drive` when the list was hand-written.
 *
 * `onError` is called for a frame this build cannot read *and* for the connection
 * dropping, and the two are told apart by the caller rather than here: an `EventSource`
 * retries a dropped connection by itself, so an error is news rather than an ending.
 *
 * `onOpen` is called each time the connection is made, the first and every reconnection.
 * A reconnection is the one moment the page learns the engine may have changed under it.
 */
export const openEngineStream = (
  onFrame: (frame: EngineFrameDto) => void,
  onError: (error: Error) => void,
  onOpen: () => void,
): (() => void) => {
  const source = new EventSource(url("/api/stream"))
  const receive = (event: MessageEvent<string>): void => {
    const decoded = decodeFrame(JSON.parse(event.data))
    if (decoded._tag === "Left") {
      onError(new Error(`the engine sent a frame this build cannot read: ${decoded.left.message}`))
      return
    }
    onFrame(decoded.right)
  }
  for (const name of ENGINE_FRAME_TAGS) source.addEventListener(name, receive)
  source.addEventListener("error", () => {
    onError(new Error("the stream dropped"))
  })
  source.addEventListener("open", onOpen)
  return () => {
    source.close()
  }
}
