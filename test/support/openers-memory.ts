// The opener scan in memory, for every flow test that is not about openers: the routes
// need an `Openers` in scope, and this one answers as a machine with the two terminals
// and the one editor the sweep found — real bundle identifiers, so an assertion reads
// like the wire will. The openers theme provides its own shape over the top of a body to
// watch what was opened; nothing here scans, walks or spawns.

import { Effect, Layer, Ref } from "effect"
import {
  Openers,
  type ChooseOutcome,
  type OpenerKind,
  type OpenOutcome,
  type RunOutcome,
} from "../../src/app/openers.js"

const KNOWN = {
  terminal: [
    { id: "com.mitchellh.ghostty", name: "Ghostty", icon: "data:image/png;base64,Zmc=" },
    { id: "com.apple.Terminal", name: "Terminal", icon: undefined },
  ],
  editor: [{ id: "dev.zed.Zed", name: "Zed", icon: "data:image/png;base64,emQ=" }],
} satisfies Record<OpenerKind, unknown>

export const memoryOpeners: Effect.Effect<Layer.Layer<Openers>> = Effect.gen(function* () {
  const chosen = yield* Ref.make<Partial<Record<OpenerKind, string>>>({})
  return Layer.succeed(Openers, {
    list: Effect.map(Ref.get(chosen), (stored) => ({
      terminal: { apps: KNOWN.terminal, chosen: stored.terminal ?? "com.mitchellh.ghostty" },
      editor: { apps: KNOWN.editor, chosen: stored.editor ?? "dev.zed.Zed" },
    })),
    choose: (kind, id) =>
      KNOWN[kind].some((app) => app.id === id)
        ? Effect.as(
            Ref.update(chosen, (stored) => ({ ...stored, [kind]: id })),
            "stored" satisfies ChooseOutcome,
          )
        : Effect.succeed<ChooseOutcome>("unknown"),
    openAt: () => Effect.succeed<OpenOutcome>("opened"),
    runInTerminal: () => Effect.succeed<RunOutcome>("opened"),
  })
})
