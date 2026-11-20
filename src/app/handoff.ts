// Session handoff for a trak whose checkout is in a sandbox. The session file and the
// files it edited are there, at this machine's paths, and nothing of them is here — so a
// person resumes the session in the sandbox, through the runner's `shell` verb. Under
// `pnpm serve` the terminal press runs that verb; under `pnpm host` no terminal the engine
// opens is the viewer's, so the screen shows `pnpm host shell <project> <trak>` to run on
// the host's machine, which asks this engine for the same line.
//
// With no runner file `placeOf` answers `undefined`, every function here answers
// `undefined`, and nothing on the wire changes.

import { Context, Effect, Option } from "effect"
import type { HandoffDto } from "@orkestra/shared/dto/trak"
import { Provider } from "../agent/ports/provider.js"
import type { SessionId } from "../agent/types/session.js"
import type { Library } from "../library/types/library.js"
import { type Rebuild, Sandboxes, type SandboxShell } from "../vcs/ports/sandboxes.js"
import type { CheckoutPlace } from "../vcs/index.js"
import { modelAt, slotAt, type Trak } from "../workflow/domain/trak.js"

/**
 * The project's id on the host that started this engine, which the pasted line names and
 * `engineLayers` provides from its seams. Absent on an engine nobody hosts, and in a test
 * that provides none.
 */
export class HostProject extends Context.Tag("app/HostProject")<HostProject, string>() {}

/** Why an editor press on a sandboxed trak opens nothing. */
export const NO_LOCAL_PATH = "a sandboxed trak has no local path"

/** Where a checkout is in a sandbox, or `undefined` with no runner or for a checkout on this machine. */
export const sandboxPlaceOf = (path: string): Effect.Effect<CheckoutPlace | undefined> =>
  Effect.gen(function* () {
    const sandboxes = Option.getOrUndefined(yield* Effect.serviceOption(Sandboxes))
    return sandboxes === undefined ? undefined : yield* sandboxes.placeOf(path)
  })

/** The sandboxes and the trak whose sandbox holds `path`, or `undefined` where none does. */
const sandboxAt = (path: string) =>
  Effect.gen(function* () {
    const sandboxes = Option.getOrUndefined(yield* Effect.serviceOption(Sandboxes))
    const place = sandboxes === undefined ? undefined : yield* sandboxes.placeOf(path)
    return sandboxes === undefined || place === undefined
      ? undefined
      : { sandboxes, trak: place.trak }
  })

/** Where a person's Rebuild of the sandbox at `path` stands, or `undefined` where none is owed or there is no sandbox. */
export const sandboxRebuildOf = (path: string): Effect.Effect<Rebuild | undefined> =>
  Effect.flatMap(sandboxAt(path), (at) =>
    at === undefined ? Effect.succeed(undefined) : at.sandboxes.rebuildOf(at.trak),
  )

/** A person's Rebuild of the sandbox at `path`, pressed — `undefined` where the path is in none. */
export const rebuildSandboxAt = (path: string): Effect.Effect<Rebuild | undefined> =>
  Effect.flatMap(sandboxAt(path), (at) =>
    at === undefined ? Effect.succeed(undefined) : at.sandboxes.rebuild(at.trak),
  )

/**
 * The runner's `shell` line for the sandbox at `place`, carrying every agent CLI's
 * credentials so `claude --resume` signs in there, beside the named secrets the sandboxes
 * add. `undefined` where no runner answers.
 */
export const sandboxShellOf = (place: CheckoutPlace) =>
  Effect.gen(function* () {
    const sandboxes = Option.getOrUndefined(yield* Effect.serviceOption(Sandboxes))
    if (sandboxes === undefined) return undefined
    return yield* sandboxes.shell(place, (yield* Provider).credentials)
  })

/**
 * The environment a terminal hands `shell`: the line's own values, each inherited name
 * valued from this engine's environment where it holds one, and the engine's `PATH`, so
 * the script finds the tools it finds when the engine runs it.
 */
export const shellEnv = (
  shell: SandboxShell,
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const picked: Record<string, string> = {}
  for (const name of ["PATH", ...shell.inherited]) {
    const value = parent[name]
    if (value !== undefined) picked[name] = value
  }
  return { ...picked, ...shell.env }
}

/**
 * The session of the furthest position that holds one, and the model it was minted on —
 * the trak's latest turn. `undefined` before its first turn, and where the library can no
 * longer name the model, since then no CLI can be said to resume it.
 */
export const latestSession = (
  trak: Trak,
  lib: Library,
): { readonly session: SessionId; readonly model: string } | undefined => {
  const positions = [...trak.slots.keys()].filter((p) => slotAt(trak, p).session !== undefined)
  if (positions.length === 0) return undefined
  const position = Math.max(...positions)
  const session = slotAt(trak, position).session
  const model = modelAt(trak, position, lib)
  return session === undefined || model === undefined ? undefined : { session, model }
}

/** What a trak's screen offers a person to pick its session up, or `undefined` where its checkout is not sandboxed. */
export const handoffFor = (trak: Trak, lib: Library) =>
  Effect.gen(function* () {
    if (trak.worktree === undefined) return undefined
    const place = yield* sandboxPlaceOf(trak.worktree.path)
    if (place === undefined) return undefined
    const latest = latestSession(trak, lib)
    const resume =
      latest === undefined
        ? undefined
        : (yield* Provider).resumeLineFor(latest.model, latest.session)
    const project = yield* Effect.serviceOption(HostProject)
    const handoff: HandoffDto = {
      ...(resume === undefined ? {} : { resume }),
      ...(Option.isNone(project) ? {} : { host: `pnpm host shell ${project.value} ${trak.id}` }),
    }
    return handoff
  })
