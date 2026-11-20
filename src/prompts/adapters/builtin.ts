// The only Layer here: read the shipped templates off disk, at startup and again on a reload.

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { Prompts, TemplateMissing } from "../ports/prompts.js"
import { TEMPLATE_NAMES, type TemplateName, type Templates } from "../types/template.js"

const readTemplate = Effect.fn("readTemplate")(function* (dir: string, name: TemplateName) {
  const path = join(dir, `${name}.md`)
  const body = yield* Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => new TemplateMissing({ name, reason: `${path}: ${String(cause)}` }),
  })
  return [name, body] as const
})

/** Every template under `dir`, or the first one missing — what a boot reads, and a reload again. */
export const loadTemplates = (dir: string): Effect.Effect<Templates, TemplateMissing> =>
  Effect.map(
    Effect.forEach(TEMPLATE_NAMES, (n) => readTemplate(dir, n)),
    (entries) => new Map(entries),
  )

/**
 * A function of the directory holding the templates rather than a value, because
 * where they are is not this module's to know: it is `app/packaged.ts`'s, which is
 * where the checkout and the bundle are told apart.
 *
 * Fails loudly at startup if a template is missing, rather than at the moment a
 * trak needs it — a half-loaded prompt set would otherwise surface as an agent
 * behaving oddly three minutes into a run.
 */
export const BuiltinPromptsLayer = (dir: string): Layer.Layer<Prompts, TemplateMissing> =>
  Layer.effect(Prompts, loadTemplates(dir))
