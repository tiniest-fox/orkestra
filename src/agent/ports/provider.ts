// port: an agent provider, plus the spec that describes one.

import { Context, type Effect, type Scope, type Stream } from "effect"
import type { Dialogue } from "../types/dialogue.js"
import type { McpFailed, ProviderFailed } from "../types/errors.js"
import type { McpAnswer, McpReply, McpRequest } from "../types/mcp.js"
import type { ProviderEvent } from "../types/provider-event.js"
import type {
  PromptImage,
  SessionId,
  SessionRequest,
  SetupGate,
  SteeredMessage,
} from "../types/session.js"

/**
 * A provider is DATA plus two pure functions — never control flow. Everything
 * that actually runs a process lives in adapters/cli-provider.ts, once.
 *
 * To add a provider: copy `providers/claude/` — `argv.ts`, `normalize.ts` and
 * `index.ts` are the whole shape — and name the spec where the registry is built.
 */
/**
 * How a provider resumes a session, and whose id names it.
 *
 * A type difference rather than a comment on purpose: the two `Id` arms are what
 * make bidirectional handoff work — a human can `claude --resume <id>` or
 * `codex exec resume <id>` a session Orkestra started. `ContinueLast` cannot offer
 * that, and the engine must not be able to assume it silently.
 *
 * - `SuppliedId` — the CLI takes the id it is given, so the one minted before the
 *   turn is the session's.
 * - `ReportedId` — the CLI mints its own and announces it on `SessionStarted`; the
 *   minted id is ignored, and the announced one is what the engine records and
 *   resumes with.
 */
export type ResumeStrategy =
  | { readonly _tag: "SuppliedId" }
  | { readonly _tag: "ReportedId" }
  | { readonly _tag: "ContinueLast" }

/** Whether tool restrictions are enforced by the CLI or only by prompting. */
export type ToolRestrictionStrategy =
  | { readonly _tag: "NativeFlag" }
  | { readonly _tag: "PromptOnly" }

/**
 * Where the prompt goes — one choice, so the ways cannot contradict each
 * other. A provider with no streaming input keeps `Stdin` or `LastArg` and
 * behaves exactly as before, which is the whole degradation.
 *
 * `StreamJson` is the duplex one: the prompt travels as one line of the
 * provider's own framing, stdin is held open, and the turn ends at the
 * provider's own result frame rather than at stdin EOF — which is what keeps
 * background work the agent left running from being torn down. The two
 * functions are the provider's wire vocabulary, carried here because the
 * shared harness writes the lines and must not know any one CLI's framing:
 *
 * - `promptLine` — the line a prompt travels as, and a message steered into the
 *   running turn after it: both are a user message on the same pipe.
 * - `stopTaskLine` — the control line that stops one named background task.
 *   `requestId` is the harness's correlation handle; the provider echoes it in
 *   an acknowledgement the normalizer reads and drops.
 *
 * `Dialogue` is for a CLI that will not take the prompt until it has been asked
 * for things first — Codex's app server wants a handshake and a thread before a
 * turn, and the turn names the thread the server just minted, so no line written
 * at spawn can carry the prompt. The pipe is held as under `StreamJson`, and the
 * harness writes `opening` at spawn and then, for every line the provider
 * prints, whatever `replyTo` returns for it — before that line is normalized.
 * `dialogue` is called once per spawn with the prompt as the harness finished
 * it, restriction and brief included. A message steered into the turn is the
 * dialogue's to frame as well (`Dialogue.steer`), since it has to name a turn only
 * an earlier answer named. The harness closes the pipe on the same rule as
 * `StreamJson` and only once the dialogue is settled, so a provider under this arm
 * has to exit at stdin EOF.
 */
export type PromptDelivery =
  | { readonly _tag: "Stdin" }
  | { readonly _tag: "LastArg" }
  | {
      readonly _tag: "StreamJson"
      readonly promptLine: (prompt: string, images: readonly PromptImage[]) => string
      readonly stopTaskLine: (taskId: string, requestId: string) => string
    }
  | {
      readonly _tag: "Dialogue"
      readonly dialogue: (req: SessionRequest, prompt: string) => Dialogue
    }

/**
 * How the standing brief reaches the CLI.
 *
 * `SessionFlag`: the CLI has a per-session system prompt, `argv` puts the whole
 * brief on it, and it holds on every turn including resumes. `PromptBody`: the CLI
 * has none, so the harness writes the brief into the prompt itself — core and
 * contract when the conversation opens, the contract alone when a turn takes over a
 * conversation another position held, and nothing on an ordinary resume, which the
 * conversation already holds. A re-ask is an ordinary resume: re-sending several
 * thousand tokens the conversation has is what this split exists to avoid.
 */
export type BriefDelivery = { readonly _tag: "SessionFlag" } | { readonly _tag: "PromptBody" }

/**
 * A log the CLI writes beside its stream, read once the process has exited.
 *
 * Codex keeps each model call's count and the context window in its own session
 * file, and that file is where a step's meter takes them from. The harness reads the file after
 * the exit and pushes each line through `read`, the side file's own normalizer;
 * nothing in it is written to the transcript, and a file that cannot be found or
 * read yields nothing rather than failing the turn. A turn a person stops is
 * interrupted before this runs and carries no reading.
 *
 * `under` is the directory tree to search, from the environment the CLI was spawned
 * with and the home directory; `isFor` says whether a file name under it is the log
 * of `sessionId`, the id the provider announced. Three pure pieces, because
 * `cli-provider.ts` is the only thing that opens a file and a spec is data.
 */
export type SessionLog =
  | { readonly _tag: "None" }
  | {
      readonly _tag: "File"
      readonly under: (env: Readonly<Record<string, string | undefined>>, home: string) => string
      readonly isFor: (sessionId: SessionId, fileName: string) => boolean
      readonly read: (line: string) => readonly ProviderEvent[]
    }

/**
 * How a CLI is asked about the MCP servers it dialed, on the pipe a turn already
 * holds — the tool list, a resource, and a tool call, none of which is a model turn.
 *
 * Four pure pieces, for `PromptDelivery`'s reason: the harness writes the lines and
 * pairs the answers, and must not know any one CLI's framing.
 *
 * - `request` — the line one request travels as. `n` is the harness's count, which the
 *   provider frames as an id of its own and reads back in `reply`. `session` is the one
 *   the CLI announced; `undefined` from here means the request cannot be framed yet —
 *   Codex will not call a tool without a thread to name.
 * - `reply` — a line recognised as the answer to such a request, before the line is
 *   normalized. The normalizer drops the same line, so an answer nobody waits for is
 *   nothing.
 * - `answer` — an answer's body as what was asked for. `undefined` is a body this
 *   reader cannot make that of.
 * - `attending` — the conversation that opens a process holding no turn: what a CLI
 *   has to be told before it will answer, and nothing that starts the model. Its
 *   `settled` is the process being ready to be asked.
 */
export type McpWire =
  | { readonly _tag: "None" }
  | {
      readonly _tag: "Requests"
      readonly request: (
        request: McpRequest,
        n: number,
        session: SessionId | undefined,
      ) => string | undefined
      readonly reply: (line: string) => McpReply | undefined
      readonly answer: (request: McpRequest, body: unknown) => McpAnswer | undefined
      readonly attending: (req: SessionRequest) => Dialogue
    }

export interface CliProviderSpec {
  readonly name: string
  readonly command: string
  /**
   * Override 1: what to run.
   *
   * Handed `readOnlyTools` rather than reaching for its own copy, so that
   * overriding the field below reaches the flag as well as the prompt. It used
   * to close over a module constant, which made the override silently
   * decorative for a `NativeFlag` provider — `pnpm real:trak` announced a clamp
   * on `Bash` that was never on the command line.
   *
   * `mcpConfigPath` is where the harness wrote `mcpConfigFile`'s text for this spawn,
   * and `undefined` where that wrote nothing; `settingsPath` is the same for the file
   * `setupGate` makes.
   */
  readonly argv: (
    req: SessionRequest,
    readOnlyTools: readonly string[],
    mcpConfigPath: string | undefined,
    settingsPath?: string,
  ) => readonly string[]
  /**
   * Override 2: how to read its output — built once per spawn, and handed one line
   * at a time.
   *
   * A factory rather than the function, because one CLI names the turn's answer only
   * when the turn ends: Codex writes several messages per turn and the last before
   * the turn completes is the answer, which no memoryless reader can tell from the
   * narration before it. A provider whose lines each stand alone returns the same
   * function every time — Claude's does — and nothing is lost by it.
   */
  readonly normalizer: () => (line: string) => readonly ProviderEvent[]
  /** Override 3: where the prompt goes. */
  readonly promptDelivery: PromptDelivery
  /** Override 4: does a non-zero exit mean failure? */
  readonly failOnNonZeroExit: boolean
  /** Override 5: can a named session be resumed, and whose id names it? */
  readonly resume: ResumeStrategy
  /** Override 6: are tool restrictions enforced, or merely requested? */
  readonly toolRestriction: ToolRestrictionStrategy
  /**
   * Override 7: which of this provider's tools a `read-only` turn must not use.
   *
   * The engine says whether a turn writes; only the provider knows what its tools
   * are called. **This is the only copy**: cli-provider.ts reads it where
   * restrictions are only a request, and passes it to `argv` where they are a
   * flag. One list, so a spec spread with a wider one narrows both.
   */
  readonly readOnlyTools: readonly string[]
  /** Override 8: how the standing brief reaches the CLI. */
  readonly brief: BriefDelivery
  /** Override 9: a log the CLI keeps beside its stream, and how to read it after the exit. */
  readonly sessionLog: SessionLog
  /** Override 10: how the CLI is asked about its MCP servers. */
  readonly mcp: McpWire
  /**
   * Override 11: variables every spawn of this CLI carries, under whatever the request
   * lays over them. Here rather than where a turn's environment is built, because
   * naming one is knowing which CLI is being run.
   */
  readonly env: Readonly<Record<string, string>>
  /**
   * Override 13: the inherited variables the CLI signs in with. A spawn on the engine's
   * host inherits them with everything else; a sandboxed spawn inherits nothing, and is
   * handed these as the only credential it carries.
   */
  readonly credentials: readonly string[]
  /**
   * Override 12: the text of an MCP configuration file the CLI reads at spawn, or
   * `undefined` for none. For a CLI that takes its servers on its command line, which
   * any process on the machine can read: a server's `env` and `headers` carry
   * credentials. The harness writes the text to a file only this user can read, hands
   * `argv` its path, and removes it when the spawn's scope closes — after an exit and
   * after a kill alike.
   */
  readonly mcpConfigFile: (req: SessionRequest) => string | undefined
  /**
   * Override 14: where the CLI files a session run in `cwd`, as a path under its home
   * directory — or `undefined` where the engine keeps no copy of it. Read by an engine
   * whose turns run in a sandbox, which copies the file back to the same place under
   * this machine's home after every turn so a session outlives the sandbox it ran in.
   */
  readonly sessionFile: (cwd: string, sessionId: SessionId) => string | undefined
  /**
   * Override 15: the file under its home the CLI signs in through, or `undefined` for a
   * CLI handed its sign-in as a variable. An engine whose turns run in a sandbox never
   * writes a credential there, so it refuses a turn on a CLI that names one.
   */
  readonly signInFile: string | undefined
  /**
   * Override 16: the command a person types to pick `sessionId` up themselves, in the
   * directory the session ran in — the handoff line a surface offers beside its terminal.
   */
  readonly resumeLine: (sessionId: SessionId) => string
  /**
   * Override 17: how the CLI holds a shell command while `SessionRequest.setupGate`'s setup
   * runs. `SettingsFile` is the text of a file read at spawn, which the harness writes as
   * it writes `mcpConfigFile`'s and hands `argv` as `settingsPath`. `None` is a CLI with no
   * such hook, whose turn the engine starts only once setup has ended.
   */
  readonly setupGate: SetupGateDelivery
}

/** See `CliProviderSpec.setupGate`. */
export type SetupGateDelivery =
  | { readonly _tag: "SettingsFile"; readonly text: (gate: SetupGate) => string }
  | { readonly _tag: "None" }

/** One CLI: what the harness builds from a spec, and what a fake stands in for. */
export interface ProviderAdapter {
  readonly name: string
  readonly run: (req: SessionRequest) => Stream.Stream<ProviderEvent, ProviderFailed>
  /** Exposed so callers can tell whether the handoff promise actually holds. */
  readonly resume: ResumeStrategy
  /**
   * Stop one named background task of a session whose turn is still running,
   * down the same held-open pipe the turn is on. A control line, not a model
   * turn — it spends nothing. `false` means there was no open pipe to write:
   * the turn already ended, the process belonged to a daemon that is gone, or
   * the provider has no streaming input. The outcome a caller can watch for is
   * on the event stream — the level shrinking and the task's own stopped
   * notification — never in this answer.
   */
  readonly stopBackgroundTask: (sessionId: SessionId, taskId: string) => Effect.Effect<boolean>
  /**
   * Hand a person's message to a session whose turn is still running, down the same
   * held-open pipe. The model reads it when its current response or tool call ends,
   * and carries on in the same turn — nothing is stopped and nothing is resumed.
   *
   * `false` has `stopBackgroundTask`'s meaning: there was no open pipe to write. The
   * message is then nobody's, and the caller keeps it for the next turn. `true` says
   * the line was written, or is held to be written once the CLI names the turn, and
   * nothing about the model having read it — that is
   * `ProviderEvent.MessageDelivered` on the turn's stream, carrying this `key`.
   *
   * **`sessionId` is the one the turn was requested under.** A pipe is held by that
   * id for as long as the turn runs, whatever session the CLI announced.
   *
   * **A key already written down this turn's pipe is not written again**, and answers
   * `true`: two callers race to deliver one message — the press that sent it and the
   * turn that started under it — and the second must not make the model read it twice.
   */
  readonly steer: (sessionId: SessionId, message: SteeredMessage) => Effect.Effect<boolean>
  /**
   * Ask the CLI holding this session's pipe about its MCP servers, and wait for the
   * answer. A control line and its reply, not a model turn — it spends nothing, and it
   * is answered while a tool call of the turn is still running.
   *
   * `undefined` has `stopBackgroundTask`'s `false` for its meaning: there was no open
   * pipe to write. `McpFailed` is a pipe that was written and did not answer with what
   * was asked — the CLI refused, the pipe closed first, or the wait ran out.
   *
   * **A request still unanswered holds the turn's pipe open**, as a steered message
   * does, so the answer is not lost to the process ending under it.
   */
  readonly mcp: (
    sessionId: SessionId,
    request: McpRequest,
  ) => Effect.Effect<McpAnswer | undefined, McpFailed>
  /**
   * Start the CLI with no prompt and hold its pipe under `req.sessionId` for as long
   * as the scope lives, so `mcp` can be asked of it with no turn running. Nothing is
   * sent to the model and nothing is spent. Returns once the CLI is ready to be asked;
   * closing the scope ends the process.
   *
   * `req.prompt` is not read. Fails where the CLI did not start, exited before it was
   * ready, or has no way to be asked at all.
   */
  readonly attend: (req: SessionRequest) => Effect.Effect<void, ProviderFailed, Scope.Scope>
  /** The spec's `sessionFile`; absent where there is no CLI and so no file. */
  readonly sessionFile?: CliProviderSpec["sessionFile"]
  /** The spec's `signInFile`; absent where there is no CLI and so no file. */
  readonly signInFile?: string
  /** The spec's `resumeLine`; absent where there is no CLI for a person to run. */
  readonly resumeLine?: CliProviderSpec["resumeLine"]
  /** The spec's `credentials`; absent where there is no CLI and so nothing it signs in with. */
  readonly credentials?: readonly string[]
  /** Whether a turn's shell commands wait for `setupGate` — absent where they cannot. */
  readonly gatesCommands?: true
}

/**
 * What the engine holds: every adapter it can spawn, indexed per turn by the
 * request's model name — `<provider>/<model>` selects the adapter named, and a bare
 * name selects the first one registered. One registry rather than one adapter chosen
 * at boot, so a plan can run one step on each CLI, and so the per-task stop — which
 * has only a session id to go on — reaches whichever adapter holds that turn's pipe.
 */
export interface ProviderRegistry {
  /** Selects on `req.model` and hands the adapter the bare name; fails for a qualifier nothing answers to. */
  readonly run: (req: SessionRequest) => Stream.Stream<ProviderEvent, ProviderFailed>
  /** Every adapter is asked; only the one that spawned the turn holds its pipe. */
  readonly stopBackgroundTask: (sessionId: SessionId, taskId: string) => Effect.Effect<boolean>
  /** Every adapter is asked, as for the stop; `false` where none holds the turn's pipe. */
  readonly steer: (sessionId: SessionId, message: SteeredMessage) => Effect.Effect<boolean>
  /** Every adapter is asked in turn; `undefined` where none holds the session's pipe. */
  readonly mcp: ProviderAdapter["mcp"]
  /** Selects on `req.model` as `run` does, and fails the same way for a qualifier nothing answers to. */
  readonly attend: ProviderAdapter["attend"]
  /** The name of the adapter `model` selects — the CLI's own — or `undefined` where none does. */
  readonly cliFor: (model: string) => string | undefined
  /** The declared strategy of the adapter `model` selects; `undefined` where none does. */
  readonly resumeFor: (model: string) => ResumeStrategy | undefined
  /**
   * Where the adapter `model` selects files a session run in `cwd`, under its home —
   * `undefined` where none does, or it keeps no file the engine copies.
   */
  readonly sessionFileFor: (model: string, cwd: string, sessionId: SessionId) => string | undefined
  /** The file the adapter `model` selects signs in through; `undefined` where none does. */
  readonly signInFileFor: (model: string) => string | undefined
  /**
   * The command a person runs to resume `sessionId`, from the adapter `model` selects —
   * `undefined` where none does, or it has no CLI for a person to run.
   */
  readonly resumeLineFor: (model: string, sessionId: SessionId) => string | undefined
  /** Every adapter's `credentials`, once each: what a person's own shell for a sandbox carries. */
  readonly credentials: readonly string[]
  /**
   * Whether the adapter `model` selects holds a turn's shell commands while setup runs, so
   * the turn may start beside it. `false` where none does.
   */
  readonly gatesCommandsFor: (model: string) => boolean
}

/**
 * True when a session Orkestra starts can be picked up by a human later.
 * Check this rather than assuming — see ResumeStrategy.
 */
export const supportsSessionHandoff = (strategy: ResumeStrategy): boolean =>
  strategy._tag !== "ContinueLast"

export class Provider extends Context.Tag("agent/Provider")<Provider, ProviderRegistry>() {}
