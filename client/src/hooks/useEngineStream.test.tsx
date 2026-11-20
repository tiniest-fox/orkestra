// The sibling of `useTraks`'s poll guard, one layer down.
//
// That test exists because a poll outliving its watcher is a request loop nobody is
// reading; this one exists because a *stream* outliving its watcher is worse — it is a
// live socket writing into a cache the app has stopped rendering, and unlike a poll it
// never stops on its own. `client-style`'s regression checklist item 3 is the pair.
//
// The subscription is injected rather than mocked. An `EventSource` is invisible to
// MSW, so a test that faked one would be asserting on the fake; handing the hook a
// `subscribe` is the port/adapter split the skill asks of a hook, at the smallest size
// that works.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import type { EngineFrameDto, HostedProcessDto, TrakDetailDto } from "../api/types"
import {
  makeAppended,
  makeDetail,
  makeGoalDetail,
  makeHostGit,
  makeCliUsage,
  makeHostedProcess,
  makeInFlight,
  makeProcessOutput,
  makeTrakCreated,
  makeWorktreeReady,
} from "../fixtures"
import { queryKeys } from "../queryCache"
import { receiveFrame, useEngineStream, type Subscribe } from "./useEngineStream"

afterEach(cleanup)

const ID = "trak-1"

const held: TrakDetailDto = makeDetail({
  id: ID,
  description: "Add a --json flag",
  log: [makeTrakCreated({ description: "Add a --json flag" })],
})

const appended: EngineFrameDto = makeAppended({
  trak: ID,
  seq: 2,
  event: makeWorktreeReady({ worktree: { path: "/tmp/w", branch: "trak/t", base: "abc" } }),
  state: { _tag: "AwaitingProposal" },
})

/** A stream under the test's control, which also records whether it was stopped. */
const scripted = (): {
  readonly subscribe: Subscribe
  readonly send: (frame: EngineFrameDto) => void
  readonly stopped: () => boolean
} => {
  let deliver: ((frame: EngineFrameDto) => void) | undefined
  let closed = false
  return {
    subscribe: (onFrame) => {
      deliver = onFrame
      return () => {
        closed = true
      }
    },
    send: (frame) => deliver?.(frame),
    stopped: () => closed,
  }
}

const Mounted = ({ subscribe }: { readonly subscribe: Subscribe }): ReactNode => {
  useEngineStream(subscribe)
  return undefined
}

const wrap = (client: QueryClient, subscribe: Subscribe): ReactNode => (
  <QueryClientProvider client={client}>
    <Mounted subscribe={subscribe} />
  </QueryClientProvider>
)

describe("useEngineStream", () => {
  it("closes the stream when its last subscriber unmounts", () => {
    const stream = scripted()
    const { unmount } = render(wrap(new QueryClient(), stream.subscribe))
    expect(stream.stopped()).toBe(false)
    unmount()
    expect(stream.stopped()).toBe(true)
  })

  it("asks which client the engine serves each time the stream connects", () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.build, "old")
    let connect: (() => void) | undefined
    render(
      wrap(client, (_frame, _error, onOpen) => {
        connect = onOpen
        return () => {}
      }),
    )
    expect(client.getQueryState(queryKeys.build)?.isInvalidated).toBe(false)
    act(() => connect?.())
    expect(client.getQueryState(queryKeys.build)?.isInvalidated).toBe(true)
  })
})

describe("receiveFrame", () => {
  const cached = (): QueryClient => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.trak(ID), held)
    return client
  }

  it("patches a trak it holds without going back to the server", () => {
    const client = cached()
    receiveFrame(client, appended)
    const next: TrakDetailDto | undefined = client.getQueryData(queryKeys.trak(ID))
    expect(next?.log.map((e) => e._tag)).toStrictEqual(["TrakCreated", "WorktreeReady"])
    expect(next?.state).toStrictEqual({ _tag: "AwaitingProposal" })
  })

  it("leaves a trak alone when the frame is not its next line", () => {
    // The cache must not end up holding a log with a hole in it — which reads exactly
    // like a complete one. Refetching is the answer, so what matters here is that the
    // held value was not patched.
    const client = cached()
    receiveFrame(client, { ...appended, seq: 7 })
    const next: TrakDetailDto | undefined = client.getQueryData(queryKeys.trak(ID))
    expect(next?.log).toHaveLength(1)
  })

  it("patches a turn's spend onto the detail it holds, without going back to the server", () => {
    // The reading is on no log and no transcript line, so this frame is the only way a
    // drawer's meter moves between polls — and a poll never comes while frames keep
    // arriving, because each write into the cache re-arms it.
    const client = cached()
    receiveFrame(client, makeInFlight({ trak: ID }))
    const next: TrakDetailDto | undefined = client.getQueryData(queryKeys.trak(ID))
    expect(next?.inFlight).toMatchObject({ step: 2 })
    expect(client.getQueryState(queryKeys.trak(ID))?.isInvalidated).toBe(false)
  })

  it("does not invent a trak it was never holding", () => {
    // Frames arrive for every trak, not just the one on screen. A row nobody has open
    // has nothing to patch, and writing one from a single frame would put a trak in
    // the cache with a log that starts in the middle.
    const client = new QueryClient()
    receiveFrame(client, appended)
    expect(client.getQueryData(queryKeys.trak(ID))).toBeUndefined()
  })

  it("patches a trak's processes and asks for no re-read of the list", () => {
    // A dev server prints a chunk every 200ms, and a process never moves a row.
    const client = new QueryClient()
    client.setQueryData(queryKeys.processes(ID), [
      makeHostedProcess({ name: "dev", run: 1, log: "a\n", chunks: 1 }),
    ])
    expect(
      receiveFrame(client, makeProcessOutput({ trak: ID, run: 1, seq: 2, chunk: "b\n" })),
    ).toBe(false)
    const next: readonly HostedProcessDto[] | undefined = client.getQueryData(
      queryKeys.processes(ID),
    )
    expect(next?.[0]?.log).toBe("a\nb\n")
    expect(receiveFrame(client, appended)).toBe(true)
  })
  it("patches the project checkout's processes from a frame that names no trak", () => {
    const client = new QueryClient()
    const both = [makeHostedProcess({ name: "dev", run: 1, log: "a\n", chunks: 1 })]
    client.setQueryData(queryKeys.projectProcesses, both)
    client.setQueryData(queryKeys.processes(ID), both)
    const { trak: _trak, ...onProject } = makeProcessOutput({ run: 1, seq: 2, chunk: "b\n" })
    expect(receiveFrame(client, onProject)).toBe(false)
    const project: readonly HostedProcessDto[] | undefined = client.getQueryData(
      queryKeys.projectProcesses,
    )
    const trak: readonly HostedProcessDto[] | undefined = client.getQueryData(
      queryKeys.processes(ID),
    )
    expect([project?.[0]?.log, trak?.[0]?.log]).toEqual(["a\nb\n", "a\n"])
  })
  it("re-reads the git bar when a merge lands, and not on any other append", () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.git, makeHostGit())
    receiveFrame(client, appended)
    expect(client.getQueryState(queryKeys.git)?.isInvalidated).toBe(false)
    receiveFrame(client, makeAppended({ trak: ID, event: { _tag: "WorkMerged", sha: "abc1234" } }))
    expect(client.getQueryState(queryKeys.git)?.isInvalidated).toBe(true)
  })
  it("replaces a CLI's usage whole from its frame, and asks for no re-read of the list", () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.usage, { clis: [makeCliUsage()] })
    const polling = makeCliUsage({ polling: true })
    expect(receiveFrame(client, { _tag: "Usage", usage: polling })).toBe(false)
    expect(client.getQueryData(queryKeys.usage)).toEqual({ clis: [polling] })
  })
  it("adds no CLI the list lacks — a Codex turn on a picked model when no agent names Codex", () => {
    const client = new QueryClient()
    const listed = { clis: [makeCliUsage()] }
    client.setQueryData(queryKeys.usage, listed)
    const codex = makeCliUsage({ cli: "codex", polling: true })
    expect(receiveFrame(client, { _tag: "Usage", usage: codex })).toBe(false)
    expect(client.getQueryData(queryKeys.usage)).toEqual(listed)
  })
  it("re-reads a goal and the goal list on a goal frame, and leaves the traks alone", () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.goal("g1"), makeGoalDetail())
    client.setQueryData(queryKeys.goals, { goals: [] })
    client.setQueryData(queryKeys.traks, { traks: [], archived: 0 })
    expect(receiveFrame(client, { _tag: "Goal", goal: "g1" })).toBe(false)
    expect(client.getQueryState(queryKeys.goal("g1"))?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.goals)?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.traks)?.isInvalidated).toBe(false)
  })
})
