// Nothing hosted, and nothing to host.
//
// For the offline demos and the flow tests that run with no `Process` behind them: a
// library there declares no `processes/`, so no agent can list one and nothing asks to
// start one. A name that reaches `start` anyway is answered the way an undeclared one
// is everywhere else.

import { Effect, Layer } from "effect"
import {
  HostedProcesses,
  type HostedProcessesShape,
  UnknownProcess,
} from "../ports/hosted-processes.js"

const unknown = (name: string) => Effect.fail(new UnknownProcess({ name }))

export const NoHostedProcessesLayer = Layer.succeed(HostedProcesses, {
  list: () => Effect.succeed([]),
  survey: () => Effect.succeed({ runs: [], unreadable: [] }),
  start: (_trak, _cwd, name) => unknown(name),
  restart: (_trak, _cwd, name) => unknown(name),
  stop: (_trak, name) => unknown(name),
  stopAll: () => Effect.void,
  turnEnv: () => Effect.succeed({}),
  reap: Effect.succeed([]),
} satisfies HostedProcessesShape)
