import { describe, expect, it } from "vitest"
import { parseWalkthrough } from "./walkthrough"

const TWO_PATHS = `actors: View, Client, Engine, CLI, MCP server

path: During the turn
1. The view asks
   at: View -> Client
   The view posts \`tools/call\` with the tool's bare name,
   as it loads or on a press.
2. The engine decides
   at: Engine
3. The view redraws
   at: Engine -> Client -> View
   The result goes back the way it came.

path: Refused
1. The view asks
   at: View -> Client
2. The engine refuses
   at: Client -> Engine
   Not a tool the view may call.`

describe("parseWalkthrough", () => {
  it("reads actors, paths and steps, with lanes as indices and a body joined to one line", () => {
    const walk = parseWalkthrough(TWO_PATHS)

    expect(walk?.actors).toEqual(["View", "Client", "Engine", "CLI", "MCP server"])
    expect(walk?.paths.map((path) => path.name)).toEqual(["During the turn", "Refused"])
    expect(walk?.paths[0]?.steps).toEqual([
      {
        title: "The view asks",
        at: [0, 1],
        body: "The view posts `tools/call` with the tool's bare name, as it loads or on a press.",
      },
      { title: "The engine decides", at: [2], body: "" },
      { title: "The view redraws", at: [2, 1, 0], body: "The result goes back the way it came." },
    ])
  })

  it("names the lanes a path never reaches, which is how an early end is told", () => {
    const walk = parseWalkthrough(TWO_PATHS)

    expect(walk?.paths[0]?.unreached).toEqual([3, 4])
    expect(walk?.paths[1]?.unreached).toEqual([3, 4])
  })

  it("takes the steps of a walkthrough that never names its one path", () => {
    const walk = parseWalkthrough("actors: A, B\n1. Go\n   at: A -> B\n2. Back\n   at: B -> A")

    expect(walk?.paths).toHaveLength(1)
    expect(walk?.paths[0]?.name).toBe("")
    expect(walk?.paths[0]?.steps.map((step) => step.at)).toEqual([
      [0, 1],
      [1, 0],
    ])
  })

  it("refuses more than five actors, which the track has no room for", () => {
    expect(parseWalkthrough("actors: A, B, C, D, E, F\n1. Go\n   at: A -> F")).toBeUndefined()
  })

  it.each([
    ["no actors line", "1. Go\n   at: A -> B"],
    ["an actor named twice", "actors: A, A\n1. Go\n   at: A"],
    ["a step with no at", "actors: A, B\n1. Go\n   Only words."],
    ["a step naming someone who is not an actor", "actors: A, B\n1. Go\n   at: A -> C"],
    ["two at lines on one step", "actors: A, B\n1. Go\n   at: A\n   at: B"],
    ["a path with no steps", "actors: A\npath: Empty\npath: Full\n1. Go\n   at: A"],
    ["a path named twice", "actors: A\npath: P\n1. Go\n   at: A\npath: P\n1. Go\n   at: A"],
    ["unnamed steps beside a named path", "actors: A\n1. Go\n   at: A\npath: P\n1. Go\n   at: A"],
    ["an unindented line that is none of the forms", "actors: A\n1. Go\n   at: A\nstray words"],
    ["an indented line before any step", "actors: A\n   at: A"],
    ["no steps at all", "actors: A, B"],
  ])("is undefined for %s", (_, source) => {
    expect(parseWalkthrough(source)).toBeUndefined()
  })
})
