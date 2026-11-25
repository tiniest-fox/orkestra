// The e2e slice: compose a pipeline, approve the plan, run two steps against a
// scripted agent, and park at each artifact — including the reviewer's, which is
// an artifact like any other. No subprocess, no network, no clock.

import { BuiltinPromptsLayer } from "./prompts/adapters/builtin.js"
import { TEMPLATES, version } from "./app/packaged.js"
import { Console, Effect, Either, Layer } from "effect"
import { ScriptedProviderLayer } from "./agent/adapters/scripted.js"
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
import { Events } from "./workflow/domain/event.js"
import { artifactText } from "./workflow/domain/outputs/artifact.js"
import { Actions } from "./workflow/domain/human-action.js"
import { TrakId, type Trak } from "./workflow/domain/trak.js"
import { Checks } from "./workflow/ports/checks.js"
import { EngineVersion } from "./workflow/ports/engine-version.js"
import { NO_CONNECTIONS } from "./workflow/adapters/environment-shell.js"
import { Environment } from "./workflow/ports/environment.js"
import { Observer } from "./workflow/ports/observer.js"
import { Store } from "./workflow/ports/store.js"
import { advance, resume } from "./workflow/runtime.js"

// ============================================================================
// A tiny .orkestra library, as it would be loaded from disk
// ============================================================================

const library: Library = {
  models: {
    allowed: ["opus", "sonnet", "haiku"],
    efforts: new Map(),
    composer: "sonnet",
    windows: {},
  },
  composition: "Unless changes are exceedingly trivial, include some review.",
  goals: "",
  guidance: "",
  checks: new Map(),
  processes: new Map(),
  tools: new Map(),
  setup: undefined,
  teardown: undefined,
  env: undefined,
  deploy: undefined,
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
    [
      "review",
      {
        name: "review",
        description: "Judges work already done and says whether it ships.",
        brief: "Review the diff and say whether you would ship it.",
        model: "opus",
        // The one agent here that cannot write, which is what makes the two
        // requests visibly different in the transcript.
        permission: "read-only",
        sections: [
          {
            title: "Assessment",
            description: "Would you ship it.",
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
  // out here because a `Library` is not a library without one — nothing in this spike
  // runs it, and nothing here can be re-entered to reach it.
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

// ============================================================================
// The scripted agent's turns, in order
// ============================================================================

const turns = [
  // 1. Composer proposes two steps. Every artifact gates, so step 0 parks.
  {
    text: `I'll keep this contained.

\`\`\`ork
{
  "type": "proposal",
  "title": "Add a --json flag to ork list",
  "ambiguity": "none",
  "steps": [
    { "agent": "build", "instruction": "Add the flag." },
    { "agent": "review", "instruction": "Review it." }
  ]
}
\`\`\``,
  },
  // 2. Step 0 replies with prose only -> extraction fails -> elicit resumes.
  { text: "Sure, I've added the flag and updated the tests." },
  // 3. The retry produces a valid Artifact.
  {
    text: `Done.

\`\`\`ork
{ "type": "artifact", "ambiguity": "none", "sections": { "Summary": "Added --json to ork list; 3 tests added." } }
\`\`\``,
  },
  // 4. Step 1 reviews and finds nothing blocking — which is an artifact like any
  //    other. There is no approve envelope; the other one sends work back.
  {
    text: `\`\`\`ork
{ "type": "artifact", "ambiguity": "none", "sections": { "Assessment": "Read the diff and the tests. Clean." } }
\`\`\``,
  },
]

// ============================================================================
// Run
// ============================================================================

const show = (label: string, trak: Trak) =>
  Console.log(
    `  ${label.padEnd(22)} state=${trak.state._tag}${"step" in trak.state ? `(${trak.state.step})` : ""}`,
  )

const program = Effect.gen(function* () {
  const id = TrakId.make("tunefully-cogent-bird")
  const store = yield* Store

  yield* Console.log("\n=== 1. create -> compose -> run step 0 ===")
  const parked = yield* advance(id, Events.trakCreated("Add a --json flag to `ork list`"))
  yield* show("parked at", parked)

  yield* Console.log("\n=== 2. human approves the plan, which runs step 0 ===")
  const reviewed = yield* advance(id, Events.humanActed(0, Actions.approve()))
  yield* show("parked at", reviewed)

  // The reviewer's own artifact parks too. A demo that stops at the review looks
  // like a hang, which is the pressure that argues for letting a reviewer's
  // approve advance on its own. The answer is the gate below, not skipping it.
  yield* Console.log("\n=== 3. human approves the work, which runs the reviewer ===")
  const done = yield* advance(id, Events.humanActed(1, Actions.approve()))
  yield* show("final", done)

  // Nothing is held in memory: rebuild the trak purely from its event log,
  // exactly as startup recovery does after a crash.
  yield* Console.log("\n=== 4. simulate a restart: resume from the log alone ===")
  const resumed = yield* resume(id)
  yield* show("resumed", resumed)
  yield* Console.log(
    `  identical to in-memory trak: ${JSON.stringify(resumed) === JSON.stringify(done)}`,
  )

  yield* Console.log("\n=== artifacts ===")
  for (const [name, a] of done.artifacts) yield* Console.log(`  ${name}: ${artifactText(a)}`)

  yield* Console.log("\n=== event log (tier 1) ===")
  for (const e of yield* store.events(id)) yield* Console.log(`  ${e._tag}`)

  yield* Console.log("\n=== transcript (tier 2, normalized) ===")
  const t = yield* store.transcript(id)
  const kinds = t.map((e) => (e._tag === "Tool" ? e.name : e._tag))
  yield* Console.log(`  ${t.length} events: ${[...new Set(kinds)].join(", ")}`)
  return done
})

const PrintingObserver = Layer.succeed(Observer, {
  transition: (trak, reduction) =>
    Console.log(
      `  → ${reduction.padEnd(8)} ${trak.state._tag}${"step" in trak.state ? `(step ${trak.state.step})` : ""}`,
    ),
  agentEvent: () => Effect.void,
})

const layers = Layer.mergeAll(
  BuiltinPromptsLayer(TEMPLATES),
  Layer.succeed(EngineVersion, version()),
  MermaidDiagramsLayer,
  PrintingObserver,
  MemoryStoreLayer,
  MemoryRunsLayer,
  MemoryGoalStoreLayer,
  MemoryPassesLayer,
  MemoryTurnToolsLayer(undefined),
  MemorySetupsLayer,
  MemoryLocksLayer,
  // Naming a trak asks what the store already holds and what git does; offline,
  // `NoVcsLayer` answers no to the second, so the store is the whole check.
  PhraseIdsLayer.pipe(Layer.provide(Layer.merge(MemoryStoreLayer, NoVcsLayer))),
  Layer.succeed(Lib, library),
  // Commanded but never called: `RunChecks` runs for every artifact now, and
  // neither agent above declares a check, so the loop it runs is empty. The
  // spike stays offline, and this is what says so out loud.
  Layer.succeed(Checks, {
    run: () => Effect.die("the spike declares no checks"),
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
  // Offline, like the scripted provider beside it: the walkthrough must not
  // create a branch in the checkout someone ran it from.
  NoVcsLayer,
  NoForgeLayer,
  NoWorkspaceLayer,
  NoHostedProcessesLayer,
  ScriptedProviderLayer(turns, (line) => Console.log(line)),
)

const final = await Effect.runPromise(program.pipe(Effect.provide(layers)))

// The spike's one claim is that the script above reaches the reviewer's gate — step 2,
// parked for approval. Anything else, a malformed proposal failing the trak included,
// still prints a tidy log, so the exit code is what says it went wrong.
const atReviewerGate =
  final.state._tag === "AwaitingHuman" && final.state.step === 2 && final.state.kind === "approval"
if (!atReviewerGate) {
  console.error(`\nspike: expected the reviewer's gate, ended at ${final.state._tag}`)
  process.exitCode = 1
}
