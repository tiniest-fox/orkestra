// Checks, end to end: an agent declares them, the engine runs them between an
// artifact and its gate, and a failure comes back to the step that caused it.
//
// The composer does not choose these — the `work` agent declares them, so each
// test states its policy rather than its plan. What a check DOES is scripted per
// test: running `bash` is the shell adapter's contract, and
// `test/contract/checks.ts` covers that against the real thing.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Deferred, Effect } from "effect"
import { afterAll, describe, expect, it } from "vitest"
import type { Check } from "../../src/library/types/check.js"
import { composer, runFlowWithAgentLog, step, stepRuns } from "../support/flow.js"
import {
  act,
  create,
  createAndStart,
  expectAwaiting,
  expectState,
  human,
  idle,
  logged,
  logTags,
  sectionOf,
} from "../support/scenario.js"
import { workDeclaring } from "../support/library.js"
import { type ChecksLog, fail, hangs, pass, proving } from "../support/scripted-checks.js"
import { onPromptAfter, onResume, reply } from "../support/scripted-agent.js"
import { Drives } from "../../src/app/drive.js"
import { type Event, Events } from "../../src/workflow/domain/event.js"
import { replayHistory } from "../../src/workflow/domain/replay.js"
import type { Trak, TrakId } from "../../src/workflow/domain/trak.js"
import { Store } from "../../src/workflow/ports/store.js"
import { advance } from "../../src/workflow/runtime.js"

const VERIFY: Check = {
  name: "verify",
  description: "Runs the project's own verification.",
  timeoutSeconds: 60,
  askedEverySeconds: undefined,
  exclusive: false,
  cache: true,
  ignoresLinguistGenerated: false,
  units: undefined,
  cacheAcross: "platform" as const,
  path: "/repo/.orkestra/checks/verify.sh",
}

const CHECKS = new Map([
  ["verify", VERIFY],
  [
    "no-secrets",
    {
      name: "no-secrets",
      description: "Nothing that looks like a credential reached the tree.",
      timeoutSeconds: 30,
      askedEverySeconds: undefined,
      exclusive: false,
      cache: true,
      ignoresLinguistGenerated: false,
      units: undefined,
      cacheAcross: "platform" as const,
      path: "/repo/.orkestra/checks/no-secrets.sh",
    },
  ],
])

/**
 * A fleet whose `work` agent declares the given checks.
 *
 * Checks are policy, not plan. The fleet is passed as the library to each flow,
 * which is why every test below hands `runFlowWithAgentLog` a different one — that
 * IS the thing under test.
 */
const declaring = (...checks: readonly string[]) => workDeclaring(checks, { checks: CHECKS })

/** Hoisted predicates and projections: a callback inline in a flow body is one too many. */
const hasComposed = (tags: readonly string[]): boolean => tags.includes("ComposerReturned")
const marksOf = (t: Trak): readonly (readonly [number, string])[] =>
  [...t.marks].map(([at, m]) => [at, m._tag])
const bornAuto = (): Event => Events.trakCreated("Add a --json flag", undefined, "auto")
const isChecksPassed = (e: Event): boolean => e._tag === "ChecksPassed"
const eventsOf = (id: TrakId) => Effect.flatMap(Store, (s) => s.events(id))

/** The one-step plan every test here runs. What differs is the agent's policy. */
const planned = composer("work")

/**
 * The step's answer to a check failure.
 *
 * Matched on `resumeFrom` rather than on the prompt, because a resume prompt
 * deliberately does not repeat "produce the artifact named `1-work`" — it
 * carries only what is new. That the retry matches this at all is itself the
 * assertion that the session was resumed.
 */
const retry = (content: string, label = "retry") => onResume(reply.artifact(content), label)

describe("checks that pass", () => {
  it("run before the gate, and the human sees the artifact as usual", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("Added --json"))],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expectAwaiting(parked, "approval")
          expect(sectionOf(parked, "1-work")).toBe("Added --json")
          expect((yield* checks).ran).toEqual(["verify"])

          // The log says verification happened. That is the point of recording
          // a pass at all — final state alone cannot tell it from a step that
          // declared no checks.
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
          ])

          expectState(yield* act(id, 1, human.approve()), "Finished")
        }),
      declaring("verify"),
      { verify: [pass] },
    )
  })

  it("run in the order the agent declared them", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("done"))],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          expect((yield* checks).ran).toEqual(["no-secrets", "verify"])
        }),
      declaring("no-secrets", "verify"),
      {},
    )
  })

  it("stop at the first failure — the later ones are not run", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("v1")), retry("v2")],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          // First pass over the list stops at `no-secrets`; the retry gets
          // through it and reaches `verify`.
          expect((yield* checks).ran).toEqual(["no-secrets", "no-secrets", "verify"])
        }),
      declaring("no-secrets", "verify"),
      { "no-secrets": [fail("found an api_key on line 12"), pass] },
    )
  })
})

describe("a check that fails", () => {
  it("sends the step back, and the fixed artifact reaches the gate", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("v1")), retry("v2")],
      (id, agent) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expectAwaiting(parked, "approval")
          expect(sectionOf(parked, "1-work")).toBe("v2")

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

          const runs = stepRuns(yield* agent)
          expect(runs).toHaveLength(2)
          // Resumed, not restarted. The conversation that produced the artifact
          // is exactly the context needed to repair it — the opposite of a
          // rejection, where that context is what makes an agent defend itself.
          expect(runs[1]?.sessionId).toBe(runs[0]?.sessionId)
          expect(runs[1]?.resumeFrom).toBe(runs[0]?.sessionId)
        }),
      declaring("verify"),
      { verify: [fail("2 problems"), pass] },
    )
  })

  it("tells the step what complained and what it said", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("v1")), retry("v2")],
      (id, agent) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const resumed = stepRuns(yield* agent)[1]?.prompt ?? ""
          expect(resumed).toContain("`verify` check failed")
          expect(resumed).toContain("missing Risks section")
          // A resume prompt: neither the trak description nor the output contract
          // is sent again. The first is already in the session, and the second is
          // on it — the contract ships as the session's system prompt.
          expect(resumed).not.toContain("Add a --json flag")
          expect(resumed).not.toContain('"type": "artifact"')
        }),
      declaring("verify"),
      { verify: [fail("missing Risks section"), pass] },
    )
  })

  it("owes an artifact — a check failure is not a conversation", async () => {
    await runFlowWithAgentLog(
      [
        planned,
        step(1, "work", reply.artifact("v1")),
        // Prose, which `converse` would accept as an answer. `elicit` must not:
        // nobody typed anything and nobody is waiting to read a reply.
        onResume(reply.prose("I think the check is wrong"), "prose"),
        retry("v2"),
      ],
      (id, agent) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          // Three step invocations: the original, the prose that was refused and
          // re-prompted inside elicit, and the artifact. Only two of them are
          // AgentReturned events — a re-prompt never reaches the log.
          expect(stepRuns(yield* agent).length).toBeGreaterThan(2)
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
        }),
      declaring("verify"),
      { verify: [fail("2 problems"), pass] },
    )
  })
})

describe("a check that keeps failing the same way", () => {
  const stuck = [
    planned,
    step(1, "work", reply.artifact("v1")),
    retry("v2"),
    retry("v3", "retry-2"),
  ]

  it("hands over to a human rather than spending another turn", async () => {
    await runFlowWithAgentLog(
      stuck,
      (id, agent) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expectAwaiting(parked, "checks")
          // Two agent turns, not three: the second identical failure stops it.
          expect(stepRuns(yield* agent)).toHaveLength(2)
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "CheckFailed",
            "AgentReturned",
            "CheckFailed",
          ])
        }),
      declaring("verify"),
      { verify: [fail("still 2 problems")] },
    )
  })

  it("lets the human take the artifact anyway", async () => {
    await runFlowWithAgentLog(
      stuck,
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          // Approving a checks gate means the same thing approving an artifact
          // means — it is the same routing, which is why it is a kind and not a
          // state of its own.
          const done = yield* act(id, 1, human.approve())
          expectState(done, "Finished")
          // And the artifact it could not verify is kept, not discarded.
          expect(sectionOf(done, "1-work")).toBe("v2")
        }),
      declaring("verify"),
      { verify: [fail("still 2 problems")] },
    )
  })

  it("lets the human say something instead, which resumes the step", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("v1")), retry("v2"), retry("v3", "after-chat")],
      (id) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const after = yield* act(id, 1, human.chat("ignore the third one"))
          // Back at the gate: the agent tried again, and the check said the same
          // thing. One turn per intervention is the whole budget a repeated
          // failure gets, and that is deliberate.
          expectAwaiting(after, "checks")
          expect(sectionOf(after, "1-work")).toBe("v3")
        }),
      declaring("verify"),
      { verify: [fail("still 2 problems")] },
    )
  })
})

describe("the composer is not told what it may attach", () => {
  it("never sees the check registry, and the step is still told what will judge it", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("done"))],
      (id, agent) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const log = yield* agent
          // The registry was one of three the composer chose from. It is the
          // agent's now, so offering it here would be offering a choice that
          // nothing reads.
          const composed = log.requests[0]?.prompt ?? ""
          expect(composed).not.toContain("Available checks")
          expect(composed).not.toContain("verify")

          // The step still knows before it starts, which is the cheapest place to
          // catch a failure: it can run the check itself.
          const first = stepRuns(log)[0]?.prompt ?? ""
          expect(first).toContain("Checks that will run on your artifact")
          expect(first).toContain("`verify`")
        }),
      declaring("verify"),
      {},
    )
  })
})

describe("an agent that declares no checks", () => {
  it("still passes through verification, and the log says nothing ran", async () => {
    // `decide` cannot see an agent's checks without reading policy, so every
    // artifact is verified and an empty declaration is the degenerate case. The
    // empty `ChecksPassed` is what makes "nothing was required" readable in the
    // log rather than indistinguishable from a step that skipped the state.
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("done"))],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          expectAwaiting(parked, "approval")
          expect((yield* checks).ran).toEqual([])
          expect(yield* logTags(id)).toEqual([
            "TrakCreated",
            "WorktreeReady",
            "ComposerReturned",
            "HumanActed",
            "ConditionsMet",
            "AgentReturned",
            "ChecksPassed",
          ])
        }),
      declaring(),
      {},
    )
  })
})

// A person's switch keeping the next check run from happening: the run is skipped, the
// step is accepted exactly as a pass accepts it, and the switch is used up by it.
describe("a person skipping the next step's checks", () => {
  it("runs nothing, accepts the step as a pass would, and is spent by it", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("v1")), onResume(reply.artifact("v2"))],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          // Armed before the step files, while the trak is parked at its plan gate: the
          // switch reaches the run that follows the artifact.
          yield* create(id, "Add a --json flag")
          const armed = yield* advance(id, Events.skipChecksChanged(true))
          expect([armed.skippingChecks, armed.state._tag]).toEqual([true, "AwaitingProposal"])

          const parked = yield* act(id, 0, human.approve())
          expectAwaiting(parked, "approval")
          expect((yield* checks).ran).toEqual([])
          expect(parked.skippingChecks).toBe(false)
          // The log says what did not run, on the same event a pass writes.
          const passed = (yield* eventsOf(id)).findLast(isChecksPassed)
          expect(passed).toMatchObject({
            _tag: "ChecksPassed",
            step: 1,
            ran: [],
            skipped: ["verify"],
          })

          // Used up: sending that same step back runs its checks.
          const again = yield* act(id, 1, human.chat("tighten the summary"))
          expectAwaiting(again, "approval")
          expect((yield* checks).ran).toEqual(["verify"])
        }),
      declaring("verify"),
      {},
    )
  })

  it("on auto, the step goes past with nobody reading it — marked as a pass would be", async () => {
    // Pressed while the step is still writing, which on `auto` is the only moment there
    // is: `onPromptAfter` holds the step's answer until the press has landed.
    const release = Effect.runSync(Deferred.make<void>())
    await runFlowWithAgentLog(
      [
        planned,
        onPromptAfter(/artifact named `1-work`/, Deferred.await(release), reply.artifact("v1")),
      ],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const drives = yield* Drives
          yield* drives.start(id, bornAuto)
          yield* logged(id, hasComposed)
          yield* advance(id, Events.skipChecksChanged(true))
          yield* Deferred.succeed(release, undefined)
          yield* idle(id)

          const done = replayHistory(id, yield* eventsOf(id))
          expectState(done, "Finished")
          expect((yield* checks).ran).toEqual([])
          expect(marksOf(done)).toEqual([
            [0, "Mode"],
            [1, "Mode"],
          ])
        }),
      declaring("verify"),
      {},
    )
  })

  it("waits past a step that declares no checks, for the first that does", async () => {
    await runFlowWithAgentLog(
      [
        composer("plan", "work"),
        step(1, "plan", reply.artifact("the plan")),
        step(2, "work", reply.artifact("the work")),
      ],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* create(id, "Add a --json flag")
          yield* advance(id, Events.skipChecksChanged(true))
          // `plan` declares nothing: its empty run spends no switch.
          const first = yield* act(id, 0, human.approve())
          expectAwaiting(first, "approval")
          expect(first.skippingChecks).toBe(true)
          // `work` declares `verify`, and this is the run the switch was waiting for.
          const second = yield* act(id, 1, human.approve())
          expectAwaiting(second, "approval")
          expect([second.skippingChecks, (yield* checks).ran]).toEqual([false, []])
        }),
      declaring("verify"),
      {},
    )
  })
})

// A check that passed on exactly these files is accepted on that pass. These need a
// script on disk, because its text is part of what a pass is kept under; what the check
// *does* is still the fake's.
const scripts = mkdtempSync(join(tmpdir(), "orkestra-passes-"))
afterAll(() => {
  rmSync(scripts, { recursive: true, force: true })
})

/** `verify` as a file on disk, holding `text`, with `cache:` as given. */
const onDisk = (text: string, cache = true) => {
  const path = join(mkdtempSync(join(scripts, "verify-")), "verify.sh")
  writeFileSync(path, text)
  const verify = { ...VERIFY, path, cache }
  return { path, lib: workDeclaring(["verify"], { checks: new Map([["verify", verify]]) }) }
}

const twice = [planned, step(1, "work", reply.artifact("v1")), onResume(reply.artifact("v2"))]
const passedTree = (call: ChecksLog["calls"][number]) => call.env?.["ORKESTRA_PASSED_TREE"]
const baseCommit = (call: ChecksLog["calls"][number]) => call.env?.["ORKESTRA_BASE_COMMIT"]
const lastPass = (id: TrakId) => Effect.map(eventsOf(id), (log) => log.findLast(isChecksPassed))

describe("a check that already passed on these files", () => {
  it("is not run again, and the log names it as reused rather than run", async () => {
    const { lib } = onDisk("pnpm verify\n")
    await runFlowWithAgentLog(
      twice,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const again = yield* act(id, 1, human.chat("tighten the summary"))

          expectAwaiting(again, "approval")
          expect((yield* checks).ran).toEqual(["verify"])
          expect(yield* lastPass(id)).toMatchObject({ ran: [], reused: ["verify"] })
        }),
      lib,
      { verify: [pass] },
    )
  })

  it("runs again once a file in the checkout changes", async () => {
    const { lib } = onDisk("pnpm verify\n")
    await runFlowWithAgentLog(
      twice,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          writeFileSync(join(parked.worktree?.path ?? "", "fresh.ts"), "export const a = 1\n")
          yield* act(id, 1, human.chat("tighten the summary"))

          expect((yield* checks).ran).toEqual(["verify", "verify"])
          expect(yield* lastPass(id)).toMatchObject({ ran: ["verify"] })
          expect(yield* lastPass(id)).not.toHaveProperty("reused")
        }),
      lib,
      { verify: [pass] },
    )
  })

  it("hands the run after it the tree it passed on, and the first run none", async () => {
    const { lib } = onDisk("pnpm verify\n")
    await runFlowWithAgentLog(
      twice,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          writeFileSync(join(parked.worktree?.path ?? "", "fresh.ts"), "export const a = 1\n")
          yield* act(id, 1, human.chat("tighten the summary"))

          const handed = (yield* checks).calls.map(passedTree)
          expect(handed).toEqual([undefined, expect.stringMatching(/^[0-9a-f]{40}$/)])
        }),
      lib,
      { verify: [pass] },
    )
  })

  it("hands every run the commit the trak's checkout was cut from", async () => {
    const { lib } = onDisk("pnpm verify\n")
    await runFlowWithAgentLog(
      twice,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          writeFileSync(join(parked.worktree?.path ?? "", "fresh.ts"), "export const a = 1\n")
          yield* act(id, 1, human.chat("tighten the summary"))

          const base = parked.worktree?.base
          expect(base).toBeDefined()
          const handed = (yield* checks).calls.map(baseCommit)
          expect(handed).toEqual([base, base])
        }),
      lib,
      { verify: [pass] },
    )
  })

  it("runs again once the script changes", async () => {
    const { lib, path } = onDisk("pnpm verify\n")
    await runFlowWithAgentLog(
      twice,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          writeFileSync(path, "pnpm verify --strict\n")
          yield* act(id, 1, human.chat("tighten the summary"))

          expect((yield* checks).ran).toEqual(["verify", "verify"])
        }),
      lib,
      { verify: [pass] },
    )
  })

  it("runs every time where the file says `cache: false`", async () => {
    const { lib } = onDisk("pnpm verify\n", false)
    await runFlowWithAgentLog(
      twice,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          yield* act(id, 1, human.chat("tighten the summary"))

          expect((yield* checks).ran).toEqual(["verify", "verify"])
        }),
      lib,
      { verify: [pass] },
    )
  })
})

describe("what a pass is never reused for", () => {
  it("never reuses a failure: the retry over the same files runs it again", async () => {
    const { lib } = onDisk("pnpm verify\n")
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("v1")), retry("v2")],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")

          expectAwaiting(parked, "approval")
          expect((yield* checks).ran).toEqual(["verify", "verify"])
        }),
      lib,
      { verify: [fail("2 problems"), pass] },
    )
  })
})

describe("a reused pass and the exclusive queue", () => {
  // The `exclusive:` queue is inside `Checks.run`, so a hit that returns without calling
  // it never joins the queue. Scripted to hang on its second run: reaching the runner at
  // all would hold this flow open until it timed out.
  it("comes back without reaching the runner, so it waits behind nothing", async () => {
    const { lib } = onDisk("pnpm verify\n")
    await runFlowWithAgentLog(
      twice,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")
          const again = yield* act(id, 1, human.chat("tighten the summary"))

          expectAwaiting(again, "approval")
          expect((yield* checks).ran).toEqual(["verify"])
        }),
      lib,
      { verify: [pass, hangs] },
    )
  })
})

/** Two checks declaring one label, on disk so each keeps a pass. */
const sharingUnits = () => {
  const at = mkdtempSync(join(scripts, "units-"))
  const declared = (name: string): Check => {
    const path = join(at, `${name}.sh`)
    writeFileSync(path, `pnpm ${name}\n`)
    return { ...VERIFY, name, path, units: "tests" }
  }
  const checks = new Map([
    ["verify-light", declared("verify-light")],
    ["verify", declared("verify")],
  ])
  return workDeclaring(["verify-light", "verify"], { checks })
}

const handed = (calls: ChecksLog["calls"]) => calls.map((c) => [c.name, c.proven ?? []])

describe("units a check proved", () => {
  it("reach the next check with the same label on the same tree, and no further", async () => {
    await runFlowWithAgentLog(
      twice,
      (id, _agent, checks) =>
        Effect.gen(function* () {
          const parked = yield* createAndStart(id, "Add a --json flag")
          writeFileSync(join(parked.worktree?.path ?? "", "fresh.ts"), "export const a = 1\n")
          yield* act(id, 1, human.chat("tighten the summary"))

          expect(handed((yield* checks).calls)).toEqual([
            ["verify-light", []],
            ["verify", ["a.test.ts", "b.test.ts"]],
            ["verify-light", []],
            ["verify", ["a.test.ts", "b.test.ts"]],
          ])
        }),
      sharingUnits(),
      { "verify-light": [proving(["a.test.ts", "b.test.ts"])] },
    )
  })

  it("are kept from a check that failed, so the retry on the same tree skips them", async () => {
    await runFlowWithAgentLog(
      [planned, step(1, "work", reply.artifact("v1")), retry("v2")],
      (id, _agent, checks) =>
        Effect.gen(function* () {
          yield* createAndStart(id, "Add a --json flag")

          expect(handed((yield* checks).calls)).toEqual([
            ["verify-light", []],
            ["verify-light", ["a.test.ts"]],
            ["verify", ["a.test.ts"]],
          ])
        }),
      sharingUnits(),
      { "verify-light": [proving(["a.test.ts"], fail("b.test.ts failed")), pass] },
    )
  })
})
