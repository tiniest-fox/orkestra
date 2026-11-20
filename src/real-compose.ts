// The composer alone, against real Claude Code: one turn, no pipeline.
//
//   pnpm real:compose "<description>"
//
// `real:trak` answers "does the engine work"; this answers "does the composer
// sequence sensibly", which is a different question and a hundred times cheaper.
// Running the whole pipeline to see a proposal means paying for every step's real
// work — minutes of a step reading the repo — to read output that arrived in the
// first ten seconds.
//
// NOT safe by permission mode any more: the composer runs with `permission:
// "full"`, so a turn that decides to write can. It is a single planning turn and
// the template tells it to plan, which is the whole of the guarantee now.

import { randomUUID } from "node:crypto"
import { Console, Duration, Effect, Layer } from "effect"
import { NodeProcessLayer } from "./agent/adapters/process-node.js"
import { cliProviderLayer } from "./agent/adapters/cli-provider.js"
import { claudeSpec } from "./agent/providers/claude/index.js"
import { codexSpec } from "./agent/providers/codex/index.js"
import { FsLibraryLayer } from "./library/adapters/library-fs.js"
import { Lib } from "./library/ports/library.js"
import { BuiltinPromptsLayer } from "./prompts/adapters/builtin.js"
import { SHIPPED_AGENTS, TEMPLATES, version } from "./app/packaged.js"
import { NoVcsLayer } from "./vcs/adapters/none.js"
import { PhraseIdsLayer } from "./workflow/adapters/ids-phrase.js"
import { ShellEnvironmentLayer } from "./workflow/adapters/environment-shell.js"
import { MemoryLocksLayer } from "./workflow/adapters/locks-memory.js"
import { MemoryRunsLayer } from "./workflow/adapters/runs-memory.js"
import { MemoryStoreLayer } from "./workflow/adapters/store-memory.js"
import { MemoryTurnToolsLayer } from "./workflow/adapters/turn-tools-memory.js"
import { MemorySetupsLayer } from "./workflow/adapters/setups-memory.js"
import { NoWorkspaceLayer } from "./workflow/adapters/workspace-none.js"
import { Command } from "./workflow/domain/decide.js"
import {
  artifactKey,
  childKey,
  childSteps,
  isSpawn,
  waitUntilOf,
} from "./workflow/domain/outputs/proposal.js"
import { resolveWaitUntil, spellLocal } from "./workflow/domain/wait-until.js"
import { emptyTrak, TrakId } from "./workflow/domain/trak.js"
import { Triggers } from "./workflow/domain/trigger.js"
import { EngineVersion } from "./workflow/ports/engine-version.js"
import { Observer } from "./workflow/ports/observer.js"
import { Store } from "./workflow/ports/store.js"
import { Compose } from "./workflow/runtime.js"

const description =
  process.argv[2] ??
  "Add a --json flag to `ork list` so scripts can consume its output, and make sure it is verified and reviewed."

const program = Effect.gen(function* () {
  const lib = yield* Lib
  const id = TrakId.make(randomUUID())

  yield* Console.log(`\n╭─ compose only`)
  yield* Console.log(`│ agents: ${[...lib.agents.keys()].join(", ")}`)
  yield* Console.log(`│ model: ${lib.models.composer}`)
  yield* Console.log(`│ request: ${description}`)
  yield* Console.log(`│`)

  const started = Date.now()
  yield* Console.log(`│ now: ${spellLocal(started)}`)
  const event = yield* Compose(
    emptyTrak(id),
    Command.Compose({ description, trigger: Triggers.initial() }),
  )
  const took = `${((Date.now() - started) / 1000).toFixed(1)}s`

  // `Events.*` constructors widen to `Event` on purpose — a command runner returns
  // "an event". Compose is the only producer of this one, so anything else is a bug.
  if (event._tag !== "ComposerReturned") {
    return yield* Effect.die(`Compose returned ${event._tag}`)
  }
  const out = event.output
  switch (out.type) {
    case "proposal": {
      yield* Console.log(`│ ${out.title} — ${out.steps.length} step(s) in ${took}`)
      // Absent on most plans, and its presence is the interesting half: it means
      // the composer read something that changed the shape.
      if (out.rationale !== undefined) yield* Console.log(`│ ${out.rationale}`)
      // What the run said it ran into, verbatim — the one thing on this output a gate
      // turns on, and the half worth watching here: a plan gate goes past on `none`
      // and stops on either of the other two.
      yield* Console.log(`│ ambiguity: ${out.ambiguity ?? "(none written)"}`)
      for (const [i, s] of out.steps.entries()) {
        yield* Console.log(`│`)
        yield* Console.log(`│ ${artifactKey(s, i)}`)
        yield* Console.log(`│    ${s.instruction}`)
        // The one thing on an entry the composer is told the time for. Resolved
        // against this probe's own start, since nothing here stamps a log.
        const wait = waitUntilOf(s)
        if (wait !== undefined) {
          const until = resolveWaitUntil(wait, started)
          yield* Console.log(
            `│    waits until ${wait} — ${until === undefined ? "unresolvable" : spellLocal(until)}`,
          )
        }
        // A spawn's whole content is its children, and printing the entry alone
        // reported `0-spawn` and one sentence for a proposal of four pieces of
        // work — which is the one thing this command exists to show.
        if (!isSpawn(s)) continue
        for (const [c, child] of s.children.entries()) {
          yield* Console.log(`│      ${childKey(i, c, child)}`)
          // A piece is a plan, so its steps are what it is — one line, agent-prefixed,
          // because a piece of two named only by its last agent hides what it builds.
          const plan = childSteps(child).map((cs) => `${cs.agent}: ${cs.instruction}`)
          yield* Console.log(`│         ${plan.join(" → ")}`)
        }
      }
      break
    }
    case "questions": {
      yield* Console.log(`│ asked ${out.questions.length} question(s) in ${took}`)
      for (const q of out.questions) {
        yield* Console.log(`│ ${q.question}`)
        yield* Console.log(`│   ${q.options.map((o) => o.label).join(" | ")}`)
      }
      break
    }
    case "failed": {
      yield* Console.log(`│ gave up in ${took}: ${out.error}`)
      break
    }
    // Reachable here, unlike `message`: this probe composes from the request alone, and
    // a request already satisfied by the checkout is exactly what this answers.
    case "finished": {
      yield* Console.log(`│ nothing left to plan, in ${took}: ${out.reason}`)
      break
    }
    // Unreachable: a message is only produced on a chat turn, and this probe runs
    // one Initial compose. Handled because the switch is exhaustive, and printed
    // rather than ignored because the alternative is a silent blank run.
    case "message": {
      yield* Console.log(`│ replied instead of proposing, in ${took}: ${out.text}`)
      break
    }
  }

  // How much the composer did to decide. A selection turn should be small; a
  // number in the hundreds means it went exploring instead — and now that the
  // transcript keeps activities, *what* it reached for is right here.
  const transcript = yield* (yield* Store).transcript(id)
  yield* Console.log(`│`)
  yield* Console.log(`│ ${transcript.length} normalized events`)
  const tools = transcript.filter((entry) => entry._tag === "Tool")
  const named = tools.map((t) => (t.detail === undefined ? t.name : `${t.name}(${t.detail})`))
  if (tools.length > 0) yield* Console.log(`│ ${tools.length} tool calls: ${named.join(", ")}`)
  yield* Console.log("╰──────────────────────────────────────────────────\n")
})

const ProbeLibrary = FsLibraryLayer(process.cwd(), SHIPPED_AGENTS)

await Effect.runPromise(
  program.pipe(
    Effect.timeout(Duration.minutes(3)),
    Effect.provide(
      Layer.mergeAll(
        BuiltinPromptsLayer(TEMPLATES),
        MemoryStoreLayer,
        MemoryRunsLayer,
        // What a turn needs to record a steered message as heard. Nothing steers a
        // probe, and a turn is one shape whoever runs it.
        MemoryLocksLayer,
        Layer.succeed(EngineVersion, version()),
        // `NoVcsLayer` is here for the mint and for nothing else: naming a trak
        // asks git whether it already holds the branch, and this script isolates
        // nothing — so the honest answer is no, and the store is the whole check.
        PhraseIdsLayer.pipe(Layer.provide(Layer.merge(MemoryStoreLayer, NoVcsLayer))),
        // Silent: the composer's tool calls are summarized at the end, where the
        // count is the thing worth reading.
        Layer.succeed(Observer, { transition: () => Effect.void, agentEvent: () => Effect.void }),
        ProbeLibrary,
        NoWorkspaceLayer,
        // No engine listens for tool calls here, and the composer runs on this machine.
        MemoryTurnToolsLayer(undefined),
        MemorySetupsLayer,
        cliProviderLayer(claudeSpec, codexSpec).pipe(Layer.provide(NodeProcessLayer)),
        // Real, because the composer is a real spawn and should find what the
        // repository pins the way a trak's turn would.
        ShellEnvironmentLayer().pipe(Layer.provide(Layer.merge(NodeProcessLayer, ProbeLibrary))),
      ),
    ),
    Effect.scoped,
  ),
)
