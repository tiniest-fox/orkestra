// adapter: the registry the engine holds — every adapter it can spawn, chosen per
// turn by the model name's qualifier.
//
// One Layer, built over adapters rather than specs, so a fake stands in exactly as
// a CLI does: `ScriptedProviderLayer` and the flow tests' scripted agent register
// themselves here, and `cliProviderLayer` registers one adapter per spec.

import { Effect, Layer, Stream } from "effect"
import { splitModel } from "../logic/qualified-model.js"
import { Provider, type ProviderAdapter, type ProviderRegistry } from "../ports/provider.js"
import { ProviderFailed } from "../types/errors.js"
import type { SessionRequest } from "../types/session.js"

/**
 * The first adapter is what a bare model name selects — the one every name meant
 * before names could be qualified, which is why the order is not a set.
 *
 * A qualifier nothing answers to fails the turn as `ProviderFailed`, naming the
 * qualifier as the provider: `models.yaml` lists names and the library checks an
 * agent against that list, so the one way here is an entry naming a CLI this build
 * does not carry — a `provider` failure, retryable once it does.
 */
export const registryOf = (
  first: ProviderAdapter,
  ...rest: readonly ProviderAdapter[]
): ProviderRegistry => {
  const adapters = [first, ...rest]
  const select = (
    model: string,
  ): { readonly adapter: ProviderAdapter; readonly model: string } | undefined => {
    const named = splitModel(model)
    const adapter =
      named.provider === undefined ? first : adapters.find((a) => a.name === named.provider)
    return adapter === undefined ? undefined : { adapter, model: named.model }
  }
  return {
    run: (req: SessionRequest) => {
      const selected = select(req.model)
      return selected === undefined
        ? Stream.fail(
            new ProviderFailed({
              provider: splitModel(req.model).provider ?? req.model,
              reason: `no provider named by model ${req.model}; this build carries ${adapters.map((a) => a.name).join(", ")}`,
            }),
          )
        : selected.adapter.run({ ...req, model: selected.model })
    },
    // In registration order, stopping at the first that held the pipe. Every other
    // adapter answers `false` for a session it never spawned, so the fan-out changes
    // nothing for a registry of one.
    stopBackgroundTask: (sessionId, taskId) =>
      Effect.reduce(adapters, false, (wrote, adapter) =>
        wrote ? Effect.succeed(true) : adapter.stopBackgroundTask(sessionId, taskId),
      ),
    steer: (sessionId, message) =>
      Effect.reduce(adapters, false, (wrote, adapter) =>
        wrote ? Effect.succeed(true) : adapter.steer(sessionId, message),
      ),
    // The first adapter with the pipe answers, or fails; one without it says `undefined`.
    mcp: (sessionId, request) =>
      Effect.gen(function* () {
        for (const adapter of adapters) {
          const answer = yield* adapter.mcp(sessionId, request)
          if (answer !== undefined) return answer
        }
        return undefined
      }),
    attend: (req) => {
      const selected = select(req.model)
      return selected === undefined
        ? Effect.fail(
            new ProviderFailed({
              provider: splitModel(req.model).provider ?? req.model,
              reason: `no provider named by model ${req.model}`,
            }),
          )
        : selected.adapter.attend({ ...req, model: selected.model })
    },
    cliFor: (model) => select(model)?.adapter.name,
    resumeFor: (model) => select(model)?.adapter.resume,
    sessionFileFor: (model, cwd, sessionId) => select(model)?.adapter.sessionFile?.(cwd, sessionId),
    signInFileFor: (model) => select(model)?.adapter.signInFile,
    resumeLineFor: (model, sessionId) => select(model)?.adapter.resumeLine?.(sessionId),
    credentials: [...new Set(adapters.flatMap((a) => a.credentials ?? []))],
    gatesCommandsFor: (model) => select(model)?.adapter.gatesCommands === true,
  }
}

/** One registry over the adapters given, in the order given. */
export const providersLayer = <R>(
  first: Effect.Effect<ProviderAdapter, never, R>,
  ...rest: readonly Effect.Effect<ProviderAdapter, never, R>[]
): Layer.Layer<Provider, never, R> =>
  Layer.effect(
    Provider,
    Effect.map(Effect.all([first, ...rest]), ([head, ...tail]) => registryOf(head, ...tail)),
  )
