// What `deploy.sh` last said about each trak's merge commit, and the one door a
// surface asks it through.
//
// Here rather than in `workflow/` for `conditions.ts`'s reason: it drives nothing and
// appends nothing. The runtime runs the same script for a trak waiting on `deployed`
// and reads its exit the same way — `askConditions` — and what this adds is memory:
// the sweep's last answer, which a list row draws for a waiting trak, and an answer a
// page asked for, shared across every tab asking and kept for a short while so a poll
// on each of them is not a script run on each of them.
//
// **What is held is only the newest answer per trak, and a daemon restart loses it.**
// The log holds the not-yet that rested a waiting trak, and the list falls back to
// that until the sweep asks again — see `toSummaryDto`'s caller.

import {
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  HashMap,
  Layer,
  Option,
  Ref,
  Scope,
} from "effect"
import type { CommitSha } from "../vcs/index.js"
import { conditionAnswer } from "../workflow/domain/condition.js"
import type { Event } from "../workflow/domain/event.js"
import type { Trak, TrakId } from "../workflow/domain/trak.js"
import { Checks } from "../workflow/ports/checks.js"
import { libraryNow } from "../workflow/ports/project-files.js"

/**
 * One answer from the script: its three exits under the names a surface draws, what
 * it printed — the JSON line still inside, read out at the boundary — and when.
 */
export interface DeployStatus {
  readonly answer: "live" | "not-yet" | "gave-up"
  readonly output: string
  /** When the script ran, epoch milliseconds. */
  readonly at: number
}

/**
 * How long an answer a page asked for is handed to the next asker rather than the
 * script being run again. Every open tab polls the trak page on its own timer, and a
 * deploy's status does not move faster than this.
 */
export const DEPLOY_ANSWER_REUSED_FOR = Duration.seconds(30)

export interface DeploysShape {
  /**
   * What the script says about this trak's merge commit, now: run unless an answer
   * younger than `DEPLOY_ANSWER_REUSED_FOR` is held, and one run shared by everyone
   * asking while it runs. `undefined` is a trak with nothing to ask about — the
   * project has no `deploy.sh`, or the trak has no merge commit — which is the one
   * answer that costs no run.
   */
  readonly status: (trak: Trak) => Effect.Effect<DeployStatus | undefined>
  /** The newest answer held for this trak, from either asker, or nothing. */
  readonly last: (id: TrakId) => Effect.Effect<DeployStatus | undefined>
  /** The sweep's answer, put here by the drive that asked — see `asking` in `drive.ts`. */
  readonly remember: (id: TrakId, status: DeployStatus) => Effect.Effect<void>
}

export class Deploys extends Context.Tag("app/Deploys")<Deploys, DeploysShape>() {}

/**
 * The commit a deploy is asked about: the one a wait found the branch landed as, or
 * the one an archive ended the trak `Merged` with. Nothing else has one.
 */
export const mergeCommitOf = (trak: Trak): CommitSha | undefined =>
  trak.landed?.sha ?? (trak.state._tag === "Merged" ? trak.state.sha : undefined)

/**
 * What a condition answer says about the deploy, or nothing: only a not-yet or a
 * gave-up from `deployed` that ran the script — one carrying the merge commit — is
 * about the deploy at all. A not-yet about the branch not having merged names a run
 * that never happened, and a met answer carries no output to draw.
 */
export const deployStatusOf = (answer: Event, at: number): DeployStatus | undefined =>
  answer._tag === "ConditionsUnmet" && answer.name === "deployed" && answer.merged !== undefined
    ? { answer: answer.stopped ? "gave-up" : "not-yet", output: answer.output, at }
    : undefined

const answerOf = (exitCode: number | undefined): DeployStatus["answer"] => {
  switch (conditionAnswer(exitCode)) {
    case "met":
      return "live"
    case "unmet":
      return "not-yet"
    case "stopped":
      return "gave-up"
  }
}

export const DeploysLayer = Layer.scoped(
  Deploys,
  Effect.gen(function* () {
    // Read on each ask: a reload can add or change `deploy.sh` under this layer.
    const library = yield* libraryNow
    const runner = yield* Checks
    const scope = yield* Scope.Scope
    const held = yield* Ref.make(HashMap.empty<TrakId, DeployStatus>())
    /**
     * The runs in flight, one per trak, so two tabs asking at once share one script
     * run. Each is forked into the layer's own scope rather than the request's, so a
     * tab closing mid-run neither kills the run the other tab is waiting on nor
     * leaves the entry behind.
     */
    const running = yield* Ref.make(HashMap.empty<TrakId, Deferred.Deferred<DeployStatus>>())

    const remember = (id: TrakId, status: DeployStatus): Effect.Effect<void> =>
      Ref.update(held, (all) => HashMap.set(all, id, status))

    const last = (id: TrakId): Effect.Effect<DeployStatus | undefined> =>
      Effect.map(Ref.get(held), (all) => Option.getOrUndefined(HashMap.get(all, id)))

    const ask = (id: TrakId, sha: CommitSha): Effect.Effect<DeployStatus> =>
      Effect.gen(function* () {
        const lib = yield* library
        const script = lib.deploy
        if (script === undefined) return yield* Effect.die("asked for a deploy with no deploy.sh")
        // The project's script, so under an external store it runs as `askConditions` runs it.
        const outcome = yield* runner.run(script, lib.root, undefined, [sha], undefined, {}, true)
        const status: DeployStatus = {
          answer: answerOf(outcome.exitCode),
          output: outcome.output,
          at: yield* Clock.currentTimeMillis,
        }
        yield* remember(id, status)
        return status
      })

    /**
     * Start the run for this trak unless one is going, and hand back the one to wait
     * on. `Ref.modify` decides both in one step, so two askers arriving together
     * cannot both start one.
     */
    const share = (id: TrakId, sha: CommitSha): Effect.Effect<Deferred.Deferred<DeployStatus>> =>
      Effect.gen(function* () {
        const fresh = yield* Deferred.make<DeployStatus>()
        const [deferred, started] = yield* Ref.modify(
          running,
          (
            all: HashMap.HashMap<TrakId, Deferred.Deferred<DeployStatus>>,
          ): readonly [
            readonly [Deferred.Deferred<DeployStatus>, boolean],
            HashMap.HashMap<TrakId, Deferred.Deferred<DeployStatus>>,
          ] => {
            const going = HashMap.get(all, id)
            return Option.isSome(going)
              ? [[going.value, false], all]
              : [[fresh, true], HashMap.set(all, id, fresh)]
          },
        )
        if (started) {
          yield* ask(id, sha).pipe(
            Effect.tap((status) => Deferred.succeed(deferred, status)),
            Effect.ensuring(Ref.update(running, (all) => HashMap.remove(all, id))),
            Effect.forkIn(scope),
          )
        }
        return deferred
      })

    const status = (trak: Trak): Effect.Effect<DeployStatus | undefined> =>
      Effect.gen(function* () {
        const sha = mergeCommitOf(trak)
        if (sha === undefined || (yield* library).deploy === undefined) return undefined
        const now = yield* Clock.currentTimeMillis
        const kept = yield* last(trak.id)
        if (kept !== undefined && now - kept.at < Duration.toMillis(DEPLOY_ANSWER_REUSED_FOR)) {
          return kept
        }
        return yield* Deferred.await(yield* share(trak.id, sha))
      })

    return { status, last, remember } satisfies DeploysShape
  }),
)
