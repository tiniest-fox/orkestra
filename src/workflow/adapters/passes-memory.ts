// In-memory Passes, for flow tests and the offline demos.
//
// The key reads the script off disk as the file adapter's does, so a flow can show an
// edit to a script running its check again; it is the parts joined rather than hashed,
// because nothing here is kept long enough for its size to matter.
//
// It keeps no prints: a print is made from the recording a real test runner writes, which
// no flow here runs, so a check with `fingerprint:` keeps its units by tree alone.

import { readFileSync } from "node:fs"
import { Effect, Layer, Ref } from "effect"
import { platformPart } from "../../library/logic/platform-part.js"
import { Passes, type PassesShape } from "../ports/passes.js"

export const MemoryPassesLayer: Layer.Layer<Passes> = Layer.effect(
  Passes,
  Effect.gen(function* () {
    const ref = yield* Ref.make<ReadonlySet<string>>(new Set())
    const units = yield* Ref.make<ReadonlyMap<string, readonly string[]>>(new Map())
    const trees = yield* Ref.make<ReadonlyMap<string, string>>(new Map())
    const shape: PassesShape = {
      keyOf: (check, tree) =>
        Effect.try(() => readFileSync(check.path, "utf8")).pipe(
          Effect.map((script) => `${tree}\0${check.name}\0${script}`),
          // The file adapter's reason: a script nobody can read has no text to key on.
          Effect.orElseSucceed(() => undefined),
        ),
      has: (key) => Effect.map(Ref.get(ref), (keys) => keys.has(key)),
      record: (key) => Ref.update(ref, (keys) => new Set(keys).add(key)),
      lastPassed: (check, cwd) =>
        Effect.map(Ref.get(trees), (held) => held.get(`${check.name}\0${cwd}`)),
      passedOn: (check, cwd, tree) =>
        Ref.update(trees, (held) => new Map(held).set(`${check.name}\0${cwd}`, tree)),
      unitKeyOf: (check, tree) =>
        Effect.succeed(
          check.units === undefined || !check.cache
            ? undefined
            : `units\0${tree}\0${check.units}\0${platformPart(check, process.platform, process.arch)}`,
        ),
      proven: (key) => Effect.map(Ref.get(units), (held) => held.get(key) ?? []),
      prove: (key, proved) =>
        Ref.update(units, (held) =>
          new Map(held).set(key, [...new Set([...(held.get(key) ?? []), ...proved])]),
        ),
      printKeyOf: () => Effect.succeed(undefined),
      printed: () => Effect.succeed([]),
      print: () => Effect.void,
      packed: () => Effect.succeed([]),
      adopt: () => Effect.succeed([]),
    }
    return shape
  }),
)
