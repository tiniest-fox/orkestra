// The project's env script, end to end: what it left exported reaches every turn the
// engine spawns, and a script that breaks fails the turn it was for rather than
// letting the agent run on the engine's own toolchain.
//
// What a script actually leaves exported is the shell adapter's contract, under
// `test/contract/environment.ts`; the flows here take the answer as given.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { composer, composerRuns, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import { create, createAndStart, expectState, logTags } from "../support/scenario.js"
import { reply } from "../support/scripted-agent.js"
import { environmentFailing, environmentOf } from "../support/scripted-environment.js"
import type { SessionRequest } from "../../src/agent/types/session.js"

const envOf = (runs: readonly SessionRequest[]): readonly Readonly<Record<string, string>>[] =>
  runs.map((r) => r.env)

describe("a project with an env script", () => {
  it("hands what it exported to the composer and to every step", async () => {
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("Added --json"))],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const log = yield* agentLog
          expect(envOf(composerRuns(log))).toEqual([{ RUBY_ROOT: "/opt/rubies/3.3" }])
          expect(envOf(stepRuns(log))).toEqual([{ RUBY_ROOT: "/opt/rubies/3.3" }])
        }),
      undefined,
      undefined,
      undefined,
      undefined,
      environmentOf({ RUBY_ROOT: "/opt/rubies/3.3" }),
    )
  })

  it("fails the turn when the script does, before any session starts", async () => {
    await runFlowWithAgentLog(
      [composer("work")],
      (id, agentLog) =>
        Effect.gen(function* () {
          const trak = yield* create(id, "x")
          // A provider-kind failure, because nothing about the work was wrong and the
          // retry keeps the worktree — the same answer a projection that would not
          // write gets. The reason is the script's own account.
          expectState(trak, "Failed")
          if (trak.state._tag !== "Failed") return
          expect(trak.state.error).toContain("mise: ruby 3.3.0 is not installed")
          expect(yield* logTags(id)).toEqual(["TrakCreated", "WorktreeReady", "TurnFailed"])
          // No session: nothing was spawned, so there is nothing to resume.
          expect(trak.composerSession).toBeUndefined()
          expect(composerRuns(yield* agentLog)).toEqual([])
        }),
      undefined,
      undefined,
      undefined,
      undefined,
      environmentFailing(
        "env script `/repo/.orkestra/worktrees/env.sh` exited 3:\nmise: ruby 3.3.0 is not installed",
      ),
    )
  })
})
