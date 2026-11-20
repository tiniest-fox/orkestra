// No sandbox: every trak's checkout is a linked worktree on this machine.
//
// What an engine with no runner provides, as the runner's adapter answered with no runner
// file: nothing is in one, so every reader keeps its own disk code, and a verb that would
// have to reach a sandbox fails saying the project has none. Nothing asks one where `holds`
// and `placeOf` answer as these do, so those failures are the guard rather than a path.

import { Effect, Layer } from "effect"
import { Sandboxes, type SandboxesShape } from "../../vcs/ports/sandboxes.js"
import { GitFailed } from "../../vcs/types/errors.js"

const none = (op: string) =>
  Effect.fail(new GitFailed({ op, reason: "this project has no runner file" }))

export const NoSandboxesLayer = Layer.succeed(Sandboxes, {
  inUse: Effect.succeed(false),
  holds: () => Effect.succeed(false),
  create: () => none("create sandbox"),
  status: () => none("read sandbox status"),
  idOf: () => Effect.succeed(undefined),
  list: none("list sandboxes"),
  expose: (_trak, port) => none(`expose port ${String(port)}`),
  reach: (_trak, port) => none(`reach port ${String(port)}`),
  healthThrough: () => none("ask the engine's health from the sandbox"),
  release: () => none("release sandbox"),
  kill: () => none("kill exec"),
  transfer: (_trak, op) => none(op),
  retried: (_trak, _op, call) => call,
  placeOf: () => Effect.succeed(undefined),
  project: Effect.succeed(undefined),
  place: () => none("place files in sandbox"),
  write: () => none("write file in sandbox"),
  collect: () => none("collect files from sandbox"),
  moveOut: () => none("move files out of sandbox"),
  readInside: () => none("read file in sandbox"),
  stats: () => none("stat paths in sandbox"),
  copyHomeBack: () => none("copy session back from sandbox"),
  copyHomeIn: () => none("copy session into sandbox"),
  awake: () => none("read sandbox status"),
  asWork: (work) => work,
  lost: () => Effect.void,
  resuming: () => Effect.succeed(false),
  remakeWith: () => Effect.void,
  // No sandbox to rebuild; the handoff asks only for a path `placeOf` places.
  rebuild: () => Effect.succeed("waiting"),
  rebuildOf: () => Effect.succeed(undefined),
  leftBehindTo: () => Effect.void,
  stopIdleUnder: () => Effect.void,
  waitingBy: () => Effect.void,
  shell: () => Effect.succeed(undefined),
} satisfies SandboxesShape)
