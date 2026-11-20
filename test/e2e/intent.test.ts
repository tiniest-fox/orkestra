// The requirements channel, end to end: what a turn records, what a later turn is
// told, and what survives the projection dropping the file that carried it.
//
// **Nothing here buys a composer round**, and that is the point of the entries these
// flows file: a requirement whose `kind` is not `unplanned_work` lands on the intent
// and stops there. Filing one that does is `raised.test.ts`, which is the same channel
// asked to change the plan.
//
// The claim these are about is *what an agent is handed*, which final state
// cannot see — so they assert on the prompts. The engine's obligation ends at the
// text being there and saying the right thing; whether a model acts on it is a
// question for a real run, and a fake taught to comply would only be asserted to
// have complied.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { composer, composerRuns, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import { act, approveAll, createAndStart, human } from "../support/scenario.js"
import { onPrompt, reply, type AgentLog } from "../support/scripted-agent.js"

const SCOPE = {
  text: "the admin view is out of scope for this trak",
  source: "stated",
  kind: "out_of_scope",
} as const
const TABLET = {
  text: "responsive means phone and desktop",
  source: "assumed",
  kind: "constraint",
} as const

/** Every prompt as one string. Keeps assertions out of a fifth nested callback. */
const allPrompts = (log: AgentLog): string => log.requests.map((r) => r.prompt).join("\n")

/** The step prompts that carried the intent block. Hoisted for the same reason. */
const carryingIntent = (log: AgentLog): readonly string[] =>
  stepRuns(log)
    .map((r) => r.prompt)
    .filter((p) => p.includes("**requirements** were recorded"))

describe("what a later step is told", () => {
  it("hands a step every requirement filed before it, with the stage that recorded it", async () => {
    // The phase's whole point: a step two positions later reads the intent rather
    // than the original request.
    await runFlowWithAgentLog(
      [
        composer("plan", "design", "work"),
        step(1, "plan", reply.deciding("the plan", [SCOPE])),
        step(2, "design", reply.sectioned({ Summary: "how", Steps: "these" })),
        step(3, "work", reply.artifact("done")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const filed = yield* createAndStart(id, "Add a --json flag")
          yield* approveAll(id, filed)

          const work = stepRuns(yield* agentLog).at(-1)?.prompt ?? ""
          expect(work).toContain("**requirements** were recorded")
          expect(work).toContain("- **stated** — the admin view is out of scope for this trak")
          expect(work).toContain("*1-plan.1*")
          // Under the request, because the two together are what is being asked for.
          expect(work.indexOf("Add a --json flag")).toBeLessThan(
            work.indexOf("**requirements** were recorded"),
          )
          // And it reached them without a planning turn: the entry settled something,
          // and the plan already had somewhere for the work to go. One compose, at
          // the start, is what a trak that raised nothing costs.
          expect(composerRuns(yield* agentLog)).toHaveLength(1)
        }),
    )
  })

  it("tells nobody about a channel nobody filled, which is most traks", async () => {
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          // Prompt bodies only — the contract on the session says how to write
          // one, and says so whether or not any exist.
          expect(allPrompts(yield* agentLog)).not.toContain("**requirements** were recorded")
        }),
    )
  })
})

describe("what a step's own later turns are told", () => {
  it("says it once per step and never again, because it cannot change mid-step", async () => {
    // Only an artifact carries requirements and an artifact ends a step, so a chat,
    // a schema re-prompt, a failed check and a restart all sit inside one step
    // with nothing filed between them. This is the assertion that catches a
    // well-meaning addition to a resume template.
    await runFlowWithAgentLog(
      [
        composer("plan", "work"),
        step(1, "plan", reply.deciding("the plan", [SCOPE, TABLET])),
        step(2, "work", reply.artifact("v1")),
        onPrompt(/is the admin view really out/, reply.artifact("v2"), "work chat"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          yield* act(id, 1, human.approve())
          yield* act(id, 2, human.chat("is the admin view really out of scope?"))

          const carrying = carryingIntent(yield* agentLog)
          expect(carrying).toHaveLength(1)
          // And it was the fresh session, not the resume that followed it.
          expect(carrying.at(0)).toContain("artifact named `2-work`")
        }),
    )
  })
})

describe("the accumulated intent", () => {
  it("is derived state, and it outlives a document nothing ever filed", async () => {
    // A step that could not do the work still recorded something directional, and
    // it stays although its account is filed nowhere: what a turn settled is a fact
    // about the conversation, not a property of the document that carried it.
    await runFlowWithAgentLog(
      [
        composer("work", "review"),
        step(1, "work", reply.deciding("v1", [SCOPE])),
        step(2, "review", reply.decidingStuck("two passes over the diff", [TABLET])),
        onPrompt(/have another go/, reply.artifact("no blockers"), "reviewer retries"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const filed = yield* createAndStart(id, "Add a --json flag")
          // Provenance is stamped and the kind is not: it is spent the moment it
          // routes, and this one routed nowhere.
          expect(filed.decisions).toEqual([
            { text: SCOPE.text, source: SCOPE.source, at: "1-work" },
          ])

          // Approving runs the review straight away — no plan was re-cut, because
          // nothing filed said work was missing. It gets stuck and records on its
          // way out.
          const escalated = yield* act(id, 1, human.approve())
          const both = [
            { text: SCOPE.text, source: SCOPE.source, at: "1-work" },
            { text: TABLET.text, source: TABLET.source, at: "2-review" },
          ]
          expect(escalated.decisions).toEqual(both)
          // The account files like any other document; what a later agent is shown is
          // decided on the read side.
          expect(escalated.artifacts.get("2-review")?.sections).toBeDefined()

          // And what was recorded before it reached that step, on the fresh session,
          // which is the only body that carries the intent.
          const chatted = yield* act(id, 2, human.chat("have another go"))
          expect(chatted.decisions).toEqual(both)
          expect(stepRuns(yield* agentLog).at(1)?.prompt).toContain("*1-work.1*")
        }),
    )
  })
})
