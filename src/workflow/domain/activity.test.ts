import { describe, expect, it } from "vitest"
import { SessionId } from "../../agent/types/session.js"
import { activeAt, IDLE_AFTER_MS, leftSince, mayIdle, touchedAt } from "./activity.js"
import { Events, stamped } from "./event.js"
import { replayHistory } from "./replay.js"
import { TrakId } from "./trak.js"

const sid = SessionId.make("00000000-0000-4000-8000-000000000001")

describe("activeAt", () => {
  it("counts a person's press and a finished turn, and nothing else", () => {
    const history = [
      stamped(Events.trakCreated("d"), 1000),
      stamped(Events.turnFailed(0, sid, "the provider went"), 2000),
      stamped(Events.checksPassed(0, []), 3000),
    ]
    expect([touchedAt(history), activeAt(history)]).toStrictEqual([1000, 2000])
  })

  it("is absent on a log with no timed activity", () => {
    expect(activeAt([Events.trakCreated("d")])).toBeUndefined()
  })
})

describe("leftSince", () => {
  const active = 1_754_000_000_000
  it("is idle at three days and not before", () => {
    expect([
      leftSince(active, active + IDLE_AFTER_MS - 1),
      leftSince(active, active + IDLE_AFTER_MS),
    ]).toStrictEqual([false, true])
  })

  it("is idle where nothing says when anything happened", () => {
    expect(leftSince(undefined, active)).toBe(true)
  })
})

describe("mayIdle", () => {
  const id = TrakId.make("t")
  it("lets a live trak go idle, and never a put-away one", () => {
    const created = [Events.trakCreated("d")]
    expect([
      mayIdle(replayHistory(id, created)),
      mayIdle(replayHistory(id, [...created, Events.abandoned("not needed")])),
    ]).toStrictEqual([true, false])
  })
})
