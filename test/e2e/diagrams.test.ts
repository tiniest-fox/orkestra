// Flows where an artifact carries a mermaid diagram that does not parse. The parser
// is faked: it refuses one source and accepts every other, so each flow says which
// diagram is the bad one rather than depending on mermaid's grammar.

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { composerRuns, runFlow, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import { diagramsRefusing } from "../support/diagrams.js"
import {
  approveAll,
  countTag,
  create,
  createAndStart,
  expectState,
  sectionOf,
  transcriptTags,
} from "../support/scenario.js"
import { always, onPrompt, onResume, reply } from "../support/scripted-agent.js"

const BAD = "flowchart TD\n  A -->"
const GOOD = "flowchart TD\n  A --> B"
const PARSER = "Parse error on line 2: expecting NODE_STRING, got EOF"

const TICKS = "```"
const fenced = (source: string): string =>
  ["Here is the flow.", "", `${TICKS}mermaid`, source, TICKS, ""].join("\n")

const refusingBad = diagramsRefusing({ [BAD]: PARSER })

describe("a step artifact with a diagram that does not parse", () => {
  it("is re-asked in the same session with the parser's words, and the correction is filed", async () => {
    await runFlowWithAgentLog(
      [
        onPrompt(
          /Compose a pipeline/,
          reply.proposal("Draw it", [{ agent: "work", instruction: "draw it" }]),
          "compose",
        ),
        step(1, "work", reply.artifact(fenced(BAD))),
        onResume(reply.artifact(fenced(GOOD)), "corrected"),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const done = yield* approveAll(id, yield* create(id, "Draw the flow"))
          expectState(done, "Finished")
          expect(sectionOf(done, "1-work")).toBe(fenced(GOOD))
          // The re-ask happened below the engine: one ending, one iteration.
          expect(yield* countTag(id, "AgentReturned")).toBe(1)
          expect(yield* transcriptTags(id)).toContain("Reask")

          const [first, retry] = stepRuns(yield* agentLog)
          expect(retry?.resumeFrom).toBe(first?.sessionId)
          expect(retry?.prompt).toContain('section "Summary"')
          expect(retry?.prompt).toContain(PARSER)
        }).pipe(Effect.provide(refusingBad)),
    )
  })

  it("fails the step as an exhausted elicit after three unparseable answers", async () => {
    await runFlowWithAgentLog(
      [
        onPrompt(
          /Compose a pipeline/,
          reply.proposal("Draw it", [{ agent: "work", instruction: "draw it" }]),
          "compose",
        ),
        always(reply.artifact(fenced(BAD))),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const trak = yield* createAndStart(id, "Draw the flow")
          expect(trak.state).toMatchObject({ _tag: "Failed", kind: "agent" })
          const { error } = trak.state._tag === "Failed" ? trak.state : { error: "" }
          expect(error).toContain("no usable output after 3 attempts")
          expect(error).toContain(PARSER)
          expect(stepRuns(yield* agentLog)).toHaveLength(3)
        }).pipe(Effect.provide(refusingBad)),
    )
  })

  it("is not refused for a mermaid example shown inside a longer fence", async () => {
    await runFlow(
      [
        onPrompt(
          /Compose a pipeline/,
          reply.proposal("Draw it", [{ agent: "work", instruction: "draw it" }]),
          "compose",
        ),
        step(
          1,
          "work",
          reply.artifact(
            ["Write it like this:", `${TICKS}\`md`, fenced(BAD), `${TICKS}\``].join("\n"),
          ),
        ),
      ],
      (id) =>
        Effect.gen(function* () {
          const done = yield* approveAll(id, yield* create(id, "Show the syntax"))
          expectState(done, "Finished")
          expect(yield* transcriptTags(id)).not.toContain("Reask")
        }).pipe(Effect.provide(refusingBad)),
    )
  })
})

describe("a composer turn with a diagram that does not parse", () => {
  it("is not re-asked: only step artifacts are checked", async () => {
    await runFlowWithAgentLog(
      [
        onPrompt(
          /Compose a pipeline/,
          reply.proposal("Draw it", [{ agent: "work", instruction: fenced(BAD) }]),
          "compose",
        ),
        step(1, "work", reply.artifact("drawn")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          const done = yield* approveAll(id, yield* create(id, "Draw the flow"))
          expectState(done, "Finished")
          expect(composerRuns(yield* agentLog)).toHaveLength(1)
          expect(yield* transcriptTags(id)).not.toContain("Reask")
        }).pipe(Effect.provide(refusingBad)),
    )
  })
})
