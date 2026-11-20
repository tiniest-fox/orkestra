// Server-sent events, read off a `fetch` body rather than an `EventSource`.
//
// The main process has no `EventSource`, and the stream has to be closed when a window
// does and resumed from `Last-Event-ID` after a drop, so the protocol is parsed here:
// a frame is the lines up to a blank one, `id:`, `event:` and `data:` are the fields
// the engine writes, and a line beginning `:` is a comment — the heartbeat, which
// says nothing and keeps the connection open.

export interface SseEvent {
  readonly id: string | undefined
  readonly event: string | undefined
  readonly data: string
}

export interface SseParse {
  /** Text after the last complete frame, to be put in front of the next chunk. */
  readonly rest: string
  readonly events: readonly SseEvent[]
}

const eventOf = (block: string): SseEvent | undefined => {
  let id: string | undefined
  let event: string | undefined
  const data: string[] = []
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    const raw = colon === -1 ? "" : line.slice(colon + 1)
    const value = raw.startsWith(" ") ? raw.slice(1) : raw
    if (field === "id") id = value
    else if (field === "event") event = value
    else if (field === "data") data.push(value)
  }
  return data.length === 0 ? undefined : { id, event, data: data.join("\n") }
}

/**
 * The complete frames in `carried + chunk`, and what is left over. A frame with no
 * `data` — the opening comment, a heartbeat — is not an event and is dropped.
 */
export const parseSse = (carried: string, chunk: string): SseParse => {
  const blocks = `${carried}${chunk}`.replaceAll("\r\n", "\n").split("\n\n")
  const rest = blocks.pop() ?? ""
  const events: SseEvent[] = []
  for (const block of blocks) {
    const event = eventOf(block)
    if (event !== undefined) events.push(event)
  }
  return { rest, events }
}
