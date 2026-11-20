// types: data declarations only. No behavior.

import { Data, Schema } from "effect"

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"))
export type SessionId = Schema.Schema.Type<typeof SessionId>

/**
 * What the session is allowed to do without asking a human.
 *
 * Required, and deliberately not defaulted. A non-interactive `claude --print`
 * with no permission mode DENIES Write/Edit and still reports
 * `subtype: "success", is_error: false` — so a step told to change files returns
 * a confident artifact describing work that never happened. Forcing every call
 * site to choose is what stops that being the accidental default.
 *
 * - `read`  — may read and search, cannot modify. Planning and review steps.
 * - `edit`  — may modify files in `cwd` without prompting. Implementation steps.
 * - `auto`  — a classifier the CLI runs judges each call and refuses the risky ones,
 *             with nobody asked. A refusal comes back as a failed tool call inside a
 *             turn that still exits `subtype: "success"`.
 * - `full`  — bypasses all checks. Only for a sandbox we control.
 *
 * The engine sends `auto` for a step that writes and `full` for everything else: a
 * read-only step, a writer whose writes are refused, and both composers. `read` and
 * `edit` are both scoped to `cwd`, and anything outside it — a sibling checkout the
 * composer wants to read — falls through to an interactive prompt that a `--print`
 * session has nobody to answer, and the turn lies about it as above. `auto` asks
 * nobody either, so a refusal there is the agent's to report: a step that needs the
 * call returns a `permission` envelope naming it, and a person's yes clears it on the
 * resumed session. The composers keep `full` because their own MCP calls must not
 * meet a classifier.
 *
 * `full` is otherwise a placeholder for two things we cannot express yet: extra
 * readable roots (`claude --add-dir`) and a sandbox to run inside. What still
 * constrains an agent meanwhile is `toolAccess`, which becomes a deny list the CLI
 * enforces regardless of permission mode.
 */
export type PermissionMode = "read" | "edit" | "auto" | "full"

/**
 * Whether this turn is expected to change the checkout it runs in.
 *
 * Two values rather than the free-form deny list this replaced, because every
 * use of that list spelled out the same edit tools — it was spelling `read-only`
 * the long way.
 *
 * **Which tools that becomes is the provider's business.** `Edit`, `Write` and
 * `NotebookEdit` are Claude's names for them; another provider names them
 * differently, or can only ask rather than enforce. So the request carries the
 * intent and `providers/<name>/` carries the translation — see
 * `CliProviderSpec.readOnlyTools`.
 *
 * The same two words an agent declares in `.orkestra/agents/*.md`, and
 * deliberately so, but not the same type: this is what a session was asked for,
 * and that is what a role declares. `workflow/` is the one module that sees both.
 */
export type ToolAccess = "read-only" | "write"

/**
 * The rules that hold for every turn of a session, in the two parts a CLI may have
 * to deliver separately.
 *
 * `core` is the framing every role shares, and `contract` is the role's own output
 * shape. They are one text to a CLI with a per-session system prompt, which is told
 * both on every turn; a CLI with none is told the core once, when the conversation
 * opens, and the contract again only when a turn takes over a conversation another
 * position held — see `CliProviderSpec.brief`.
 */
export interface StandingBrief {
  readonly core: string
  readonly contract: string
}

/**
 * A picture handed to the turn beside its prompt: `path` is where the file lies in `cwd`,
 * absolute as the CLI's own process spells it, and `data` its bytes as base64. A CLI that
 * takes pictures inline sends `data` and `mediaType`; one that reads a local file sends
 * `path`.
 */
export interface PromptImage {
  readonly path: string
  readonly mediaType: string
  readonly data: string
}

export interface SessionRequest {
  readonly prompt: string
  /**
   * Pictures this turn's prompt carries — the images a person sent with the words it
   * holds. Left out by every turn that carries none.
   */
  readonly images?: readonly PromptImage[]
  readonly cwd: string
  /**
   * As `models.yaml` lists it: a bare name, or `<provider>/<name>` where the
   * qualifier picks the CLI. The registry strips the qualifier before an adapter
   * sees it, so a spec's `argv` is handed the bare name.
   */
  readonly model: string
  /**
   * The reasoning effort this turn runs at, as `models.yaml` or the agent file spelled
   * it, already checked against the CLI's levels at load. `undefined` sends no flag at
   * all, so the CLI runs at its own default — which is every turn of a project that
   * declares none. Resolved off the entry that minted the session, the way `model` is:
   * a conversation never changes parameters mid-way.
   */
  readonly effort: string | undefined
  /**
   * The id this turn is filed under before it runs. A CLI that takes a session id
   * claims it (`claude --session-id`); one that announces its own ignores it, and
   * the id it announces on `SessionStarted` is the one the engine records — see
   * `ResumeStrategy`.
   */
  readonly sessionId: SessionId
  readonly toolAccess: ToolAccess
  readonly permission: PermissionMode
  /** Present when resuming an existing session rather than starting one. */
  readonly resumeFrom: SessionId | undefined
  /**
   * Whether `resumeFrom` is a conversation another position held, which this turn is
   * the first to pick up — an entry with `continues` on its first run. `false` on a
   * fresh session and on every turn of a conversation this position already owns,
   * a re-ask included. It is what tells a CLI with no session prompt that the
   * contract has to be said again.
   */
  readonly inherited: boolean
  /**
   * The standing brief. `undefined` sends none at all — which is what a test fake
   * wants, and what makes its absence observable.
   */
  readonly brief: StandingBrief | undefined
  /**
   * Variables laid over the inherited environment for this turn's spawn — what the
   * project's env script left exported, resolved in `cwd` by whoever built the request.
   * Empty means the turn inherits exactly what the engine has, which is what a project
   * without such a script gets and what every fake sends.
   */
  readonly env: Readonly<Record<string, string>>
  /**
   * Whether one result's text ends the turn. `elicit` and `converse` set it to "holds
   * the envelope this step may return", and they hand the same test to the fold that
   * reads the answer — so the result a pipe closed on is the one the answer is read from.
   *
   * A result it accepts is the turn's answer: a harness that holds the pipe stops the
   * background work the agent left running, and reads no later result. One it refuses, written while background work is outstanding, keeps
   * the turn open, and every later result is read.
   *
   * Left out by a caller that runs a provider with no envelope to wait for. No result
   * settles such a turn, and it ends when the background work has.
   */
  readonly settles?: Settles
  /**
   * MCP servers this session dials beside whatever the CLI's own configuration names,
   * keyed by the name its tools are called under. Added, never instead: the repository's
   * and the person's servers stay. Left out by every turn that is handed none.
   */
  readonly mcpServers?: Readonly<Record<string, McpServer>>
  /**
   * The credential this turn's CLI signs in with, where it is not the one the engine
   * inherited — a host user's own, asked of the host for this spawn. Left out by every turn
   * that runs on what the engine holds.
   */
  readonly signIn?: SignIn
  /** Handed to the CLI's spawn as `ProcessSpec.allowedOnHost`. Left out by every turn but one with no checkout. */
  readonly allowedOnHost?: true
  /** Handed to the CLI's spawn as `ProcessSpec.inProject`. Set only on a turn the project's sandbox runs. */
  readonly inProject?: true
  /**
   * A setup still running in `cwd`, which every shell command of the turn waits for — on a
   * CLI that can hold a command, which the registry's `gatesCommandsFor` says. Left out by
   * every turn with no setup running beside it.
   */
  readonly setupGate?: SetupGate
  /**
   * The exec id of this turn's command, still running detached in its sandbox after the
   * engine that started it died: the provider rejoins it and reads its stream from the
   * start rather than spawning — see `ProcessSpec.attach`. Left out by every other turn.
   */
  readonly reattach?: string
  /**
   * The id this turn's command runs under in a sandbox, minted by the caller so it is on
   * the run record before the spawn — see `ProcessSpec.execId`. Left out with no runner,
   * and by a re-ask, which is a spawn of its own.
   */
  readonly execId?: string
}

/**
 * Where a turn's shell commands learn whether setup has finished: `statusFile`'s first line
 * is `running`, `passed` or `failed`, and a failure's lines after it are what a refused
 * command is told. A command waits while it says `running`, and runs where the file is
 * missing. `waitSeconds` is how long one command may wait, longer than setup may run.
 */
export interface SetupGate {
  readonly statusFile: string
  readonly waitSeconds: number
}

/**
 * A credential for one spawn: `env` is laid over everything else the spawn is handed, and
 * no name in `withhold` reaches it — inherited, from the turn's own `env`, or into a
 * sandbox — so the CLI is handed this credential and no other one. It travels as the
 * spawn's environment, never on its command line or in a file.
 */
export interface SignIn {
  readonly env: Readonly<Record<string, string>>
  readonly withhold: readonly string[]
}

/**
 * One MCP server handed to a single session, for that session alone. A `Stdio` server
 * is started by the CLI, and `env` is laid over the CLI's own environment for the
 * server's process, which is how a server learns who it is serving. An `Http` server is
 * already running: the CLI dials `url` over streamable HTTP, sending `headers` with
 * every request.
 *
 * `env` and `headers` may carry credentials, so they reach the server alone: never the
 * CLI's own environment, which every command the agent runs inherits, and never the
 * CLI's command line, which any process on the machine can read.
 *
 * `timeoutSeconds` is how long one tool call may run before the CLI gives up on it. Left
 * out, the CLI's own default holds — a minute under Codex, which a server whose calls
 * wait on a script has to raise.
 */
export type McpServer = Data.TaggedEnum<{
  Stdio: {
    readonly command: string
    readonly args: readonly string[]
    readonly env: Readonly<Record<string, string>>
    readonly timeoutSeconds?: number
  }
  Http: {
    readonly url: string
    readonly headers?: Readonly<Record<string, string>>
    readonly timeoutSeconds?: number
  }
}>
export const McpServer = Data.taggedEnum<McpServer>()

/** See `SessionRequest.settles`. */
export type Settles = (text: string) => boolean

/**
 * A message for a running turn: what the person typed, under the handle its delivery is
 * reported by, and the pictures they sent with it.
 */
export interface SteeredMessage {
  readonly key: string
  readonly text: string
  readonly images?: readonly PromptImage[]
}
