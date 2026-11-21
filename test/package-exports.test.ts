// What another package may import from this one, one module through each of its `exports`,
// so a rename or a dropped entry fails here rather than in the package that imports it.
// `client/src/package-exports.test.ts` does the same for `@orkestra/client`.

import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"
import { canonical } from "@orkestra/engine/app/discovery"
import { credential, nodeLaunch, startEngine, stopEngine } from "@orkestra/engine/supervisor/engine"
import { storeContract } from "@orkestra/engine/test/contract/store"
import { serveFakeEngine } from "@orkestra/engine/test/support/fake-engine"
import { FAKE_LAUNCH, project } from "@orkestra/engine/test/support/host"

const EXTRA = fileURLToPath(new URL("fixtures/fake-engine/extra-route.ts", import.meta.url))
const engines: Awaited<ReturnType<typeof startEngine>>[] = []

afterAll(() => Promise.all(engines.map(stopEngine)))

describe("@orkestra/engine", () => {
  it("exports a module under src/ by its path, without the extension", () => {
    expect(canonical).toBeTypeOf("function")
    expect(startEngine).toBeTypeOf("function")
  })

  it("exports test/support/ under its own path", () => {
    expect(serveFakeEngine).toBeTypeOf("function")
    expect(FAKE_LAUNCH.env).toHaveProperty("NODE_OPTIONS")
  })

  it("exports test/contract/, a port's shared suite any host can run against its own adapter", () => {
    expect(storeContract).toBeTypeOf("function")
  })

  it("answers a host's extra route beside the fake engine's own, behind the same bearer", async () => {
    const engine = await startEngine(
      project("extra").path,
      nodeLaunch(EXTRA, process.execPath, FAKE_LAUNCH.env),
    )
    engines.push(engine)
    const extra = await fetch(`${engine.url}api/extra`, { headers: credential(engine) })
    const traks = await fetch(`${engine.url}api/traks`, { headers: credential(engine) })
    const bare = await fetch(`${engine.url}api/extra`)
    expect([extra.status, await extra.json(), traks.status, bare.status]).toEqual([
      200,
      { extra: true },
      200,
      401,
    ])
  })
})
