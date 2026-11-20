import { describe, expect, it } from "vitest"
import { failureOf, railProject } from "./rail.js"

const HOME = "/Users/k"
const ROOT = "/Users/k/Repos/harbor-web"

describe("a failed start, as the pane draws it", () => {
  it("sets the sentence apart from what the engine printed", () => {
    const thrown = new Error(
      `the engine for ${ROOT} exited with 1 before serving.\n\nloading .orkestra/\ncould not load review.md`,
    )
    expect(failureOf(thrown)).toEqual({
      reason: `The engine for ${ROOT} exited with 1 before serving.`,
      output: "loading .orkestra/\ncould not load review.md",
    })
  })

  it("carries no output for an engine that printed nothing", () => {
    const thrown = new Error(`the engine for ${ROOT} did not answer on 31000.\n\n`)
    expect(failureOf(thrown).output).toBeUndefined()
  })
})

describe("a project, as the rail is told about it", () => {
  const tile = { root: ROOT, state: "off", failure: undefined, icon: undefined, traks: undefined }

  it("is named by its folder, with the path a person reads", () => {
    expect(railProject({ ...tile, state: "off" }, HOME)).toEqual({
      path: ROOT,
      name: "harbor-web",
      short: "~/Repos/harbor-web",
      engine: "off",
    })
  })

  it("carries no list until an engine has answered, rather than an empty one", () => {
    expect("traks" in railProject({ ...tile, state: "started" }, HOME)).toBe(false)
    expect(railProject({ ...tile, state: "started", traks: [] }, HOME).traks).toEqual([])
  })

  it("says a refusal in the path a person reads, with no output", () => {
    const refused = {
      ...tile,
      state: "refused" as const,
      failure: { reason: `${ROOT} no longer exists.`, output: undefined },
    }
    expect(railProject(refused, HOME).failure).toEqual({
      reason: "~/Repos/harbor-web no longer exists.",
    })
  })
})
