// The Sandboxes port, wrapped so that every failure is also a line in the engine's output.
//
// A failed runner verb carries the runner script's stderr in its reason, and the runtime
// records that reason on the trak's log and prints nothing. The engine's output is the one
// record a host keeps across traks, so a failure is printed
// here, where every call into the port passes, rather than at each place one is caught.
// A failure a caller then absorbs is printed too: it is still what the runner said.

import { Effect, Layer } from "effect"
import { Sandboxes, type SandboxesShape } from "../../vcs/ports/sandboxes.js"
import type { GitFailed } from "../../vcs/types/errors.js"

const logged = <A, R>(
  trak: string,
  call: Effect.Effect<A, GitFailed, R>,
): Effect.Effect<A, GitFailed, R> =>
  Effect.tapError(call, (e) => Effect.logWarning(`${trak}: sandbox ${e.op} failed: ${e.reason}`))

/** A call about the project's sandboxes rather than one trak's, so the line names no trak. */
const loggedForProject = <A, R>(
  call: Effect.Effect<A, GitFailed, R>,
): Effect.Effect<A, GitFailed, R> =>
  Effect.tapError(call, (e) => Effect.logWarning(`sandbox ${e.op} failed: ${e.reason}`))

const decorated = (inner: SandboxesShape): SandboxesShape => ({
  ...inner,
  create: (trak, path) => logged(trak, inner.create(trak, path)),
  status: (trak) => logged(trak, inner.status(trak)),
  list: loggedForProject(inner.list),
  expose: (trak, port) => logged(trak, inner.expose(trak, port)),
  reach: (trak, port, unreached) => logged(trak, inner.reach(trak, port, unreached)),
  release: (trak) => logged(trak, inner.release(trak)),
  kill: (trak, execId) => logged(trak, inner.kill(trak, execId)),
  transfer: (trak, op, cwd, path, args) => logged(trak, inner.transfer(trak, op, cwd, path, args)),
  place: (at, files, replace) => logged(at.trak, inner.place(at, files, replace)),
  write: (at, name, text) => logged(at.trak, inner.write(at, name, text)),
  collect: (at, options) => logged(at.trak, inner.collect(at, options)),
  moveOut: (at, into) => logged(at.trak, inner.moveOut(at, into)),
  readInside: (at, requested) => logged(at.trak, inner.readInside(at, requested)),
  copyHomeBack: (trak, path) => logged(trak, inner.copyHomeBack(trak, path)),
  copyHomeIn: (trak, path) => logged(trak, inner.copyHomeIn(trak, path)),
  awake: (trak) => logged(trak, inner.awake(trak)),
})

/** Wrap a Sandboxes so each failure is logged as a warning before it reaches the caller. */
export const loggedSandboxes = <E, R>(
  inner: Layer.Layer<Sandboxes, E, R>,
): Layer.Layer<Sandboxes, E, R> =>
  Layer.effect(Sandboxes, Effect.map(Sandboxes, decorated)).pipe(Layer.provide(inner))
