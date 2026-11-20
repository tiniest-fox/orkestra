// logic: override point 1 of 2 for the Claude provider — what to run.
// Pure and independently testable; adding a provider means writing a sibling.

import type { Dialogue } from "../../types/dialogue.js"
import type { McpRequest } from "../../types/mcp.js"
import {
  McpServer,
  type PermissionMode,
  type PromptImage,
  type SessionId,
  type SessionRequest,
  type SetupGate,
} from "../../types/session.js"

/** Our four-way choice onto claude's --permission-mode vocabulary. */
const PERMISSION_FLAG: Record<PermissionMode, string> = {
  read: "plan",
  edit: "acceptEdits",
  auto: "auto",
  full: "bypassPermissions",
}

/**
 * What `toolAccess: "read-only"` means to claude specifically — the default the
 * spec carries, not a list this file reads.
 *
 * `claudeArgv` takes the names as an argument rather than closing over them, so
 * a spec spread with a wider list (`pnpm real:trak` adds `Bash` and `Task`)
 * reaches the flag and not only the prompt. Closing over the constant made that
 * override decorative, and the demo printed a clamp it was not applying.
 */
export const CLAUDE_READ_ONLY_TOOLS: readonly string[] = ["Edit", "Write", "NotebookEdit"]

/**
 * The configuration file's own JSON: `type: "stdio"` for a server the CLI starts,
 * `type: "http"` for a streamable-HTTP one it dials. Values are written as they are,
 * credentials included, which is why this is a file the harness writes for the spawn
 * and never `--mcp-config`'s inline form — argv is readable by every process on the
 * machine. `undefined` for a session handed no server.
 */
export const claudeMcpConfigFile = (req: SessionRequest): string | undefined =>
  req.mcpServers === undefined
    ? undefined
    : JSON.stringify({
        mcpServers: Object.fromEntries(
          Object.entries(req.mcpServers).map(([name, server]) => [
            name,
            {
              ...McpServer.$match(server, {
                Stdio: ({ command, args, env }) => ({ type: "stdio", command, args, env }),
                Http: ({ url, headers }) => ({
                  type: "http",
                  url,
                  ...(headers === undefined ? {} : { headers }),
                }),
              }),
              // Milliseconds, per server, over `MCP_TOOL_TIMEOUT`.
              ...(server.timeoutSeconds === undefined
                ? {}
                : { timeout: server.timeoutSeconds * 1000 }),
            },
          ]),
        ),
      })

/** `path` as one word to `sh`, whatever it holds. */
const shellWord = (path: string): string => `'${path.replaceAll("'", `'\\''`)}'`

/**
 * The hook that holds a Bash command while setup runs: it reads the status file's first
 * line once a second while it says `running`, then lets the command through — or, on
 * `failed`, prints the lines after it and exits 2, which is Claude Code refusing the call
 * and showing the model what was printed. A missing file lets every command through.
 */
export const claudeSetupHold = (statusFile: string): string => {
  const file = shellWord(statusFile)
  const first = `"$(head -n 1 ${file} 2>/dev/null)"`
  return `while [ ${first} = running ]; do sleep 1; done; if [ ${first} = failed ]; then tail -n +2 ${file} >&2; exit 2; fi`
}

/**
 * The `--settings` file for a turn beside a setup still running: one `PreToolUse` hook on
 * `Bash`. Its `timeout` is the gate's, because Claude Code's own default for a hook is a
 * minute and an install runs longer.
 */
export const claudeSetupSettings = (gate: SetupGate): string =>
  JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: claudeSetupHold(gate.statusFile),
              timeout: gate.waitSeconds,
            },
          ],
        },
      ],
    },
  })

/**
 * Deliberately absent: `--setting-sources` and any output-style flag. A worker turn runs
 * under whatever Claude Code's own settings resolution produces for `cwd` — the user's
 * `~/.claude/`, the repository's `.claude/settings.json`, its git-ignored
 * `settings.local.json`. Orkestra inherits that rather than pinning one: a style pinned
 * here would be a second channel restating the house rules that already travel on
 * `--append-system-prompt`, and it would override the project's own choice for a
 * repository driven with `--dir`. What a project wants every worker turn to run under goes
 * in its tracked `.claude/settings.json`.
 *
 * **`--settings` is passed only beside a setup still running**, naming the file
 * `claudeSetupSettings` wrote. It adds a hook to what those sources hold and replaces none
 * of them.
 */
export const claudeArgv = (
  req: SessionRequest,
  readOnlyTools: readonly string[],
  mcpConfigPath: string | undefined,
  settingsPath?: string,
): readonly string[] => [
  "--print",
  "--verbose",
  "--output-format",
  "stream-json",
  // Streaming input: the prompt arrives as a JSON user message on a held-open
  // stdin (see `claudePromptLine`), so the turn ends at its own result frame and
  // background work the agent left running is not torn down at stdin EOF.
  "--input-format",
  "stream-json",
  // Each user message is printed back as the model receives it, which is the only
  // report of when a message steered into the turn was read — it lags the write by a
  // whole tool call. The prompt is echoed too; the harness tells the two apart.
  "--replay-user-messages",
  "--model",
  req.model,
  // Nothing resolved means no flag, and the CLI's own default. Never checked here:
  // claude warns on stderr for a level it does not know and runs anyway at exit 0,
  // so the load-time check in the library is the only guard there is.
  ...(req.effort === undefined ? [] : ["--effort", req.effort]),
  // Without this claude denies Write/Edit and still exits "success".
  // Never omit it, never default it.
  "--permission-mode",
  PERMISSION_FLAG[req.permission],
  // Resume reuses the id; a fresh session claims it. Either way the id is ours,
  // which is what makes `claude --resume <id>` work for a human afterwards.
  // The id must be a UUID: claude rejects anything else outright.
  ...(req.resumeFrom === undefined
    ? ["--session-id", req.sessionId]
    : ["--resume", req.resumeFrom]),
  // Persists across resumes because it is the session's system prompt, not a
  // turn's input — which is why the always-true rules go here and not in the
  // prompt body. Both halves of the brief, every turn: the flag is the session's,
  // so there is nothing a resume would be repeating.
  ...(req.brief === undefined
    ? []
    : ["--append-system-prompt", `${req.brief.core}\n\n${req.brief.contract}`]),
  // The file `claudeMcpConfigFile` wrote. Added to the servers the CLI's own settings
  // name: `--strict-mcp-config` is never passed, so the repository's and the person's
  // servers are still dialed.
  ...(mcpConfigPath === undefined ? [] : ["--mcp-config", mcpConfigPath]),
  ...(settingsPath === undefined ? [] : ["--settings", settingsPath]),
  // Last by habit rather than by necessity: --disallowedTools is variadic
  // (<tools...>), and under streaming input there is no positional argument for
  // it to swallow — the prompt travels as a stdin line.
  ...(req.toolAccess === "write" ? [] : ["--disallowedTools", ...readOnlyTools]),
]

/**
 * The line a prompt travels as under `--input-format stream-json`: claude's own
 * user-message frame, one JSON object per line. A message steered into the running
 * turn is the same frame, read at the model's next tool boundary.
 *
 * **Each picture is an image block of its own, ahead of the text**, carrying its bytes
 * rather than its path: the session file keeps the block, so `claude --resume` still
 * holds the picture once the checkout it came from is gone. The echo the harness pairs a
 * steered message by reads the text blocks alone, so the pictures do not move it.
 */
export const claudePromptLine = (prompt: string, images: readonly PromptImage[] = []): string =>
  JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        ...images.map((image) => ({
          type: "image",
          source: { type: "base64", media_type: image.mediaType, data: image.data },
        })),
        { type: "text", text: prompt },
      ],
    },
  })

/**
 * The control line that stops one named background task — measured at 6 ms to a
 * `control_response` acknowledgement, then an empty level and a `stopped`
 * notification for the task. A frame on the open pipe, not a model turn, so
 * writing it spends nothing.
 */
export const claudeStopTaskLine = (taskId: string, requestId: string): string =>
  JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request: { subtype: "stop_task", task_id: taskId },
  })

/**
 * What every `claude` spawn carries. `CLAUDE_CODE_MCP_APPS_HOST` is what makes the CLI
 * tell each MCP server it dials that views are understood; a server that checks for
 * that before offering a tool with a view offers none without it.
 */
export const CLAUDE_ENV: Readonly<Record<string, string>> = { CLAUDE_CODE_MCP_APPS_HOST: "1" }

const controlRequest = (requestId: string, request: Record<string, unknown>): string =>
  JSON.stringify({ type: "control_request", request_id: requestId, request })

/** The id an MCP request travels under, and what `claudeMcpReply` reads the count back off. */
export const CLAUDE_MCP_ID = "ork-mcp-"

/**
 * One MCP request as a control line: the tool list is `mcp_status`, a resource is
 * `mcp_read_resource`, and a call is `mcp_call` under the tool's qualified name. Each
 * is answered by a `control_response` carrying the same id, with no model turn — while
 * a tool call of the turn is running as much as with no turn at all, and under every
 * permission mode.
 */
export const claudeMcpRequest = (request: McpRequest, n: number): string => {
  const id = `${CLAUDE_MCP_ID}${n}`
  switch (request._tag) {
    case "ListTools":
      return controlRequest(id, { subtype: "mcp_status" })
    case "ReadResource":
      return controlRequest(id, {
        subtype: "mcp_read_resource",
        serverName: request.server,
        uri: request.uri,
      })
    case "CallTool":
      return controlRequest(id, {
        subtype: "mcp_call",
        tool: request.callName,
        arguments: request.arguments,
      })
  }
}

const ATTENDING = "ork-attend"

/**
 * The opening of a `claude` that holds no turn: one `initialize` control request, and
 * ready once it is answered. No user message is ever written, so the model never runs.
 */
export const claudeAttending = (): Dialogue => {
  let ready = false
  return {
    opening: controlRequest(ATTENDING, { subtype: "initialize" }),
    replyTo: (line) => {
      // The answer names the request, and nothing else on this pipe does.
      if (line.includes(`"${ATTENDING}"`) && line.includes('"control_response"')) ready = true
      return []
    },
    steer: () => [],
    settled: () => ready,
  }
}

/**
 * Where Claude Code files a session run in `cwd`, under its home: a directory under
 * `.claude/projects/` named for the absolute `cwd` with every character that is not a
 * letter or a digit written as `-`, and the session's id as the file.
 */
export const claudeSessionFile = (cwd: string, sessionId: SessionId): string =>
  `.claude/projects/${cwd.replaceAll(/[^A-Za-z0-9]/gu, "-")}/${sessionId}.jsonl`

/** What a person runs to pick a session up: `claude --resume <id>`, in the session's `cwd`. */
export const claudeResumeLine = (sessionId: SessionId): string => `claude --resume ${sessionId}`
