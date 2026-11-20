// Tier 1: the rule that makes patching safe.
//
// The failure this guards against does not look like a failure. A client that applied
// a frame it was not next in line for would hold a log with a hole in it, which reads
// exactly like a complete log — every surface above would draw it without complaint and
// nothing would ever say the trak was wrong. So the contiguity check is the whole of
// what this file asserts, from both sides.

import { describe, expect, it } from "vitest"
import type { EngineFrameDto, TrakDetailDto } from "./api/types"
import { applyFrame, applyProcessFrame } from "./applyFrame"
import {
  makeActivity,
  makeAgentStep,
  makeAppended,
  makeCheckEnded,
  makeCheckOutput,
  makeCheckRun,
  makeCheckStarted,
  makeChecksPassed,
  makeComposeEntry,
  makeDetail,
  makeDrive,
  makeHostedProcess,
  makeInFlight,
  makePreparing,
  makeSeamStatus,
  makeNote,
  makePlan,
  makeProcessFrame,
  makeProcessOutput,
  makeRemoved,
  makeTrakCreated,
  makeWorktree,
  makeWorktreeReady,
} from "./fixtures"

const held: TrakDetailDto = makeDetail({
  id: "trak-1",
  description: "Add a --json flag",
  log: [makeTrakCreated({ description: "Add a --json flag" })],
  transcript: [makeNote()],
})

const appended = (seq: number): EngineFrameDto =>
  makeAppended({
    seq,
    event: makeWorktreeReady({ worktree: { path: "/tmp/w", branch: "trak/t", base: "abc" } }),
  })

const activity = (seq: number): EngineFrameDto => makeActivity({ seq })

/**
 * The fields the frame is authoritative for. Each is written by the engine off the
 * event's decision and named nowhere in the event, so a client that patched only the
 * log would draw the previous value until a poll it may never get.
 */
describe("the projection an append carries", () => {
  it("takes the mode and the pending hold off the frame, like the state", () => {
    // The event on this frame says nothing about either: a hold is spent by the engine
    // as the step it holds is accepted, so a client that patched only the log would show a
    // hold still pending on a trak whose held step has already been taken.
    const next = applyFrame(
      { ...held, mode: "smart", holding: true },
      makeAppended({
        seq: 2,
        event: makeWorktreeReady({ worktree: { path: "/tmp/w", branch: "trak/t", base: "abc" } }),
        mode: "auto",
        holding: false,
        skippingChecks: false,
      }),
    )
    expect(next?.mode).toBe("auto")
    expect(next?.holding).toBe(false)
  })

  it("takes the skip switch off the frame too, since the run that spends it says nothing of it", () => {
    const next = applyFrame(
      { ...held, skippingChecks: true },
      makeAppended({
        seq: 2,
        event: makeChecksPassed({ step: 1, ran: [], skipped: ["verify"] }),
        skippingChecks: false,
      }),
    )
    expect(next?.skippingChecks).toBe(false)
  })

  it("takes the marks off the frame, so a band paints with the gate rather than the poll", () => {
    // The engine stamps them from the decision the event produced, and nothing on the
    // event names one — so a client that patched only the log would draw the gate and
    // wait up to a poll for the band on the document of the step it held.
    const marks = [
      { _tag: "Mode", at: 0 },
      { _tag: "Held", at: 1 },
    ] as const
    const next = applyFrame(held, makeAppended({ seq: 2, marks }))
    expect(next?.marks).toEqual(marks)
  })

  it("takes the plan, the checkout and the decisions off the frame, so nothing waits for the poll", () => {
    // The rest of the projection, and the half the symptoms were about: a composer
    // re-cutting the plan moves the step the drawer draws, and a re-read that would
    // have caught it never comes while frames keep arriving.
    const recut = makePlan({ steps: [makeComposeEntry(), makeAgentStep(), makeAgentStep()] })
    const worktree = makeWorktree({ branch: "trak/recut" })
    const decisions = [
      { text: "the admin view is out", source: "stated", at: "0-plan", id: "0-plan.1" },
    ] as const
    const next = applyFrame(held, makeAppended({ seq: 2, plan: recut, worktree, decisions }))
    expect([next?.plan?.steps.length, next?.worktree?.branch, next?.decisions]).toStrictEqual([
      3,
      "trak/recut",
      decisions,
    ])
  })

  /**
   * The two optional fields, and their absence as much as their presence: a wait that
   * passed arrives as a frame with no `waiting`, and a held value standing would keep the
   * finished pane drawing a block for a step that is now running. `landed` is what hides
   * the local Merge press and asks the deploy, so it cannot wait for the poll either.
   */
  it("takes the wait and the landing off the frame, and their absence too", () => {
    const waiting = { step: 2, name: "deployed", stopped: false } as const
    const landed = { sha: "8c41d0e" } as const
    const resting = applyFrame(held, makeAppended({ seq: 2, waiting, landed }))
    expect([resting?.waiting, resting?.landed]).toStrictEqual([waiting, landed])
    if (resting === undefined) throw new Error("the frame was the next one")
    const running = applyFrame(resting, makeAppended({ seq: 3, landed }))
    expect(running?.waiting).toBeUndefined()
    expect(running?.landed).toStrictEqual(landed)
  })
})

describe("applyFrame", () => {
  it("appends the next log line and takes the state the frame reports", () => {
    const next = applyFrame(held, appended(2))
    expect(next?.log.map((e) => e._tag)).toStrictEqual(["TrakCreated", "WorktreeReady"])
    // From the frame, never derived: working the state out from the event would be a
    // second copy of the engine's state machine living in the client.
    expect(next?.state).toStrictEqual({ _tag: "AwaitingProposal" })
  })

  it("refuses a log line that is not the next one", () => {
    // Ahead — two frames were dropped, so applying this would leave a hole.
    expect(applyFrame(held, appended(4))).toBeUndefined()
    // Behind — a duplicate, which is what a reconnect can deliver. Applying it would
    // append an event the log already has.
    expect(applyFrame(held, appended(1))).toBeUndefined()
  })

  it("counts the transcript in its own file", () => {
    // Both files are at one line, so the *same* seq is next for one and a repeat for
    // the other. A single counter would make every turn's first tool call look like a
    // gap.
    expect(applyFrame(held, activity(2))?.transcript.map((e) => e._tag)).toStrictEqual([
      "Note",
      "Tool",
    ])
    expect(applyFrame(held, activity(1))).toBeUndefined()
  })

  it("leaves a removed trak and a resync to the caller", () => {
    // Neither is a new value for a trak we hold: one says forget it, the other says
    // nothing held is known to be contiguous. Answering with the unchanged object
    // would tell the caller there was nothing to do.
    expect(applyFrame(held, makeRemoved({ trak: "trak-1" }))).toBeUndefined()
    expect(applyFrame(held, { _tag: "Resync" })).toBeUndefined()
  })

  it("takes custody off a drive frame, and leaves the rest as held", () => {
    // The release is what every press on the screen is gated on, and it is on no log
    // line — so it is the one thing a frame with no `seq` has to say.
    const driven = { ...held, custody: { holder: { since: 1_000 } } }
    const next = applyFrame(driven, makeDrive({ trak: "trak-1", custody: {} }))
    expect(next?.custody).toStrictEqual({})
    expect(next?.log).toStrictEqual(held.log)
  })

  it("takes the turn in flight off its frame, and takes the field off on the release", () => {
    // Daemon memory, like custody: the record's turn replaces whatever is held, and the
    // release is a frame with no turn — which must remove the field rather than leave the
    // last figure standing, because the ending's own usage is on the log by then.
    const next = applyFrame(held, makeInFlight({ trak: "trak-1" }))
    expect(next?.inFlight).toMatchObject({ step: 2 })
    expect(next?.log).toStrictEqual(held.log)
    const released = applyFrame(
      { ...held, inFlight: makeInFlight().turn },
      makeInFlight({ trak: "trak-1", turn: undefined }),
    )
    expect(released).toBeDefined()
    expect(released !== undefined && "inFlight" in released).toBe(false)
  })

  it("takes the preparation off its frame, and takes the field off once none is running", () => {
    const next = applyFrame(held, makePreparing())
    expect(next?.preparing).toStrictEqual({ _tag: "SetupBeside" })
    expect(next?.log).toStrictEqual(held.log)
    const ended = applyFrame(
      { ...held, preparing: { _tag: "SetupBeside" } },
      makePreparing({ preparing: undefined }),
    )
    expect(ended).toBeDefined()
    expect(ended !== undefined && "preparing" in ended).toBe(false)
  })

  it("takes the action at the seam off its frame, and takes the field off once it ends", () => {
    const next = applyFrame(held, makeSeamStatus())
    expect(next?.seam).toStrictEqual({ action: "stop", phase: "crossing", attempt: 1, since: 0 })
    expect(next?.log).toStrictEqual(held.log)
    const ended = applyFrame(next ?? held, makeSeamStatus({ seam: undefined }))
    expect(ended).toBeDefined()
    expect(ended !== undefined && "seam" in ended).toBe(false)
  })

  it("does not touch what it was given", () => {
    applyFrame(held, appended(2))
    expect(held.log).toHaveLength(1)
  })

  describe("a check run", () => {
    const running = makeDetail({
      id: "trak-1",
      check: makeCheckRun({ output: "compiling\n", chunks: 1 }),
    })

    it("takes a started run whole, over whatever was held", () => {
      // A run names its own position and carries its own output, so an earlier one at an
      // earlier position has nothing to contribute — merging would leave the console
      // showing two runs' lines with no boundary between them.
      const next = applyFrame(running, makeCheckStarted({ run: makeCheckRun({ step: 2 }) }))
      expect(next?.check).toStrictEqual(makeCheckRun({ step: 2 }))
    })

    it("appends the next chunk and moves the count with it", () => {
      const next = applyFrame(running, makeCheckOutput({ seq: 2, chunk: "linting\n" }))
      expect(next?.check?.output).toBe("compiling\nlinting\n")
      expect(next?.check?.chunks).toBe(2)
    })

    it("refuses a chunk that is not the next one, and one for another position", () => {
      // The same rule the two appends follow, over the one count this family has. A hole
      // in a console reads as a console, which is why a gap has to reach the server.
      expect(applyFrame(running, makeCheckOutput({ seq: 3 }))).toBeUndefined()
      expect(applyFrame(running, makeCheckOutput({ seq: 1 }))).toBeUndefined()
      expect(applyFrame(running, makeCheckOutput({ seq: 2, step: 1 }))).toBeUndefined()
    })

    it("refuses a chunk when no run is held at all", () => {
      // Nothing backs a run but the daemon's memory, so the answer to *I missed the
      // start* is to ask for it rather than to invent a run around one chunk.
      expect(applyFrame(held, makeCheckOutput())).toBeUndefined()
    })

    it("replaces the output when the run ends", () => {
      // What was watched is stdout as it arrived; what is settled is the report the
      // agent is handed, stderr first. Appending the second to the first would print
      // every failing line twice.
      const ended = makeCheckEnded({
        run: makeCheckRun({
          output: "error: two problems\ncompiling\n",
          chunks: 1,
          finished: { verdict: "failed", exitCode: 1, at: 2_000 },
        }),
      })
      expect(applyFrame(running, ended)?.check?.output).toBe("error: two problems\ncompiling\n")
    })
  })
})

describe("applyProcessFrame", () => {
  const running = makeHostedProcess({
    name: "dev",
    run: 1,
    log: "vite\n",
    chunks: 1,
    state: {
      _tag: "Running",
      port: 47213,
      startedAt: 1_000,
      readyAt: 2_000,
      url: "http://[::1]:47213/",
    },
  })
  const list = [running, makeHostedProcess({ name: "api", page: false })]

  it("replaces the process a state frame names, and leaves the others", () => {
    const stopped = {
      ...running,
      state: { _tag: "Stopped" as const, port: 47213, startedAt: 1_000, at: 9_000 },
    }
    expect(applyProcessFrame(list, makeProcessFrame({ process: stopped }))).toStrictEqual([
      stopped,
      list[1],
    ])
  })

  it("appends the next chunk of the run it holds", () => {
    const next = applyProcessFrame(list, makeProcessOutput({ run: 1, seq: 2, chunk: "ready\n" }))
    expect(next?.[0]).toMatchObject({ log: "vite\nready\n", chunks: 2 })
  })

  it("asks again rather than leave a hole: a skipped chunk, another run, an unknown name", () => {
    expect(applyProcessFrame(list, makeProcessOutput({ run: 1, seq: 3 }))).toBeUndefined()
    expect(applyProcessFrame(list, makeProcessOutput({ run: 2, seq: 2 }))).toBeUndefined()
    expect(
      applyProcessFrame(list, makeProcessOutput({ name: "web", run: 1, seq: 2 })),
    ).toBeUndefined()
    expect(
      applyProcessFrame(list, makeProcessFrame({ process: makeHostedProcess({ name: "web" }) })),
    ).toBeUndefined()
  })

  it("keeps the log from the end, at the engine's bound", () => {
    const full = [{ ...running, log: "x".repeat(64 * 1024) }]
    const next = applyProcessFrame(full, makeProcessOutput({ run: 1, seq: 2, chunk: "tail\n" }))
    expect(next?.[0]?.log).toHaveLength(64 * 1024)
    expect(next?.[0]?.log.endsWith("tail\n")).toBe(true)
  })
})
