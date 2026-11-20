// provider bundle: Claude Code.
//
// Every provider directory has the same three files, and that shape IS the
// contract — to add one, copy it:
//
//   argv.ts       override 1: what to run          (pure logic)
//   normalize.ts  override 2: how to read output   (pure logic)
//   index.ts      the CliProviderSpec + Layer      (data only)
//
// Nothing here spawns anything. adapters/cli-provider.ts does that, once, for
// every provider.
//
// Spawning the CLI (rather than the API or Agent SDK) is a product requirement:
// it runs on the user's subscription and inherits their whole ~/.claude and
// .claude configuration, so a session Orkestra starts is one a human can pick
// up with `claude --resume <id>`.
//
// This is the adapter a bare model name selects — `opus` means Claude's opus —
// which `cliProviderLayer` settles by naming this spec first.

import type { Layer } from "effect"
import { cliProviderLayer } from "../../adapters/cli-provider.js"
import type { Process } from "../../ports/process.js"
import type { CliProviderSpec, Provider } from "../../ports/provider.js"
import {
  CLAUDE_ENV,
  CLAUDE_READ_ONLY_TOOLS,
  claudeArgv,
  claudeAttending,
  claudeMcpConfigFile,
  claudeMcpRequest,
  claudePromptLine,
  claudeResumeLine,
  claudeSessionFile,
  claudeSetupSettings,
  claudeStopTaskLine,
} from "./argv.js"
import { claudeMcpAnswer, claudeMcpReply, claudeNormalizer } from "./normalize.js"

export const claudeSpec: CliProviderSpec = {
  name: "claude",
  command: "claude",
  argv: claudeArgv,
  // One reader per spawn. Every stream-json line stands alone but one pair: an MCP
  // call's arguments are on its `tool_use` and its result on a later line.
  normalizer: claudeNormalizer,
  // Duplex: the prompt is one stdin line and the pipe stays open, so background
  // work the agent leaves running is waited for rather than torn down at EOF —
  // and the same pipe carries the per-task stop control and a message a person
  // sends mid-turn. Stdin also dodges
  // ARG_MAX, and --disallowedTools being variadic is why the prompt was never a
  // trailing positional.
  promptDelivery: {
    _tag: "StreamJson",
    promptLine: claudePromptLine,
    stopTaskLine: claudeStopTaskLine,
  },
  failOnNonZeroExit: true,
  // claude takes --session-id / --resume <id>, so handoff to a human works.
  resume: { _tag: "SuppliedId" },
  // --disallowedTools is real enforcement, not a request.
  toolRestriction: { _tag: "NativeFlag" },
  readOnlyTools: CLAUDE_READ_ONLY_TOOLS,
  // --append-system-prompt is the session's, so the whole brief rides it every turn.
  brief: { _tag: "SessionFlag" },
  // Everything a meter needs is on the stream: each `assistant` frame carries its
  // call's usage and the `result` line the model's window.
  sessionLog: { _tag: "None" },
  // Control requests on the stream-json pipe, each answered by a `control_response`.
  mcp: {
    _tag: "Requests",
    request: claudeMcpRequest,
    reply: claudeMcpReply,
    answer: claudeMcpAnswer,
    attending: claudeAttending,
  },
  env: CLAUDE_ENV,
  // The token a host lays into the engine's environment; without one, the CLI signs in
  // from its own home.
  credentials: ["CLAUDE_CODE_OAUTH_TOKEN"],
  // Its servers, credentials included, in a file only this user can read.
  mcpConfigFile: claudeMcpConfigFile,
  // Under its home's `projects/`, in a directory named for the turn's `cwd`.
  sessionFile: claudeSessionFile,
  // Its token is a variable, in `credentials`.
  signInFile: undefined,
  resumeLine: claudeResumeLine,
  // A `PreToolUse` hook on `Bash`, in a `--settings` file.
  setupGate: { _tag: "SettingsFile", text: claudeSetupSettings },
}

export const ClaudeProviderLayer: Layer.Layer<Provider, never, Process> =
  cliProviderLayer(claudeSpec)
