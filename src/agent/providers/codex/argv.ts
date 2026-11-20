// logic: override point 1 of 2 for the Codex provider — what to run.
// Pure and independently testable; the Claude sibling is `../claude/argv.ts`.

import { Option, Schema } from "effect"
import type { Dialogue } from "../../types/dialogue.js"
import type { McpRequest } from "../../types/mcp.js"
import {
  McpServer,
  type PromptImage,
  type SessionId,
  type SessionRequest,
  type SteeredMessage,
} from "../../types/session.js"

/**
 * What `toolAccess: "read-only"` means to Codex, said in the prompt rather than
 * enforced: a thread has one sandbox setting and no per-tool deny list, and every
 * turn runs with the sandbox open by decision — the read-only sandbox also takes
 * away the web and all scratch writing, which a reading step still needs. So a
 * reading step that edits anyway is not stopped, and the edit reaches the branch.
 *
 * `apply_patch` is the editing tool by name; the shell is named by what it must not
 * do, because it is also how every read happens.
 */
export const CODEX_READ_ONLY_TOOLS: readonly string[] = [
  "apply_patch",
  "any shell command that writes to the checkout",
]

/**
 * `codex app-server`, which speaks JSON-RPC over stdio, one object per line. Nothing
 * else is on the command line: the model, the sandbox and the session all travel in
 * the requests `codexDialogue` writes, and the prompt in the last of them.
 *
 * It reads nothing of the request for that reason, and nothing of `readOnlyTools`:
 * the restriction is prompt-only here, and the harness is what writes it into the body.
 */
export const codexArgv = (): readonly string[] => ["app-server"]

// The ids this client gives the three requests that open a turn. Every request after
// them — a message steered into the turn, or started as a turn of its own — counts
// up from here.
const INITIALIZE = 1
const THREAD = 2
const TURN = 3

/**
 * Whether `id` names one of the three requests the step's own turn stands on. A
 * refusal of one of those is the turn failing before it began; a refusal of anything
 * later is a message that was not taken, which the dialogue answers and which must
 * not fail a turn that is running or already answered.
 */
export const codexOpensTurn = (id: number | string): boolean =>
  id === INITIALIZE || id === THREAD || id === TURN

/** One line, as far as the dialogue reads it: an answer by `id`, or a turn's ending. */
const Line = Schema.Struct({
  id: Schema.optional(Schema.Number),
  method: Schema.optional(Schema.String),
  params: Schema.optional(
    Schema.Struct({
      threadId: Schema.optional(Schema.String),
      turn: Schema.optional(Schema.Struct({ id: Schema.optional(Schema.String) })),
    }),
  ),
  result: Schema.optional(
    Schema.Struct({
      thread: Schema.optional(Schema.Struct({ id: Schema.String })),
      turn: Schema.optional(Schema.Struct({ id: Schema.String })),
    }),
  ),
  error: Schema.optional(Schema.Unknown),
})
const asLine = Schema.decodeUnknownOption(Schema.parseJson(Line))

/**
 * One user input: the text, then each picture as a `localImage` the app server reads off
 * the disk it runs beside — the checkout, at the path the CLI's own process spells it.
 */
const textInput = (text: string, images: readonly PromptImage[] = []): readonly unknown[] => [
  { type: "text", text, text_elements: [] },
  ...images.map((image) => ({ type: "localImage", path: image.path })),
]

const request = (method: string, id: number, params: Record<string, unknown>): string =>
  JSON.stringify({ method, id, params })

/** What a `turn/steer` and a follow-on `turn/start` share: the thread, the message, and its key. */
const carrying = (
  thread: string | undefined,
  message: SteeredMessage,
): Record<string, unknown> => ({
  threadId: thread,
  clientUserMessageId: message.key,
  input: textInput(message.text, message.images),
})

/**
 * What every thread request carries, a fresh thread and a resumed one alike — a
 * resume takes them as overrides, so a step that resumes on another model or effort
 * runs on what it declared.
 *
 * `approvalPolicy: "never"` is what keeps the server from asking this client a
 * question: an approval request nobody answers is a turn that never ends, and
 * `codexNormalizer` fails the turn on any request that arrives anyway.
 *
 * `model_reasoning_summary` is what puts a summary on a `reasoning` item at all:
 * unset, Codex spends the reasoning tokens and the item completes empty, whatever the
 * effort. The summary is a header per part, never the chain of thought, so the cost
 * is a few summary tokens and the gain is the pause a watcher sees drawn with what
 * the model was working out. Fixed here rather than a key in the agent file: a
 * display concern, and a step that draws nothing until somebody sets a key is the
 * wrong default.
 *
 * `model_reasoning_effort` travels the same way, and only where something declared
 * one: unset, Codex runs the model at its catalog's own default. Checked against the
 * CLI's vocabulary at load and never against the model's — the catalog is Codex's.
 */
const threadSettings = (req: SessionRequest): Record<string, unknown> => ({
  model: req.model,
  cwd: req.cwd,
  sandbox: "danger-full-access",
  approvalPolicy: "never",
  config: {
    model_reasoning_summary: "detailed",
    ...(req.effort === undefined ? {} : { model_reasoning_effort: req.effort }),
    // One dotted key per server, as `-c mcp_servers.<name>=…` sets one: the table in
    // `config.toml` is not replaced, so the person's own servers stay.
    ...Object.fromEntries(
      Object.entries(req.mcpServers ?? {}).map(([name, server]) => [
        `mcp_servers.${name}`,
        {
          // `config.toml`'s own keys: a `url` with no `command` is a streamable-HTTP server.
          // `env` is the server's alone: Codex's own environment, and every command the
          // agent runs, never holds a credential a server carries.
          ...McpServer.$match(server, {
            Stdio: ({ command, args, env }) => ({ command, args, env }),
            Http: ({ url, headers }) => ({
              url,
              ...(headers === undefined ? {} : { http_headers: headers }),
            }),
          }),
          ...(server.timeoutSeconds === undefined
            ? {}
            : { tool_timeout_sec: server.timeoutSeconds }),
        },
      ]),
    ),
  },
})

/** The second request: a fresh thread, or the one `req.resumeFrom` names. */
const threadRequest = (req: SessionRequest): string =>
  req.resumeFrom === undefined
    ? request("thread/start", THREAD, threadSettings(req))
    : request("thread/resume", THREAD, {
        threadId: req.resumeFrom,
        // Without `excludeTurns` the answer carries every turn the thread has held,
        // on one line, and nothing here reads any of it.
        excludeTurns: true,
        ...threadSettings(req),
      })

/**
 * One spawn's side of the conversation with `codex app-server`: `initialize`, then a
 * thread, then the turn that carries the prompt. Each request waits on the answer to
 * the one before, because the turn has to name the thread and on a fresh one only
 * the server's answer says what that is — Codex mints the id
 * (`ResumeStrategy.ReportedId`), and the minted one in `req.sessionId` is never sent.
 *
 * A resume is `thread/resume` by the id Codex announced, which is the same thread
 * `codex exec resume <id>` picks up by hand. The brief is in the prompt body: the
 * thread request has a field for it and this does not use it
 * (`BriefDelivery.PromptBody`).
 *
 * **A refused opening request gets no reply from here.** The server answers it with
 * an `error` in place of a `result`, `codexNormalizer` fails the turn on that line,
 * and the harness ends the process.
 *
 * **A person's message is `turn/steer`, and it has to name the turn in progress.** So
 * one that arrives before the `turn/start` answer is held and written when the answer
 * names the turn. `clientUserMessageId` is the message's key: Codex puts it back on
 * the `userMessage` item it writes when the model receives the message, which is how
 * `codexNormalizer` reports the delivery and tells it from the prompt's own item.
 *
 * **A steer Codex refuses becomes a turn of its own, in this process.** The refusal
 * seen is `no active turn to steer`: the message arrived as the turn was ending. It is
 * sent as a `turn/start` on the same thread once the turn before it has ended —
 * never beside a turn still running — and that turn's reply is drawn and files
 * nothing, since the step's answer is the first turn's. One follow-on turn at a time:
 * a second refused message is steered into the first one's turn.
 */
export const codexDialogue = (req: SessionRequest, prompt: string): Dialogue => {
  let thread: string | undefined
  // The turn in progress, from the answer that names it until its `turn/completed`.
  let turn: string | undefined
  // A `turn/start` is on its way or unanswered. True from the first line, because the
  // opening requests lead to one.
  let starting = true
  let lastId = TURN
  // Messages with no request of their own in flight: waiting for a turn to be named.
  const held: SteeredMessage[] = []
  // Each `turn/steer` not yet answered, and each follow-on `turn/start`, by request id.
  const steers = new Map<number, SteeredMessage>()
  const starts = new Set<number>()

  const steerLine = (message: SteeredMessage, into: string): string => {
    lastId += 1
    steers.set(lastId, message)
    return request("turn/steer", lastId, { ...carrying(thread, message), expectedTurnId: into })
  }

  /** The oldest held message as a turn of its own, where no turn is running or coming. */
  const startHeld = (): readonly string[] => {
    if (turn !== undefined || starting) return []
    const message = held.shift()
    if (message === undefined) return []
    starting = true
    lastId += 1
    starts.add(lastId)
    return [request("turn/start", lastId, carrying(thread, message))]
  }

  const turnAnswered = (id: number, named: string | undefined): readonly string[] => {
    starting = false
    if (named === undefined) {
      // No turn came of it. The step's own turn refused is the turn failing, which
      // `codexNormalizer` says and nothing here replaces. A follow-on's message is
      // not asked again; the next held one is, so one refusal cannot leave the rest
      // waiting on a turn that is not coming.
      return id === TURN ? [] : startHeld()
    }
    turn = named
    // Every held message goes into the turn just named.
    return held.splice(0).map((message) => steerLine(message, named))
  }

  const answered = (id: number, line: Schema.Schema.Type<typeof Line>): readonly string[] => {
    if (id === INITIALIZE) return [JSON.stringify({ method: "initialized" }), threadRequest(req)]
    if (id === THREAD) {
      if (line.result?.thread === undefined) return []
      thread = line.result.thread.id
      return [
        request("turn/start", TURN, { threadId: thread, input: textInput(prompt, req.images) }),
      ]
    }
    if (id === TURN || starts.delete(id)) return turnAnswered(id, line.result?.turn?.id)
    const steered = steers.get(id)
    if (steered === undefined) return []
    steers.delete(id)
    if (line.error === undefined) return []
    held.push(steered)
    return startHeld()
  }

  return {
    opening: request("initialize", INITIALIZE, {
      clientInfo: { name: "orkestra", title: "Orkestra", version: "0" },
    }),
    replyTo: (text) => {
      const decoded = asLine(text)
      if (Option.isNone(decoded)) return []
      const line = decoded.value
      if (line.method === undefined) return line.id === undefined ? [] : answered(line.id, line)
      // A subagent's turn ends on this connection too, naming its own thread.
      const ours = line.params?.threadId === thread && line.params?.turn?.id === turn
      if (line.method !== "turn/completed" || turn === undefined || !ours) return []
      turn = undefined
      return startHeld()
    },
    steer: (message) => {
      if (turn !== undefined) return [steerLine(message, turn)]
      held.push(message)
      return startHeld()
    },
    settled: () => turn === undefined && !starting && held.length === 0 && steers.size === 0,
  }
}

/**
 * Where the ids of MCP requests start. The dialogue counts its own up from the three
 * that open a turn, one per message a person sends, so a request numbered from here is
 * one no dialogue of any length will have written — and an answer to it is one the
 * dialogue reads as nothing of its own.
 */
export const CODEX_MCP_IDS = 1_000_000

/**
 * One MCP request as a JSON-RPC line: `mcpServerStatus/list`, `mcpServer/resource/read`
 * and `mcpServer/tool/call`, none of which starts a turn. A call has to name a thread,
 * which is the session Codex announced — so before the thread request is answered there
 * is no line to write for one.
 */
export const codexMcpRequest = (
  asked: McpRequest,
  n: number,
  session: SessionId | undefined,
): string | undefined => {
  const id = CODEX_MCP_IDS + n
  switch (asked._tag) {
    case "ListTools":
      return JSON.stringify({ method: "mcpServerStatus/list", id, params: {} })
    case "ReadResource":
      return JSON.stringify({
        method: "mcpServer/resource/read",
        id,
        params: { server: asked.server, uri: asked.uri },
      })
    case "CallTool":
      return session === undefined
        ? undefined
        : JSON.stringify({
            method: "mcpServer/tool/call",
            id,
            params: {
              server: asked.server,
              threadId: session,
              tool: asked.tool,
              arguments: asked.arguments,
            },
          })
  }
}

/**
 * The opening of a `codex app-server` that holds no turn: the handshake, then a thread
 * and no `turn/start`. A tool call has to name a thread and a fresh one is free, so
 * the thread is the whole reason for the second request. Ready once it is answered —
 * the harness reads the thread's id off that answer, as it does for a turn.
 */
export const codexAttending = (req: SessionRequest): Dialogue => {
  let ready = false
  return {
    opening: request("initialize", INITIALIZE, {
      clientInfo: { name: "orkestra", title: "Orkestra", version: "0" },
    }),
    replyTo: (text) => {
      const decoded = asLine(text)
      if (Option.isNone(decoded) || decoded.value.method !== undefined) return []
      if (decoded.value.id === INITIALIZE) {
        return [
          JSON.stringify({ method: "initialized" }),
          request("thread/start", THREAD, {
            cwd: req.cwd,
            sandbox: "read-only",
            approvalPolicy: "never",
          }),
        ]
      }
      if (decoded.value.id === THREAD) ready = true
      return []
    },
    steer: () => [],
    settled: () => ready,
  }
}

/**
 * Where Codex keeps its session logs: `sessions/` under its home, which is
 * `CODEX_HOME` where the environment names one and `~/.codex` otherwise. The tree
 * below it is dated — `2026/09/22/rollout-…jsonl` — so the harness walks it rather
 * than building a date the file name may not share with the turn.
 */
export const codexSessionsDir = (
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string => `${env["CODEX_HOME"] ?? `${home}/.codex`}/sessions`

/**
 * A rollout file is named `rollout-<started at>-<thread id>.jsonl`, and the thread id
 * is the one the thread request's answer announced — the only part of the name the stream says.
 */
export const codexRolloutFor = (sessionId: SessionId, fileName: string): boolean =>
  fileName.startsWith("rollout-") && fileName.endsWith(`-${sessionId}.jsonl`)

/** What a person runs to pick a thread up: `codex resume <id>`, Codex's interactive resume. */
export const codexResumeLine = (sessionId: SessionId): string => `codex resume ${sessionId}`
