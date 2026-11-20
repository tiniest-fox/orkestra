// The whole engine against real Claude Code, driven by this repo's own
// `.orkestra/` directory: advance -> compose -> run a step. Wall-clock capped,
// because a real provider that keeps missing the schema would otherwise spend
// three haiku sessions' worth of retries before giving up.
//
//   pnpm real:trak

import { BuiltinPromptsLayer } from "./prompts/adapters/builtin.js"
import { SHIPPED_AGENTS, TEMPLATES, version } from "./app/packaged.js"
import { randomUUID } from "node:crypto"
import { eventLine } from "./agent/logic/event-line.js"
import { NodeProcessLayer } from "./agent/adapters/process-node.js"
import { MermaidDiagramsLayer } from "./agent/adapters/diagrams-mermaid.js"
import { cliProviderLayer } from "./agent/adapters/cli-provider.js"
import { claudeSpec } from "./agent/providers/claude/index.js"
import { codexSpec } from "./agent/providers/codex/index.js"
import { Console, Duration, Effect, Layer } from "effect"
import { FsLibraryLayer } from "./library/adapters/library-fs.js"
import { Lib } from "./library/ports/library.js"
import type { Library } from "./library/types/library.js"
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
import { MemoryStoreLayer } from "./workflow/adapters/store-memory.js"
import { NodeWorkspaceLayer } from "./workflow/adapters/workspace-node.js"
import { Events } from "./workflow/domain/event.js"
import { Actions } from "./workflow/domain/human-action.js"
import { artifactText } from "./workflow/domain/outputs/artifact.js"
import { artifactKey, instructionOf } from "./workflow/domain/outputs/proposal.js"
import { type Trak, TrakId } from "./workflow/domain/trak.js"
import { EngineVersion } from "./workflow/ports/engine-version.js"
import { Observer } from "./workflow/ports/observer.js"
import { Store } from "./workflow/ports/store.js"
import { advance } from "./workflow/runtime.js"

/**
 * Every tool that can change the working tree.
 *
 * Wider than what `read-only` means to claude — which is the three edit tools —
 * because a demo needs a stronger guarantee than a role does. A step runs with
 * `permission: "full"` in its own worktree, and that isolates the files but not
 * the repository: `Bash` in a worktree can still reach this checkout's history.
 * A real read-only agent legitimately wants `Bash` to run `git diff` and the
 * tests, so widening the provider's own list would be wrong.
 */
// `Task` here is claude's own sub-agent tool, not a trak — the one place in this
// repo where the word still means what it means to the CLI.
const WRITE_TOOLS = ["Edit", "Write", "NotebookEdit", "Bash", "Task"]

/**
 * Two overrides, and it takes both — which is the honest consequence of the deny
 * list moving to the provider.
 *
 * `read-only` is now one bit an agent declares, so a demo cannot express "deny
 * more than that" through the library any more. It says the bit here, and says
 * what the bit *means* in the provider spec below. Same override the old version
 * did, one level along — and an improvement, since that one did nothing at all
 * for a step that named no techniques to restrict.
 */
const readOnly = (lib: Library): Library => ({
  ...lib,
  agents: new Map([...lib.agents].map(([name, a]) => [name, { ...a, permission: "read-only" }])),
  // And the checks go too, by the same argument one step further: a check is a
  // shell script this repo wrote, so clamping the agent's tools says nothing
  // about what one of them would do. An empty registry means no agent can name
  // one — the library would refuse to load if one did — so no script runs.
  checks: new Map(),
  processes: new Map(),
  // The setup script is a script by the same argument, and this one is not even
  // chosen — it runs on every trak. `pnpm real:trak` must not spend a minute
  // installing dependencies into a worktree it is about to read and discard.
  // The env script stays: it installs nothing, and a real turn should find what the
  // repository pins the way a trak's would.
  setup: undefined,
  teardown: undefined,
})

/** This repo's real `.orkestra/`, then clamped to read-only for the demo. */
const ReadOnlyLibrary = Layer.effect(Lib, Effect.map(Lib, readOnly)).pipe(
  Layer.provide(FsLibraryLayer(process.cwd(), SHIPPED_AGENTS)),
)

/**
 * Claude with a wider idea of what a read-only turn may not touch, and Codex as it
 * ships: its restriction is prompt-only and already names the shell, and the
 * library is clamped read-only above either way.
 */
const ClampedClaudeLayer = cliProviderLayer(
  { ...claudeSpec, readOnlyTools: WRITE_TOOLS },
  codexSpec,
)

/**
 * `pnpm real:trak "<description>"`. Taking it from argv is what makes composition
 * observable: the default is deliberately trivial, and one step is the right
 * answer to it — you cannot tell whether the composer can sequence until you
 * hand it something that needs sequencing.
 */
const description =
  process.argv[2] ??
  "Describe, in one short paragraph, how a trak's state is rebuilt after a process restart. Do not change any files."

/**
 * Stands in for the human, approving every gate.
 *
 * This trak is `manual` — every artifact waits — so a demo that only created it would
 * stop at the first one. Bounded, because each approval spends another session, and it
 * stops at a `questions` gate rather than inventing an answer, which is the one thing a
 * stand-in must not do.
 *
 * **Not the engine's `auto`, and it must not be read as one.** That mode is a person's
 * standing answer recorded on the trak, it takes the plan gate and an artifact's gate
 * and holds back at a failing check, and it has no ceiling on how far it runs. This is a
 * demo's stand-in with a spend cap, and the cap is why it is still here: `pnpm real:trak`
 * pays for every gate it takes.
 */
const approveEverything = Effect.fn("approveEverything")(function* (id: TrakId, from: Trak) {
  let trak = from
  for (let i = 0; i < 6; i += 1) {
    const state = trak.state
    // The plan gate comes first now, and carries no step index.
    if (state._tag === "AwaitingProposal") {
      yield* Console.log(`│ approving the proposal on your behalf`)
      trak = yield* advance(id, Events.humanActed(0, Actions.approve()))
      continue
    }
    if (state._tag !== "AwaitingHuman") return trak
    if (state.kind === "answers") {
      yield* Console.log(`│ waiting on answers — only a human can answer that`)
      return trak
    }
    yield* Console.log(`│ approving step ${state.step} (${state.kind}) on your behalf`)
    trak = yield* advance(id, Events.humanActed(state.step, Actions.approve()))
  }
  yield* Console.log(`│ stopping after 6 approvals — a demo does not run forever`)
  return trak
})

const program = Effect.gen(function* () {
  const lib = yield* Lib
  const id = TrakId.make(randomUUID())
  yield* Console.log(`\n╭─ real trak ${id}`)
  yield* Console.log(`│ library: ${lib.agents.size} agents (${[...lib.agents.keys()].join(", ")})`)
  yield* Console.log(`│ composer: ${lib.models.composer} of ${lib.models.allowed.join(", ")}`)
  yield* Console.log(`│ read-only: ${WRITE_TOOLS.join(", ")} denied to every step`)

  yield* Console.log(`│ trak: ${description}`)
  const final = yield* approveEverything(id, yield* advance(id, Events.trakCreated(description)))

  yield* Console.log(`│`)
  yield* Console.log(`│ final state: ${final.state._tag}`)
  const store = yield* Store
  const log = yield* store.events(id)

  // A parked trak owes its reason to the human. Real Claude reads
  // COMPOSITION.md and does sometimes ask instead of proposing, and a demo that
  // printed only "AwaitingHuman" would look like a hang.
  for (const event of log) {
    if (event._tag !== "ComposerReturned" || event.output.type !== "questions") continue
    for (const q of event.output.questions) {
      yield* Console.log(`│ composer asks: ${q.question}`)
      yield* Console.log(`│   options: ${q.options.map((o) => o.label).join(" | ")}`)
    }
  }

  if (final.plan !== undefined) {
    yield* Console.log(`│ title: ${final.plan.title}`)
    yield* Console.log(`│ steps: ${final.plan.steps.map(artifactKey).join(" → ")}`)
    for (const [i, s] of final.plan.steps.entries()) {
      yield* Console.log(`│   ${artifactKey(s, i)}: ${instructionOf(s) ?? ""}`)
    }
  }
  for (const [name, a] of final.artifacts) {
    yield* Console.log(`│ artifact ${name}: ${artifactText(a).slice(0, 160)}`)
  }
  yield* Console.log(`│ log (${log.length}): ${log.map((e) => e._tag).join(" · ")}`)
  const tr = yield* store.transcript(id)
  yield* Console.log(`│ transcript (${tr.length} normalized events)`)
  yield* Console.log("╰──────────────────────────────────────────────────\n")
})

/**
 * Reports each transition, and reports the proposal and each artifact the moment
 * they exist rather than at the end.
 *
 * That ordering is not cosmetic: a run that hits the wall-clock cap loses the
 * whole in-memory store, so an end-of-run summary is exactly the output you do
 * not get on the runs you most want to read. This observer is the only thing
 * that survives a timeout.
 */
const TracingObserver = Layer.sync(Observer, () => {
  let announced = false
  let artifacts = 0
  // Elapsed per transition, because "why is this slow" needs to be answerable
  // from the output. Composing should be seconds; a step reading the repo is
  // minutes, and the gap between those two is the thing worth watching.
  let last = Date.now()
  return {
    transition: (trak, decision) =>
      Effect.gen(function* () {
        const now = Date.now()
        const took = `${((now - last) / 1000).toFixed(1)}s`
        last = now
        yield* Console.log(
          `│   advance → ${decision.padEnd(8)} ${trak.state._tag.padEnd(14)} +${took}`,
        )

        const proposal = trak.plan
        if (proposal !== undefined && !announced) {
          announced = true
          yield* Console.log(`│ proposed ${proposal.steps.length} step(s): ${proposal.title}`)
          for (const [i, s] of proposal.steps.entries()) {
            yield* Console.log(`│   ${artifactKey(s, i)}`)
            yield* Console.log(`│     ${instructionOf(s) ?? ""}`)
          }
        }

        if (trak.artifacts.size > artifacts) {
          artifacts = trak.artifacts.size
          const [name, a] = [...trak.artifacts].at(-1) ?? ["", undefined]
          const size = a === undefined ? 0 : artifactText(a).length
          yield* Console.log(`│ artifact ${name} (${size} chars)`)
        }
      }),

    // Tool calls as they happen, so a long step is legible rather than silent.
    agentEvent: (event) =>
      event._tag === "ToolUse" ? Console.log(`│     ↳ ${eventLine(event)}`) : Effect.void,
  }
})

// Named because the mint takes it too: naming a trak asks git whether it already
// holds the branch, and one reference keeps that the same git this runs against.
const RealGit = GitCliLayer(process.cwd()).pipe(Layer.provide(NodeProcessLayer))
// The project's env script, real: a turn here spawns a real `claude`, and it should
// find what the repository pins the same way a trak's would.
const RealEnvironment = ShellEnvironmentLayer().pipe(
  Layer.provide(Layer.merge(NodeProcessLayer, ReadOnlyLibrary)),
)
// Read-only here: the one question the runtime asks it is what a pull request merged
// as, at an archive. Its one write, `merge`, is the forge sweep's, which `serve.ts` alone
// runs.
const RealForge = GhForgeLayer(process.cwd()).pipe(Layer.provide(NodeProcessLayer))

await Effect.runPromise(
  program.pipe(
    // A backstop, not the spend guard — `elicit` caps itself at 3 attempts. Ten
    // minutes is roughly two real read-only steps against this repo; four kills a
    // two-step flow mid-investigation.
    Effect.timeout(Duration.minutes(10)),
    Effect.provide(
      Layer.mergeAll(
        BuiltinPromptsLayer(TEMPLATES),
        Layer.succeed(EngineVersion, version()),
        MermaidDiagramsLayer,
        MemoryStoreLayer,
        MemoryRunsLayer,
        MemoryGoalStoreLayer,
        MemoryPassesLayer,
        MemoryTurnToolsLayer(undefined),
        MemorySetupsLayer,
        MemoryLocksLayer,
        PhraseIdsLayer.pipe(Layer.provide(Layer.merge(MemoryStoreLayer, RealGit))),
        TracingObserver,
        ReadOnlyLibrary,
        RealGit,
        RealForge,
        NodeWorkspaceLayer(process.cwd()),
        ClampedClaudeLayer.pipe(Layer.provide(NodeProcessLayer)),
        // Provided but reachable with nothing to run: `readOnly` emptied the
        // registry, so every step's check list is empty and `RunChecks` reports
        // that nothing failed. The feed under it is the same story — a run would
        // publish into a ring nothing here subscribes to.
        RealEnvironment,
        ShellChecksLayer().pipe(
          Layer.provide(Layer.mergeAll(NodeProcessLayer, PubSubFeedLayer, RealEnvironment)),
        ),
        // Real, so an agent listing a process gets it: no record, since nothing here
        // boots again to reap one, and no command, since no HTTP engine is listening.
        ShellHostedProcessesLayer({ record: undefined }).pipe(
          Layer.provide(
            Layer.mergeAll(NodeProcessLayer, PubSubFeedLayer, RealEnvironment, ReadOnlyLibrary),
          ),
        ),
      ),
    ),
    Effect.scoped,
  ),
)
