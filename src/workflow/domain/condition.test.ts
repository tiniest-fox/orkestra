import { describe, expect, it } from "vitest"
import { conditionAnswer, readDeployOutput } from "./condition.js"

describe("what a condition's exit means", () => {
  it("reads 0 as met, 1 as not yet, and no exit as not yet", () => {
    expect(conditionAnswer(0)).toBe("met")
    expect(conditionAnswer(1)).toBe("unmet")
    // A timeout or a spawn that never happened is nothing the world said.
    expect(conditionAnswer(undefined)).toBe("unmet")
  })

  it("reads any other code as giving up", () => {
    expect(conditionAnswer(2)).toBe("stopped")
    expect(conditionAnswer(3)).toBe("stopped")
    expect(conditionAnswer(127)).toBe("stopped")
  })
})

describe("what a deploy script printed", () => {
  it("takes the last JSON object line as the fields and the rest as text", () => {
    expect(
      readDeployOutput(
        'checking release…\n{"url":"https://app.example/","version":"v42","detail":"canary"}\n',
      ),
    ).toStrictEqual({
      url: "https://app.example/",
      version: "v42",
      detail: "canary",
      text: "checking release…",
    })
  })

  it("keeps a JSON line that carries no known field as an empty answer, with the rest as text", () => {
    expect(readDeployOutput('{"sha":"abc"}\nstill rolling out')).toStrictEqual({
      text: "still rolling out",
    })
  })

  it("is plain text when no line is a JSON object", () => {
    expect(readDeployOutput("deploy 88 is queued\n[1,2]\n")).toStrictEqual({
      text: "deploy 88 is queued\n[1,2]",
    })
  })

  it("drops a field whose value is not a string rather than stringifying it", () => {
    expect(readDeployOutput('{"url":7,"version":"v1"}')).toStrictEqual({ version: "v1", text: "" })
  })
})
