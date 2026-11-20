// The contract, run against the fake. Fast, offline, part of `pnpm verify`.

import { Effect } from "effect"
import { ScriptedProviderLayer } from "../../src/agent/adapters/scripted.js"
import { providerContract } from "./provider.js"

providerContract({
  label: "scripted",
  layer: ScriptedProviderLayer(
    Array.from({ length: 20 }, () => ({
      text: '```json\n{ "type": "artifact", "sections": { "Summary": "ok" } }\n```',
    })),
    () => Effect.void,
  ),
  model: "haiku",
  artifactPrompt: "produce an artifact",
  // The fake replies; it does not think, and pretending otherwise would make the
  // capability describe the fake rather than the port.
  reportsThinking: false,
  timeoutMs: 1000,
})
