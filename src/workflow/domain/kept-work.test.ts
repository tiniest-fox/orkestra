import { describe, expect, it } from "vitest"
import { SessionId } from "../../agent/types/session.js"
import { BranchName, CommitSha, KeptWork, WorktreePath } from "../../vcs/index.js"
import { type Event, Events } from "./event.js"
import { keptWork } from "./kept-work.js"
import { emptyTrak, type Trak, TrakId, TrakState } from "./trak.js"

const base = CommitSha.make("b".repeat(40))
const head = CommitSha.make("c".repeat(40))
const trak: Trak = {
  ...emptyTrak(TrakId.make("t")),
  worktree: { path: WorktreePath.make("/tmp/wt"), branch: BranchName.make("trak/t"), base },
  state: TrakState.Closing({ merged: undefined }),
}
const turn = Events.checksPassed(1, ["verify"])

describe("what the log says of a trak's work as it is archived", () => {
  it("is at the last commit where nothing ran after it", () => {
    const history: Event[] = [
      turn,
      Events.workCommitted(head, 1),
      Events.worktreeFailed("fetch trak branch: lost"),
      Events.restarted(undefined),
      Events.closed(),
    ]
    expect(keptWork(trak, history, false)).toEqual(KeptWork.At({ head }))
  })

  it("is at the base where the last commit kept nothing", () => {
    expect(keptWork(trak, [Events.workCommitted(undefined)], false)).toEqual(
      KeptWork.At({ head: base }),
    )
  })

  it("is unsure, naming what ran, where a check ran after the last commit", () => {
    const history = [Events.workCommitted(head, 0), turn]
    expect(keptWork(trak, history, false)).toEqual(
      KeptWork.Unsure({ why: "ChecksPassed at step 1 ran after the last commit" }),
    )
  })

  it("is unsure where a restart ended a turn that wrote no ending", () => {
    const history = [Events.workCommitted(head, 0), Events.restarted(SessionId.make("s"), 2)]
    expect(keptWork(trak, history, false)._tag).toBe("Unsure")
  })

  it("is unsure where work ran and nothing was ever committed", () => {
    expect(keptWork(trak, [turn], false)).toEqual(
      KeptWork.Unsure({ why: "ChecksPassed at step 1 ran with nothing committed" }),
    )
  })

  it("is merged on the forge's word, on the close's, or on a landing, whatever ran since", () => {
    const history = [Events.workCommitted(head, 0), turn]
    expect(keptWork(trak, history, true)).toEqual(KeptWork.Merged())
    const closedMerged = { ...trak, state: TrakState.Closing({ merged: head }) }
    expect(keptWork(closedMerged, history, false)).toEqual(KeptWork.Merged())
    expect(keptWork({ ...trak, landed: { sha: head } }, history, false)).toEqual(KeptWork.Merged())
  })
})
