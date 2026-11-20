// `pnpm compose-lab "<what to do>"` — the composer against real Claude, every
// other agent answered by you at a prompt.
//
// The lab for composition. Only the composer's turn spends anything, so a plan
// can be pushed through a raised requirement, a replan and a splice for the price of
// the compose turns alone — and the composer sees exactly what it would see on a
// real trak, because everything around it is real: the same library, the same
// prompts, the same engine, a real worktree.
//
// One line-based language, read from stdin, so a person and an agent drive it the
// same way. Piped, it echoes what it read, so the run is its own transcript:
//
//   pnpm compose-lab "add a footer to the docs site" <<'EOF'
//   approve
//   requires the footer wants a token audit first
//   approve
//   approve
//   EOF
//
// It writes, unlike `pnpm real:trak`: the store is on disk, so the trak survives
// the run, shows up in `pnpm ui`, and can be picked up with `pnpm ork resume
// <id>` — where the steps become real agents again.

import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline"
import { Console, Duration, Effect, Layer, Match, Stream } from "effect"
import { eventLine } from "./agent/logic/event-line.js"
import { NodeProcessLayer } from "./agent/adapters/process-node.js"
import { Provider } from "./agent/ports/provider.js"
import { ProviderEvent } from "./agent/types/provider-event.js"
import { ProviderFailed } from "./agent/types/errors.js"
import type { SessionRequest } from "./agent/types/session.js"
import type { TranscriptEntry } from "./agent/types/transcript-entry.js"
import { MermaidDiagramsLayer } from "./agent/adapters/diagrams-mermaid.js"
import { cliProviderLayer } from "./agent/adapters/cli-provider.js"
import { claudeSpec } from "./agent/providers/claude/index.js"
import { codexSpec } from "./agent/providers/codex/index.js"
import type { Agent } from "./library/types/agent.js"
import { FsLibraryLayer } from "./library/adapters/library-fs.js"
import { Lib } from "./library/ports/library.js"
import type { Library } from "./library/types/library.js"
import { BuiltinPromptsLayer } from "./prompts/adapters/builtin.js"
import { SHIPPED_AGENTS, TEMPLATES, version as engineVersion } from "./app/packaged.js"
import { GhForgeLayer } from "./vcs/adapters/forge-gh.js"
import { GitCliLayer } from "./vcs/adapters/git-cli.js"
import { ShellChecksLayer } from "./workflow/adapters/checks-shell.js"
import { ShellHostedProcessesLayer } from "./workflow/adapters/processes-shell.js"
import { ShellEnvironmentLayer } from "./workflow/adapters/environment-shell.js"
import { PubSubFeedLayer } from "./workflow/adapters/feed-pubsub.js"
import { PhraseIdsLayer } from "./workflow/adapters/ids-phrase.js"
import { MemoryLocksLayer } from "./workflow/adapters/locks-memory.js"
import { MemoryRunsLayer } from "./workflow/adapters/runs-memory.js"
import { MemoryGoalStoreLayer } from "./workflow/adapters/goal-store-memory.js"
import { MemoryPassesLayer } from "./workflow/adapters/passes-memory.js"
import { MemoryTurnToolsLayer } from "./workflow/adapters/turn-tools-memory.js"
import { MemorySetupsLayer } from "./workflow/adapters/setups-memory.js"
import { FileStoreLayer } from "./workflow/adapters/store-file.js"
import { NodeWorkspaceLayer } from "./workflow/adapters/workspace-node.js"
import { type Event, Events } from "./workflow/domain/event.js"
import { Actions } from "./workflow/domain/human-action.js"
import { artifactText } from "./workflow/domain/outputs/artifact.js"
import {
  artifactKey,
  instructionOf,
  isCompose,
  isSpawn,
  type ReconsultWhy,
  stepName,
} from "./workflow/domain/outputs/proposal.js"
import { replayHistory } from "./workflow/domain/replay.js"
import { atRest, firstUnrun, slotAt, type Trak, TrakId } from "./workflow/domain/trak.js"
import { EngineVersion } from "./workflow/ports/engine-version.js"
import { Observer } from "./workflow/ports/observer.js"
import { Store } from "./workflow/ports/store.js"
import { advance } from "./workflow/runtime.js"

const description = process.argv[2]
if (description === undefined) {
  console.error(`usage: pnpm compose-lab "<what to do>"`)
  process.exit(1)
}

// ============================================================================
// The operator, at a prompt
// ============================================================================

/**
 * Lines are buffered as they arrive rather than read on demand.
 *
 * Piped in, every line lands the moment the stream has it — long before the first
 * prompt exists — so a reader that only listens while it is waiting drops the
 * whole script. Returns `undefined` once stdin closes: ctrl-D, or the end of a
 * heredoc, is how you leave.
 */
const makeReader = (): ((prompt: string) => Effect.Effect<string | undefined>) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
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
  rl.on("line", (line: string) => {
    deliver(line)
  })
  rl.once("close", () => {
    closed = true
    deliver(undefined)
  })

  // A terminal echoes what was typed; a pipe does not, so a scripted run would
  // otherwise print the answer and the line after it on top of each other.
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
    })
}

const ask = makeReader()

/** `word rest of the line`, with the word lower-cased and the rest left alone. */
const said = (line: string): { readonly word: string; readonly rest: string } => {
  const trimmed = line.trim()
  const gap = trimmed.indexOf(" ")
  return gap === -1
    ? { word: trimmed.toLowerCase(), rest: "" }
    : { word: trimmed.slice(0, gap).toLowerCase(), rest: trimmed.slice(gap + 1).trim() }
}

/** `a | b | c` — how every list is typed, whether of units, questions or answers. */
const listed = (rest: string): readonly string[] =>
  rest
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "")

// ============================================================================
// What the trak is doing — the one thing the router needs
// ============================================================================

/**
 * The last state the engine announced, which is what tells a provider call
 * whether the composer is asking or a step is.
 *
 * A `let` rather than a Ref because the observer writes it and the router reads
 * it from inside a Stream, and this is an entry point. It is a snapshot of the
 * trak *before* the command it announced runs, which is exactly the question:
 * `Composing` means the turn about to happen is the composer's.
 */
let watching: Trak | undefined

// ============================================================================
// The faked step
// ============================================================================

/** Every section the agent declares, filled with the same line. */
const sectionsOf = (agent: Agent, text: string): Record<string, string> =>
  Object.fromEntries(agent.sections.map((section) => [section.title, text]))

const fence = (body: unknown): string => `\`\`\`json\n${JSON.stringify(body, undefined, 2)}\n\`\`\``

const REPLY_HINT =
  "│ [enter] file the artifact  ·  `artifact <text>`  ·  `ambiguous <text>`\n" +
  "│ `requires <a> | <b>`  ·  `stuck <what happened>`  ·  `ask <q> | <q>`\n" +
  "│ `say <prose>`  ·  ctrl-D quit"

/**
 * One reply from the operator, as the JSON a real step would have written.
 *
 * `undefined` means the line was not one of these — asked again rather than
 * guessed at, because a typo'd `requres` silently filing an artifact is the one
 * failure a scripted run could not see.
 *
 * A blank line fills every section with the step's own instruction: a step that
 * did exactly what it was told, and no invented prose for the composer to read
 * later.
 */
const stepReply = (agent: Agent, instruction: string, line: string): string | undefined => {
  const { word, rest } = said(line)
  const body = rest === "" ? instruction : rest
  // `ambiguity` on every artifact, because a step that leaves it out is re-prompted —
  // and the operator standing in for a step met no fork, so the rung that changes
  // nothing is the honest one to write. `ambiguous` is how a run is pushed through the
  // gate the other rungs open.
  if (word === "") {
    return fence({ type: "artifact", ambiguity: "none", sections: sectionsOf(agent, instruction) })
  }
  if (word === "artifact") {
    return fence({ type: "artifact", ambiguity: "none", sections: sectionsOf(agent, body) })
  }
  if (word === "ambiguous") {
    return fence({ type: "artifact", ambiguity: "a_lot", sections: sectionsOf(agent, body) })
  }
  if (word === "requires") {
    const units = listed(rest)
    if (units.length === 0) return undefined
    return fence({
      type: "artifact",
      ambiguity: "none",
      sections: sectionsOf(agent, instruction),
      requirements: units.map((text) => ({ text, source: "assumed" })),
    })
  }
  if (word === "stuck") {
    // `tried` is the instruction and the operator's words are what happened. The
    // diagnosis is a guess even from a real agent, and a `replan` reason is the
    // only thing the composer is told about any of it.
    return fence({ type: "stuck", tried: instruction, happened: body, diagnosis: body })
  }
  if (word === "ask") {
    const questions = listed(rest)
    if (questions.length === 0) return undefined
    return fence({
      type: "questions",
      questions: questions.map((question) => ({ question, options: [] })),
    })
  }
  // No JSON at all. On a conversational entry that is the reply; anywhere else it
  // is what `elicit` re-prompts, which is the cheap way to watch it do so.
  if (word === "say") return rest === "" ? undefined : rest
  return undefined
}

/** Where the trak is, as the faked step needs it: which position, and whose turn. */
const stepAsk = (
  lib: Library,
): { readonly key: string; readonly agent: Agent; readonly instruction: string } | undefined => {
  const trak = watching
  if (trak === undefined || trak.state._tag !== "AgentWorking") return undefined
  const index = trak.state.step
  const entry = trak.plan?.steps[index]
  if (entry === undefined || isSpawn(entry) || isCompose(entry)) return undefined
  const agent = lib.agents.get(entry.agent)
  return agent === undefined
    ? undefined
    : { key: artifactKey(entry, index), agent, instruction: entry.instruction }
}

/**
 * A step's turn, answered by the operator instead of by an agent.
 *
 * Leaving here is a `ProviderFailed` rather than a quiet end: the turn genuinely
 * did not happen, and a retryable `Failed{provider}` is what the log should say
 * about a lab someone walked away from.
 */
const fakeTurn = (
  lib: Library,
  req: SessionRequest,
): Stream.Stream<ProviderEvent, ProviderFailed> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const asking = stepAsk(lib)
      if (asking === undefined) {
        return Stream.fail(
          new ProviderFailed({
            provider: "compose-lab",
            reason: `a turn was asked for at ${watching?.state._tag ?? "nothing"}, which is neither the composer nor a step`,
          }),
        )
      }
      yield* Console.log(`│`)
      yield* Console.log(`│ ${asking.key} — ${asking.instruction}`)
      for (;;) {
        yield* Console.log(REPLY_HINT)
        const line = yield* ask(`│ ${asking.key} > `)
        if (line === undefined) {
          return Stream.fail(
            new ProviderFailed({ provider: "compose-lab", reason: "the operator left" }),
          )
        }
        const text = stepReply(asking.agent, asking.instruction, line)
        if (text === undefined) continue
        return Stream.fromIterable<ProviderEvent>([
          ProviderEvent.SessionStarted({ id: req.sessionId }),
          ProviderEvent.Result({ text }),
        ])
      }
    }),
  )

/**
 * Real Claude for the composer, the operator for everything else.
 *
 * The state the engine last announced is the discriminator, and it is the honest
 * one: `Composing` is the engine saying the next turn is the composer's, so
 * nothing here has to recognise a prompt or trust a heuristic about the request.
 */
const LabProviderLayer = Layer.effect(
  Provider,
  Effect.gen(function* () {
    const real = yield* Provider
    const lib = yield* Lib
    return {
      resumeFor: real.resumeFor,
      sessionFileFor: real.sessionFileFor,
      signInFileFor: real.signInFileFor,
      resumeLineFor: real.resumeLineFor,
      credentials: real.credentials,
      run: (req: SessionRequest) =>
        watching?.state._tag === "Composing" ? real.run(req) : fakeTurn(lib, req),
      // The composer's turns are the real provider's, so a stop reaches its pipes.
      stopBackgroundTask: real.stopBackgroundTask,
      steer: real.steer,
      mcp: real.mcp,
      attend: real.attend,
      cliFor: real.cliFor,
      gatesCommandsFor: real.gatesCommandsFor,
    }
  }),
).pipe(Layer.provide(cliProviderLayer(claudeSpec, codexSpec).pipe(Layer.provide(NodeProcessLayer))))

// ============================================================================
// The library, with nothing an absent agent would have earned
// ============================================================================

/**
 * No checks and no setup script.
 *
 * A check inspects the worktree, and in here nothing ever writes to it: every
 * check would run against work that did not happen and fail for a reason that
 * says nothing about composition. The setup script is the same argument one step
 * earlier — it would install this project's dependencies into a worktree nothing
 * is going to build.
 *
 * **Emptying the registry is not enough**: an agent that still *names* a check is
 * an `Effect.die` the moment its step is spawned, because the loader's guarantee
 * is that every name resolves and the runtime is entitled to rely on it. So the
 * names go too.
 *
 * Agent permissions are left alone: the only turn that reaches a CLI is the
 * composer's, and it must be the turn production runs.
 */
const noChecks = (lib: Library): Library => ({
  ...lib,
  agents: new Map([...lib.agents].map(([name, agent]) => [name, { ...agent, checks: [] }])),
  checks: new Map(),
  processes: new Map(),
  // The env script stays, for the same reason the permissions do: the composer's
  // turn must be the turn production runs, toolchain included.
  setup: undefined,
  teardown: undefined,
})

const LabLibrary = Layer.effect(Lib, Effect.map(Lib, noChecks)).pipe(
  Layer.provide(FsLibraryLayer(process.cwd(), SHIPPED_AGENTS)),
)

// ============================================================================
// The gates
// ============================================================================

const GATE_HINT =
  "│ [enter] approve  ·  `replan <why>`  ·  `skip [message]`  ·  `say <text>`\n" +
  "│ `answer <a> | <b>`  ·  ctrl-D quit"

const block = (text: string): string =>
  text
    .split("\n")
    .map((line) => `│   ${line}`)
    .join("\n")

/**
 * The plan as the TRAK holds it, never as the composer wrote it.
 *
 * A revision comes back as the remainder and is spliced at the resume point, so
 * its own steps are numbered from zero while the trak calls the first of them
 * `1-breakdown`. Rendering the output would put the wrong key in front of the
 * person approving it, and the key is the thing every later line refers to.
 */
const planLines = (trak: Trak): string => {
  // Whether an entry ran is `firstUnrun`, never the artifact map: a compose is an
  // entry and files nothing, so keying off artifacts calls every compose that has
  // already run `planned`. Filing is the second fact, and only a step has it.
  const from = firstUnrun(trak)
  return (trak.plan?.steps ?? [])
    .map((step, at) => {
      const key = artifactKey(step, at)
      const how = at >= from ? "planned" : trak.artifacts.has(key) ? "kept   " : "ran    "
      return `${how} ${key}${rung(trak, at)} — ${instructionOf(step) ?? ""}`
    })
    .join("\n")
}

/**
 * What the turn at this position said it ran into, verbatim and in brackets, or nothing
 * where nothing has run there yet.
 *
 * The word as it was written rather than a prettier one: this lab exists to read what
 * real turns produced, and it is the one thing on a plan a gate now turns on — a
 * position that reported the lowest rung and one that reported nothing at all take the
 * same gate and must not read alike.
 */
const rung = (trak: Trak, at: number): string => {
  const reported = slotAt(trak, at).ambiguity
  return reported === undefined ? "" : ` [${reported}]`
}

/** Whatever the last turn said, which is what every gate but the plan's is about. */
const lastOutput = (log: readonly Event[]): string | undefined => {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const event = log[i]
    if (event === undefined) continue
    if (event._tag !== "ComposerReturned" && event._tag !== "AgentReturned") continue
    const out = event.output
    if (out.type === "artifact") {
      const raised = (out.requirements ?? []).map((r) => r.text)
      const found = raised.length === 0 ? "" : `requires: ${raised.join(" · ")}\n\n`
      return `${found}${artifactText(out)}`
    }
    if (out.type === "questions") return out.questions.map((q) => `? ${q.question}`).join("\n")
    if (out.type === "stuck") return `stuck: ${out.happened}\ntried: ${out.tried}`
    return undefined
  }
  return undefined
}

/** The two gates the composer itself is parked at, neither of which carries a step. */
const isComposerGate = (tag: string): boolean =>
  tag === "AwaitingProposal" || tag === "AwaitingComposerAnswers"

/**
 * What the operator wants done here, as the event that does it.
 *
 * `undefined` means leave — either they said so, or the trak is somewhere this
 * lab does not drive. A spawn is the live example: children are driven by a
 * surface rather than by the engine, and `pnpm ork` is the surface that does it.
 */
const gateEvent = Effect.fn("gateEvent")(function* (trak: Trak, log: readonly Event[]) {
  const state = trak.state
  const shown = state._tag === "AwaitingProposal" ? planLines(trak) : lastOutput(log)
  if (shown !== undefined && shown !== "") yield* Console.log(block(shown))

  if (state._tag === "Failed") {
    yield* Console.log(`│ failed (${state.kind}): ${state.error}`)
    yield* Console.log("│ `retry` to run it again  ·  ctrl-D quit")
    const line = yield* ask("│ > ")
    return line !== undefined && said(line).word === "retry"
      ? Events.restarted(undefined)
      : undefined
  }
  if (state._tag !== "AwaitingHuman" && !isComposerGate(state._tag)) {
    yield* Console.log(`│ ${state._tag} — nothing here for this lab to answer`)
    return undefined
  }

  const where = state._tag === "AwaitingHuman" ? `${state.kind} @ step ${state.step}` : state._tag
  const step = state._tag === "AwaitingHuman" ? state.step : 0
  yield* Console.log(`│`)
  yield* Console.log(`│ gate: ${where}`)
  for (;;) {
    yield* Console.log(GATE_HINT)
    const line = yield* ask("│ > ")
    if (line === undefined) return undefined
    const { word, rest } = said(line)
    if (word === "") return Events.humanActed(step, Actions.approve())
    if (word === "approve") return Events.humanActed(step, Actions.approve())
    if (word === "skip")
      return Events.humanActed(step, Actions.skip(rest === "" ? undefined : rest))
    if (word === "replan" && rest !== "") {
      return Events.humanActed(step, Actions.replan(rest))
    }
    if (word === "say" && rest !== "") return Events.humanActed(step, Actions.chat(rest))
    if (word === "answer") {
      const [first, ...others] = listed(rest)
      if (first !== undefined) return Events.humanActed(step, Actions.answer([first, ...others]))
    }
  }
})

const drive = Effect.fn("drive")(function* (id: TrakId, from: Trak) {
  const store = yield* Store
  let trak = from
  while (!atRest(trak.state)) {
    const event = yield* gateEvent(trak, yield* store.events(id))
    if (event === undefined) return trak
    trak = yield* advance(id, event)
  }
  return trak
})

// ============================================================================
// The report — what the composer did with what it was told
// ============================================================================

/**
 * Why the composer was asked, from the trak as it stood when it was asked.
 *
 * Replayed rather than inferred from the surrounding events: `reconsult` is the
 * same field the composer's own prompt was built from, so a report of what it was
 * asked cannot disagree with what it was told. Nothing in the log says this
 * directly — the field is derived, and the reasons are only distinguishable here
 * because `replayHistory` derives them the one way.
 *
 * Absent means nobody re-consulted anything: a first plan, or a person talking to
 * the composer at the plan gate, which resumes its session rather than asking it
 * from a position.
 */
const askedBecause = (id: TrakId, before: readonly Event[]): string => {
  const trak = replayHistory(id, before)
  const why = trak.reconsult?.why
  if (why === undefined) {
    if (trak.plan === undefined) return "initial"
    // Nothing asked, and the plan has reached a compose the composer wrote for
    // itself — the one route to this turn that is on the plan rather than beside it.
    const here = trak.plan.steps[firstUnrun(trak)]
    return here !== undefined && isCompose(here)
      ? "planned — the composer stops here"
      : "chat at the plan gate"
  }
  return whyLine(why)
}

/**
 * One reason as one line. Recursive, because a person's replan that raced what the
 * step sent back carries the displaced ask inside it — and this lab is the surface
 * that exercises that path, so it is the one that must show the fold.
 */
const whyLine = (why: ReconsultWhy): string =>
  Match.value(why).pipe(
    Match.tag(
      "Raised",
      (w) =>
        `raised @ ${w.step} — ${[...w.requirements, ...w.corrections.map((c) => `${c.at}: ${c.text}`)].join(" · ")}`,
    ),
    Match.tag(
      "Replanned",
      (w) =>
        `replan @ ${w.step} — ${w.reason}${w.displaced === undefined ? "" : ` (over: ${whyLine(w.displaced)})`}`,
    ),
    Match.tag("Reentered", (w) => `reentered — ${w.what}`),
    Match.tag("Refused", (w) => `refused @ ${w.step} — ${w.reason}`),
    Match.tag(
      "Conflicted",
      (w) => `conflicted → ${w.into ?? "a detached HEAD"} — ${w.paths.join(" · ")}`,
    ),
    Match.exhaustive,
  )

const composerTurns = (id: TrakId, log: readonly Event[]): Effect.Effect<void> =>
  Effect.gen(function* () {
    let version = 0
    for (const [i, event] of log.entries()) {
      if (event._tag !== "ComposerReturned") continue
      version += 1
      const why = askedBecause(id, log.slice(0, i))
      const out = event.output
      // Agent names, not artifact keys. A revision is the *remainder*, numbered
      // from zero in its own answer and spliced somewhere else entirely — a key
      // here would name a position this plan never had. The plan above is where
      // positions are read.
      const steps =
        out.type === "proposal" ? out.steps.map((s) => stepName(s)).join(" → ") : out.type
      yield* Console.log(`│ ${version}. ${why}`)
      yield* Console.log(`│    ${steps}`)
    }
  })

/**
 * One transcript entry as the lab's single column of it. Exhaustive, so a new entry
 * kind is a compile error here rather than a row that silently says nothing.
 */
const entryText = (entry: TranscriptEntry): string => {
  switch (entry._tag) {
    case "Tool":
      return `${entry.kind} ${entry.detail ?? entry.name}`
    case "Session":
      return entry.id
    case "Spawned":
      return `pid ${entry.pid}`
    case "Reask":
      return `re-asked: ${entry.reason}`
    case "Subagent":
      return `→ ${entry.description ?? entry.agentType ?? "subagent"}`
    case "SubagentResult":
      return `← ${entry.outcome ?? (entry.ok ? "subagent returned" : "subagent failed")}`
    case "Background":
      return `outstanding: ${entry.tasks.length === 0 ? "none" : entry.tasks.map((t) => t.id).join(", ")}`
    case "BackgroundStarted":
      return `backgrounded ${entry.description ?? entry.taskId}`
    case "ApiRetry": {
      const because = entry.status === undefined ? "" : ` · ${entry.status}`
      return `retrying${because} · attempt ${entry.attempt} of ${entry.of}`
    }
    case "Said":
      return `heard: ${entry.text}`
    case "View":
      return `view ${entry.server}/${entry.tool}`
    case "Check":
      return `check ${entry.name}${entry.outcome === undefined ? "" : ` · ${entry.outcome}`}`
    case "Hook":
      return `hook ${entry.event} · ${entry.status}`
    case "Denied":
      return `denied ${entry.tool}${entry.reason === undefined ? "" : ` · ${entry.reason}`}`
    case "Text":
    case "Note":
      return entry.text
  }
}

const report = Effect.fn("report")(function* (id: TrakId, trak: Trak) {
  const store = yield* Store
  const log = yield* store.events(id)
  const transcript = yield* store.transcript(id)

  yield* Console.log(`│`)
  yield* Console.log(`│ ── the plan it ended with ──────────────────────`)
  yield* Console.log(block(planLines(trak)))
  yield* Console.log(`│ ── what the composer was asked, and handed back ─`)
  yield* composerTurns(id, log)
  yield* Console.log(`│ ── the transcript ─────────────────────────────`)
  for (const entry of transcript) {
    const at = entry.position ?? "-"
    yield* Console.log(`│ ${String(at).padEnd(9)} ${entry._tag.padEnd(8)} ${entryText(entry)}`)
  }
  yield* Console.log(`│`)
  yield* Console.log(`│ state: ${trak.state._tag}`)
  yield* Console.log(`│ log (${log.length}): ${log.map((e) => e._tag).join(" · ")}`)
  // The worktree is still standing: nothing here closes a trak, and a lab run is
  // exactly the kind you want to walk back through before it goes.
  yield* Console.log(`│ kept: pnpm ork record ${id}  ·  pnpm ork resume ${id}`)
  yield* Console.log(`│ done with it: pnpm ork wipe ${id}`)
})

// ============================================================================
// The run
// ============================================================================

const program = Effect.gen(function* () {
  const lib = yield* Lib
  const id = TrakId.make(randomUUID())
  yield* Console.log(`\n╭─ compose lab ${id}`)
  yield* Console.log(`│ composer: ${lib.models.composer} — the only turn that spends anything`)
  yield* Console.log(`│ agents: ${[...lib.agents.keys()].join(", ")}`)
  yield* Console.log(`│ trak: ${description}`)

  const started = yield* advance(id, Events.trakCreated(description))
  yield* report(id, yield* drive(id, started))
  yield* Console.log("╰──────────────────────────────────────────────────\n")
})

/**
 * Announces every transition, and hands the router the state it needs.
 *
 * One layer for both because they are one fact: what the engine is about to do.
 * Anything printed here survives a run that is killed, which an end-of-run report
 * does not.
 */
const LabObserver = Layer.sync(Observer, () => ({
  transition: (trak, decision) =>
    Effect.gen(function* () {
      watching = trak
      yield* Console.log(`│   advance → ${decision.padEnd(8)} ${trak.state._tag}`)
    }),
  agentEvent: (event) =>
    event._tag === "ToolUse" ? Console.log(`│     ↳ ${eventLine(event)}`) : Effect.void,
}))

// Both named because the mint takes both: naming a trak asks what the store
// already holds and whether git holds the branch. One reference each, so the mint
// reads the same directory and the same repository the run does.
const LabStore = FileStoreLayer(process.cwd())
const LabGit = GitCliLayer(process.cwd()).pipe(Layer.provide(NodeProcessLayer))
// Real for the composer's sake: its turn is the one real spawn here.
const LabEnvironment = ShellEnvironmentLayer().pipe(
  Layer.provide(Layer.merge(NodeProcessLayer, LabLibrary)),
)
// Read-only here: the one question the runtime asks it is what a pull request merged
// as, at an archive. Its one write, `merge`, is the forge sweep's, which `serve.ts` alone
// runs.
const LabForge = GhForgeLayer(process.cwd()).pipe(Layer.provide(NodeProcessLayer))

await Effect.runPromise(
  program.pipe(
    // A backstop for a composer turn that hangs, not a spend guard: everything
    // else in here is waiting on a person, and a person is allowed to be slow.
    Effect.timeout(Duration.hours(1)),
    Effect.provide(
      Layer.mergeAll(
        BuiltinPromptsLayer(TEMPLATES),
        Layer.succeed(EngineVersion, engineVersion()),
        MermaidDiagramsLayer,
        LabStore,
        MemoryRunsLayer,
        MemoryGoalStoreLayer,
        MemoryPassesLayer,
        MemoryTurnToolsLayer(undefined),
        MemorySetupsLayer,
        MemoryLocksLayer,
        PhraseIdsLayer.pipe(Layer.provide(Layer.merge(LabStore, LabGit))),
        LabObserver,
        LabLibrary,
        LabGit,
        LabForge,
        NodeWorkspaceLayer(process.cwd()),
        LabProviderLayer.pipe(Layer.provide(LabLibrary)),
        // Reachable with nothing to run: `noChecks` emptied the registry, so
        // every step's list is empty and `RunChecks` reports that none failed.
        // The feed under it would carry a run's output if there were one to carry.
        LabEnvironment,
        ShellChecksLayer().pipe(
          Layer.provide(Layer.mergeAll(NodeProcessLayer, PubSubFeedLayer, LabEnvironment)),
        ),
        // Real, so an agent listing a process gets it: no record, since nothing here
        // boots again to reap one, and no command, since no HTTP engine is listening.
        ShellHostedProcessesLayer({ record: undefined }).pipe(
          Layer.provide(
            Layer.mergeAll(NodeProcessLayer, PubSubFeedLayer, LabEnvironment, LabLibrary),
          ),
        ),
      ),
    ),
    Effect.scoped,
  ),
)

process.exit(0)
