import { Context, type Effect, type Scope } from "effect"
import type { McpServer } from "../../agent/types/session.js"
import type { ProviderEvent } from "../../agent/types/provider-event.js"
import type { TurnPosition } from "../../agent/types/transcript-entry.js"
import type { GoalId, TrakId } from "../domain/trak.js"

/** A step's turn in flight in this process, held open to the engine's tools. */
export interface OpenTurn {
  readonly step: number
  /** Closed when the turn ends however it ends — what a tool call's work is forked into. */
  readonly scope: Scope.Scope
}

/**
 * How a session whose CLI runs in the trak's sandbox reaches the engine, where neither
 * the shim's command nor the proxy's exists: each server as an HTTP route on the engine,
 * dialed at the engine's own loopback port, which a tunnel brings into the sandbox.
 */
export interface ReachedTools {
  /** The engine's tools for the trak, in place of `TurnToolsShape.server`. */
  readonly tools: McpServer
  /** An `mcp.yaml` server with `connection:`, by its name there, in place of the stdio proxy. */
  readonly connection: (name: string) => McpServer
  /**
   * What the turn's environment adds in the sandbox: under a host's GitHub App, the `gh`
   * wrapper and the git helper that ask the engine for a token through the tunnel at each
   * use, which a host may provide. Absent everywhere else.
   */
  readonly env?: Readonly<Record<string, string>>
  /**
   * Hold the tunnel for the caller's scope, answering once the engine answers through it
   * or a bounded wait is spent. One that cannot be opened, that ends, or that the engine
   * does not answer through in time is handed to `say` for the turn's transcript rather
   * than failed: the turn runs without its tools, as it does where a server is left out,
   * and says so.
   */
  readonly reach: (
    say: (text: string) => Effect.Effect<void>,
  ) => Effect.Effect<void, never, Scope.Scope>
}

/**
 * The servers a goal composer's session may be handed for the goal's tools: the shim, for
 * a turn on this machine, and for a turn in the project's sandbox the same tools over HTTP
 * with the tunnel that brings the engine's port there.
 */
export interface GoalServers {
  readonly here: McpServer
  readonly reached: Pick<ReachedTools, "tools" | "reach">
}

/**
 * The engine's own tools for a step's turn: the server its session is handed, and the
 * turns they can act for.
 *
 * **A call's work lives in the turn's scope, not in the request's.** A check the agent
 * started has to stop when the turn does — a stop, a kill, a filing — and the request
 * that asked for it is the one thing nothing ends reliably: the CLI may leave its tool
 * server's connection open, or drop it while the turn goes on.
 */
export interface TurnToolsShape {
  /** The server a session is handed, or `undefined` where no engine is listening for its calls. */
  readonly server: ((id: TrakId) => McpServer) | undefined
  /**
   * Where this trak's session reaches the engine from its sandbox, or `undefined` where
   * its CLI runs on this machine — no runner file, or no engine listening. Asked at every
   * turn, as the runner file is read.
   */
  readonly reached: (id: TrakId) => Effect.Effect<ReachedTools | undefined>
  /** Hold this trak's turn open to the tools for the length of the caller's scope. */
  readonly open: (id: TrakId, step: number) => Effect.Effect<void, never, Scope.Scope>
  /** The turn in flight at this trak, or `undefined` where none is. */
  readonly current: (id: TrakId) => Effect.Effect<OpenTurn | undefined>
  /**
   * Hold a turn on the live list for the length of the caller's scope: a trak's step or
   * composer turn, or a goal's composer turn. What it answers is handed every event the
   * turn's provider reports, and keeps where the CLI runs and when it last said anything.
   */
  readonly live: (owner: LiveOwner) => Effect.Effect<LiveHeard, never, Scope.Scope>
  /** Every turn on the live list, oldest first. */
  readonly lives: Effect.Effect<readonly LiveTurn[]>
}

/** Whose turn a live one is. */
export type LiveOwner =
  | { readonly kind: "trak"; readonly id: TrakId; readonly position: TurnPosition }
  | { readonly kind: "goal"; readonly id: GoalId }

/** Hand a live turn one event its provider reported. */
export type LiveHeard = (event: ProviderEvent) => Effect.Effect<void>

/** One turn the engine holds live, and whether its provider is still saying anything. */
export interface LiveTurn {
  readonly owner: LiveOwner
  readonly startedAt: number
  /**
   * When the provider last reported an event — for a turn in a sandbox, when the runner's
   * connection delivered it. `Spawned` and `Reask` are the harness's own and do not count.
   */
  readonly lastEventAt: number | undefined
  /** The CLI's pid on this machine, or `runner.sh`'s for a turn in a sandbox. */
  readonly pid: number | undefined
  /** The runner's id for the command, where the turn runs in the trak's sandbox. */
  readonly execId: string | undefined
}

export class TurnTools extends Context.Tag("workflow/TurnTools")<TurnTools, TurnToolsShape>() {}
