// Declarations local to a checkout: a `.orkestra/processes/*.sh` written in one trak's
// checkout is listed and started at that trak, read from that checkout, and is nothing
// at another trak or on the project — and a broken one there is reported, not fatal.
//
// The checkouts are real directories, because reading them is the subject. The servers
// are the fake Process port `process-needs.test.ts` uses, so nothing is spawned.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import type { HostedProcess } from "../../src/library/types/process.js"
import { Lib } from "../../src/library/ports/library.js"
import { ShellHostedProcessesLayer } from "../../src/workflow/adapters/processes-shell.js"
import { TrakId } from "../../src/workflow/domain/trak.js"
import { HostedProcesses, type HostedRun } from "../../src/workflow/ports/hosted-processes.js"
import { fakeServers, processFrames } from "../support/fake-servers.js"
import { library } from "../support/library.js"
import { inheritedEnvironment } from "../support/scripted-environment.js"

const HERE = TrakId.make("here-trak")
const THERE = TrakId.make("there-trak")

/** The project's one process, declared in the engine's library. */
const WEB: HostedProcess = {
  name: "web",
  description: "the project's web server",
  page: true,
  readySeconds: 5,
  needs: [],
  path: "/project/.orkestra/processes/web.sh",
}

const header = (description: string, needs = ""): string =>
  `# ---\n# description: ${description}\n${needs === "" ? "" : `# needs: [${needs}]\n`}# ---\n\nexec serve\n`

/** A checkout holding each of `scripts` under `.orkestra/processes/`. */
const checkout = (scripts: Readonly<Record<string, string>>): string => {
  const dir = mkdtempSync(join(tmpdir(), "orkestra-checkout-"))
  mkdirSync(join(dir, ".orkestra", "processes"), { recursive: true })
  for (const [name, text] of Object.entries(scripts))
    writeFileSync(join(dir, ".orkestra", "processes", `${name}.sh`), text)
  return dir
}

const names = (runs: readonly HostedRun[]): readonly string[] => runs.map((r) => r.name)

const supervising = <A>(body: Effect.Effect<A, unknown, HostedProcesses>) => {
  const servers = fakeServers({ web: 0, gallery: 0 })
  const layer = ShellHostedProcessesLayer({ record: undefined }).pipe(
    Layer.provide(
      Layer.mergeAll(
        servers.layer,
        inheritedEnvironment,
        processFrames().layer,
        Layer.succeed(Lib, library({ processes: new Map([["web", WEB]]) })),
      ),
    ),
  )
  return Effect.runPromise(
    body.pipe(
      Effect.map((result) => ({ result, spawned: [...servers.spawned] })),
      Effect.provide(layer),
      Effect.orDie,
    ),
  )
}

describe("a process declared in a trak's checkout", () => {
  it("is listed and started at its trak, and is unknown at another trak and the project", async () => {
    const here = checkout({ gallery: header("the gallery this trak added", "web") })
    const there = checkout({})
    const { result, spawned } = await supervising(
      Effect.gen(function* () {
        const h = yield* HostedProcesses
        const listedHere = names(yield* h.list(HERE, here))
        const listedThere = names(yield* h.list(THERE, there))
        const listedProject = names(yield* h.list(undefined, "/project"))
        const gallery = yield* h.start(HERE, here, "gallery")
        const elsewhere = yield* Effect.flip(h.start(THERE, there, "gallery"))
        const onProject = yield* Effect.flip(h.start(undefined, "/project", "gallery"))
        // Read again with no checkout given: the one the trak was seen at.
        const again = yield* h.list(HERE, "")
        yield* h.stopAll(HERE)
        return {
          listedHere,
          listedThere,
          listedProject,
          gallery: gallery.state._tag,
          galleryDescription: gallery.description,
          elsewhere: elsewhere._tag,
          onProject: onProject._tag,
          again: again.map((r) => `${r.name} ${r.state._tag}`),
        }
      }),
    )
    expect(result).toEqual({
      listedHere: ["gallery", "web"],
      listedThere: ["web"],
      listedProject: ["web"],
      gallery: "Running",
      galleryDescription: "the gallery this trak added",
      elsewhere: "UnknownProcess",
      onProject: "UnknownProcess",
      again: ["gallery Running", "web Running"],
    })
    // Its `needs:` was resolved at the trak, so the project's `web` came up first.
    expect(spawned).toEqual(["web", "gallery"])
  })

  it("is reported where it does not parse, and the rest of the checkout still lists", async () => {
    const here = checkout({ gallery: "exec serve\n" })
    const { result } = await supervising(
      Effect.gen(function* () {
        const h = yield* HostedProcesses
        const refused = yield* Effect.flip(h.start(HERE, here, "gallery"))
        const surveyed = yield* h.survey(HERE, here)
        return {
          listed: names(surveyed.runs),
          unreadable: surveyed.unreadable.map((u) => u.shown),
          refused: refused.reason,
        }
      }),
    )
    expect(result.listed).toEqual(["web"])
    expect(result.unreadable).toEqual(["processes/gallery.sh"])
    expect(result.refused).toContain("processes/gallery.sh:")
  })
})
