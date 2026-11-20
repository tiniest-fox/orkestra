// provider bundle: Codex.
//
// The same three files as `../claude/`, which is the contract for a provider:
//
//   argv.ts       override 1: what to run          (pure logic)
//   normalize.ts  override 2: how to read output   (pure logic)
//   index.ts      the CliProviderSpec              (data only)
//
// Nothing here spawns anything. adapters/cli-provider.ts does that, once, for
// every provider.
//
// Spawning `codex` rather than driving the API buys the same three things it buys
// with `claude`: the person's ChatGPT subscription, the repository's own
// `AGENTS.md` and `.agents/skills`, and a session a human can pick up with
// `codex exec resume <id>` — the id being the one Codex announced, since it takes
// none. Every turn runs with the sandbox open; a read-only step's restriction is
// stated in its prompt and not enforced.
//
// Selected by a model name qualified with this spec's name — `codex/gpt-5.6-sol`
// in `models.yaml`.

import type { CliProviderSpec } from "../../ports/provider.js"
import {
  CODEX_READ_ONLY_TOOLS,
  codexArgv,
  codexAttending,
  codexDialogue,
  codexMcpRequest,
  codexResumeLine,
  codexRolloutFor,
  codexSessionsDir,
} from "./argv.js"
import { codexMcpAnswer, codexMcpReply, codexNormalizer, codexRolloutLine } from "./normalize.js"

export const codexSpec: CliProviderSpec = {
  name: "codex",
  command: "codex",
  argv: codexArgv,
  // One reader per spawn: the answer is the last message before the turn ends and
  // the usage is every call's count added, which no line says on its own.
  normalizer: codexNormalizer,
  // `codex app-server` takes a turn only on a thread it has been asked to open, so
  // the prompt travels in the third request of a dialogue rather than at spawn. The
  // pipe stays open for the length of the turn and the server exits when it closes,
  // which the harness does once the answer is in and the dialogue owes nothing. The
  // same dialogue frames a message a person sends mid-turn, as `turn/steer`. No
  // per-task stop: that is `StreamJson`'s, and Codex reports no background work to stop.
  promptDelivery: { _tag: "Dialogue", dialogue: codexDialogue },
  // 0 when its stdin closes, whatever the turn did, and 137 on a kill. A failed turn
  // and a refused request are both reported in-band, so the code is read only where
  // neither an answer nor an error arrived.
  failOnNonZeroExit: true,
  // `thread/resume` takes the id the thread request's answer announced, verbatim —
  // and so does `codex exec resume <id>`, typed by a person.
  resume: { _tag: "ReportedId" },
  // One sandbox setting, no per-tool deny list, and the sandbox is open by decision.
  toolRestriction: { _tag: "PromptOnly" },
  readOnlyTools: CODEX_READ_ONLY_TOOLS,
  // No system-prompt flag, so the brief travels in the prompt body — once.
  brief: { _tag: "PromptBody" },
  // The per-call reading and the model's window are read from the rollout Codex
  // keeps under its home, named for the thread it announced.
  sessionLog: {
    _tag: "File",
    under: codexSessionsDir,
    isFor: codexRolloutFor,
    read: codexRolloutLine,
  },
  // JSON-RPC requests on the app server's pipe, numbered clear of the dialogue's own.
  // Codex tells no MCP server that views are understood, so a server that checks
  // before offering a tool with a view offers none here.
  mcp: {
    _tag: "Requests",
    request: codexMcpRequest,
    reply: codexMcpReply,
    answer: codexMcpAnswer,
    attending: codexAttending,
  },
  env: {},
  // It signs in from `~/.codex/auth.json`, a file, so there is no variable to carry.
  credentials: [],
  // Its servers travel in the thread request, down the pipe, and never on argv.
  mcpConfigFile: () => undefined,
  // None copied: Codex does not run under a runner, and its rollout is read where it ran.
  sessionFile: () => undefined,
  // Why it does not: a sandbox is never handed a credential in a file.
  signInFile: ".codex/auth.json",
  resumeLine: codexResumeLine,
  // No hook is configured for it, so its turn starts once setup has ended.
  setupGate: { _tag: "None" },
}
