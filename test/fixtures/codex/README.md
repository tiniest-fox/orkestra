# Codex JSONL fixtures

`*.captured.jsonl` — **real** stdout from `codex app-server` (codex-cli 0.154.0,
`gpt-5.6-luna` at low effort, a ChatGPT subscription), one file per run, every line kept.
Each line is one JSON-RPC message: an answer to a request, or a notification. The
requests themselves went down stdin and are not here. The three steering runs were
driven by a script whose request ids simply count up, so an id past `3` there is a
steer or a second turn. Captured by hand; nothing refreshes
them. **Never edit one** — that turns evidence into fiction. The one elision: `serverName`
and `installationId` on the `remoteControl/status/changed` line read `…`, because they
name the machine the run was on.

`*.synthetic.jsonl` — hand-written for shapes no run produced. Replace with captured
output when a real run produces one.

| | what only this one has |
|---|---|
| `launch-shell-call.captured.jsonl` | the whole skeleton: the three answers, a `reasoning` item that starts and completes empty, a narration message spelled out in `item/agentMessage/delta` lines, one `commandExecution` started and completed, the answer, a `thread/tokenUsage/updated` per model call, and a `turn/completed` that carries no usage |
| `resume-by-id.captured.jsonl` | `thread/resume` with `excludeTurns`: no `thread/started`, and a `thread/tokenUsage/updated` naming the **previous** turn ahead of `turn/started` |
| `resume-miss.captured.jsonl` | `thread/resume` of an id with no rollout: the request answered with an `error`, and nothing after it |
| `file-change.captured.jsonl` | `fileChange` items with `kind.type` `add` then `update` on the same absolute path; a `commandExecution` with `status: "failed"` on a turn that completes; a `reasoning` item with one summary part |
| `reasoning.captured.jsonl` | medium effort and no command: `item/reasoning/summaryPartAdded` and `summaryTextDelta` lines, then the item completing with its `summary` |
| `unknown-model.captured.jsonl` | a `warning` the turn survives, then an `error` notification with `willRetry: false` and a `turn/completed` with `status: "failed"`, both carrying one JSON message with `"status":400` and `codexErrorInfo: "other"` |
| `subagent.captured.jsonl` | a turn told to spawn one subagent and wait: two `collabAgentToolCall` items on the parent's thread, `spawnAgent` then `wait`, and between the `wait` starting and completing a **second thread's** `turn/started`, items, two `thread/tokenUsage/updated` and `turn/completed`, each naming its own `threadId` |
| `steered.captured.jsonl` | a `turn/steer` sent as a `webSearch` item started, with `web_search: "live"` on the thread: the answer `{"turnId":…}`, the `webSearch` item completing, then a `userMessage` item whose `clientId` is the request's `clientUserMessageId`. After `turn/completed`, two more steers refused with code `-32600`: `no active turn to steer` and `thread not found` |
| `steered-subagent.captured.jsonl` | two steers sent to the parent's thread while a subagent's command ran: one naming the subagent's turn, refused with `expected active turn id … but found …`, and one naming the parent's, accepted. The parent's keyed `userMessage` item arrives only after its `wait` item completes; the subagent's thread shows none |
| `late-message.captured.jsonl` | **two turns in one process**: a turn that answers, a steer refused with `no active turn to steer`, then a second `turn/start` on the same thread carrying `clientUserMessageId` — its own `turn/started`, a `userMessage` item with that `clientId`, an answer, a count and a `turn/completed` |
| `hooks.captured.jsonl` | codex-cli 0.163.0, with a `preToolUse` and a `postToolUse` command hook configured in its home: a `hook/started` and `hook/completed` pair before the `commandExecution` item starts and another after it completes, each `run.id` ending in the item's own `id`. The capture ends at the thread going idle, with no `turn/completed` |
| `sigkill.captured.jsonl` | SIGKILL once a command had started: the whole lines on disk, no `turn/completed` |
| `rollout-launch-shell-call.captured.jsonl` | **not stdout**: the session log Codex wrote under `~/.codex/sessions/` for a launch with one shell call, captured from a `codex exec` run — every line kept, the base instructions and the developer and user message texts elided to `…`. Two `token_count` records with `info.last_token_usage` per model call and `info.model_context_window`; `codexRolloutLine` reads it and the harness finds it by the thread id in its name |
| `artifact-reply.synthetic.jsonl` | the contract's happy path: a `reasoning` item with a summary, a read, then an answer whose last message is a decodable artifact |
| `rate-limited.synthetic.jsonl` | the in-band failure the contract asks for — `unknown-model`'s shape with `codexErrorInfo: "usageLimitExceeded"`, so the kind is one a retry policy acts on. It opens with the same three lines as `artifact-reply`, which is what lets the contract's stand-in choose between them by prompt |
