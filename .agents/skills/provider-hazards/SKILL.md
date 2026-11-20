---
name: provider-hazards
description: The rules in orkestra's process and provider code that look removable and are not. Read before touching agent/providers/, process-node.ts, runs-file.ts, cli-provider.ts or elicit.ts, and before adding an engine action that crosses into a sandbox — and before simplifying anything about process killing, error handling or session ids there — and before writing code that needs a GitHub token.
---

# Provider and process hazards

Every rule here looks like a leftover. Each one has a live failure behind it.

## A turn fails two ways, and only one is the agent's fault

- **The agent failed** — in three attempts it wrote nothing that decodes and passes the `vet` `elicit` was given. `orGiveUp`
  records that as the agent's own `failed` output.
- **The provider failed** — dropped connection, exhausted usage limit, non-zero exit.
  Says nothing about the work, and becomes `TurnFailed`.

**Keep them apart.** A transport error folded into the first reads as a verdict the
agent never gave, and that verdict is terminal — the work becomes unreachable.
`elicit.ts` separates them; `runtime.ts` has one catch for each.

**A chat has a third ending, and it is not a failure.** `converse` re-prompts an
envelope that was meant and refused — bounded by the same three attempts — because the
refusal text is guidance and the agent is the only reader it helps. Exhausting the bound
hands the last text back as prose instead of giving up: a person is at the prompt, and
their reading the raw text and saying so beats a trak settling `failed` under them.
`meant` is the loose *this was written as one of the outputs* shape, and it is what keeps
a reply that merely ends in a JSON block from being re-prompted.

## A provider reports an error two ways, and both must fail the turn

A non-zero exit, **and in-band**: `claude` writes a `result` line with `is_error` and
**exits 0**. `normalize.ts` turns the second into `ProviderEvent.ApiError`.

**The exit code stops being evidence once our own result frame has arrived.** It reports
the session's *last* turn, never ours: a self-given turn draining background work can fail
after our answer is in hand, and a session containing a failed turn exits 0 when a later
turn succeeds. `assertCleanExit` in `cli-provider.ts` therefore fails a turn on the code
only where no result frame ever came — a missing binary, expired auth, a crash before the
answer.

**Consume both.** A stream that only reads `Result` and `TextDelta` sees an erroring
session as empty text, re-prompts it three times, and files the give-up as the agent's
verdict.

`failOnApiError` in `cli-provider.ts` **emits the event and *then* fails the stream**,
so the transcript still records what went wrong. It sits in the shared harness so every
provider gets it, and classifies every in-band error `provider` — a max-turns stop also
reports `is_error` with no subtype, and `provider` is the retryable direction.

**`ProviderFailed.kind` is the `ApiErrorKind` off that event, and it is the only copy
left.** The event is gone by the time anything above the harness looks, so a failure that
drops it is one the engine cannot record and no surface can ever name — which is what
made every interruption, usage limit and expired token read as *provider failed*. Absent
where nothing was reported in-band, and absent must stay distinguishable from
`unclassified`.

Only for *our* turn — see below.

## One invocation is not one turn

`--print` stays alive after our prompt is answered so background work can report back,
and each time one does, Claude gives itself another turn: another `system/init` with the
same session id, another `result`, another `total_cost_usd`. Three of each on a turn that
delegates.

**The pipe is what a stop is written down, and closing it is a decision.**
`cli-provider.ts` holds stdin open under streaming input and ends it only once a result
is in *and* the background level is empty. How the level empties depends on the result.
One that holds the caller's envelope (`SessionRequest.settles`) has filed the step, so
the harness writes a stop line for every task still on the level and reads no later
result. Any other result leaves the work running, and that wait has no cap by decision —
the escape hatch is the per-task stop control down the same pipe, not a timer — so a
`claude` alive hours after a prose result is the design working, not a leak: its
lifetime is the stream's, and the process-group finalizer in `process-node.ts` still
runs when that scope closes.

**Closing the pipe does not stop a task, so never close it to end one.** At stdin EOF the
CLI goes on waiting for a background task that is running, with nothing left to write a
stop down. A task is stopped by name, and the pipe closes on the empty level that
follows.

**Which results are the answer is `afterResult`'s rule, and it is not "the first".** A
first result with nothing outstanding is the whole answer, and one after it — the reply
to a message that came too late to steer — is withheld. A first result written while a
task runs is the agent saying it will wait: every later result is read, self-given ones
included, because the report it waited to write is one of them and arrives after the
level has emptied. A self-given turn's `is_error` is still spend and nothing else.

**The test that ends a turn is "decodes as the caller's envelope", and the fold is handed
the same one.** `holdsEnvelope` in `elicit.ts` builds `SessionRequest.settles`, and
`CollectText` gives it to the provider and to `answering` both. A looser test — holds
JSON — stops the check an agent is waiting on the moment it quotes a config block. A test
the fold does not share reads the answer from another result than the one the tasks were
stopped on. An envelope that decodes and `vet` then refuses has still stopped the work,
so what it stopped is carried through every re-ask to the event that files the turn.

**Every write down that pipe has an error path, and the pipe's `'error'` has a
listener.** A stop press lands at any time, including after the child has closed its
stdin and before Node has destroyed the socket — `writableEnded` and `destroyed` see
neither — and an EPIPE nobody listens for is an uncaught exception that ends the daemon
and every trak it is driving. `send` settles on the write's own callback and `endInput`
refuses a pipe that has already failed; `stopBackgroundTask` reads both as `false`.

**A person's message rides that pipe too, and three things about it are not obvious.**
`ProviderAdapter.steer` writes it as a second user line, and the model reads it when its
current response or tool call ends.

- **The write succeeding is not delivery.** `--replay-user-messages` makes the CLI print a
  user line back as the model receives it, and that echo is the only report there is — it
  lags the write by a whole tool call. `ProviderEvent.MessageDelivered` is that echo.
- **The turn's own prompt is echoed first**, as the same kind of line. The harness pairs an
  echo with a message it wrote down this turn's pipe, by text, and drops the rest — never
  by position.
- **A message that arrives after the final answer began is answered in a second turn of
  the same process**, even with stdin closed, and that turn's `result` carries no
  `origin`. So `cli-provider.ts` withholds a `Result` written after the answer was
  complete, and an `ApiError` once any result is in: an error there would fail a turn
  whose answer is in hand. Its `Usage` still arrives.

- **A `result` frame carrying `origin` is not ours.** It is the origin of the *prompt*
  that turn answered, absent only on the one we sent. `normalize.ts` keeps its `Usage`
  and its answer and drops its `is_error`: a result of ours is already in hand, and
  failing on it throws away good work. Whether its answer is part of ours is
  `afterResult`'s rule, above.
- **`total_cost_usd` is this CLI run's running total**, not this report's share —
  subagents included, and starting again from nothing on every spawn, a `--resume`
  included. That is what `runCostUsd` is named for, and it is why summing a session's
  turns double-counts none of it. `meter.ts` takes the maximum; the token counters
  beside it are increments and are added. A **re-ask** spawns a second run whose total
  starts at nothing, so `meter.ts` banks the cost at the `Reask` and lays every later
  report on top — kept as a bare maximum, a turn that reported $18.15 then $2.60
  records $18.15.
- **The answer is the first `Result` that holds the caller's envelope, alone, and
  nothing after it counts.** With no such result it is every `Result` the harness let
  through, joined in order. A subagent's `TextDelta` never counts. `logic/answer.ts` is
  the rule; `extractJson` taking the *last* JSON-shaped thing is what makes a stray
  document expensive.
- **`SessionStarted` may repeat with the same id.** Counting them counts re-entries.

## The normalized vocabulary

**`Unknown` stays, though every kind a real run produces is now named.** It is what
makes a CLI shipping a *new* kind a no-op rather than a crash, and you cannot enumerate
a third party's future. `eventLine` prints `Unknown(<type>/<subtype>)` so the remainder
stays legible — do not shorten it.

**`ToolUse` carries the provider's own `name` beside the normalized `kind`, and both
stay.** `meter.ts` counts by `name`, and that table is what `ork record` prints for a
human judging a trak — counting by kind would collapse `Edit ×40` and `MultiEdit ×12`
into one number, in a document somebody reads. The kind is what a second provider maps
onto and what the UI groups by.

**`Occupancy` and `ContextWindow` are kept as the latest, never added** — the opposite
rule from `Usage`, on events that look like it. They measure what the window holds rather
than what the turn spent, and every model call re-reads the conversation, so a turn's
readings summed come to several windows' worth of a window that never filled. `meter.ts`
keeps the last `Occupancy` and the `ContextWindow` whose `model` matches it, which is what
keeps a subagent's window off the turn's own on a `result` line reporting both.

That rule is also the licence to emit a repeat: Claude writes one `assistant` frame per
content block with the same `usage` on each, and `normalize.ts` emits both readings rather
than remembering `message.id`, because last-wins makes the second free. **A provider that
reports per call reports no reading inside a delegation** — the subagent's window is its
own — and its output count is partial where the frame is written as the call starts.

**`ToolResult` carries the id of the call it answers, and a consumer matches on it
rather than counting.** A turn dispatches several tools in one message and they come
back in whichever order they finish, so counting outcomes onto the calls above them is
wrong exactly when a turn is busiest — it took a command's failure and drew it on the
delegation issued beside it. Claude puts the id on the `tool_result` block; a provider
that reports none leaves it absent, and the client falls back to counting for those
alone. **Do not make the field required in a Schema**: a block that fails to decode is
an outcome that vanishes, which draws as a call still running.

**A recognised kind that produces no event is not `Unknown`.** `subagentEvents` returns
`undefined` for a line that is not its own and an empty array for one that is and earns
nothing — a shell task's bracket, an ambient `skip_transcript` task, a bracket with no
`tool_use_id`. Collapse the two and a kind the file *reads* renders as
`Unknown(system/task_started)` and needs an entry in `known-kinds.json` to explain why
it does not.

**`task_started` does not mean a subagent started.** The CLI registers a task for shell
work too, and in a real corpus those outnumber delegations by two orders — so only
`local_agent`, `remote_agent` and `local_workflow` open one, and a bracket naming no
`task_type` is read as *not* a delegation. `task_notification` carries no `task_type` to
gate on, so an answer for a task nothing opened is emitted and dropped by whatever draws
it: joining it back would need memory of an earlier line, which this file does not have.

**`ApiRetry` is not `ApiError` and must not fail a turn.** It is the pause a watcher is
already looking at, explained — three 529s and ninety seconds of backoff otherwise read
as a model thinking. `ApiError` is the same trouble once the provider has stopped trying,
and it is the one `failOnApiError` acts on.

**`PermissionDenied` must not fail a turn either.** Under auto mode — every `write`
step's — a call the classifier refuses is a failed `ToolResult` in a turn that still
exits `success`, and the agent is the one that answers it: a step that needs the call
files a `permission` envelope naming it, and a person's yes on the resumed session clears
it. Failing the turn on the event takes away the only route to that yes.

**`ActivityKind` is closed, and `Other` is where an unmapped tool goes.** Adding a member
per tool a CLI ships makes the vocabulary a translation rather than a table, and an
unclassified tool is a no-op — the same thing `Unknown` says about a stream kind. The
extractor never parses a shell command to guess a kind: `Bash(cat x)` is what happened.
A name **mapped to `Other`** is in `ACTIVITIES` for its `from` alone — the tools that
control background work draw a row saying which task or which skill — and the `Task*`
prefix spans two unrelated families, told apart by whether the argument is a camelCase
`taskId` (the todo list) or a snake_case `task_id` (a background task).

**`RateLimit` is not a failure.** It is a quota *broadcast*: `status: "rejected"`
appears on turns that finish cleanly on overage, so acting on it fails healthy turns.
The failure it resembles arrives separately as `result.is_error`.

**Every entry in `test/smoke/known-kinds.json` is a kind `Unknown` no longer means
"never seen before" for, so a kind goes in only with the reason it cannot be modelled.**
The file is a record — the kind is the key and the reason is the value — so an entry
without one cannot be written. Empty is still the goal; two delegation lifecycle lines
are in there today and each says why.

**A spec's `normalizer` is built once per spawn, and Claude's remembers nothing.**
`claudeNormalizeLine` is one line in, events out, which is what makes it testable line by
line; a stream kind that can only be understood by remembering an earlier line —
`system/task_updated`, which carries a task id and no tool id — belongs in
`known-kinds.json` with that as its reason, not in a `Ref` above the function. The
factory exists for Codex, whose turn's answer and usage no line names: it writes several
`agentMessage` items and the last before `turn/completed` is the answer, and
`turn/completed` carries no usage, so `codexNormalizer` keeps the latest message, adds up
each call's `thread/tokenUsage/updated`, and settles `Usage` and `Result` when the turn
ends. It keeps the thread and the turn too — see *Codex is a server* below. The reader dies
with the spawn — a reader shared across turns would hand one turn's answer to the next.

**`claudeApiErrorKind` defaults to `unclassified`.** It matches English prose, so it is
a heuristic — widen a pattern to catch one more message and it starts filing unknown
failures under a kind a retry policy will act on. A wrong kind is actionable and wrong.
A status code counts only after the word "error"; bare, it matches "truncated at 500
tokens". `codexApiErrorKind` reads the status off the JSON string Codex embeds and has
no prose half — a 400 is `unclassified`, because a refused request is none of the kinds
a retry policy acts on.

**Codex is read whole per item, and a refused write still says nothing.** Text is written
once per message at its completion; the `item/agentMessage/delta` lines before it are the
same text a token at a time and are dropped. A `reasoning` item starts empty and completes
with a `summary` only where `model_reasoning_summary` is set, which `codexDialogue` sends
on every thread; each summary part is a bold header rather than the chain of thought,
which travels sealed, and `codexNormalizer` writes one `Thinking` per part with the
markers stripped. Every turn runs with the sandbox open by decision, so a read-only
step's restriction is stated in its prompt (`CODEX_READ_ONLY_TOOLS`) and a step that
edits anyway is not stopped.

## Codex is a server, and a turn is a dialogue with it

`codex app-server` speaks JSON-RPC over stdio and takes a turn only on a thread it was
asked to open, so the prompt cannot travel at spawn. `PromptDelivery.Dialogue` is the
override: the harness writes the spec's opening line, then whatever the spec's `replyTo`
returns for each line read — `initialize`, then `thread/start` or `thread/resume`, then
`turn/start` naming the thread the server just announced.

- **The connection carries more than this turn.** A subagent runs on a thread of its
  own, and that thread's `turn/started`, items, counts, `error` and `turn/completed` all
  arrive here, each naming its own `threadId`; a resumed thread opens by replaying the
  last count of the turn before. `codexNormalizer` reads a turn-scoped line only where it
  names the thread the thread request's answer announced and the turn the `turn/start`
  answer named — never the id on `turn/started`, which a subagent sends too. Read
  without that, a subagent's ending closes the pipe under the parent and files the
  subagent's last message as the step's answer. Anything else that reads this stream
  owes the same match.
- **A subagent is one call, and nothing under it.** The spawn is a `collabAgentToolCall`
  item on the parent's thread, drawn as a `Task` carrying the prompt; the calls that
  wait on one or close one are `Other`. The subagent's own items are dropped with the
  rest of its thread, so a delegation has no rows of its own.
- **Every ending of this turn ends it.** A `turn/completed` whose status nothing reads,
  or whose body does not decode, is an `ApiError` and not `Unknown` — `Unknown` there
  settles nothing, and the next bullet is why that is a hang.
- **The server never exits on its own.** It exits 0 when its stdin closes, whatever the
  turn did. `closeWhenDrained` closing the pipe at the `Result` is what ends it, and the
  rollout is read after that exit — so a normalizer that settles no `Result` is a
  process that outlives its turn.
- **A request the server sends this client is a turn that never ends.** An approval
  nobody answers waits without limit. `approvalPolicy: "never"` on the thread keeps one
  from being sent, and `codexNormalizer` turns any line carrying both `method` and `id`
  into an `ApiError`, which fails the turn and ends the process.
- **A refused request is an answer, not a notification.** `thread/resume` of an id with
  no rollout comes back as `{"id":2,"error":…}` and nothing follows it. The normalizer
  fails the turn on it; a reader that waited for `turn/completed` would wait forever.
- **A reply that cannot be written fails the turn, until the answer is in.** The prompt
  travels in one, so the harness does not catch a failed `send` there the way it catches
  a failed close. After the answer a reply carries only a person's message, and one
  that cannot be written leaves the message waiting.
- **The protocol is labelled experimental.** `codex app-server generate-ts` prints the
  types for the installed version; a change in the CLI shows up as a diff in those.

**A person's message is `turn/steer`, framed by the dialogue and not by the harness.**
`Dialogue.steer` returns the lines for it, and `Dialogue.settled` is the third condition
on closing the pipe.

- **The pipe is found by the minted id.** `cli-provider.ts` registers a pipe under the id
  the turn was requested with, and Codex announces another, which replaces `sessionId` on
  the run record. The record keeps the first as `minted`, and `holdMessage` steers by it.
- **A steer has to name the turn in progress**, and the runtime hands over every waiting
  message the moment the process exists. The dialogue holds one that arrives before the
  `turn/start` answer and writes it when the answer names the turn.
- **Delivery is the `userMessage` item carrying the key, never the steer's answer.** The
  steer is answered at once; the item arrives when the model takes the message, which is
  after the hosted tool call or the subagent the turn was waiting on. The key travels as
  `clientUserMessageId` and comes back as `clientId`, which is `null` on a turn's own
  prompt. A subagent never receives the parent's message.
- **A refused steer is an `error` answer that must not fail the turn.** Every refusal seen
  carries code `-32600` and differs only in its message, so the normalizer goes by the
  request id: a refusal of one of the three opening requests fails the turn, and a
  refusal of any later one earns nothing.
- **A refused message becomes a `turn/start` on the same thread, once the turn before it
  has ended.** That is a second turn in one process. The normalizer reads the latest turn
  named and settles each one's `Usage` and `Result` from its own count and its own last
  message; the harness keeps the first `Result`, so the reply is drawn and the step's
  answer stands.
- **Closing the pipe at the first `Result` would kill that second turn**, because the
  server exits at stdin EOF. The harness closes only where the dialogue is settled: no
  steer unanswered, no message held, no turn running. It re-decides after every reply as
  well as every event, since a refused follow-on turn settles the dialogue on a line
  that normalizes to nothing.

**`withTranscript` records one `Thinking` per burst and one `SessionStarted` per session,
and sends every one to the Observer.** The asymmetry is deliberate: the Observer watches
it happen, the Store keeps the turn for later, and 38 ticks are not 38 things that
happened. The token estimate stays on the event and out of the line for the same reason —
the first tick's number would stand for the whole burst. A burst is ticks carrying the
same `text`: two Codex summaries in a row are two lines, because they are two thoughts.

## A person's images travel beside the prompt, in each provider's own frame

`SessionRequest.images` and `SteeredMessage.images` are the images a person attached,
read out of the checkout when the turn starts — `promptImages` in `runtime.ts`. A
provider carries them on the opening prompt and on every steered message:

- **Claude** gets an image block of base64 bytes ahead of the text, in the stream-json
  user frame. The bytes, not the path: the session file keeps the block, so `claude
  --resume` still holds the picture once the checkout is gone. The echo a steered message
  is paired by reads the text blocks alone.
- **Codex** gets a `localImage` input after the text, by `path`. That path is absolute as
  the CLI's own process spells it, which in a sandbox is the place's path rather than the
  engine's.

**Only a `StreamJson` or `Dialogue` delivery carries them.** `Stdin` and `LastArg` drop
them without a word, and the `attached` list in the prompt is then the only trace. A new
provider maps `images` into its own frame or is known to show none. **An image that
cannot be read is left off with a warning, and the turn still runs.**

## A session recorded is not a session that exists, and the id recorded is the announced one

`ProviderFailed` covers a non-zero exit — missing binary, expired auth, usage limit
refused at startup — where the CLI **never created a session**. File a session id on
that `TurnFailed` and the retry sets `resumeFrom`, `claudeArgv` makes it `--resume
<id>`, and resuming a session that never existed fails identically forever.

`withTranscript` keeps the id off `ProviderEvent.SessionStarted` in a `Ref`, and
`orRecordFailure` and the two turn runners read it: **the log carries the id the
provider announced, and the minted one only where it announced none.** Claude echoes
the id it was given, so the two are one; Codex mints its own (`ResumeStrategy.ReportedId`)
and never knew the minted one, so a log carrying it would name a conversation nothing
can resume. `elicit`'s re-ask resumes by the same announced id, off `Answer.session`.
`promptTrigger(trigger, resumeFrom)` renders a restart with nothing to continue as
`Initial` — the full prompt — because `Continue.` means nothing to an agent never told
what the work is.

This lives in `runtime.ts`, not `decide.ts`: whether a session survived is a fact about
the provider, not the state machine. `run.json`'s in-flight record still names the
minted id, so a crash mid-turn under Codex restarts with an id Codex cannot resume —
the deferred entry *a crash mid turn under codex restarts with an id codex cannot resume* carries it.

**A sandboxed turn's session file is copied between the sandbox and this machine's `$HOME`,
and the newer modification time wins.** `withSessionCopies` in `runtime.ts` copies it in
before a resume that is not a reattach and back after the turn however it ends, so
`claude --resume <id>` on this machine finds it.

## A CLI may keep what you need outside its stream

Codex's per-call count and its context window are read from the rollout it keeps under
its own home. So a spec may declare **`CliProviderSpec.sessionLog`** — where to look, whether a file name
under it is this session's, and how to read one line — and `cli-provider.ts` does the
opening, by the id the provider announced, which is the only name the file has. Each
reading ends with a `SessionLogRead` naming the file.

**Read it after the exit, and after a clean one.** During the turn the file is still being
written; after a failed stream a reading has no meter to land on.

**Nothing in it may fail the turn.** The answer is already in hand by then, so a home with
no `sessions/`, a file not yet written and one that cannot be read all yield no events and
one debug line. Absent is what every consumer of a reading already handles.

**A line it does not read is nothing, not `Unknown`.** The log is the CLI's own record of
the thread rather than a stream this reader is held to cover, so the usual rule inverts —
`Unknown` there prints a line for every kind the CLI happens to keep.

**A turn a person stops carries no reading from it**, because the stop interrupts the
stream before the exit. That is a gap by decision, not a bug to chase: a provider that
reports per call off its own stream, as Claude does, is unaffected.

## The CLI answers for its MCP servers, on requests nothing documents

An MCP tool's **view** is read and pressed through the CLI and never by dialing the
server: the CLI holds the server's configuration and its sign-in. `CliProviderSpec.mcp`
is three requests on the pipe a turn already holds, and none is a model turn.

| | `claude` — a control request | `codex` — JSON-RPC |
|---|---|---|
| the tool list, which names each tool's view | `mcp_status` | `mcpServerStatus/list` |
| a resource — the view's HTML | `mcp_read_resource` | `mcpServer/resource/read` |
| a tool call | `mcp_call` | `mcpServer/tool/call` |

**`CLAUDE_CODE_MCP_APPS_HOST=1` rides every `claude` spawn**, through
`CliProviderSpec.env`, and nothing turns it off. It makes the CLI tell each server it
dials that views are understood, and a server that checks before offering a tool with a
view offers none without it. **Codex says so to no server and has no such variable**, so
that server shows no view on a `codex` step; one that offers its view unconditionally
does.

**The variable, `mcp_read_resource` and `mcp_call` are in no documentation and not in
`claude --help`.** The binary is the only place they are named, and `system/init`
announces `mcp_read_resource` alone. Codex's three are in the app-server protocol, which
is labelled experimental. **A CLI release that drops one fails nothing**: `viewKeeper`
in `runtime.ts` never fails a turn, so the call draws as the ordinary call it also is
and no line says a view is missing. The view check in `pnpm smoke` is the only reader of
all four off a real `claude` — its fixture offers the view only to a client that
declares view support, so the tool list is also the check on the variable.

- **An answer is read before the line is normalized.** Both normalizers drop the line, so
  an answer nobody waits for is nothing — and a reader placed after the normalizer never
  sees one.
- **A request still unanswered holds the turn's pipe open, and the close is decided again
  every time one leaves `Pipe.asks`** — answered, timed out, its write failed or its
  asker interrupted, all through `left`. A removal that goes round it is a turn whose
  result is in hand and which never ends.
- **`mcp_call` is answered under every permission mode, and while a tool call of the
  turn is still running.** No step's permission narrows a press, so what a press may
  call is the engine's check and nothing else: `pressable` in `src/app/views.ts`, against
  the tools the view's own server opened to views when the call completed.
- **Codex refuses a tool call that names no thread.** `request` returns `undefined`
  until the thread request is answered, and a process holding no turn opens with
  `thread/start` and no `turn/start`.
- **A call is joined to its server by `callName` off the tool list**, never by splitting
  `mcp__<server>__<tool>` at the separator, which guesses wrong for a server whose own
  name holds one.
- **Claude returns a call's `content` as one string.** `resultOf` wraps it as the text
  block it stands for, so everything above the provider sees an array.
- **`attend` — the CLI started with no prompt — is not a turn.** It writes no event, no
  transcript line and no meter reading, and it is held in `src/app/views.ts` rather than
  in `Runs`, because `Runs.inFlight` is what the stop and message routes read. A local
  server restarts with each CLI process, so this one holds none of the turn's memory:
  a view redraws from the result the engine stored, and the tool is never called again
  to redraw.
- **A view is kept only for a call the step's own agent makes**, and only where the
  call's id is plainly a file name (`isViewKey`). A call inside a delegation keeps none.

## Killing

**`killGroup` checks `kill(-pid, 0)` before waiting out the grace period.** Most callers
are processes that have already run to completion — every check that answers, every turn
that finishes — and sleeping `GRACE_MS` between SIGTERM and SIGKILL for each of those
turns nine `exit 0` scripts into 21 seconds. The grace period still applies to anything
genuinely alive. **It is polled, not slept**: the groups are asked again every 20ms, so one
that ends on the SIGTERM — a `git grep` stopped at its cap — releases its scope at once,
and only a group still alive at the end of `GRACE_MS` is SIGKILLed.

**A group kill does not reach the agent's tool processes.** Claude Code puts each Bash
invocation in a process group of its own, so `kill(-pid)` signals `claude` and nothing it
started. On the SIGTERM path that costs nothing — `claude`'s own handler kills the shell,
which dies before `claude` does — but a SIGKILL gives it no such chance and the shell
survives, reparented to pid 1 where the reaper cannot see it: `run.json` records
`agentPid` only. So `killGroup` reads the descendant tree with `ps` and kills those groups
too. **It reads the tree before the SIGTERM as well as before the SIGKILL**: a process that
dies on SIGTERM without stopping its children — Playwright, leaving its `webServer` on the
worktree's e2e ports — takes the only path from the pid to them with it.
**Never SIGKILL the agent directly and never shorten `GRACE_MS`** — either one turns a
stop into an orphaned build running in a worktree Orkestra is about to commit. Only the
Process contract test passes a shorter grace, through `nodeProcessLayerWithGrace`.

**Never read a failed liveness check as "dead".** `EPERM` from `process.kill(pid, 0)`
means the process exists and is not yours. Discriminate on the code.

**`Runs.reap()` kills a stray only after reading its start time back and finding it equal
to the one recorded when the agent was spawned.** A wrong kill is worse than a leaked
process billing a few more minutes. The start time and not the command line, because a
`codex app-server` carries no session id anywhere — and it is read back from `ps` at
spawn rather than taken off the wall clock, which `ps` would never agree with.

**A sandboxed turn's `agentPid` is the local `runner.sh`, not the agent.** A group kill
reaches the remote command only through that script's SIGTERM handler, so a `runner.sh`
that was SIGKILLed, or lost to a reboot, leaves the command running in the sandbox.
The turn's `execId` is recorded in `run.json` for that reason, and `reap` calls
`killExec` for it once the holder is dead, whatever the pid check found. **Never gate that call on the
start-time match**: the exec id is unique and the kill idempotent, so it cannot stop
anything else, and after a reboot the pid is as likely reissued as free. **A detached
exec is the exception**: it is the turn still running, so `reap` reports it as `Rejoining`
and the trak's restart rejoins it with `attach` rather than killing it.

**The holder is judged by its start time too, never by its pid alone.** A shutdown leaving
a detached turn leaves its holder on `run.json`, and after a restart the next process to get
that pid is often the next engine: read as alive, `reap` skips the record and nothing
rejoins the turn. `adopt` records the holder's start, and a live pid that started at
another time is dead. **So is one whose start cannot be read now**: that is what `ps`
answers for a thread id, which `kill(tid, 0)` passes on Linux, and a restarted container's
dense pids make a thread the likely reissue — read as alive, ten detached turns sat
undriven after a restart. The Node `isAlive` reads a thread id as dead from `/proc` for
the same reason. The engine's own holder is matched against the start it wrote without
asking `ps`, so one failed `ps` never clears a live drive's record.

**Whatever replaces the holder keeps both of its jobs.** First, the record of a detached
turn — its `execId` and `detached` — outlives the engine that wrote it, so the next
engine to take the trak rejoins from it. Second, one process at most attaches to an exec, because `attach` joins the
command's stdin: two engines attached to one turn both write the agent's input and both
record its transcript. The holder is a pid on this machine, so it says nothing about an
engine on another: a `run.json` copied to a second machine reads its holder as dead, and
that engine attaches beside the first. Doubt about custody reads as held.

**Only a turn's first spawn rejoins.** The rejoined command ends with the answer, and its
exec is killed when that stream closes, so a re-ask carrying `reattach` finds it `gone` and
ends the turn. `ResumeWithFeedback` in `elicit.ts` drops it, for `elicit` and `converse`
both; anything else that builds a later spawn from a `SessionRequest` has to as well.

**`gone` on a rejoin's first `attach` is not a failure, and appends nothing.** The command a
dead engine started ended with nothing this engine read of it, so `ProcessFailed.gone` rides
up through `ProviderFailed.gone` to `orRecordFailure`, which raises `TurnLeft` instead of
`TurnFailed`, and `appended` stops the drive on it. The trak stays in flight with nothing
carrying it — the stopped notice and Resume — and the run record lets the exec go, so Resume
starts the step again. **Only that first attach sets `gone`.** A `gone` on a later
connection — the reattach `followed` makes after a drop, on a rejoin or a fresh turn whose
sandbox the provider removed — ends a turn that ran here, and stays a `TurnFailed` carrying
its reason and its spend; appending nothing there dropped an hour's bill.

**An engine action that crosses into a sandbox goes through the seam operation, `crossSeam`
in `runtime.ts`, rather than a retry of its own.** It asks the sandbox's state first, so a
stopped or absent sandbox is nothing running and never reaches a retry. It waits `lost`
and `unreachable` out on the trak's `Outages` window, fails at once on anything else,
`limited` among them, and publishes the trak's `SeamStatus` at every step. Only
`StopTurn`'s kill crosses through it so far.

**A detached turn, its session copy-back and the branch fetch after it wait one outage
out together.** The fetch waits only under `waitingOutOutages`, which `fetchedAfter` in
`runtime.ts` sets, so an archive or a remake of a sandbox that is gone still fails in
seconds. All three back off on `outageWait` in `workflow/ports/outages.ts` until the trak's
entry in `Outages` is `reattach_minutes` old, and the entry is the window: a caller that
waits it out marks it spent, so the copy-back and fetch after a turn that gave up try once
rather than a window each. Only a new detached turn, or an answer, clears it. `MergeWork` sets `waitingOutOutages` too, so a merge's
transfers, and its git in a parent's sandbox — put through `Sandboxes.retried`, since the
Process layer retries no command — wait the same window. **Every final failure of a detached turn but `limited` calls `Sandboxes.lost`** — `gone`, or a spent window — as an attached command's does: the sandbox may be one the provider removed, and without it the next turn finds it `seen` and never makes it again. A turn that
gives up asks `Leaving.keep` to leave its command running and its `run.json` turn standing,
which `endOnRelease` and `Runs` both read, so the trak's Resume rejoins it. A stop keeps
its turn's exec the same way — a detached one, or one written to the record before its
spawn reported — so the kill that ends it is `StopTurn`'s through the seam operation, not
the close's single try. An engine that is leaving keeps only a detached one. A fetch that
gives up after a turn that answered drops the answer as `TurnFailed{unfetched}`, and the
restart after it fetches before it spawns. A new file script is
retried unless `repeatable` excludes it, so one that is not safe to repeat goes there; a
`transfer` caller's `args` stay a forced fetch or push of one ref.

**The relay `reach` leaves in a sandbox outlives the engine and every runner script.** A
`reach` starts it once on the engine's port and reuses a live one, so a change to the relay
reaches only a sandbox whose relay is not running yet. Every request a
sandbox sends the engine on that port passes through it: a call may arrive late, held
through a restart, and one the restart cut arrives once more with `orkestra-resent`. **So a
route the sandbox dials there answers a marked request without running anything**, as
`trak-mcp.ts` does — the engine that died may already have run it — and a relay never
resends a request unmarked once a byte of it reached the engine, because a `connection:`
server forwards to tools that are not safe to run twice. A cut `run_check` is answered
from `trak/lost-to-restart`, which tells the agent that calling it again is safe.

**The relay accepts before anything behind it answers, so a listening port says nothing.**
Claude Code gives a server thirty seconds to connect and never asks again. `reachedTools`
in `src/app/hosting.ts` holds a sandboxed turn until `Sandboxes.healthThrough` — `GET
/api/health` from inside the sandbox, through the relay — answers, for twenty seconds,
or thirty-five where the runner's exec itself hangs, and then starts it anyway with a
warning in the log and a note on the trak.

## Before you spawn one

The provider-bundle shape — three files, nothing in them spawns — is in
`where-code-goes`.

**`process-node.ts` takes the stdout line iterator at the spawn, never on the first
pull.** Node's readline iterator queues only the `'line'` and `'close'` events emitted
after it exists, and the interface reads stdout from the moment it is made. An iterator
made later loses every line and the close of a child that printed and exited before
anyone read, so `lines` never ends: a turn whose agent answered and exited stays in
`AgentWorking` with nothing after `Spawned`. That unread iterator pauses stdout once 1024
lines are queued, so **a caller reads `lines` before or alongside awaiting `exited`** —
one that awaits `exited` first deadlocks on a child with more output than that.

**Real invocations cost tokens.** Use `model: "haiku"` for anything exploratory. An
inherited `OPENAI_API_KEY` is stripped from every spawn (`spawn-env.ts`), because it
silently moves `codex` off the person's subscription onto API billing.
`CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN` are inherited on purpose by a spawn on this
machine: an engine started with either signs its spawns in with it, so stripping either
signs them out.

**Code that needs a GitHub token spawns `gh` or git through `Process` and lets it be
inherited**, naming `GH_TOKEN` in `credentials` where the spawn is sandboxed. **Never read
`GH_TOKEN` from `process.env`**: a host may hand the token per spawn rather than to the
engine, and there it is blank. A new spawn site that sets its own `GIT_CONFIG_COUNT` or
`PATH` in `env` overrides the credential helper such a host installs, and is signed out
there.

**Spawn through the `Process` tag, because that is where the sandbox is.** A host that
provides a runner layers it into `Process`, sending every spawn whose `cwd` is a trak's
checkout into its sandbox unless `HostTraks` records the trak as placed on this machine. A
child started any other way runs on this machine; `process-node.ts`'s own `ps` call is one.

**A spawn with no checkout names the project as its place with `ProcessSpec.inProject`**
(`SessionRequest.inProject` for a turn), so a runner layer can send it to the project's
sandbox. With no runner the flag does nothing and the spawn runs here. **Its env script is
captured there as well**, through `Environment.capture`'s `placed` argument with the spawn's
own `inProject` and `passOnly`: a capture on this machine hands the script this machine's
whole environment, and the sandbox gets it back as explicit `env`.

**A new site that chooses between this machine and a trak's sandbox asks `HostTraks` too**
(`src/vcs/ports/host-traks.ts`), as git's choice of where, the Process routing,
`Sandboxes.placeOf` and `holds`, the MCP reach, the teardown and the restore
fetch do. One that asks only whether the project has a runner sends a host-placed trak's
work to a sandbox that holds no checkout of it.

**A sandboxed spawn inherits nothing from the engine.** It is handed its explicit `env`,
the runner's `pass:` names, the named secrets less the protected ones
(`carriedSecrets`) and the names in `ProcessSpec.credentials`, and the sandbox's
login environment supplies the rest, `PATH` and `HOME` included. A `ProcessSpec.passOnly`
spawn gets no `carriedSecrets`. So a value a child needs
goes in `env`, and the token a CLI signs in with goes in its spec's `credentials`, which
`cli-provider.ts` sets on the CLI's spawns and nowhere else. A spec that leaves its token
out works on this machine and is signed out in a sandbox.

**A path a sandboxed command names has to be one the runner layer copies** before the
spawn. A new engine file a script is handed by path goes on that layer's list, or the
command finds nothing there in a sandbox while it works on this machine.
