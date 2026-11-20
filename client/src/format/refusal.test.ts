/**
 * Tier 1 (`testing-tiers`): one pure function.
 *
 * The assertion is that **every member of the union has a sentence of its own** — a
 * mapping with a fallback would pass a spot check and read as "something went wrong" for
 * whichever refusal nobody thought about. A refusal exists precisely because the engine
 * had something specific to say.
 */

import { describe, expect, it } from "vitest"
import type { RefusalDto } from "@orkestra/shared/dto/common"
import { refusalSaid } from "./refusal"

const EVERY_REFUSAL: readonly RefusalDto[] = [
  { _tag: "Dirty", files: ["src/app/server.ts"] },
  { _tag: "NotParked" },
  { _tag: "NotFinished" },
  { _tag: "Driving" },
  { _tag: "AtRest" },
  { _tag: "NotAtRest" },
  {
    _tag: "BranchNotMoved",
    why: "pull request #4 merged, and moving trak/x onto origin/main stopped",
  },
  { _tag: "NotWaiting" },
  { _tag: "NoFailedEffect" },
  { _tag: "DetachedHead" },
  { _tag: "NoOrigin" },
  { _tag: "NoUpstream" },
  { _tag: "Diverged", ahead: 1, behind: 4 },
  { _tag: "Behind", behind: 2 },
]

describe("refusalSaid", () => {
  it("gives every refusal a sentence, and no two the same one", () => {
    const said = EVERY_REFUSAL.map((r) => refusalSaid(r))

    expect(said.every((s) => s.length > 0)).toBe(true)
    expect(new Set(said).size).toBe(EVERY_REFUSAL.length)
  })

  it("names the action, not the status, for the two an approval can earn", () => {
    expect(refusalSaid({ _tag: "Driving" })).toContain("already driving")
    expect(refusalSaid({ _tag: "NotParked" })).toContain("nothing to answer")
  })
})
