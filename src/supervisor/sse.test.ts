import { describe, expect, it } from "vitest"
import { parseSse } from "./sse.js"

describe("reading server-sent events off a body", () => {
  it("reads id, event and data from one frame", () => {
    expect(parseSse("", 'id: 7\nevent: Appended\ndata: {"a":1}\n\n')).toEqual({
      rest: "",
      events: [{ id: "7", event: "Appended", data: '{"a":1}' }],
    })
  })

  it("carries an incomplete frame to the next chunk", () => {
    const first = parseSse("", "id: 1\nevent: Removed\ndata: {")
    expect(first.events).toEqual([])
    const second = parseSse(first.rest, '"trak":"t"}\n\nid: 2\n')
    expect(second).toEqual({
      rest: "id: 2\n",
      events: [{ id: "1", event: "Removed", data: '{"trak":"t"}' }],
    })
  })

  it("drops the opening comment and the heartbeat, which carry no data", () => {
    expect(parseSse("", ": open\n\n: beat\n\ndata: x\n\n").events).toEqual([
      { id: undefined, event: undefined, data: "x" },
    ])
  })

  it("joins several data lines with a newline and accepts CRLF", () => {
    expect(parseSse("", "data: a\r\ndata: b\r\n\r\n").events).toEqual([
      { id: undefined, event: undefined, data: "a\nb" },
    ])
  })
})
