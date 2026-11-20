// oxlint-disable-next-line eslint/no-restricted-imports -- a test of starting an engine
import { spawn } from "node:child_process"
import { once } from "node:events"
import { describe, expect, it } from "vitest"
import { type Engine, running, stopEngine, stopQuestion } from "./engine.js"

const engine = (child: Engine["child"]): Engine => ({
  root: "/nowhere",
  port: 1,
  url: "http://127.0.0.1:1/",
  child,
  token: undefined,
})

describe("stopping an engine", () => {
  it("signals one started here, and it goes", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    })
    await once(child, "spawn")
    await stopEngine(engine(child))
    expect(child.signalCode).toBe("SIGTERM")
  })

  it("leaves an attached one alone: there is no child to signal", async () => {
    await expect(stopEngine(engine(undefined))).resolves.toBeUndefined()
  })

  it("reads a child that has already exited as idle without asking it", async () => {
    const child = spawn(process.execPath, ["-e", ""], {
      stdio: "ignore",
    })
    await once(child, "exit")
    await expect(running(engine(child))).resolves.toBe("idle")
  })
})

describe("the question before a stop", () => {
  it("is not asked when every engine answered idle, or there is none to stop", () => {
    expect(stopQuestion(["idle", "idle"])).toBe("none")
    expect(stopQuestion([])).toBe("none")
  })

  it("is about the running turn when one engine reports one", () => {
    expect(stopQuestion(["idle", "unknown", "running"])).toBe("running")
  })

  it("is asked for an engine that could not say, worded for that", () => {
    expect(stopQuestion(["idle", "unknown"])).toBe("unknown")
  })
})
