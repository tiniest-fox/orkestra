// The simplest possible path through Orkestra, in two halves.
//
//   Part A — the pure domain, called by hand. No Effect, no layers, no I/O.
//   Part B — the same thing wired to an agent, via advance().
//
// Run with: pnpm walkthrough

import { BuiltinPromptsLayer } from "./prompts/adapters/builtin.js"
import { TEMPLATES, version } from "./app/packaged.js"
import { Console, Effect, Either, Layer } from "effect"
import { ScriptedProviderLayer } from "./agent/adapters/scripted.js"
import { SessionId } from "./agent/types/session.js"
import { MermaidDiagramsLayer } from "./agent/adapters/diagrams-mermaid.js"
import { Lib } from "./library/ports/library.js"
import type { Library } from "./library/types/library.js"
import { NoForgeLayer, NoVcsLayer } from "./vcs/adapters/none.js"
import { PhraseIdsLayer } from "./workflow/adapters/ids-phrase.js"
import { MemoryLocksLayer } from "./workflow/adapters/locks-memory.js"
import { MemoryRunsLayer } from "./workflow/adapters/runs-memory.js"
import { MemoryGoalStoreLayer } from "./workflow/adapters/goal-store-memory.js"
import { MemoryPassesLayer } from "./workflow/adapters/passes-memory.js"
import { MemoryTurnToolsLayer } from "./workflow/adapters/turn-tools-memory.js"
import { MemorySetupsLayer } from "./workflow/adapters/setups-memory.js"
import { MemoryStoreLayer } from "./workflow/adapters/store-memory.js"
import { NoWorkspaceLayer } from "./workflow/adapters/workspace-none.js"
import { NoHostedProcessesLayer } from "./workflow/adapters/processes-none.js"
import { artifact } from "./workflow/domain/outputs/artifact.js"
import { Events } from "./workflow/domain/event.js"
import { Actions } from "./workflow/domain/human-action.js"
import { decide, party } from "./workflow/domain/decide.js"
import type { History } from "./workflow/domain/replay.js"
import { applyEvent, replayHistory } from "./workflow/domain/replay.js"
import { proposal } from "./workflow/domain/outputs/proposal.js"
import { emptyTrak, type Trak, TrakId } from "./workflow/domain/trak.js"
import { Checks } from "./workflow/ports/checks.js"
import { EngineVersion } from "./workflow/ports/engine-version.js"
import { NO_CONNECTIONS } from "./workflow/adapters/environment-shell.js"
import { Environment } from "./workflow/ports/environment.js"
import { Observer } from "./workflow/ports/observer.js"
import { Store } from "./workflow/ports/store.js"
import { advance } from "./workflow/runtime.js"

const id = TrakId.make("witty-jade-otter")
const sid = SessionId.make("00000000-0000-4000-8000-000000000000")

// One step. Every artifact then waits for a human: this trak is `manual`, which is
// what a trak created with nothing said about it runs as.
const onePlan = proposal("Add a --json flag to ork list", [
  { agent: "build", instruction: "Describe what the change involves." },
])

// ============================================================================
// Part A — the pure domain
// ============================================================================

/** Position -> attempts, the one thing this narration wants out of the slots. */
const iterationsOf = (trak: Trak): readonly (readonly [number, number])[] =>
  [...trak.slots].map(([position, slot]) => [position, slot.iterations] as const)

const line = (s: string): void => {
  console.log(s)
}

const partA = (): void => {
  line("\n╭─ PART A ── the pure domain, no Effect anywhere ──────────────────")

  // A trak starts with nothing.
  let trak = emptyTrak(id)
  line(`│ emptyTrak()                       state = ${trak.state._tag}`)

  const history: History = [
    Events.trakCreated("Add a --json flag to ork list"),
    Events.composerReturned(sid, onePlan),
    Events.agentReturned(0, sid, artifact({ Summary: "Added --json; 3 tests." })),
    // The artifact parked the trak. Nothing polls; this event is the only way on.
    Events.humanActed(0, Actions.approve()),
  ]

  // Feed one event at a time. `decide` says what it means; `applyEvent` does it.
  for (const event of history) {
    const decision = decide(trak, event)
    const commands =
      decision._tag === "Advance" ? decision.commands.map((c) => c._tag).join(", ") : "—"
    const parked = decision._tag === "Await" ? party(decision.awaiting).join("/") : "—"

    line(`│`)
    line(`│ event      ${event._tag}`)
    line(`│   decide → ${decision._tag.padEnd(8)} next = ${decision.next._tag}`)
    line(`│            commands = [${commands}]   owed-by = ${parked}`)

    trak = applyEvent(trak, event).trak
  }

  line(`│`)
  line(`│ final      state = ${trak.state._tag}`)
  line(`│            artifacts = ${JSON.stringify([...trak.artifacts])}`)
  line(`│            iterations = ${JSON.stringify(iterationsOf(trak))}`)
  line(`│`)
  line(`│ replayHistory() rebuilds the same trak from the log alone:`)
  line(`│   equal = ${JSON.stringify(replayHistory(id, history)) === JSON.stringify(trak)}`)
  line("╰──────────────────────────────────────────────────────────────────")
}

// ============================================================================
// Part B — the same thing, wired to an agent
// ============================================================================

const library: Library = {
  models: { allowed: ["opus", "sonnet"], efforts: new Map(), composer: "sonnet", windows: {} },
  composition: "Keep trivial changes lean.",
  goals: "",
  guidance: "",
  checks: new Map(),
  processes: new Map(),
  tools: new Map(),
  setup: undefined,
  teardown: undefined,
  env: undefined,
  deploy: undefined,
  mcp: { servers: [], problems: [] },
  root: ".",
  agents: new Map([
    [
      "build",
      {
        name: "build",
        description: "Implements a specified change and reports what it did.",
        brief: "Match the surrounding code.",
        model: "sonnet",
        permission: "write",
        sections: [
          {
            title: "Summary",
            description: "What now works that did not before.",
            when: undefined,
            figure: undefined,
          },
        ],
        checks: [],
        effects: [],
        conditions: [],
        processes: [],
        skills: [],
        start: true,
        place: "sandbox" as const,
        icon: undefined,
        effort: undefined,
      },
    ],
  ]),
  // The engine's own agent, which a real library parses out of the package. Written
  // out here because a `Library` is not a library without one — nothing in this
  // walkthrough runs it, and nothing here can be re-entered to reach it.
  generic: {
    name: "generic",
    description: "No role of its own: does the one thing it was asked.",
    brief: "Do what the sentence asks and stop.",
    model: "sonnet",
    permission: "write",
    sections: [
      {
        title: "What happened",
        description: "The answer, or what changed.",
        when: undefined,
        figure: undefined,
      },
    ],
    checks: [],
    effects: [],
    conditions: [],
    processes: [],
    skills: [],
    start: false,
    place: "sandbox" as const,
    icon: "bot",
    effort: undefined,
  },
}

const turns = [
  // the composer's reply
  {
    text: `\`\`\`ork
{ "type": "proposal", "ambiguity": "none", "title": "Add a --json flag to ork list", "steps": [{ "agent": "build", "instruction": "Describe what the change involves." }] }
\`\`\``,
  },
  // step 0's reply
  {
    text: `\`\`\`ork
{ "type": "artifact", "ambiguity": "none", "sections": { "Summary": "Added --json; 3 tests." } }
\`\`\``,
  },
]

const partB = Effect.gen(function* () {
  yield* Console.log("\n╭─ PART B ── the same flow, driven by advance() ───────────────────")

  const parked = yield* advance(id, Events.trakCreated("Add a --json flag to ork list"))
  yield* Console.log(`│            parked at ${parked.state._tag}, owed an approval`)

  const final = yield* advance(id, Events.humanActed(0, Actions.approve()))

  yield* Console.log(`│`)
  yield* Console.log(`│ final      state = ${final.state._tag}`)
  yield* Console.log(`│            artifacts = ${JSON.stringify([...final.artifacts])}`)

  const store = yield* Store
  const log = yield* store.events(id)
  yield* Console.log(`│`)
  yield* Console.log(`│ the log it wrote (${log.length} events):`)
  for (const e of log) yield* Console.log(`│   ${e._tag}`)
  yield* Console.log("╰──────────────────────────────────────────────────────────────────\n")
})

const TracingObserver = Layer.succeed(Observer, {
  transition: (trak, decision) =>
    Console.log(`│   advance → ${decision.padEnd(8)} state = ${trak.state._tag}`),
  agentEvent: () => Effect.void,
})

partA()
await Effect.runPromise(
  partB.pipe(
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
        // Naming a trak asks what the store already holds and what git does;
        // offline, `NoVcsLayer` answers no to the second.
        PhraseIdsLayer.pipe(Layer.provide(Layer.merge(MemoryStoreLayer, NoVcsLayer))),
        TracingObserver,
        Layer.succeed(Lib, library),
        // Commanded but never called: `RunChecks` runs for every artifact now,
        // and the one agent above declares no checks, so the loop it runs is
        // empty. A walkthrough that started spawning shell scripts would no
        // longer be offline, and this is what says so out loud.
        Layer.succeed(Checks, {
          run: () => Effect.die("the walkthrough declares no checks"),
          live: () => Effect.succeed(undefined),
        }),
        // Inherited, as a project with no env script gets: nothing here spawns.
        Layer.succeed(Environment, {
          capture: () => Effect.succeed({}),
          engine: Effect.succeed({}),
          secretNames: Effect.succeed([]),
          connection: NO_CONNECTIONS,
          credential: () => Effect.succeed(Either.right({})),
          credentialRefused: () => Effect.void,
        }),
        // Offline, like the scripted provider beside it: a demo must not create a
        // branch in the checkout someone ran it from.
        NoVcsLayer,
        NoForgeLayer,
        NoWorkspaceLayer,
        NoHostedProcessesLayer,
        ScriptedProviderLayer(turns),
      ),
    ),
  ),
)
