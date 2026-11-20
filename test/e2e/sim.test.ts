// `pnpm sim` booted as the process script boots it, and read over HTTP: every seeded
// state where the catalog says it rests, presses that advance a trak through its own
// queue and on past it, and nothing written outside the temporary project. Beside it,
// `pnpm spike`, the other scripted entry: it exits 0 only at the reviewer's gate.

import { type ChildProcess, execFile, spawn } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SIM_TRAKS } from "../support/sim-states.js"

const SIM_ENTRY = new URL("../../src/sim.ts", import.meta.url).pathname
const SPIKE_ENTRY = new URL("../../src/main.ts", import.meta.url).pathname
const CHECKOUT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const TSX = import.meta.resolve("tsx")

interface Row {
  readonly id: string
  readonly state: { readonly _tag: string; readonly step?: number; readonly kind?: string }
  readonly running: boolean
}

/** Where each seeded trak rests, as the list route reports it. */
const EXPECTED: Readonly<Record<string, Row["state"]>> = {
  "sim-plan-gate": { _tag: "AwaitingProposal" },
  "sim-at-gate": { _tag: "AwaitingHuman", step: 1, kind: "approval" },
  "sim-questions": { _tag: "AwaitingHuman", step: 1, kind: "answers" },
  "sim-stuck": { _tag: "AwaitingHuman", step: 1, kind: "stuck" },
  "sim-check-running": { _tag: "CheckRunning", step: 1 },
  "sim-check-failed": { _tag: "AwaitingHuman", step: 1, kind: "checks" },
  "sim-second-step": { _tag: "AwaitingHuman", step: 2, kind: "approval" },
  "sim-finished": { _tag: "Finished" },
}

describe("the simulated engine", () => {
  // Started somewhere empty, so a write that escaped the temporary project would land here.
  const cwd = mkdtempSync(join(tmpdir(), "orkestra-sim-cwd-"))
  let child: ChildProcess
  let base = ""
  let output = ""

  const json = async (path: string): Promise<unknown> => {
    const parsed: unknown = await (await fetch(`${base}${path}`)).json()
    return parsed
  }
  const rows = async (): Promise<readonly Row[]> => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the wire's own shape, read back
    const list = (await json("/api/traks")) as { readonly traks: readonly Row[] } | readonly Row[]
    return "traks" in list ? list.traks : list
  }
  const rowOf = async (id: string): Promise<Row | undefined> =>
    (await rows()).find((r) => r.id === id)
  const until = async (id: string, done: (row: Row) => boolean): Promise<Row> => {
    for (let i = 0; i < 300; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- polling the drive a press started
      const row = await rowOf(id)
      if (row !== undefined && !row.running && done(row)) return row
      // oxlint-disable-next-line no-await-in-loop -- polling the drive a press started
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(
      `${id} never settled where expected; last read ${JSON.stringify(await rowOf(id))}`,
    )
  }
  const approve = (id: string) =>
    fetch(`${base}/api/traks/${id}/act`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    })

  beforeAll(async () => {
    // Port 0: the sim binds what the kernel picks and names it in its ready line.
    child = spawn(process.execPath, ["--import", TSX, SIM_ENTRY], {
      cwd,
      env: { ...process.env, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    await new Promise<void>((resolve, reject) => {
      const read = (chunk: Buffer): void => {
        output += chunk.toString()
        const ready = /sim: ready on (\S+)\//.exec(output)
        if (ready?.[1] === undefined) return
        base = ready[1]
        resolve()
      }
      child.stdout?.on("data", read)
      child.stderr?.on("data", read)
      child.once("exit", (code) => {
        reject(new Error(`pnpm sim exited ${String(code)} before it was ready:\n${output}`))
      })
    })
  }, 120_000)

  afterAll(() => {
    child.kill("SIGKILL")
    rmSync(cwd, { recursive: true, force: true })
  })

  it("rests every seeded trak where the catalog says, and the goal partway through", async () => {
    const seeded = Object.fromEntries(
      (await rows()).filter((r) => r.id.startsWith("sim-")).map((r) => [r.id, r.state] as const),
    )
    expect(Object.keys(EXPECTED).toSorted()).toEqual(SIM_TRAKS.map((t) => t.id).toSorted())
    expect(seeded).toEqual(EXPECTED)

    // oxlint-disable-next-line typescript/consistent-type-assertions -- the wire's own shape, read back
    const goals = (await json("/api/goals")) as {
      readonly goals: readonly {
        readonly state: { readonly _tag: string }
        readonly traks: readonly unknown[]
        readonly planned: number
      }[]
    }
    expect(goals.goals.map((g) => [g.state._tag, g.traks.length, g.planned])).toEqual([
      ["Watching", 1, 2],
    ])
  })

  it("serves a temporary project, and writes nothing where it was started", async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the wire's own shape, read back
    const health = (await json("/api/health")) as { readonly cwd: string }
    // Real paths both, since the engine reports its project canonical — `/tmp` is a link on macOS.
    expect(health.cwd.startsWith(join(realpathSync(tmpdir()), "orkestra-sim-"))).toBe(true)
    expect(health.cwd.startsWith(CHECKOUT)).toBe(false)
    expect(readdirSync(cwd)).toEqual([])
  })

  it("advances a trak through its own queue on Approve, and past it on the repeat", async () => {
    // Its queue held the plan and the build step's document, both spent by the seed: the
    // review step's turn is the first the repeat answers.
    expect((await approve("sim-at-gate")).status).toBe(202)
    const reviewing = await until("sim-at-gate", (r) => r.state.step === 2)
    expect(reviewing.state).toEqual({ _tag: "AwaitingHuman", step: 2, kind: "approval" })
    const detail = await (await fetch(`${base}/api/traks/sim-at-gate`)).text()
    expect(detail).toContain("At the gate: the ")
    expect(detail).toContain("Repeated: the ")
    expect(detail).toContain("the simulated `review` filed")

    expect((await approve("sim-at-gate")).status).toBe(202)
    expect((await until("sim-at-gate", (r) => r.state._tag === "Finished")).state).toEqual({
      _tag: "Finished",
    })
  })

  it("removes its temporary project when it is stopped", async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the wire's own shape, read back
    const project = ((await json("/api/health")) as { readonly cwd: string }).cwd
    const exited = new Promise((resolve) => child.once("exit", resolve))
    child.kill("SIGTERM")
    await exited
    expect(existsSync(project)).toBe(false)
  })
})

describe("the spike", () => {
  it("parks at the reviewer's gate and exits 0", async () => {
    // A script it cannot follow — a proposal the composer contract refuses — fails the
    // trak, and the spike exits 1, which rejects here.
    const cwd = mkdtempSync(join(tmpdir(), "orkestra-spike-cwd-"))
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ["--import", TSX, SPIKE_ENTRY],
        { cwd },
      )
      expect(stdout).toContain("final                  state=AwaitingHuman(2)")
      expect(readdirSync(cwd)).toEqual([])
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
