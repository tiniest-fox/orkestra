import { describe, expect, it } from "vitest"
import type { SeamStatusDto } from "../api/types"
import { seamWords } from "./seam"

const seam = (over: Partial<SeamStatusDto>): SeamStatusDto => ({
  action: "stop",
  phase: "crossing",
  attempt: 1,
  since: 0,
  ...over,
})

describe("seamWords", () => {
  it("names the stop, and how far each phase has got", () => {
    expect(seamWords(seam({ phase: "readying", attempt: 0 }))).toEqual({
      label: "Stopping the turn",
      line: "checking the sandbox",
    })
    expect(seamWords(seam({})).line).toBe("reaching into the sandbox")
    expect(seamWords(seam({ attempt: 3 })).line).toBe("reaching into the sandbox, try 3")
  })

  it("says which side did not answer while it waits an outage out", () => {
    const lost = { kind: "lost", said: "ssh: connection refused" } as const
    const unreachable = { kind: "unreachable", said: "503" } as const
    expect(seamWords(seam({ phase: "waiting", lastError: lost })).line).toBe(
      "sandbox unreachable, trying again",
    )
    expect(seamWords(seam({ phase: "waiting", lastError: unreachable })).line).toBe(
      "sandbox provider unreachable, trying again",
    )
  })

  it("draws an action it has no words for by its own name", () => {
    expect(seamWords(seam({ action: "copy" })).label).toBe("Sandbox action: copy")
  })
})
