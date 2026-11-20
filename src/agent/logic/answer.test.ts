import { describe, expect, it } from "vitest"
import { ProviderEvent } from "../types/provider-event.js"
import { SessionId } from "../types/session.js"
import { answerOf, answering, noAnswer } from "./answer.js"

const said = (text: string, parent?: string) => ProviderEvent.TextDelta({ text, parent })
const never = (): boolean => false
const isEnvelope = (text: string): boolean => text.includes('"type":"artifact"')

describe("answerOf", () => {
  it("a turn that said nothing answered nothing", () => {
    expect(answerOf([])).toBe("")
  })

  it("prefers the provider's own final word over the deltas it is built from", () => {
    const turn = [said("thinking out "), said("loud"), ProviderEvent.Result({ text: "OK" })]
    expect(answerOf(turn)).toBe("OK")
  })

  it("reads the deltas when no answer arrived, which is all a dead turn leaves", () => {
    expect(answerOf([said("half a "), said("sentence")])).toBe("half a sentence")
  })

  it("ignores loose text after a result, because one invocation is no longer one turn", () => {
    // A later turn's words reach the answer as that turn's result or not at all: the
    // deltas would repeat a result that passed, and one the harness withheld is the
    // reply to a message that came after the answer was complete.
    const turn = [
      said("Waiting for background operations to complete..."),
      ProviderEvent.Result({ text: "Waiting for background operations to complete..." }),
      said("done"),
    ]
    expect(answerOf(turn)).toBe("Waiting for background operations to complete...")
  })

  it("leaves a subagent's report to the subagent", () => {
    // `parent` names the delegation the line was written inside. A subagent that
    // reports JSON would otherwise be the last JSON-shaped thing in a turn that failed
    // before answering — which is exactly what `extractJson` would pick up.
    const turn = [said("I will delegate."), said('{"type":"artifact"}', "toolu_01")]
    expect(answerOf(turn)).toBe("I will delegate.")
  })

  it("ignores everything a turn does that is not speech", () => {
    const noise = [
      ProviderEvent.Spawned({ pid: 42 }),
      ProviderEvent.Thinking({ tokens: 900, text: undefined }),
      ProviderEvent.ToolResult({ ok: true, call: undefined, parent: undefined }),
      ProviderEvent.Unknown({ raw: { type: "something/new" } }),
    ]
    expect(answerOf(noise)).toBe("")
  })

  it("keeps the session the provider announced, first announcement winning", () => {
    // A re-ask resumes by this id. Claude re-announces the same one when it picks the
    // session back up; a provider that announced a different one would be one whose
    // first conversation is the one the turn was in.
    const first = SessionId.make("01a0afa1-c237-7380-9bad-2c0a466452f2")
    const turn = [
      ProviderEvent.SessionStarted({ id: first }),
      said("hello"),
      ProviderEvent.Result({ text: "hello" }),
      ProviderEvent.SessionStarted({ id: SessionId.make("ffffffff-ffff-4fff-8fff-ffffffffffff") }),
    ]
    expect(turn.reduce(answering(never), noAnswer)).toEqual({
      ...noAnswer,
      text: "hello",
      answered: true,
      settled: false,
      session: first,
    })
  })

  it("folds one event at a time onto what came before", () => {
    // `answering` is what the stream calls per event, so the incremental form has to
    // agree with the whole-turn one — a turn that dies mid-flight is read from the
    // accumulator and never reaches `answerOf`.
    const turn = [said("a"), said("b")]
    expect(turn.reduce(answering(never), noAnswer).text).toBe(answerOf(turn))
  })
})

describe("answering — a turn that ends more than once", () => {
  const envelope = '```json\n{"type":"artifact"}\n```'

  it("joins every result in order when none of them settles", () => {
    // The sentence written before the wait and the report written after it are one
    // answer. Keeping the first alone files "waiting".
    const turn = [
      ProviderEvent.Result({ text: "Waiting for verify." }),
      ProviderEvent.Result({ text: "Verify passed; here is the report." }),
      ProviderEvent.Result({ text: "" }),
      ProviderEvent.Result({ text: "done" }),
    ]
    expect(answerOf(turn)).toBe("Waiting for verify.\n\nVerify passed; here is the report.\n\ndone")
  })

  it("answers with the settling result alone, whatever was said while waiting", () => {
    // The words around an envelope are drawn as its brief, which must not open with
    // what the agent said before the work it waited on had ended.
    const turn = [
      ProviderEvent.Result({ text: "Waiting for verify." }),
      ProviderEvent.Result({ text: `Verify passed.\n\n${envelope}` }),
    ]
    expect(turn.reduce(answering(isEnvelope), noAnswer)).toMatchObject({
      text: `Verify passed.\n\n${envelope}`,
      settled: true,
    })
  })

  it("reads nothing after the result that settled", () => {
    const turn = [
      ProviderEvent.Result({ text: envelope }),
      said("The task was stopped."),
      ProviderEvent.Result({ text: "done" }),
    ]
    expect(turn.reduce(answering(isEnvelope), noAnswer).text).toBe(envelope)
  })

  it("names the tasks alive at the settling result as the ones it stopped", () => {
    const verify = { id: "bq7", taskType: "local_bash", description: "pnpm verify" }
    const lint = { id: "c41", taskType: "local_bash", description: undefined }
    const turn = [
      ProviderEvent.BackgroundTasks({ tasks: [verify, lint] }),
      ProviderEvent.Result({ text: "Waiting on both." }),
      // The level is the whole answer each time: `lint` ended, so it was not stopped.
      ProviderEvent.BackgroundTasks({ tasks: [verify] }),
      ProviderEvent.Result({ text: envelope }),
      ProviderEvent.BackgroundTasks({ tasks: [] }),
    ]
    expect(turn.reduce(answering(isEnvelope), noAnswer).stopped).toEqual([verify])
  })

  it("stopped nothing where the work had ended, or where no result settled", () => {
    const verify = { id: "bq7", taskType: "local_bash", description: "pnpm verify" }
    const waited = [
      ProviderEvent.BackgroundTasks({ tasks: [verify] }),
      ProviderEvent.Result({ text: "Waiting." }),
      ProviderEvent.BackgroundTasks({ tasks: [] }),
      ProviderEvent.Result({ text: envelope }),
    ]
    expect(waited.reduce(answering(isEnvelope), noAnswer).stopped).toEqual([])
    const prose = [
      ProviderEvent.BackgroundTasks({ tasks: [verify] }),
      ProviderEvent.Result({ text: "Waiting." }),
    ]
    expect(prose.reduce(answering(isEnvelope), noAnswer).stopped).toEqual([])
  })
})
