# Claude stream-json fixtures

`*.captured.jsonl` — **real** output from `claude --print --output-format stream-json`.
Refresh with `pnpm smoke --refresh-fixtures`; review the diff, since a change here
means Claude Code's output format moved.

`*.synthetic.jsonl` — hand-written for shapes we have not yet captured from a real
run. Replace with captured output when a real run produces one.

Long fields (tool lists, MCP servers, slash commands) are elided with `…` where
they are irrelevant to normalization; everything the normalizer reads is verbatim.
`background-work.captured.jsonl` and `slow-command.captured.jsonl` additionally drop
per-message `usage` / `diagnostics` / `context_management` and replace thinking prose
with `…` — it was four fifths of the bytes, and only `usage` is read at all, so those
two produce no `Occupancy` and `context-window.captured.jsonl` below is where a
per-call reading is tested. **Every line is
kept**, including the 103 `thinking_tokens` frames, because how densely the background
frames are interleaved is the thing those two fixtures exist to show.

`connection-dropped.synthetic.jsonl` is the shape the failure notice exists for, and it
is a whole turn for one reason: the error arrives **twice**, once as an assistant `text`
block and once as the `result` line's `is_error`, with the agent's own half-written reply
above both. A fixture holding only the `result` line could not show that.

Two of them are not one shape each but a whole turn, captured by hand rather than by
`--refresh-fixtures` (which only rewrites `simple-reply`):

| | what only this one has |
|---|---|
| `background-work.captured.jsonl` | an inline delegation, a backgrounded one that answers out of order, a backgrounded `Bash`, and **three `system/init` + three `result` frames in one invocation** — one session id across all three, and `origin: {kind: "task-notification"}` on the two `result`s that are not ours |
| `slow-command.captured.jsonl` | a foreground `Bash` bracketed by `task_started` / `task_notification` with a `tool_progress` heartbeat between — the shape that makes a slow shell command render as a delegation |

`context-window.captured.jsonl` is a third whole turn, captured by hand from 2.1.263 on
haiku for the two figures a context meter reads and nothing else carries: `message.usage`
on every `assistant` frame — two frames per model call, the same block on each — and
`modelUsage` on the `result` line, keyed by resolved model id, with `contextWindow`. Its
`system/init` has the long lists elided as above and everything else is verbatim.

Both of the two above were captured from Claude Code 2.1.220 on haiku. `delegation.synthetic.jsonl` is
kept beside them: it is the same story short enough to read, and it now agrees with
them on `task_type` and on `task_updated` preceding `task_notification`.

`steered.captured.jsonl` and `late-message.captured.jsonl` are two more whole turns,
captured by hand from 2.1.296 on haiku under `--replay-user-messages`, each with one
message written to the open pipe mid-turn. Both echo the turn's own prompt first.

| | what only this one has |
|---|---|
| `steered.captured.jsonl` | a message written while `sleep 6` ran, echoed as `isReplay` in the same millisecond as the call's `tool_result`, and **one `result`** that obeys it |
| `late-message.captured.jsonl` | a message written while the final answer was being generated: **two `result` frames, neither carrying `origin`**, with a second `system/init` and the echo between them |

`auto-mode-denied.captured.jsonl` is three consecutive lines of one real run, captured by
hand from 2.1.308 on haiku under `--permission-mode auto`: a `Bash` call, the
`system/permission_denied` line the classifier's refusal wrote for it, and the call's error
`tool_result`. Verbatim; the rest of the turn is left out because only the denial is new.

`resume-miss.captured.jsonl` is the whole stdout of one real run, captured by hand from
2.1.323 on haiku: `--resume` of a session id the CLI has no file for. It fails before any
model call, with one `result` line whose text is in `errors` rather than `result`.
