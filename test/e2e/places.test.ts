// Where work ran, end to end: a check's place is written on the events that end it, and
// a reader of the log — a restarted engine's included — hands it to the wire.
//
// What a check reports is scripted, as in `checks.test.ts`; that a spawn in a sandbox
// answers its place is the runner layer's contract, run in `test/contract/`.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Places } from "../../src/agent/types/place.js"
import { toEventDto } from "../../src/app/dto.js"
import type { Check } from "../../src/library/types/check.js"
import type { Event } from "../../src/workflow/domain/event.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { composer, runFlowWithAgentLog, step } from "../support/flow.js"
import { createAndStart, expectAwaiting, logTags } from "../support/scenario.js"
import { workDeclaring } from "../support/library.js"
import { fail, pass } from "../support/scripted-checks.js"
import { onResume, reply } from "../support/scripted-agent.js"

const VERIFY: Check = {
  name: "verify",
  description: "Runs the project's own verification.",
  timeoutSeconds: 60,
  askedEverySeconds: undefined,
  exclusive: false,
  cache: false,
  ignoresLinguistGenerated: false,
  units: undefined,
  cacheAcross: "platform",
  path: "/repo/.orkestra/checks/verify.sh",
}

const THERE = Places.remote("Runs each trak in a sandbox.", "sbx-1", "exec-1")
const AGAIN = Places.remote("Runs each trak in a sandbox.", "sbx-1", "exec-2")
const WIRE = { _tag: "Remote", runner: "Runs each trak in a sandbox.", sandbox: "sbx-1" }

const eventsOf = (id: TrakId) => Effect.flatMap(Store, (s) => s.events(id))
const endingOf = (history: readonly Event[], tag: Event["_tag"]) =>
  history.find((e) => e._tag === tag)

describe("where a check ran", () => {
  it("is on the failure and the pass that end it, and reaches the wire from the stored log", async () => {
    await runFlowWithAgentLog(
      [
        composer("work"),
        step(1, "work", reply.artifact("v1")),
        onResume(reply.artifact("v2"), "retry"),
      ],
      (id) =>
        Effect.gen(function* () {
          expectAwaiting(yield* createAndStart(id, "Add a --json flag"), "approval")
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "CheckFailed",
            "AgentReturned",
            "ChecksPassed",
          ])

          // Read back from the store, as an engine that restarted reads it.
          const history = yield* eventsOf(id)
          expect(endingOf(history, "CheckFailed")).toMatchObject({ place: THERE })
          expect(endingOf(history, "ChecksPassed")).toMatchObject({ places: { verify: AGAIN } })
          const failed = endingOf(history, "CheckFailed")
          const passed = endingOf(history, "ChecksPassed")
          expect(failed === undefined ? undefined : toEventDto(failed)).toMatchObject({
            place: { ...WIRE, exec: "exec-1" },
          })
          expect(passed === undefined ? undefined : toEventDto(passed)).toMatchObject({
            places: { verify: { ...WIRE, exec: "exec-2" } },
          })
        }),
      workDeclaring(["verify"], { checks: new Map([["verify", VERIFY]]) }),
      {
        verify: [
          { ...fail("2 problems"), place: THERE },
          { ...pass, place: AGAIN },
        ],
      },
    )
  })
})
