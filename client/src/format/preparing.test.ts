// Tier-1: each preparation in words, and whose words a sandbox's line is.

import { describe, expect, it } from "vitest"
import type { PreparingPhaseDto } from "../api/types"
import { phaseWords } from "./preparing"

/** One of each, so a phase the wire grows is a missing key here. */
const phases: { [K in PreparingPhaseDto["_tag"]]: Extract<PreparingPhaseDto, { _tag: K }> } = {
  Checkout: { _tag: "Checkout" },
  Creating: { _tag: "Creating", runner: "Runs each trak in a sandbox." },
  Resuming: { _tag: "Resuming", runner: "Runs each trak in a sandbox." },
  Rebuilding: { _tag: "Rebuilding", runner: "Runs each trak in a sandbox." },
  Seeding: { _tag: "Seeding" },
  Copying: { _tag: "Copying", sent: 3, total: 40 },
  SettingUp: { _tag: "SettingUp" },
  SetupBeside: { _tag: "SetupBeside" },
}

describe("phaseWords", () => {
  it("names each preparation for what it does, and no two alike", () => {
    expect(Object.values(phases).map((p) => phaseWords(p).label)).toEqual([
      "Making a local worktree",
      "Creating a sandbox from the tools template",
      "Resuming the stopped sandbox",
      "Rebuilding the stale sandbox, carrying uncommitted work",
      "Seeding the repository",
      "Copying tools and the home mirror · 3 of 40",
      "Running setup.sh",
      "Setup still running",
    ])
  })

  it("gives a sandbox's line to the runner file, and its own only where none came", () => {
    expect(phaseWords(phases.Creating).line).toBe("Runs each trak in a sandbox.")
    expect(phaseWords({ _tag: "Creating" }).line).not.toBe("")
  })
})
