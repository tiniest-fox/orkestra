// A person editing a proposed plan at its gate, through the route that takes the press.
//
// The edits ride the `Approve` and are laid over the proposal as it is taken, so the
// theme is two halves: what the plan and the next step look like after an edited
// approval, and every edit the route refuses — each with the log left exactly as it
// was, because a refusal that still appended is the bug wearing a hat.

import { seedLog } from "../support/seed.js"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { toWeb, type HttpServerResponse } from "@effect/platform/HttpServerResponse"
import type { PlanEditsDto } from "@orkestra/shared/dto/actions"
import { RefusalDto } from "@orkestra/shared/dto/common"
import { TrakDetailDto } from "@orkestra/shared/dto/trak"
import { SessionId } from "../../src/agent/types/session.js"
import { BranchName, CommitSha, WorktreePath } from "../../src/vcs/index.js"
import { type Event, Events } from "../../src/workflow/domain/event.js"
import { Actions } from "../../src/workflow/domain/human-action.js"
import { proposal } from "../../src/workflow/domain/outputs/proposal.js"
import type { TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import {
  child,
  childStep,
  composer,
  composerStopping,
  piece,
  runFlow,
  runFlowWithAgentLog,
  spawn,
  step,
  stepRuns,
} from "../support/flow.js"
import { mount } from "../support/http.js"
import { actionRoutes } from "../../src/app/routes/actions.js"
import { trakRoutes } from "../../src/app/routes/trak.js"
import { create, idle, logged } from "../support/scenario.js"
import { library } from "../support/library.js"
import { reply } from "../support/scripted-agent.js"

const { get, post } = mount(actionRoutes, trakRoutes)

/** `0-compose` ran; the proposal is `1-plan`, `2-work`, and a review continuing `2-work`. */
const THREE = composer("plan", "work", {
  agent: "review",
  instruction: "Review it.",
  continues: "2-work",
})

const eventsOf = (id: TrakId) => Effect.flatMap(Store, (store) => store.events(id))

/** The index of the proposal on the table — what the press names. */
const proposalAt = (id: TrakId) =>
  Effect.map(eventsOf(id), (events) => events.findLastIndex((e) => e._tag === "ComposerReturned"))

/** The first event of one kind in a log. */
const firstOf = <T extends Event["_tag"]>(
  events: readonly Event[],
  tag: T,
): Extract<Event, { readonly _tag: T }> | undefined =>
  events.find((e): e is Extract<Event, { readonly _tag: T }> => e._tag === tag)

const approveWith = (id: TrakId, edits: PlanEditsDto) =>
  post(id, "act", { action: "approve", edits })

const bodyOf = (response: HttpServerResponse) =>
  Effect.promise(async (): Promise<unknown> => {
    const parsed: unknown = JSON.parse(await toWeb(response).text())
    return parsed
  })

/**
 * The refusal a press earned, and that the log did not move for it. The edits are made
 * over the proposal at the gate unless `over` names another.
 */
const refused = (id: TrakId, steps: PlanEditsDto["steps"], over?: number) =>
  Effect.gen(function* () {
    const before = (yield* eventsOf(id)).length
    const response = yield* approveWith(id, {
      proposal: over ?? (yield* proposalAt(id)),
      steps,
    })
    expect((yield* eventsOf(id)).length).toBe(before)
    const refusal = Schema.decodeUnknownSync(RefusalDto)(yield* bodyOf(response))
    return {
      status: response.status,
      refusal: refusal._tag,
      reason: refusal._tag === "PlanRefused" ? refusal.reason : "",
    }
  })

describe("approving a plan with edits", () => {
  it("runs the edited plan: the removed step gone, the tail renumbered, continues re-pointed", async () => {
    await runFlowWithAgentLog(
      [THREE, step(1, "work", reply.artifact("the smaller change"))],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          const response = yield* approveWith(id, {
            proposal: yield* proposalAt(id),
            steps: [
              { edit: "remove", at: 1 },
              { edit: "instruction", at: 2, instruction: "Do the smaller change." },
            ],
          })
          expect(response.status).toBe(202)
          yield* idle(id)

          const detail = Schema.decodeUnknownSync(TrakDetailDto)(
            yield* bodyOf(yield* get(`/${id}`)),
          )
          expect(detail.plan?.steps).toMatchObject([
            { type: "compose" },
            { type: "agent", agent: "work", instruction: "Do the smaller change." },
            { type: "agent", agent: "review", continues: "1-work" },
          ])
          // The step at the new `1-work` is the one that ran, told the person's words.
          expect(stepRuns(yield* agentLog).at(-1)?.prompt).toContain("Do the smaller change.")
          // The composer's own answer is untouched; the edits ride the press.
          const events = yield* eventsOf(id)
          expect(firstOf(events, "ComposerReturned")?.output).toMatchObject({
            steps: [{ agent: "plan" }, { agent: "work" }, { agent: "review" }],
          })
          expect(firstOf(events, "HumanActed")?.action).toStrictEqual(
            Actions.approve([
              { _tag: "Remove", at: 1 },
              { _tag: "Reword", at: 2, instruction: "Do the smaller change." },
            ]),
          )
        }),
    )
  })
})

/** `0-compose` ran; the proposal is `1-work` and a review continuing it. */
const WORK_THEN_REVIEW = composer("work", {
  agent: "review",
  instruction: "Review it.",
  continues: "1-work",
})

/** The fixture fleet, with an effort `models.yaml` declares for `haiku`. */
const HAIKU_LOW = library({
  models: { ...library().models, efforts: new Map([["haiku", "low"]]) },
})

describe("approving a plan with agents and models changed", () => {
  it("runs a swapped step as its new agent on that agent's model, and keeps the conversation continuing it", async () => {
    await runFlowWithAgentLog(
      [
        WORK_THEN_REVIEW,
        step(1, "plan", reply.artifact("the plan")),
        step(2, "review", reply.artifact("looks right")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          const response = yield* approveWith(id, {
            proposal: yield* proposalAt(id),
            steps: [{ edit: "agent", at: 1, agent: "plan" }],
          })
          expect(response.status).toBe(202)
          yield* idle(id)
          expect((yield* post(id, "act", { action: "approve" })).status).toBe(202)
          yield* idle(id)

          const detail = Schema.decodeUnknownSync(TrakDetailDto)(
            yield* bodyOf(yield* get(`/${id}`)),
          )
          expect(detail.plan?.steps).toMatchObject([
            { type: "compose" },
            { type: "agent", agent: "plan", model: "opus" },
            { type: "agent", agent: "review", continues: "1-plan", model: "opus" },
          ])
          const [swapped, review] = stepRuns(yield* agentLog)
          // `plan` is `opus`, where `work` — what the composer proposed — is `sonnet`.
          expect(swapped?.model).toBe("opus")
          expect(swapped?.prompt).toContain("Plan it.")
          // The review still picks up the conversation the swapped step started.
          expect(review?.resumeFrom).toBe(swapped?.sessionId)
          expect(review?.model).toBe("opus")
        }),
    )
  })

  it("runs a picked model at that model's own effort", async () => {
    await runFlowWithAgentLog(
      [composer("work"), step(1, "work", reply.artifact("done"))],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          const response = yield* approveWith(id, {
            proposal: yield* proposalAt(id),
            steps: [{ edit: "model", at: 1, model: "haiku" }],
          })
          expect(response.status).toBe(202)
          yield* idle(id)
          const [run] = stepRuns(yield* agentLog)
          expect(run?.model).toBe("haiku")
          expect(run?.effort).toBe("low")
          const events = yield* eventsOf(id)
          expect(firstOf(events, "HumanActed")?.action).toStrictEqual(
            Actions.approve([{ _tag: "PickModel", at: 1, model: "haiku" }]),
          )
        }),
      HAIKU_LOW,
    )
  })
})

describe("swaps and picks the act route refuses", () => {
  it("refuses a model on a step locked to the conversation it continues", async () => {
    await runFlow([WORK_THEN_REVIEW], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        const answer = yield* refused(id, [{ edit: "model", at: 2, model: "haiku" }])
        expect(answer.status).toBe(422)
        expect(answer.reason).toContain("2-review continues `1-work`")
      }),
    )
  })

  it("refuses a model models.yaml does not list", async () => {
    await runFlow([THREE], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        const answer = yield* refused(id, [{ edit: "model", at: 1, model: "gpt-9" }])
        expect(answer.status).toBe(422)
        expect(answer.reason).toContain("gpt-9")
      }),
    )
  })

  it("refuses a swap or a model on a compose entry", async () => {
    await runFlow([composerStopping("which service owns it", "plan")], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        const swap = yield* refused(id, [{ edit: "agent", at: 2, agent: "work" }])
        expect(swap.status).toBe(422)
        expect(swap.reason).toContain("no agent to swap")
        const pick = yield* refused(id, [{ edit: "model", at: 2, model: "opus" }])
        expect(pick.reason).toContain("no model to pick")
      }),
    )
  })

  it("refuses a swap to an agent no plan may name, in the composer's own words", async () => {
    await runFlow([THREE], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        const unknown = yield* refused(id, [{ edit: "agent", at: 1, agent: "nobody" }])
        expect(unknown.status).toBe(422)
        expect(unknown.reason).toContain("unknown agent(s): nobody")
        // The engine's own agent opens chats and is on no plan.
        const generic = yield* refused(id, [{ edit: "agent", at: 1, agent: "generic" }])
        expect(generic.reason).toContain("unknown agent(s): generic")
      }),
    )
  })

  it("refuses a swap that puts a writer after a step waiting on the merge", async () => {
    const lib = library()
    const review = lib.agents.get("review")
    if (review === undefined) throw new Error("the fixture fleet lost its `review` agent")
    const waiting = {
      ...lib,
      agents: new Map(lib.agents).set("review", { ...review, conditions: ["merged"] }),
    }
    await runFlow(
      [composer("plan", "review", "plan")],
      (id) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          const answer = yield* refused(id, [{ edit: "agent", at: 3, agent: "work" }])
          expect(answer.status).toBe(422)
          expect(answer.reason).toContain("`work`")
        }),
      waiting,
    )
  })

  it("refuses edits sent with an approval at a step's gate", async () => {
    await runFlow([THREE, step(1, "plan", reply.artifact("the plan"))], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        yield* post(id, "act", { action: "approve" })
        yield* idle(id)
        const answer = yield* refused(id, [{ edit: "agent", at: 2, agent: "design" }])
        expect(answer).toStrictEqual({ status: 409, refusal: "ProposalMoved", reason: "" })
      }),
    )
  })
})

describe("edits the act route refuses", () => {
  it("refuses every step removed", async () => {
    await runFlow([THREE], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        const answer = yield* refused(id, [
          { edit: "remove", at: 1 },
          { edit: "remove", at: 2 },
          { edit: "remove", at: 3 },
        ])
        expect(answer.status).toBe(422)
        expect(answer.refusal).toBe("PlanRefused")
        expect(answer.reason).toContain("every step")
      }),
    )
  })

  it("refuses a plan left holding nothing but a compose, in the composer's own words", async () => {
    await runFlow([composerStopping("which service owns it", "plan")], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        const answer = yield* refused(id, [{ edit: "remove", at: 1 }])
        expect(answer.status).toBe(422)
        expect(answer.refusal).toBe("PlanRefused")
        expect(answer.reason).toContain("a plan of nothing but a compose does no work")
      }),
    )
  })

  it("refuses a continues naming no earlier agent step", async () => {
    await runFlow([THREE], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        const answer = yield* refused(id, [{ edit: "continues", at: 3, key: "9-nothing" }])
        expect(answer.status).toBe(422)
        expect(answer.refusal).toBe("PlanRefused")
        expect(answer.reason).toContain("9-nothing")
      }),
    )
  })

  it("refuses edits made against a proposal the composer has since replaced", async () => {
    // Seeded rather than driven: a chat at the gate and the composer's second answer
    // are all this needs, and the log is what the route reads.
    const sid = SessionId.make("00000000-0000-4000-8000-000000000001")
    const first = proposal("one", [{ agent: "plan", instruction: "Plan it." }])
    const second = proposal("two", [
      { agent: "plan", instruction: "Plan it." },
      { agent: "work", instruction: "Do it." },
    ])
    await runFlow([], (id) =>
      Effect.gen(function* () {
        yield* seedLog(yield* Store, id, [
          Events.trakCreated("d"),
          Events.worktreeReady({
            path: WorktreePath.make("/tmp/wt"),
            branch: BranchName.make("trak/t"),
            base: CommitSha.make("base000"),
          }),
          Events.composerReturned(sid, first),
          Events.humanActed(0, Actions.chat("add the work")),
          Events.composerReturned(sid, second),
        ])
        const answer = yield* refused(
          id,
          [{ edit: "instruction", at: 1, instruction: "Plan it smaller." }],
          2,
        )
        expect(answer).toStrictEqual({ status: 409, refusal: "ProposalMoved", reason: "" })
      }),
    )
  })
})

/** `0-compose` ran; the proposal is `1-spawn`: a piece that works then reviews, and one review. */
const PIECES = composer(spawn(piece("security", "work", "review"), child("review", "speed")))

/** Hoisted, for `max-nested-callbacks`. */
const returned = (tags: readonly string[]): boolean => tags.includes("AgentReturned")
const toldThePlan = (r: { readonly prompt: string }): boolean =>
  r.prompt.includes("Produce the plan for security.")

describe("approving a spawn with its pieces edited", () => {
  it("births the child with the edited plan, and runs its step on the model picked for it", async () => {
    await runFlowWithAgentLog(
      [
        PIECES,
        childStep("plan", "security", reply.artifact("the plan")),
        childStep("review", "speed", reply.artifact("fast enough")),
      ],
      (id, agentLog) =>
        Effect.gen(function* () {
          yield* create(id, "d")
          const response = yield* approveWith(id, {
            proposal: yield* proposalAt(id),
            steps: [
              {
                edit: "pieceInstruction",
                at: 1,
                piece: 0,
                step: 0,
                instruction: "Produce the plan for security.",
              },
              { edit: "pieceAgent", at: 1, piece: 0, step: 0, agent: "plan" },
              { edit: "pieceModel", at: 1, piece: 0, step: 0, model: "haiku" },
              { edit: "pieceRemove", at: 1, piece: 0, step: 1 },
            ],
          })
          expect(response.status).toBe(202)
          yield* idle(id)
          const spawned = firstOf(yield* eventsOf(id), "ChildrenSpawned")
          const security = spawned?.ids[0]
          if (security === undefined) return yield* Effect.die("the spawn minted no child")
          yield* logged(security, returned)

          expect(firstOf(yield* eventsOf(security), "TrakCreated")?.plan?.steps).toStrictEqual([
            { agent: "plan", instruction: "Produce the plan for security.", model: "haiku" },
          ])
          const run = stepRuns(yield* agentLog).find(toldThePlan)
          expect(run?.model).toBe("haiku")
        }),
    )
  })

  it("refuses removing a piece's last remaining step, and takes a model picked for one", async () => {
    await runFlow([PIECES], (id) =>
      Effect.gen(function* () {
        yield* create(id, "d")
        const answer = yield* refused(id, [{ edit: "pieceRemove", at: 1, piece: 1, step: 0 }])
        expect(answer.status).toBe(422)
        expect(answer.reason).toContain("piece 2 of 1-spawn would have no steps left")
        // A pick is the person's, so the composer's decode of the edited plan does not
        // read it as the composer's.
        expect(
          (yield* approveWith(id, {
            proposal: yield* proposalAt(id),
            steps: [{ edit: "pieceModel", at: 1, piece: 1, step: 0, model: "haiku" }],
          })).status,
        ).toBe(202)
      }),
    )
  })
})
