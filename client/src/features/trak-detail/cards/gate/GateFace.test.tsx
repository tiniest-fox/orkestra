/**
 * The console on a card's Gate face, and the one thing about it that is not markup:
 * **which end it rests at, which is the end, running or ended.**
 *
 * In flight that is the tail — a terminal showing the first eighty lines of a five-minute
 * run is showing the wrong end of it. Ended is the tail too, because a fail-fast check
 * prints its report last and everything above it is the record of what passed. Getting
 * this wrong is silent: the console renders, and the answer is merely off-screen.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { CheckRun } from "../../checks/check"
import GateFace from "./GateFace"

afterEach(cleanup)

const run = (over: Partial<CheckRun> = {}): CheckRun => ({
  name: "verify",
  command: "bash .orkestra/checks/verify.sh",
  phase: "running",
  output: "compiling\n",
  limit: 300,
  startedAt: 1_000,
  took: undefined,
  exitCode: undefined,
  attempts: 0,
  place: undefined,
  ...over,
})

/**
 * The console, with the geometry happy-dom does not have — the same stubbing `DrawerPane`'s
 * own scroll cases take, and for the same reason: nothing here lays anything out.
 */
const pinned = (): { readonly writes: readonly number[]; readonly node: Element } => {
  const node = screen.getByText(/compiling|FAIL/).closest("pre")
  if (node === null) throw new Error("the face drew no console")
  const writes: number[] = []
  let top = 0
  Object.defineProperty(node, "scrollHeight", { value: 1000, configurable: true })
  Object.defineProperty(node, "clientHeight", { value: 240, configurable: true })
  Object.defineProperty(node, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (to: number) => {
      top = to
      writes.push(to)
    },
  })
  return { writes, node }
}

describe("GateFace", () => {
  it("carries a reader with the tail of a run that is still printing", () => {
    const { rerender } = render(<GateFace run={run()} />)
    const { writes } = pinned()

    rerender(<GateFace run={run({ output: "compiling\nlinting\n" })} />)
    expect(writes.at(-1)).toBe(1000)
  })

  it("leaves a run that has ended at its end, where the report is", () => {
    // A check stops at its first failure and prints the report there, so the explanation
    // is the last thing in the output and everything above it is stages that passed. A
    // console resting at the head shows those and hides this.
    const { rerender } = render(<GateFace run={run()} />)
    const { writes } = pinned()

    rerender(<GateFace run={run({ phase: "failed", exitCode: 1, output: "FAIL one test\n…\n" })} />)
    expect(writes.at(-1)).toBe(1000)
  })

  it("takes a reader who had scrolled away back to the end when the run settles", () => {
    // `CheckEnded` replaces the output rather than appending to it, so *stop moving this*
    // was said about lines that are no longer in the box. Held to while it is still
    // printing, dropped when what it printed is thrown away.
    const { rerender } = render(<GateFace run={run()} />)
    const { writes, node } = pinned()

    node.scrollTop = 0
    fireEvent.scroll(node)
    rerender(<GateFace run={run({ output: "compiling\nlinting\n" })} />)
    expect(writes.at(-1)).toBe(0)

    rerender(<GateFace run={run({ phase: "failed", exitCode: 1, output: "FAIL one test\n" })} />)
    expect(writes.at(-1)).toBe(1000)
  })

  it("says what is being asked only where there is a press on the table", () => {
    const failed = run({ phase: "failed", exitCode: 1, attempts: 3 })
    const { rerender } = render(<GateFace run={failed} />)
    expect(screen.queryByText(/Approving takes the work anyway/)).toBeNull()

    rerender(<GateFace run={failed} asked />)
    expect(screen.getByText(/Ran 3 times and failed each time/)).toBeDefined()
  })
})
