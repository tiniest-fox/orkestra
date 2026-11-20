// The Provider port's contract, written once and run against every
// implementation — scripted, claude, codex, and later opencode.
//
// This is how two providers stay honest: adding one means making an existing
// suite pass, not writing new tests.

import { BuiltinPromptsLayer } from "../../src/prompts/adapters/builtin.js"
import { TEMPLATES } from "../../src/app/packaged.js"
import type { Prompts } from "../../src/prompts/ports/prompts.js"
import { Effect, Layer, Stream } from "effect"
import { describe, expect, it } from "vitest"
import {
  ACTIVITY_KINDS,
  type ApiErrorKind,
  type ProviderEvent,
} from "../../src/agent/types/provider-event.js"
import { Provider, supportsSessionHandoff } from "../../src/agent/ports/provider.js"
import { SessionId, type SessionRequest } from "../../src/agent/types/session.js"
import { Transcript } from "../../src/agent/ports/transcript.js"
import { elicit } from "../../src/agent/interactions/elicit.js"
import { StepOutput } from "../../src/workflow/domain/outputs/step-output.js"

export interface ProviderUnderTest {
  readonly label: string
  readonly layer: Layer.Layer<Provider>
  /**
   * The model name that selects this implementation — the registry indexes by it,
   * so a qualified name is how a second CLI's arm reaches its own adapter.
   */
  readonly model: string
  /** A prompt that should make this provider emit a valid StepOutput. */
  readonly artifactPrompt: string
  /** Real providers need generous timeouts; fakes are instant. */
  readonly timeoutMs: number
  /**
   * A declared capability, in the same spirit as `supportsSessionHandoff`: how
   * to make this provider report an error **in-band** — a turn it says failed
   * while the process itself exits cleanly — and a fragment of that report which
   * has to survive into `ProviderFailed.reason`.
   *
   * `undefined` for an implementation that has no such shape: the scripted fake
   * fails by construction rather than by reporting anything, and a real CLI
   * cannot be asked to error on demand. Declaring it is how a fixture-driven
   * provider opts the case in — the alternative, branching on `p.label`, is the
   * design smell the testing-tiers skill names.
   */
  readonly inBandFailure?: {
    readonly prompt: string
    readonly reasonIncludes: string
    /** What the shared vocabulary should call it — the mapping is the contract. */
    readonly errorKind: ApiErrorKind
  }
  /**
   * Whether this provider reports the model reasoning before it answers. A
   * declared capability rather than a branch on `p.label`, for the reason above:
   * a provider that never emits `Thinking` is not broken, and one that does must
   * not report it as `Unknown` — which is what every Claude turn did until the
   * event existed.
   *
   * The classification of an in-band failure is asserted through `inBandFailure`
   * instead, because a provider that can fail in-band can always be asked what
   * *kind* of failure it just reported.
   */
  readonly reportsThinking: boolean
}

const request = (model: string, prompt: string): SessionRequest => ({
  prompt,
  cwd: process.cwd(),
  model,
  sessionId: SessionId.make("33333333-3333-4333-8333-333333333333"),
  toolAccess: "read-only",
  permission: "read",
  resumeFrom: undefined,
  inherited: false,
  effort: undefined,
  brief: undefined,
  env: {},
})

const NoTranscript = Layer.succeed(Transcript, { record: () => Effect.void })

/**
 * How to run one turn against the implementation under test, separated from what
 * is asserted about it. Split out when the suite grew past
 * `max-lines-per-function` — which was the rule making a real point: running a
 * provider and judging one are two jobs, and only the second is the contract.
 */
const harness = (p: ProviderUnderTest) => {
  const run = <A, E>(e: Effect.Effect<A, E, Provider | Transcript | Prompts>): Promise<A> =>
    Effect.runPromise(
      Effect.scoped(
        e.pipe(
          Effect.timeout(`${p.timeoutMs} millis`),
          Effect.provide(Layer.mergeAll(p.layer, NoTranscript, BuiltinPromptsLayer(TEMPLATES))),
        ),
      ),
    )

  /** One turn's events. Said once: four cases below collect exactly this. */
  const eventsFor = (prompt: string): Promise<readonly ProviderEvent[]> =>
    run(
      Effect.gen(function* () {
        const provider = yield* Provider
        const collected = yield* Stream.runCollect(provider.run(request(p.model, prompt)))
        return [...collected]
      }),
    )

  return {
    run,
    eventsFor,
    tagsFor: async (prompt: string): Promise<readonly string[]> =>
      (await eventsFor(prompt)).map((e) => e._tag),
  }
}

/** Run this against any Provider implementation. */
export const providerContract = (p: ProviderUnderTest): void => {
  const { run, eventsFor, tagsFor } = harness(p)

  describe(`Provider contract — ${p.label}`, () => {
    it(
      "declares a resume strategy, so callers can tell whether handoff is possible",
      async () => {
        const strategy = await run(Effect.map(Provider, (a) => a.resumeFor(p.model)?._tag))
        expect(["SuppliedId", "ReportedId", "ContinueLast"]).toContain(strategy)
      },
      p.timeoutMs + 5000,
    )

    it(
      "emits a Result event",
      async () => {
        const tags = await tagsFor(p.artifactPrompt)
        expect(tags).toContain("Result")
      },
      p.timeoutMs + 5000,
    )

    // Unconditional over a list that may be empty: a provider whose turn reached for
    // nothing is not in breach, and one that did owes both halves. `name` is what the
    // record counts by; `kind` is what a second provider maps its own vocabulary onto.
    it(
      "gives every tool call a provider name and a kind from the shared vocabulary",
      async () => {
        const tools = (await eventsFor(p.artifactPrompt)).filter((e) => e._tag === "ToolUse")
        expect(tools.map((e) => e.name).filter((name) => name === "")).toEqual([])
        expect(tools.map((e) => e.kind).filter((kind) => !ACTIVITY_KINDS.includes(kind))).toEqual(
          [],
        )
      },
      p.timeoutMs + 5000,
    )

    it(
      "never emits an ApiError for a benign prompt",
      async () => {
        const tags = await tagsFor(p.artifactPrompt)
        expect(tags).not.toContain("ApiError")
      },
      p.timeoutMs + 5000,
    )

    it.skipIf(!p.reportsThinking)(
      "reports thinking as Thinking, never as Unknown",
      async () => {
        const tags = await tagsFor(p.artifactPrompt)
        // Both halves matter. The first is the capability; the second is the
        // regression, because "modelled" and "still falling through to Unknown"
        // are indistinguishable from the first assertion alone.
        expect(tags).toContain("Thinking")
        expect(tags).not.toContain("Unknown")
      },
      p.timeoutMs + 5000,
    )

    const inBand = p.inBandFailure

    it.skipIf(inBand === undefined)(
      "fails the turn when it reports an error in-band, after emitting it",
      async () => {
        // `Stream.either` keeps the events AND the failure, which is the whole
        // assertion: the ApiError has to reach a consumer — `withTranscript` is
        // one — before the stream gives up, or a failed turn leaves no trace of
        // why. Collecting normally would prove only the second half.
        const outcome = await run(
          Effect.gen(function* () {
            const provider = yield* Provider
            const collected = yield* Stream.runCollect(
              Stream.either(provider.run(request(p.model, inBand?.prompt ?? ""))),
            )
            return [...collected]
          }),
        )
        const emitted = outcome.flatMap((e) => (e._tag === "Right" ? [e.right] : []))
        const failures = outcome.flatMap((e) => (e._tag === "Left" ? [e.left] : []))

        expect(emitted.map((e) => e._tag)).toContain("ApiError")
        // The kind, not just the sentence: an unclassified failure is the honest
        // answer for a message shape nobody has seen, but a provider that can be
        // asked to fail on demand knows what it asked for, so `unclassified` here
        // means the classifier stopped recognising its own vocabulary.
        const reported = emitted.find((e) => e._tag === "ApiError")
        expect(reported?._tag === "ApiError" ? reported.kind : undefined).toBe(
          inBand?.errorKind ?? "unclassified",
        )
        // Not `ElicitFailed`, and not a clean end of stream: a transport problem
        // must stay retryable rather than reading as the agent's verdict.
        expect(failures.map((e) => e._tag)).toEqual(["ProviderFailed"])
        expect(failures[0]?.reason).toContain(inBand?.reasonIncludes ?? "")
        // And the kind rides with it. The event is gone by the time anything above
        // the harness looks, so a classification the failure does not carry is one
        // the engine cannot record and no surface can ever name.
        expect(failures[0]?.kind).toBe(inBand?.errorKind)
      },
      p.timeoutMs + 5000,
    )

    it(
      "produces a value that decodes against a schema, via elicit",
      async () => {
        const out = await run(elicit(StepOutput, request(p.model, p.artifactPrompt)))
        expect(out.value.type).toBe("artifact")
      },
      p.timeoutMs + 5000,
    )

    it(
      "reports the session it ran in when it can",
      async () => {
        const events = await eventsFor(p.artifactPrompt)
        const started = events.find(
          (e): e is Extract<ProviderEvent, { _tag: "SessionStarted" }> =>
            e._tag === "SessionStarted",
        )
        // A handoff-capable provider MUST report the session, or `--resume <id>`
        // has nothing to point at. One that resumes by "last session" needn't.
        const strategy = await run(Effect.map(Provider, (a) => a.resumeFor(p.model)))
        const handoff = strategy !== undefined && supportsSessionHandoff(strategy)
        expect(started !== undefined || !handoff).toBe(true)
      },
      p.timeoutMs + 5000,
    )
  })
}
