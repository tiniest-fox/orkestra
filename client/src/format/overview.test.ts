import { describe, expect, it } from "vitest"
import { parseOverview } from "./overview"

/** The grammar's own example, as an agent writes it — blank lines inside a sketch included. */
const SOURCE = `1. Client | Hosts the frame, and answers the view's messages
   in: client/src
   + features/views/ViewFrame.tsx — The sandboxed frame
   + features/views/viewHost.ts — What the host answers
   ~ api/client.ts — \`callViewTool\`
   sketch:
     define draw(view)
       frame = sandbox(view.html)

       when: a message arrives
         answer(message)

2. Engine | Keeps what a view needs
   in: src/app
   + views.ts — The store beside the transcript
   sketch:
     define on_tool_result(turn, call)

outside: CLI | The agent process
outside: MCP server

Client -> Engine: a press
Engine -> CLI: a tool call

order: Engine first, then Client.`

describe("parseOverview", () => {
  it("reads the parts in the order written, with their roots, files and gists", () => {
    const map = parseOverview(SOURCE)

    expect(map?.parts.map((p) => [p.name, p.gist, p.root])).toEqual([
      ["Client", "Hosts the frame, and answers the view's messages", "client/src"],
      ["Engine", "Keeps what a view needs", "src/app"],
    ])
    expect(map?.parts[0]?.files).toEqual([
      {
        path: "features/views/ViewFrame.tsx",
        touch: "new",
        note: "The sandboxed frame",
        sketch: undefined,
      },
      {
        path: "features/views/viewHost.ts",
        touch: "new",
        note: "What the host answers",
        sketch: undefined,
      },
      { path: "api/client.ts", touch: "changed", note: "`callViewTool`", sketch: undefined },
    ])
  })

  it("keeps a sketch's blank lines and its own indent, and drops the blank it ends on", () => {
    const map = parseOverview(SOURCE)

    expect(map?.parts[0]?.sketch).toBe(
      "define draw(view)\n  frame = sandbox(view.html)\n\n  when: a message arrives\n    answer(message)",
    )
    expect(map?.parts[1]?.sketch).toBe("define on_tool_result(turn, call)")
  })

  it("reads the outside parts, the links and the order sentence", () => {
    const map = parseOverview(SOURCE)

    expect(map?.outside).toEqual([
      { name: "CLI", note: "The agent process" },
      { name: "MCP server", note: undefined },
    ])
    expect(map?.links).toEqual([
      { from: "Client", to: "Engine", label: "a press" },
      { from: "Engine", to: "CLI", label: "a tool call" },
    ])
    expect(map?.order).toBe("Engine first, then Client.")
  })

  it("reads a part with nothing under it", () => {
    expect(parseOverview("1. Client")?.parts).toEqual([
      {
        name: "Client",
        gist: undefined,
        root: undefined,
        files: [],
        sketch: undefined,
      },
    ])
  })

  it("accepts a spaced hyphen where an agent did not type the em dash", () => {
    expect(parseOverview("1. A\n   + a.ts - new file")?.parts[0]?.files).toEqual([
      { path: "a.ts", touch: "new", note: "new file", sketch: undefined },
    ])
  })

  it("gives a sketch indented under a file to that file, and leaves the part's own alone", () => {
    const map = parseOverview(
      "1. A\n   + a.ts — new\n     sketch:\n       define a()\n\n         return 1\n   ~ b.ts\n   sketch:\n     whole part",
    )

    expect(map?.parts[0]?.files.map((f) => [f.path, f.sketch])).toEqual([
      ["a.ts", "define a()\n\n  return 1"],
      ["b.ts", undefined],
    ])
    expect(map?.parts[0]?.sketch).toBe("whole part")
  })

  // Each of these is a fence the map would have to guess at, so it draws as its source.
  it.each([
    ["no parts at all", "outside: CLI | The agent"],
    ["a line the grammar has no shape for", "1. Client\nsomething else"],
    ["an indented line with no part above it", "   + a.ts"],
    ["an indented line after an outside part", "1. A\noutside: CLI\n   + a.ts"],
    ["an indented line that is not a root, a file or a sketch", "1. A\n   a.ts"],
    ["two sketches in one part", "1. A\n   sketch:\n     x\n   sketch:\n     y"],
    [
      "two sketches under one file",
      "1. A\n   + a.ts\n     sketch:\n       x\n     sketch:\n       y",
    ],
    ["two order sentences", "1. A\norder: A.\norder: A again."],
    ["a section heading, which this grammar does not have", "## Parts\n1. A"],
  ])("refuses %s", (_, source) => {
    expect(parseOverview(source)).toBeUndefined()
  })
})
