/**
 * Start, Restart and Stop on one trak's hosted processes, or with no trak on the project
 * checkout's — the side panel's presses and the git bar's.
 *
 * **They spend nothing and take no custody**: the route runs or kills a script in the
 * checkout, never a turn, so a drive under way does not refuse it — which is why
 * this hook takes no `running` at all, on `useSetMode`'s reason. The other two halves of
 * the acting-hook contract still hold: each press is disabled while its own request is in
 * flight, and the callback refuses while disabled.
 *
 * **Two mutations, not one.** A start answers only once it is decided, which can be the
 * declaration's whole `ready_seconds`; one shared mutation would grey Stop out for that
 * long, on exactly the process a person wants to stop. So starting (Start and Restart) is
 * one and stopping is the other, and neither waits on the other.
 *
 * What a press changed arrives as `Process` frames while it is in flight; the invalidation
 * on success is the backstop for a frame lost on the way.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ApiError } from "../api/http"
import { actOnProcess, type ProcessVerb } from "../api/trak"
import { queryKeys } from "../queryCache"
import { useScopedTo } from "./useScopedTo"

/** One press in flight: which process, and what was asked of it. */
export interface ProcessAsk {
  readonly name: string
  readonly verb: ProcessVerb
}

export interface ProcessPresses {
  /** Press `verb` on `name`. Silently does nothing while that kind of press is in flight. */
  readonly press: (name: string, verb: ProcessVerb) => void
  /** The start or restart in flight, or `undefined`. */
  readonly starting: ProcessAsk | undefined
  /** The process a stop is in flight for, or `undefined`. */
  readonly stopping: string | undefined
  /** Why the last press did not land, in a sentence. `undefined` when none has failed. */
  readonly said: string | undefined
}

/** Which list a press changes: the trak's, or with no trak the project checkout's. */
export const processesKey = (id: string | undefined): readonly unknown[] =>
  id === undefined ? queryKeys.projectProcesses : queryKeys.processes(id)

export const processPressOptions = (
  id: string | undefined,
  cache: {
    readonly invalidateQueries: (filters: {
      readonly queryKey: readonly unknown[]
    }) => Promise<void>
  },
  mutationFn: (ask: ProcessAsk) => Promise<unknown> = (ask) => actOnProcess(id, ask.name, ask.verb),
) => ({
  mutationFn,
  // The processes alone: a process never moves a trak, so neither its row nor its detail
  // can have changed.
  onSuccess: () => cache.invalidateQueries({ queryKey: processesKey(id) }),
})

/**
 * Why a press did not land. A 404 is the one refusal the route has, and its reason phrase
 * says which of three it was — no checkout, an unknown trak, or a name nothing declares.
 */
export const pressSaid = (error: Error): string =>
  error instanceof ApiError
    ? `The engine refused: ${error.statusText || String(error.status)}.`
    : "Could not reach the engine."

export const useProcessPress = (id: string | undefined): ProcessPresses => {
  const cache = useQueryClient()
  const start = useMutation(processPressOptions(id, cache))
  const stop = useMutation(processPressOptions(id, cache))
  useScopedTo(id, () => {
    start.reset()
    stop.reset()
  })
  // The newer of the two presses speaks, so a stop that worked after a start that did not
  // takes the start's sentence off the screen.
  const { error } = start.submittedAt >= stop.submittedAt ? start : stop

  return {
    press: (name, verb) => {
      const mutation = verb === "stop" ? stop : start
      if (mutation.isPending) return
      mutation.mutate({ name, verb })
    },
    starting: start.isPending ? start.variables : undefined,
    stopping: stop.isPending ? stop.variables.name : undefined,
    said: error === null ? undefined : pressSaid(error),
  }
}
