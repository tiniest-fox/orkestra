// The system, run from a terminal.
//
//   pnpm ork "<description>"      ← starts a new trak, costs tokens
//   pnpm ork --version            ← the version from package.json, then exit
//   pnpm ork list                 ← every live trak here, and how many are archived
//   pnpm ork resume <id>          ← pick a trak back up: gate, crash, or failure
//   pnpm ork record <id>          ← how one trak went, computed from its log
//   pnpm ork records              ← every trak whose checkout is gone, under .orkestra/records/
//   pnpm ork merge <id>           ← its branch into the one you are on; the checkout goes
//   pnpm ork archive <id> ["<why>"] ← put it away: the checkout, the branch, its base ref
//                                    and the branch on GitHub go. "<why>" if it has not
//                                    finished — that one interrupts the turn in flight
//   pnpm ork reenter <id> "<what>" ← a trak at rest, picked back up from outside
//   pnpm ork wipe [<id>]          ← clear one trak, or everything
//   pnpm ork revoke-sessions      ← log every browser out, on every device
//   orkestra goal-tools           ← started by a goal composer's CLI, never by a person:
//                                   the MCP server its session's tools are on, forwarding
//                                   each call to the engine
//   orkestra trak-tools           ← the same for a step's turn: its checks, its hosted
//                                   processes and the engine tools
//   pnpm ork proofs publish       ← this clean checkout's unit proofs and the project's
//                                   prints, pushed to origin
//   pnpm ork proofs read --check <name>
//                                 ← the units origin holds for that check on this commit,
//                                   one per line
//   pnpm ork proofs run --check <name> --skipped <dir> [--prints-from <tree>]
//                                 ← that check run as the engine runs it, skipping what
//                                   origin proved and what a print holds for; CI's. No
//                                   proofs command needs an engine
//
// Any of them takes `--dir <path>`: the repository to talk about, defaulting to the one
// you are standing in. It has to name the same project the daemon was started with —
// that is what the port is derived from and what identifies the engine.
//
// **This is a client. The engine is `pnpm serve`.** Nothing here drives a trak: every
// command is a request, and what happens next arrives on the daemon's stream. That is
// what one writer bought — a turn started here can be watched from the browser and the
// other way round, and two surfaces can never put two `claude` processes on one log.
//
// It follows that a command needs a daemon, and there is deliberately no fallback that
// runs the engine in-process: that would be the second writer again, quietly, exactly
// when nobody expected one. If nothing is listening, the command says so and stops.
//
// Ctrl-C leaves the daemon driving. Interrupting a turn is not this process's to do,
// and a trak carries on wherever it got to — `pnpm ork resume <id>` reattaches.

import { type Dirent, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { createInterface, type Interface } from "node:readline"
import { Console, Context, Effect, Fiber, Layer, Stream } from "effect"
import type { ActRequestDto } from "@orkestra/shared/dto/actions"
import type { RefusalDto } from "@orkestra/shared/dto/common"
import type { McpToolCallDto, McpToolListDto, McpToolResultDto } from "@orkestra/shared/dto/goals"
import type { ComposerOutputDto, QuestionDto, StepOutputDto } from "@orkestra/shared/dto/log"
import type { EngineFrameDto } from "@orkestra/shared/dto/stream"
import type { TrakDetailDto, TrakSummaryDto } from "@orkestra/shared/dto/trak"
import { projectDir } from "./app/discovery.js"
import { version } from "./app/packaged.js"
import { proofsCommand } from "./app/proofs.js"
import { Engine, type EngineError } from "./cli/engine.js"
import {
  EngineHttpLayer,
  findEngine,
  type Found,
  handedGoal,
  handedTrak,
  noEngineMessage,
} from "./cli/http.js"
import {
  INTERNAL,
  initialized,
  NO_METHOD,
  readIncoming,
  result,
  rpcError,
  toolResult,
} from "./cli/logic/mcp-server.js"
import {
  type Ask,
  atRest,
  block,
  decisionOf,
  instructionOf,
  parkedAt,
  show,
  stateLabel,
  stepLabel,
} from "./cli/logic/render.js"

// ============================================================================
// Subcommands
// ============================================================================

const usage = (): never => {
  console.error(`usage: pnpm ork "<what you want done>"`)
  console.error(`       pnpm ork --version`)
  console.error(`       pnpm ork list`)
  console.error(
    `       pnpm ork resume <id>     (a parked gate, an interrupted turn, or a failure)`,
  )
  console.error(`       pnpm ork record <id>     (how one trak went, computed from its log)`)
  console.error(`       pnpm ork records         (rewrite .orkestra/records/ from every ended log)`)
  console.error(`       pnpm ork merge <id>      (its branch into the one you are on)`)
  console.error(
    `       pnpm ork archive <id> ["<why>"]  (put it away: checkout, branch, base ref and the`,
  )
  console.error(`                                 branch on GitHub all go; "<why>" if unfinished)`)
  console.error(`       pnpm ork reenter <id> "<what came back>"  (a trak at rest, picked up)`)
  console.error(`       pnpm ork wipe [<id>]`)
  console.error(`       pnpm ork revoke-sessions (log every browser out, on every device)`)
  console.error(
    `       pnpm ork proofs publish  (this clean checkout's unit proofs, pushed to origin)`,
  )
  console.error(
    `       pnpm ork proofs read --check <name>  (the units origin holds on this commit)`,
  )
  console.error(
    `       pnpm ork proofs run --check <name> --skipped <dir> [--prints-from <tree>]  (the check, skipping on proofs and prints)`,
  )
  console.error(``)
  console.error(`       --dir <path>             (the repository, default: this one)`)
  return process.exit(1)
}

const requireArg = (value: string | undefined): string => {
  if (value === undefined || value.trim() === "") return usage()
  return value
}

// `--dir` is taken out before anything positional is read, so it may go anywhere on the
// line — a subcommand's id and sentence are counted from what is left.
const { root: PROJECT, rest: cmdArgs } = projectDir(process.argv.slice(2))
const [firstArg, ...cmdRest] = cmdArgs
// Before anything else: no discovery, no request. `--version` answers from this file
// alone, so it must not go looking for a daemon on the way.
if (firstArg === "--version") {
  console.log(version())
  process.exit(0)
}
const cmdArg = requireArg(firstArg)

// Before anything looks for a daemon: CI runs `proofs run` where none is running.
if (cmdArg === "proofs") {
  const answer = await Effect.runPromise(Effect.either(proofsCommand(PROJECT, cmdRest)))
  if (answer._tag === "Left") {
    console.error(answer.left.reason)
    process.exit(1)
  }
  for (const line of answer.right.out) console.log(line)
  if (answer.right.note !== undefined) console.error(answer.right.note)
  process.exit(answer.right.failed === true ? 1 : 0)
}

const isList = cmdArg === "list"
const isWipe = cmdArg === "wipe"
const isArchive = cmdArg === "archive"
const isReenter = cmdArg === "reenter"
const isGoalTools = cmdArg === "goal-tools"
const isTrakTools = cmdArg === "trak-tools"
if (["resume", "record", "merge", "archive"].includes(cmdArg) && cmdRest[0] === undefined) usage()
// The sentence is required, and that is the whole point of the command: a re-entry
// with nothing said gives the composer no reason to plan anything. An archive wants one
// too where the trak has not finished — a trak declared over with nothing said is
// indistinguishable from one left to rot — but which route it takes is only known once
// the trak has been read, so `archiveTrak` is where that is refused.
const saidNothing = cmdRest[0] === undefined || (cmdRest[1] ?? "").trim() === ""
if (isReenter && saidNothing) usage()
// Note the collision this leaves: a trak described exactly as "list", "resume",
// "record", "records", "merge", "archive", "reenter", "wipe" or "revoke-sessions" cannot
// be told apart from the subcommand.
const argId = cmdRest[0] ?? ""
const sentence = cmdRest[1] ?? ""

// ============================================================================
// The human's end of the conversation
// ============================================================================

/**
 * A service, not an `rl` parameter threaded through every function: it is the same
 * terminal on every call in the flow, which is what makes it a dependency.
 */
class Term extends Context.Tag("ork/Term")<
  Term,
  { readonly ask: (prompt: string) => Effect.Effect<string | undefined> }
>() {}

/**
 * Lines are buffered as they arrive, not read on demand.
 *
 * `rl.question` only listens while it is waiting, and readline emits a line the moment
 * the stream has one — so with input piped in, every line lands and is dropped before
 * the first gate exists, and a `question` after EOF throws "readline was closed" rather
 * than reporting the close. Buffering fixes both, and gives the interactive case the
 * behaviour a CLI should have anyway: type during a long step and your answer is
 * waiting at the next gate.
 *
 * Returns `undefined` once stdin has closed — ctrl-D is how you leave.
 */
const makeReader = (rl: Interface): ((prompt: string) => Effect.Effect<string | undefined>) => {
  const buffered: string[] = []
  let waiting: ((line: string | undefined) => void) | undefined
  let closed = false

  const deliver = (line: string | undefined): void => {
    const waiter = waiting
    waiting = undefined
    if (waiter === undefined) {
      if (line !== undefined) buffered.push(line)
      return
    }
    waiter(line)
  }
  rl.on("line", (line: string) => deliver(line))
  rl.once("close", () => {
    closed = true
    deliver(undefined)
  })

  // A terminal echoes what was typed; a pipe does not, so a scripted run would print
  // the answer and the line after it on top of each other.
  const echoing = !process.stdin.isTTY

  return (prompt: string) =>
    Effect.async<string | undefined>((resumeAsync) => {
      process.stdout.write(prompt)
      const done = (line: string | undefined): void => {
        if (line === undefined || echoing) process.stdout.write(`${line ?? ""}\n`)
        resumeAsync(Effect.succeed(line))
      }
      const next = buffered.shift()
      if (next !== undefined) {
        done(next)
        return
      }
      if (closed) {
        done(undefined)
        return
      }
      waiting = done
      return Effect.sync(() => {
        waiting = undefined
      })
    })
}

/**
 * Ctrl-C, and why it still must not go through a signal.
 *
 * At a TTY readline holds stdin in raw mode, so ctrl-C never becomes SIGINT — readline
 * emits it as an event. That is also the only mechanism that works here, because a
 * signal cannot be used at all: `tsx` runs this script as a child and SIGKILLs it about
 * 30ms after relaying one, so a signal-shaped ctrl-C skips every finalizer.
 *
 * **What it has to do is smaller than it was, and that is the point.** This process
 * drives nothing. Leaving takes the terminal away from the conversation; the daemon
 * carries on with the turn it is running, and `resume` reattaches.
 */
const interrupt: { ctrlC: (() => void) | undefined } = { ctrlC: undefined }

const openTerminal = Effect.sync(() => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on("SIGINT", () => interrupt.ctrlC?.())
  return rl
})

const TermLayer = Layer.scoped(
  Term,
  Effect.map(
    Effect.acquireRelease(openTerminal, (rl) => Effect.sync(() => rl.close())),
    (rl) => ({ ask: makeReader(rl) }),
  ),
)

/** Re-ask rather than send a blank: an empty answer renders as a numbered gap. */
const nonEmpty = Effect.fn("nonEmpty")(function* (prompt: string) {
  const term = yield* Term
  for (;;) {
    const said = yield* term.ask(prompt)
    if (said === undefined) return undefined
    if (said.trim() !== "") return said.trim()
  }
})

/** Ask a yes/no before anything is spent. `false` means the human declined. */
const confirm = Effect.fn("confirm")(function* (prompt: string) {
  const term = yield* Term
  const said = yield* term.ask(prompt)
  const yes = said?.trim().toLowerCase()
  return yes === "y" || yes === "yes"
})

// ============================================================================
// Asking what to do about it
// ============================================================================

/**
 * A skip is a word rather than a key, for `replan`'s reason: it is not the opposite of
 * what the gate is asking, and a bare keystroke for it would read as the default.
 */
const SKIP_WORD = "skip"
const REPLAN_WORD = "replan"

/**
 * `skip`, or `skip <message>`, and nothing else — so a sentence that merely starts with
 * the word stays a sentence rather than abandoning a step.
 */
const asSkip = (text: string): ActRequestDto | undefined => {
  const lower = text.toLowerCase()
  if (lower === SKIP_WORD) return { action: "skip" }
  return lower.startsWith(`${SKIP_WORD} `)
    ? { action: "skip", message: text.slice(SKIP_WORD.length + 1).trim() }
    : undefined
}

/**
 * `replan <why>`, and the reason is not optional: it is the whole action, and the only
 * thing the composer is told. A bare `replan` is a person reaching for the word before
 * they have decided what to say, so the hint asks again rather than sending an empty
 * sentence to a fresh session.
 */
const asReplan = (text: string): ActRequestDto | undefined => {
  if (!text.toLowerCase().startsWith(`${REPLAN_WORD} `)) return undefined
  const reason = text.slice(REPLAN_WORD.length + 1).trim()
  return reason === "" ? undefined : { action: "replan", reason }
}

const askAnswers = Effect.fn("askAnswers")(function* (questions: readonly QuestionDto[]) {
  const answers: string[] = []
  yield* Console.log(
    `│ or \`${SKIP_WORD}\`/\`${SKIP_WORD} <message>\` to move on without this step`,
  )
  for (const [i, q] of questions.entries()) {
    yield* Console.log(`│ ${String(i + 1)}. ${q.question}`)
    if (q.context !== undefined) yield* Console.log(`│    ${q.context}`)
    if (q.options.length > 0) {
      // The recommendation is named and nothing else: a blank still re-asks rather than
      // meaning "the recommended one", because a blank here already means "not answered".
      const labels = q.options.map((o) =>
        o.recommended === true ? `${o.label} (recommended)` : o.label,
      )
      yield* Console.log(`│    ${labels.join("  ·  ")}`)
    }
    const answer = yield* nonEmpty(`│ answer ${String(i + 1)} > `)
    if (answer === undefined) return undefined
    // Read in place of the first answer only. A question you are not going to answer is
    // exactly when a skip is reached for, and looking for it against every answer would
    // make "skip the migration for now" abandon the step.
    if (i === 0) {
      const skip = asSkip(answer)
      if (skip !== undefined) return skip
    }
    answers.push(answer)
  }
  // The tuple is built through a narrowed `first` rather than asserted: `ActRequestDto`
  // declares `answers` non-empty, and that is what makes the mapping on the other side
  // total — an empty list is refused by the schema rather than by a function that has
  // to throw.
  const [first, ...rest] = answers
  if (first === undefined) return undefined
  // Asked once, after the last answer, because it frames all of them rather than any
  // one. Blank is none, and it is sent as typed — `actFromDto` is the single place a
  // blank becomes absent, so this does not second-guess it.
  const term = yield* Term
  const note = yield* term.ask("│ anything else, or [enter] > ")
  if (note === undefined) return undefined
  const request: ActRequestDto = { action: "answer", answers: [first, ...rest], note }
  return request
})

const REPLAN_HINT = "`replan <why>` to ask the composer for a different rest of the plan"

const HINT =
  "│ [enter] approve  ·  or type anything to say it to the agent\n" +
  `│ ${REPLAN_HINT}  ·  ctrl-D quit`

/**
 * The two gates with no bare-enter answer, because they have nothing to approve: the
 * step has filed nothing, and an empty line is a person pressing the key that means
 * "yes" everywhere else. Honouring it would advance past work that has not happened.
 */
const NOTHING_FILED_HINT = `│ \`${SKIP_WORD}\` or \`${SKIP_WORD} <message>\` to move on without this step\n│ ${REPLAN_HINT}\n│ ctrl-D quit`

const CONVERSATION_HINT = `│ type to keep talking to the agent\n${NOTHING_FILED_HINT}`

/** The step could not do the work, and nothing here plans from that on its own. */
const STUCK_HINT = `│ type to talk to the agent — a fresh angle is the cheap fix\n${NOTHING_FILED_HINT}`

/** The step asks to run one refused command; the engine words the yes, naming it. */
const PERMISSION_HINT = `│ \`yes\` to let it run the command  ·  \`no\` to refuse it\n${NOTHING_FILED_HINT}`

/**
 * A yes or a no to the command a step asked to run — or a skip or a replan, as at any
 * gate that filed nothing. Anything else asks again: a chat here would resume the step
 * with no answer to what it asked.
 */
const askPermission = Effect.fn("askPermission")(function* () {
  const term = yield* Term
  for (;;) {
    yield* Console.log(PERMISSION_HINT)
    const said = yield* term.ask("│ > ")
    if (said === undefined) return undefined
    const text = said.trim()
    const word = text.toLowerCase()
    if (word === "yes" || word === "no") {
      const request: ActRequestDto = { action: "permit", granted: word === "yes" }
      return request
    }
    const other = asReplan(text) ?? asSkip(text)
    if (other !== undefined) return other
  }
})

/**
 * What a human can do here — approve, say something, answer what was asked, skip a step
 * that filed nothing, or send the rest of the plan back to the composer. Typing at an
 * approval gate is not "reject": it resumes that step's session, and a new output
 * follows.
 */
const askAction = Effect.fn("askAction")(function* (
  kind: Ask,
  out: ComposerOutputDto | StepOutputDto | undefined,
) {
  const term = yield* Term
  if (kind === "answers") {
    // The daemon only parks here on a questions output, so anything else is a bug in
    // the engine rather than something to paper over with a fallback.
    if (out?.type !== "questions") return yield* Effect.die(`answers gate without questions`)
    return yield* askAnswers(out.questions)
  }
  if (kind === "permission") return yield* askPermission()
  // The gates where the step has filed nothing, which is `decide`'s `skippable` and is
  // what decides both halves here: no bare-enter answer, and `skip` on offer instead.
  const nothingFiled = kind === "conversation" || kind === "stuck"
  const hint = kind === "stuck" ? STUCK_HINT : kind === "conversation" ? CONVERSATION_HINT : HINT
  let text: string | undefined
  while (text === undefined) {
    yield* Console.log(hint)
    const said = yield* term.ask("│ > ")
    if (said === undefined) return undefined
    const trimmed = said.trim()
    // An empty line means "approve" everywhere that has something to approve. Where
    // nothing is filed it does not, so ask again rather than inventing an answer.
    if (trimmed !== "" || !nothingFiled) text = trimmed
  }
  if (text === "") return { action: "approve" as const }
  const replan = asReplan(text)
  if (replan !== undefined) return replan
  return (nothingFiled ? asSkip(text) : undefined) ?? { action: "chat" as const, message: text }
})

// ============================================================================
// Watching — the running commentary, reconstructed from frames
// ============================================================================

const CLOSE = "╰──────────────────────────────────────────────────"

/**
 * Closing a run's box, with the blank line after it. A value rather than a literal
 * because every way out of a command prints it — including the ones that refuse to do
 * anything — and a box left unclosed reads as a run still going.
 */
const closeRun = Console.log(`${CLOSE}\n`)

/**
 * The engine's own account of a turn, as it happens.
 *
 * **Elapsed comes from the event, not from when the frame arrived.** The two agree
 * while a connection holds and disagree the moment one drops: a batch replayed on
 * reconnect would all look instantaneous, and the stretch nobody was watching would
 * read as the fastest part of the run.
 */
/**
 * What the agent said, and what it did.
 *
 * The rest of a transcript is bookkeeping the engine has already written down, and a
 * person watching a turn go past cannot act on any of it — the same three kinds the CLI
 * has always filtered out, decided here rather than in the engine now.
 */
const activityLine = (frame: Extract<EngineFrameDto, { _tag: "Activity" }>): void => {
  const entry = frame.entry
  if (entry._tag === "Text") console.log(block(entry.text.trim()))
  if (entry._tag === "Tool") {
    console.log(`│     ↳ ${entry.name}${entry.detail === undefined ? "" : `(${entry.detail})`}`)
  }
}

const commentator = (
  id: string,
  planNow: () => TrakDetailDto["plan"],
): ((frame: EngineFrameDto) => void) => {
  // The clock restarts when a turn begins rather than when the last one ended, so the
  // minutes spent reading a gate are not attributed to the next step.
  let last: number | undefined
  const attempts = new Map<number, number>()

  const appended = (frame: Extract<EngineFrameDto, { _tag: "Appended" }>): void => {
    const state = frame.state
    const working = state._tag === "Composing" || state._tag === "AgentWorking"
    const at = frame.event.at
    const since = last === undefined || at === undefined ? undefined : (at - last) / 1000
    const label = `│   ${decisionOf(state).padEnd(8)} ${stateLabel(state).padEnd(20)}`
    console.log(working || since === undefined ? label : `${label} +${since.toFixed(1)}s`)
    if (working && at !== undefined) last = at

    if (state._tag === "Composing") console.log(`├─ ENTERING the composer`)
    if (state._tag !== "AgentWorking") return
    const plan = planNow()
    const attempt = (attempts.get(state.step) ?? 0) + 1
    attempts.set(state.step, attempt)
    const again = attempt > 1 ? `  (attempt ${String(attempt)})` : ""
    console.log(`├─ ENTERING ${stepLabel(plan, state.step)}${again}`)
    const entry = plan?.steps[state.step]
    if (entry !== undefined) console.log(`│    ${instructionOf(entry) ?? ""}`)
  }

  return (frame) => {
    if (frame._tag === "Activity" && frame.trak === id) activityLine(frame)
    if (frame._tag === "Appended" && frame.trak === id) appended(frame)
  }
}

// ============================================================================
// The gate loop
// ============================================================================

/** How often the trak is re-read while the daemon is driving it, in milliseconds. */
const SETTLE_MS = 400

/**
 * Wait until nothing is driving this trak.
 *
 * **The stream is the commentary; this is the control flow**, and the split is
 * deliberate. A loop whose only signal was a frame would hang forever on a dropped
 * connection — and a dropped connection is exactly when a person most wants their
 * prompt back. It is the same shape the browser client takes, one layer down.
 */
const settled = (id: string): Effect.Effect<TrakDetailDto, EngineError, Engine> =>
  Effect.gen(function* () {
    const engine = yield* Engine
    for (;;) {
      const detail = yield* engine.detail(id)
      if (detail.custody.holder === undefined) return detail
      yield* Effect.sleep(SETTLE_MS)
    }
  })

/** Whatever the agent last said. That is always what a gate is about. */
const lastOutput = (detail: TrakDetailDto): ComposerOutputDto | StepOutputDto | undefined => {
  for (let i = detail.log.length - 1; i >= 0; i -= 1) {
    const event = detail.log[i]
    if (event?._tag === "ComposerReturned" || event?._tag === "AgentReturned") return event.output
  }
  return undefined
}

/** The failure a `checks` gate is about — the state carries no payload, so this looks. */
const lastCheckFailure = (
  detail: TrakDetailDto,
): { readonly name: string; readonly output: string } | undefined => {
  for (let i = detail.log.length - 1; i >= 0; i -= 1) {
    const event = detail.log[i]
    if (event?._tag === "CheckFailed") return { name: event.name, output: event.output }
  }
  return undefined
}

const showGate = Effect.fn("showGate")(function* (detail: TrakDetailDto, ask: Ask, title: string) {
  const out = lastOutput(detail)
  // Only a checks gate is about something the agent did not say, so only it goes
  // looking beyond the last output.
  const failure = ask === "checks" ? lastCheckFailure(detail) : undefined
  yield* Console.log(`│`)
  yield* Console.log(`├─ ${title}`)
  yield* Console.log(`│`)
  if (out !== undefined && out.type !== "questions") yield* Console.log(block(show(out)))
  if (failure !== undefined) {
    yield* Console.log(`│`)
    yield* Console.log(`│ \`${failure.name}\` said:`)
    yield* Console.log(block(failure.output))
  }
  yield* Console.log(`│`)
  return out
})

/**
 * Answer this trak's gates until it stops asking.
 *
 * Two cases and nothing polls for a third: the daemon parks a trak or it settles one.
 * `AwaitingChildren` used to need a third — a spawn's children are the daemon's to
 * drive now, so what is left is the human half, one child at a time, which is what it
 * always really was.
 */
const driveToEnd = (id: string): Effect.Effect<TrakDetailDto, EngineError, Engine | Term> =>
  Effect.gen(function* () {
    const engine = yield* Engine
    for (;;) {
      const detail = yield* settled(id)
      const gate = parkedAt(detail.state, detail.plan)
      if (gate === undefined) return detail
      const out = yield* showGate(detail, gate.ask, gate.title)
      const action = yield* askAction(gate.ask, out)
      if (action === undefined) return detail
      yield* engine.act(id, action)
      // The 202 means accepted, not done: give the drive it started a moment to appear
      // before asking again, or the same gate is read twice.
      yield* Effect.sleep(SETTLE_MS)
    }
  })

/**
 * Drive a trak's gates with the daemon's commentary printing beside them.
 *
 * The projection the commentary reads is refreshed as the loop goes, because naming a
 * step needs the plan and the plan changes whenever the composer runs again.
 */
const converse = (id: string, from: TrakDetailDto | undefined) =>
  Effect.gen(function* () {
    const engine = yield* Engine
    let held = from
    const onFrame = commentator(id, () => held?.plan)
    const printing = yield* Effect.fork(
      Stream.runForEach(engine.watch(), (frame) => Effect.sync(() => onFrame(frame))).pipe(
        // A stream that drops is the commentary going quiet, not the command failing.
        Effect.ignore,
      ),
    )
    return yield* Effect.ensuring(
      Effect.map(driveToEnd(id), (detail) => {
        held = detail
        return detail
      }),
      Fiber.interrupt(printing),
    )
  })

// ============================================================================
// Reporting what a run left behind
// ============================================================================

/** What each failure kind means for the retry. */
const WHY: Record<string, string> = {
  agent: "the agent gave up on its own work",
  provider: "the agent's CLI or the API went — this says nothing about the work",
  worktree: "git, or this project's `.orkestra/worktrees/setup.sh`",
  merge: "git would not merge this trak's branch into its destination — the checkout is fine",
  engine: "an invariant broke in the engine — a retry will most likely land here again",
}

const reportFailure = Effect.fn("reportFailure")(function* (id: string, detail: TrakDetailDto) {
  if (detail.state._tag !== "Failed") return
  const engine = yield* Engine
  yield* Console.log(`│`)
  yield* Console.log(`│ ${WHY[detail.state.kind] ?? "it failed"}:`)
  // In full. It is the one thing the human came here to read, and a provider error is
  // often several lines of somebody else's diagnostics.
  yield* Console.log(block(detail.state.error))
  yield* Console.log(`│`)

  const preview = yield* engine.resumePreview(id)
  if (preview.position === undefined || preview.retry === "nowhere") {
    yield* Console.log(`│ there is nothing there to re-run.`)
    return
  }
  const where = stateLabel(preview.position)
  yield* Console.log(
    preview.retry === "gate"
      ? `│ it stopped at ${where} — a gate, so picking it back up costs nothing:`
      : `│ it can be retried from ${where}, which re-runs that position:`,
  )
  yield* Console.log(`│`)
  yield* Console.log(`│     pnpm ork resume ${id}`)
})

/** What every path leaves behind: final state, the log, and where the work went. */
const reportFinal = Effect.fn("reportFinal")(function* (id: string, detail: TrakDetailDto) {
  yield* Console.log(`│`)
  yield* Console.log(`│ ${stateLabel(detail.state)} after ${String(detail.log.length)} events`)
  yield* Console.log(`│ log: ${detail.log.map((e) => e._tag).join(" · ")}`)
  const worktree = detail.worktree
  if (worktree !== undefined) {
    if (detail.state._tag === "Finished") {
      yield* Console.log(`│ committed to ${worktree.branch}`)
      yield* Console.log(`│ worktree ${worktree.path} — still here, until you merge or archive it`)
    } else if (detail.state._tag === "Merged") {
      yield* Console.log(`│ ${worktree.branch} merged as ${detail.state.sha} — archived`)
    } else {
      // At rest without a merge is archived: the branch went with the checkout, so
      // the log is what is left to point at.
      yield* Console.log(
        atRest(detail.state)
          ? `│ archived — ${worktree.branch} is gone, here and on GitHub`
          : `│ worktree ${worktree.path}`,
      )
    }
  }
  // Off the log rather than a map of its own: every document a trak filed is on the
  // `AgentReturned` that filed it, and the wire carries nothing a reader could not read
  // from there.
  for (const event of detail.log) {
    if (event._tag !== "AgentReturned" || event.output.type !== "artifact") continue
    const count = Object.keys(event.output.sections).length
    yield* Console.log(
      `│ artifact at step ${String(event.step)} (${String(count)} section${count === 1 ? "" : "s"})`,
    )
  }
  // Last, on purpose: each ends in the command to run next, and that should be the line
  // still on screen rather than one scrolled past by an artifact inventory.
  if (detail.state._tag === "Failed") yield* reportFailure(id, detail)
  if (detail.state._tag === "Finished") {
    yield* Console.log(`│`)
    yield* Console.log(`│ read it, then say what happens to it:`)
    yield* Console.log(`│`)
    yield* Console.log(`│     pnpm ork merge ${id}`)
    yield* Console.log(`│     pnpm ork archive ${id}`)
    yield* Console.log(`│     pnpm ork reenter ${id} "<what came back>"`)
  }
  yield* closeRun
})

// ============================================================================
// list
// ============================================================================

/**
 * How much disk a held checkout is holding, rounded to something a person reads.
 *
 * Still computed here rather than sent: it is a fact about this machine's filesystem,
 * the daemon is on the same one by construction, and a field the wire carried would be
 * a directory walk per row on every poll of every open tab.
 */
const checkoutSize = (path: string): string => {
  let bytes = 0
  const walk = (dir: string): void => {
    let entries: readonly Dirent[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        try {
          bytes += statSync(full).size
        } catch {
          /* gone between the listing and the stat, which is not this line's problem */
        }
      }
    }
  }
  walk(path)
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${String(Math.round(mb))} MB`
}

const showRow = Effect.fn("showRow")(function* (row: TrakSummaryDto, indent: string) {
  const engine = yield* Engine
  const running = row.running ? " · running now" : ""
  yield* Console.log(`${indent}${row.id}  ${stateLabel(row.state)}${running}`)
  // The plan's title names the row, and the request stands in only until there is
  // one — the same rule the UI's list follows, because a queue of raw requests is a
  // queue of paragraphs.
  yield* Console.log(`${indent}  ${row.title ?? row.description}`)
  if (row.instruction !== undefined) yield* Console.log(`${indent}  ${row.instruction}`)
  if (row.state._tag !== "Finished") return
  // The checkout line, and what it costs — measured only for a trak that is *holding*
  // one. Nothing sweeps them and nothing will: a background process that deletes a
  // human's checkout is exactly the surprise `merge` refuses to be. The list is where
  // that cost is paid, so the size sits beside the path.
  const detail = yield* engine.detail(row.id)
  const worktree = detail.worktree
  if (worktree === undefined) return
  yield* Console.log(
    `${indent}  worktree: ${worktree.path} (${checkoutSize(worktree.path)}, until you archive it)`,
  )
})

/**
 * Roots first, each with its children under it, then how many are put away.
 *
 * **A child whose parent is not here is a root** — a wiped parent is a thing that
 * happens, and a trak that exists and is listed nowhere is the one failure this command
 * must not have. An archived trak is the one kind that is not a row: the engine sends a
 * count in place of them and never their rows, so what this can say of them is the
 * number.
 */
const listTraks = Effect.fn("listTraks")(function* () {
  const engine = yield* Engine
  const { traks: rows, archived } = yield* engine.list()
  if (rows.length === 0 && archived === 0) {
    yield* Console.log("no traks in this repository")
    return
  }
  const present = new Set(rows.map((r) => r.id))
  const tops = rows.filter((r) => r.parent === undefined || !present.has(r.parent.id))
  for (const row of tops) {
    yield* showRow(row, "")
    // Plan order, which is what `child` is: the store lists by directory, and that is
    // not the order a spawn made them in.
    const children = rows
      .filter((r) => r.parent?.id === row.id)
      .toSorted((a, b) => (a.parent?.child ?? 0) - (b.parent?.child ?? 0))
    for (const child of children) yield* showRow(child, "  ")
  }
  if (archived > 0) yield* Console.log(`${String(archived)} archived`)
})

/**
 * The corpus, rebuilt.
 *
 * Free, and the only thing it changes is a directory of markdown — so it prints what
 * it wrote rather than asking first. Run it after a format change, or on a checkout
 * whose `.orkestra/records/` is empty because every trak in it ended before this
 * existed.
 */
const regenerateRecords = Effect.fn("regenerateRecords")(function* () {
  const folders = yield* (yield* Engine).records()
  if (folders.length === 0) {
    yield* Console.log("nothing has ended yet, so there is nothing to record")
    return
  }
  for (const folder of folders) yield* Console.log(`  .orkestra/records/${folder}`)
  yield* Console.log(`\n${String(folders.length)} trak(s) at rest`)
})

// ============================================================================
// The commands
// ============================================================================

/** One trak's opening box: its id and what it is. */
const openBox = Effect.fn("openBox")(function* (id: string, description: string) {
  yield* Console.log(`\n╭─ trak ${id}`)
  yield* Console.log(`│ ${description}`)
})

const startTrak = Effect.fn("startTrak")(function* (description: string) {
  const engine = yield* Engine
  const { id } = yield* engine.start(description)
  yield* openBox(id, description)
  yield* reportFinal(id, yield* converse(id, undefined))
})

const resumeTrak = Effect.fn("resumeTrak")(function* (id: string) {
  const engine = yield* Engine
  const detail = yield* engine.detail(id)
  const preview = yield* engine.resumePreview(id)
  yield* openBox(id, detail.description)

  if (preview.failure !== undefined) {
    yield* Console.log(`│`)
    yield* Console.log(`│ ${WHY[preview.failure.kind] ?? "it failed"}:`)
    yield* Console.log(block(preview.failure.error))
  } else if (preview.interrupted) {
    yield* Console.log(`│`)
    yield* Console.log(`│ the last turn never finished — the process driving it died mid-turn.`)
  }

  if (preview.retry === "nowhere") {
    yield* Console.log(`│ it is over — there is nothing there to re-run.`)
    yield* closeRun
    return
  }
  // **Asked only where it costs something.** `restartFrom` re-parks a gate unchanged,
  // so a spend question there would be about nothing — but the restart itself still has
  // to happen either way: a `Failed` trak is not sitting at its gate, it is sitting at
  // `Failed`, and it is `Restarted` that puts it back. Skipping it left the command
  // reporting the failure and doing nothing about it.
  if (preview.retry === "rerun" && !(yield* confirm(`│ re-run it? [y/N] > `))) {
    yield* Console.log(`│ leaving it as it is — nothing was spent`)
    yield* closeRun
    return
  }
  yield* engine.resume(id)
  yield* reportFinal(id, yield* converse(id, detail))
})

const mergeTrak = Effect.fn("mergeTrak")(function* (id: string) {
  const engine = yield* Engine
  const detail = yield* engine.detail(id)
  const preview = yield* engine.mergePreview(id)
  yield* openBox(id, detail.description)
  yield* Console.log(
    preview.parentId === undefined
      ? `│ merging ${preview.branch ?? "its branch"} into ${preview.into ?? "a detached HEAD"}`
      : `│ merging ${preview.branch ?? "its branch"} into its parent ${preview.parentId}`,
  )
  if (preview.parentId === undefined) {
    yield* Console.log(`│ — the branch you are on, which is the only place this can go`)
  }
  yield* Console.log(`│`)
  // Asked of git before anything is pressed, so the sentence describes what this
  // particular merge will do rather than what a merge can do. Both answers still
  // attempt it — the outcome decides, which is what makes a stale prediction free.
  yield* Console.log(
    preview.conflicts === true
      ? `│ these branches disagree, so this will merge nothing — it asks the composer`
      : `│ the checkout goes with it once the branch is in.`,
  )
  if (preview.conflicts === true) {
    yield* Console.log(`│ for a plan that settles it, and the trak comes back here to merge.`)
  }
  if (!(yield* confirm(`│ go on? [y/N] > `))) {
    yield* Console.log(`│ left where it was — nothing was merged`)
    yield* closeRun
    return
  }
  yield* engine.merge(id)
  yield* reportFinal(id, yield* settled(id))
})

/**
 * Put a trak away — the terminal's Archive, with the confirmation the screen has.
 *
 * One word, two routes: a finished trak goes through the close route, anything else
 * through the abandon route, which interrupts the turn in flight first and needs a
 * reason. Both delete the same four things — the checkout, the branch, its recorded
 * base ref and the branch's copy on GitHub — so both say so and ask before sending,
 * which is the only guard there is. Neither spends anything.
 */
const archiveTrak = Effect.fn("archiveTrak")(function* (id: string, reason: string) {
  const engine = yield* Engine
  const detail = yield* engine.detail(id)
  yield* openBox(id, detail.description)
  const finished = detail.state._tag === "Finished"
  if (!finished && reason.trim() === "") {
    yield* Console.log(`│ it has not finished — say why it is over:`)
    yield* Console.log(`│`)
    yield* Console.log(`│     pnpm ork archive ${id} "<why>"`)
    yield* closeRun
    return
  }
  if (!finished) yield* Console.log(`│ declaring it over: ${reason}`)
  const branch = detail.worktree?.branch
  yield* Console.log(
    `│ the checkout goes, and so do ${branch ?? "the branch"}, its base ref and its copy on GitHub.`,
  )
  yield* Console.log(
    finished
      ? `│ GitHub is asked once whether the pull request merged; that names the ending.`
      : `│ the turn in flight is interrupted, what exists is committed, then all of it goes.`,
  )
  if (!(yield* confirm(`│ archive it? [y/N] > `))) {
    yield* Console.log(`│ leaving it as it is — nothing was deleted`)
    yield* closeRun
    return
  }
  yield* finished ? engine.archive(id) : engine.archiveUnfinished(id, reason)
  yield* reportFinal(id, yield* settled(id))
})

const reenterTrak = Effect.fn("reenterTrak")(function* (id: string, what: string) {
  const engine = yield* Engine
  const detail = yield* engine.detail(id)
  yield* openBox(id, detail.description)
  yield* Console.log(`│ ${what}`)
  yield* Console.log(`│`)
  yield* Console.log(`│ picking it up re-makes its worktree and asks the composer what happens`)
  yield* Console.log(`│ now — the steps it proposes are added after the ones already run.`)
  if (!(yield* confirm(`│ go on? [y/N] > `))) {
    yield* Console.log(`│ leaving it at rest — nothing was spent`)
    yield* closeRun
    return
  }
  yield* engine.reenter(id, what)
  yield* reportFinal(id, yield* converse(id, detail))
})

const wipeTraks = Effect.fn("wipeTraks")(function* (id: string | undefined) {
  const engine = yield* Engine
  if (id !== undefined) {
    yield* engine.wipe(id)
    yield* Console.log(`removed trak ${id}`)
    return
  }
  const { traks: rows, archived } = yield* engine.list()
  if (rows.length === 0 && archived === 0) {
    yield* Console.log("nothing to wipe")
    return
  }
  // The archived ones go too, and the engine counts only the parentless of them — so
  // the live count is exact and the archive is named rather than numbered.
  yield* Console.log(
    `this removes ALL traks in this repository: ${String(rows.length)} live, and every archived one.`,
  )
  const term = yield* Term
  const said = yield* term.ask(`type "yes" to confirm > `)
  if (said?.trim() !== "yes") {
    yield* Console.log("cancelled")
    return
  }
  yield* engine.wipe()
  yield* Console.log("removed every trak")
})

const revokeSessions = Effect.gen(function* () {
  yield* (yield* Engine).revokeSessions()
  yield* Console.log("every browser session is revoked; each device logs in again")
})

// ============================================================================
// Wire it up and run
// ============================================================================

const program = Effect.gen(function* () {
  if (isList) return yield* listTraks()
  if (isWipe) return yield* wipeTraks(cmdRest[0])
  if (cmdArg === "revoke-sessions") return yield* revokeSessions
  if (cmdArg === "record") return yield* Console.log(yield* (yield* Engine).record(argId))
  if (cmdArg === "records") return yield* regenerateRecords()
  if (cmdArg === "resume") return yield* resumeTrak(argId)
  if (cmdArg === "merge") return yield* mergeTrak(argId)
  if (isArchive) return yield* archiveTrak(argId, sentence)
  if (isReenter) return yield* reenterTrak(argId, sentence)
  return yield* startTrak(cmdArg)
})

/**
 * A refusal is the engine explaining itself, not this process failing.
 *
 * Each one has a next step, which is the whole reason `RefusalDto` is a value rather
 * than a reason phrase: a command can say what to do about it. Exhaustive, so a refusal
 * the engine grows has to be given words here.
 */
const explain = (refusal: RefusalDto): string => {
  switch (refusal._tag) {
    case "Dirty":
      return [
        `the checkout this merges into has uncommitted changes:`,
        // Enough to recognise what you forgot; the count for the rest. `git status` is
        // one command away and is where a full list belongs.
        ...refusal.files.slice(0, 10).map((f) => `  ${f}`),
        ...(refusal.files.length > 10 ? [`  … and ${String(refusal.files.length - 10)} more`] : []),
        ``,
        `commit or stash them, then merge it again.`,
      ].join("\n")
    case "NotParked":
      return "nothing is being asked here, so there is nothing to answer."
    case "NotFinished":
      return "it has not finished — there is no checkout to take away yet."
    case "Driving":
      return "something is already driving it — wait for it, or watch with `pnpm ork resume`."
    case "AtRest":
      return "it has already come to rest."
    case "NotAtRest":
      return "it is still going. re-entering is for work that had stopped."
    case "BranchNotMoved":
      return `not re-entered: ${refusal.why}`
    case "NotWaiting":
      return "nothing is holding it, so there is no wait to skip."
    // The terminal has no skip verb for effects, so nothing here can earn this.
    case "NoFailedEffect":
      return "it is not stopped on a failed effect, so there is nothing to skip."
    // The terminal has no stop verb, so nothing here can earn this — it is written
    // because the switch is exhaustive, and because a refusal with no words is worse
    // than one nobody sees.
    case "NothingToStop":
      return "nothing is running here to interrupt."
    // The terminal has no hold verb either, for the same reason.
    case "OnManual":
      return "it is on manual, which already stands at every gate."
    case "Archived":
      return "it has been archived, so there is no pull request left to merge."
    case "ChildTrak":
      return "it is a child, which lands in its parent's checkout and has no pull request of its own."
    case "GoalForbidsAutoMerge":
      return "its goal is set to auto-merge never."
    // The terminal approves a plan as proposed and never sends edits, which is what earns
    // both of these — written for the reason `NothingToStop` is.
    case "PlanRefused":
      return `the plan as edited is refused: ${refusal.reason}`
    // The terminal sends no files, so nothing here can earn this either.
    case "AttachmentRefused":
      return `a file was not taken: ${refusal.reason}`
    case "ProposalMoved":
      return "the plan at the gate has changed since those edits were made."
    // The terminal has no fetch, pull or push — git is one command away there — so
    // nothing here earns these five. Written for the reason `NothingToStop` is.
    case "DetachedHead":
      return "the checkout is on no branch."
    case "NoOrigin":
      return "there is no remote named origin."
    case "NoUpstream":
      return "the branch tracks no remote branch."
    case "Diverged":
      return `the branch and its upstream have diverged (${String(refusal.ahead)} ahead, ${String(refusal.behind)} behind).`
    case "Behind":
      return `the branch is ${String(refusal.behind)} behind its upstream — pull first.`
    // The terminal draws no view, so nothing here presses one. Written for the reason
    // `NothingToStop` is.
    case "ToolNotOpen":
      return "that tool is not open to a view."
    case "NoCheckout":
      return "the checkout is removed, so there is nowhere to start a CLI."
    case "CliNotStarted":
      return `${refusal.cli} did not start: ${refusal.reason}`
    case "ToolCallFailed":
      return `the tool call failed: ${refusal.reason}`
    // The engine's own sentence, naming the owner.
    case "NotOwner":
      return refusal.reason
    case "SubgoalsLive":
      return `these sub-goals are still going: ${refusal.subgoals}`
    case "GoalBranchRefused":
      return `nothing was recorded: ${refusal.reason}`
    case "SubgoalConflicted":
      return [
        `merging into \`${refusal.into}\` would conflict in:`,
        ...refusal.paths.map((f) => `  ${f}`),
      ].join("\n")
    case "Conflict":
      return [
        `merging the upstream would conflict in:`,
        ...refusal.files.map((f) => `  ${f}`),
      ].join("\n")
    // The terminal has no merge-pull-request verb, so nothing here earns this either.
    case "PullNotMerged":
      return `the pull request was not merged: ${refusal.why}`
  }
}

/** What a tool server asks the engine: its list, and one call — and the name it answers to. */
interface ToolsOf {
  readonly name: string
  readonly list: Effect.Effect<McpToolListDto, EngineError, Engine>
  readonly call: (
    name: string,
    call: McpToolCallDto,
  ) => Effect.Effect<McpToolResultDto, EngineError, Engine>
}

/**
 * `orkestra goal-tools` and `orkestra trak-tools`: the MCP server a session's CLI starts,
 * on stdio, one JSON-RPC object per line. It holds nothing — every tool is the engine's —
 * so a request is one HTTP call and its answer one line back. Concurrent: the CLI matches
 * answers to requests by id, and a slow call does not hold up a `ping`.
 *
 * **Nothing else may write to stdout here**, which is why this runs before any terminal
 * is opened: a stray line is a protocol error to the CLI reading it.
 */
const serveTools = (handed: Found, tools: ToolsOf) => {
  const engine = EngineHttpLayer(handed)
  const ask = <A>(effect: Effect.Effect<A, EngineError, Engine>) =>
    Effect.runPromise(Effect.either(Effect.provide(effect, engine)))
  const reason = (e: EngineError): string => (e._tag === "Refused" ? explain(e.refusal) : e.reason)
  const answer = async (line: string): Promise<string | undefined> => {
    const incoming = readIncoming(line)
    switch (incoming.kind) {
      case "ignored":
        return undefined
      case "initialize":
        return result(incoming.id, initialized(incoming.version, tools.name, version()))
      case "ping":
        return result(incoming.id, {})
      case "unknown":
        return rpcError(incoming.id, NO_METHOD, `no ${incoming.method}`)
      case "list": {
        const listed = await ask(tools.list)
        return listed._tag === "Right"
          ? result(incoming.id, { tools: listed.right.tools })
          : rpcError(incoming.id, INTERNAL, reason(listed.left))
      }
      case "call": {
        const answered = await ask(
          tools.call(incoming.name, {
            arguments: incoming.arguments,
            ...(incoming.call === undefined ? {} : { call: incoming.call }),
          }),
        )
        return answered._tag === "Right"
          ? result(incoming.id, toolResult(answered.right.text, answered.right.isError))
          : result(incoming.id, toolResult(reason(answered.left), true))
      }
    }
  }
  return new Promise<void>((done) => {
    const rl = createInterface({ input: process.stdin })
    rl.on("line", (line) => {
      void answer(line).then((out) =>
        out === undefined ? false : process.stdout.write(`${out}\n`),
      )
    })
    rl.once("close", () => done())
  })
}

if (isGoalTools) {
  const handed = handedGoal(process.env)
  if (handed === undefined) {
    console.error(
      "`orkestra goal-tools` is started by a goal composer's CLI, with the goal it serves.",
    )
    process.exit(1)
  }
  await serveTools(handed, {
    name: "orkestra-goal",
    list: Effect.flatMap(Engine, (e) => e.goalTools(handed.goal)),
    call: (name, call) => Effect.flatMap(Engine, (e) => e.goalToolCall(handed.goal, name, call)),
  })
  process.exit(0)
}

if (isTrakTools) {
  const handed = handedTrak(process.env)
  if (handed === undefined) {
    console.error("`orkestra trak-tools` is started by a step's CLI, with the trak it serves.")
    process.exit(1)
  }
  await serveTools(handed, {
    name: "orkestra-trak",
    list: Effect.flatMap(Engine, (e) => e.trakTools(handed.trak)),
    call: (name, call) => Effect.flatMap(Engine, (e) => e.trakToolCall(handed.trak, name, call)),
  })
  process.exit(0)
}

const main = Effect.gen(function* () {
  const found = yield* findEngine(PROJECT)
  return yield* program.pipe(Effect.provide(EngineHttpLayer(found)))
}).pipe(
  Effect.catchTags({
    NoEngine: (e) =>
      Effect.sync(() => {
        console.error(noEngineMessage(e))
        process.exitCode = 1
      }),
    Refused: (e) =>
      Effect.sync(() => {
        console.error(explain(e.refusal))
        process.exitCode = 1
      }),
    EngineFailed: (e) =>
      Effect.sync(() => {
        console.error(`the engine could not answer: ${e.reason}`)
        process.exitCode = 1
      }),
  }),
  Effect.provide(TermLayer),
  Effect.scoped,
)

const fiber = Effect.runFork(main)

interrupt.ctrlC = () => {
  process.stdout.write("\n")
  void Effect.runPromise(Fiber.interrupt(fiber))
}

// Only reached when stdin is not a terminal, since a TTY's ctrl-C arrives through
// readline instead. Kept for a piped or `kill -INT` run, with no illusions: under `tsx`
// the SIGKILL usually lands first.
process.once("SIGINT", () => interrupt.ctrlC?.())

const exit = await Effect.runPromise(Fiber.await(fiber))
if (exit._tag === "Failure") {
  // Interruption is ctrl-C, and it is not a failure. **The daemon is still driving** —
  // leaving takes the terminal away from the conversation and nothing else.
  console.log("\n╰─ left the daemon to it. reattach with `pnpm ork resume <id>`\n")
}
