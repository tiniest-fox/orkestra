// Which trak the runtime places on the host: only one opened with an agent that sets
// `place: host`, asked once, before its checkout is first made. A trak opened with any
// other agent, and a trak the composer plans — whose plan does not exist yet when its
// checkout is made — are never placed, whichever agents the fleet holds. Where the
// checkout then goes is `host-placed.test.ts`'s.

import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import type { Library } from "../../src/library/types/library.js"
import { HostTraks } from "../../src/vcs/ports/host-traks.js"
import { Events } from "../../src/workflow/domain/event.js"
import { Proposal } from "../../src/workflow/domain/outputs/proposal.js"
import { advance } from "../../src/workflow/runtime.js"
import { runFlow } from "../support/flow.js"
import { library } from "../support/library.js"
import { create, logTags } from "../support/scenario.js"

/** The fixture fleet, with `work` asking to be placed on the host. */
const placing = (): Library => {
  const lib = library()
  const work = lib.agents.get("work")
  if (work === undefined) throw new Error("the fixture fleet lost its `work` agent")
  return { ...lib, agents: new Map(lib.agents).set("work", { ...work, place: "host" }) }
}

/** A HostTraks that records each trak it is asked to place, and places it. */
const recording = () => {
  const asked: string[] = []
  const layer = Layer.succeed(HostTraks, {
    has: (trak) => Effect.succeed(asked.includes(trak)),
    at: () => Effect.succeed(false),
    place: (trak) => Effect.sync(() => asked.push(trak) > 0),
  })
  return { asked, layer }
}

const openedWith = (agent: string) =>
  Events.trakOpenedWith(
    "why did the clinicail trak fail?",
    Proposal.make({ title: "Look", steps: [{ agent, instruction: "look" }] }),
  )

describe("placing a trak on the host", () => {
  it("places a trak opened with an agent that sets `place: host`, before its checkout", async () => {
    const host = recording()
    await runFlow(
      [],
      (id) =>
        Effect.gen(function* () {
          yield* advance(id, openedWith("work")).pipe(Effect.provide(host.layer))
          expect(host.asked).toEqual([id])
          expect(yield* logTags(id)).toContain("WorktreeReady")
        }),
      placing(),
    )
  })

  it("places no trak opened with an agent that leaves it out", async () => {
    const host = recording()
    await runFlow(
      [],
      (id) =>
        Effect.gen(function* () {
          yield* advance(id, openedWith("design")).pipe(Effect.provide(host.layer))
          expect(host.asked).toEqual([])
        }),
      placing(),
    )
  })

  it("places no trak the composer plans, even when it plans a placing agent", async () => {
    const host = recording()
    await runFlow(
      [],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "look into it").pipe(Effect.provide(host.layer))
          expect(host.asked).toEqual([])
        }),
      placing(),
    )
  })
})
