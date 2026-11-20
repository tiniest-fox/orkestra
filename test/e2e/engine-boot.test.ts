// How long `startEngine` waits for an engine to answer: the boot limit, unless the engine
// says it is migrating, and then for as long as it keeps printing. `test/support/fake-engine.ts`
// holds its bind back to stand in for a migration, and the limits are shortened to seconds.

import { rmSync } from "node:fs"
import { afterAll, describe, expect, it } from "vitest"
import { startEngine, stopEngine } from "../../src/supervisor/engine.js"
import { FAKE_LAUNCH, project } from "../support/host.js"

const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** `startEngine` on a fresh project, the fake given `env`: the engine, or what it threw, and how long it took. */
const boot = async (
  env: Readonly<Record<string, string>>,
  limits: { readonly bootMs: number; readonly stallMs: number },
) => {
  const p = project("boot")
  roots.push(p.path)
  const began = Date.now()
  try {
    const engine = await startEngine(
      p.path,
      { ...FAKE_LAUNCH, env: { ...FAKE_LAUNCH.env, ...env } },
      limits,
    )
    return { engine, ms: Date.now() - began }
  } catch (e) {
    return { thrown: e instanceof Error ? e.message : String(e), ms: Date.now() - began }
  }
}

describe("an engine's boot", () => {
  it("is waited for past the boot limit while it migrates and prints progress", async () => {
    const booted = await boot(
      { FAKE_ENGINE_MIGRATING: "1", FAKE_ENGINE_PROGRESS_MS: "200", FAKE_ENGINE_HOLD_MS: "10000" },
      { bootMs: 5000, stallMs: 1500 },
    )
    expect(booted.thrown).toBeUndefined()
    expect(booted.ms).toBeGreaterThan(10_000)
    expect(booted.engine?.child?.exitCode).toBeNull()
    if (booted.engine !== undefined) await stopEngine(booted.engine)
  }, 30_000)

  it("fails one stall limit after the last line of a migration that stops printing", async () => {
    const booted = await boot(
      { FAKE_ENGINE_MIGRATING: "1", FAKE_ENGINE_HOLD_MS: "60000" },
      { bootMs: 20_000, stallMs: 1500 },
    )
    expect(booted.thrown).toMatch(/^the engine for .* did not answer on \d+\./u)
    expect(booted.ms).toBeLessThan(10_000)
  }, 30_000)

  it("fails at the boot limit where the engine prints but never says it migrates", async () => {
    const booted = await boot(
      { FAKE_ENGINE_PROGRESS_MS: "200", FAKE_ENGINE_HOLD_MS: "60000" },
      { bootMs: 1500, stallMs: 20_000 },
    )
    expect(booted.thrown).toMatch(/^the engine for .* did not answer on \d+\./u)
    expect(booted.ms).toBeLessThan(10_000)
  }, 30_000)
})
