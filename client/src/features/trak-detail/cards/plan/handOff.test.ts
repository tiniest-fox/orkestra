import { describe, expect, it } from "vitest"
import { makeComposerReturned, makeHandedOff, makeTrakCreated } from "../../../../fixtures"
import { handedOffTraks, newTraks, openedAt } from "./handOff"

describe("openedAt", () => {
  it("names the traks the compose entry's hand-offs were opened as, off the log", () => {
    const log = [
      makeTrakCreated(),
      makeComposerReturned(),
      makeHandedOff({ step: 0, base: "main", ids: ["a-b-c", "d-e-f"] }),
    ]
    expect(openedAt(log, 0)).toStrictEqual({ step: 0, base: "main", ids: ["a-b-c", "d-e-f"] })
  })

  it("says nothing while the gate is open, and nothing for another entry's hand-off", () => {
    expect(openedAt([makeTrakCreated(), makeComposerReturned()], 0)).toBeUndefined()
    expect(openedAt([makeHandedOff({ step: 3 })], 0)).toBeUndefined()
  })
})

describe("handedOffTraks", () => {
  it("lists every hand-off the log opened, in log order", () => {
    const log = [makeHandedOff({ step: 0, ids: ["one"] }), makeHandedOff({ step: 3, ids: ["two"] })]
    expect(handedOffTraks(log).map((o) => o.ids)).toStrictEqual([["one"], ["two"]])
  })
})

describe("newTraks", () => {
  it("counts in words", () => {
    expect(newTraks(1)).toBe("1 new trak")
    expect(newTraks(3)).toBe("3 new traks")
  })
})
