// A view's press, and the CLI that answers one when no turn is running.
//
// Here rather than in `workflow/` for `conditions.ts`'s reason: a press drives nothing
// and appends nothing. It is one request down a pipe some CLI holds, and the only
// state is which CLI that is.
//
// **During a turn the pipe is the turn's own.** After it, the first press starts the
// same CLI in the trak's checkout with no prompt, and that process answers until it is
// ended. It is deliberately not a turn in `Runs`: `Runs.inFlight` is what the stop and
// the message routes read, and an idle trak holding one would read as running.
//
// **A press may call only a tool the view's own server opens to views**, as the tool
// list stood when the view was kept. That is checked here, for every surface, and no
// step's tool access narrows it: a press is a person's, not the model's.

import {
  Clock,
  Context,
  Data,
  Duration,
  Effect,
  Exit,
  HashMap,
  Layer,
  Option,
  Ref,
  Schedule,
  Scope,
  Stream,
} from "effect"
import { McpRequest, type McpResult, type McpView } from "../agent/types/mcp.js"
import { Provider } from "../agent/ports/provider.js"
import type { SessionId } from "../agent/types/session.js"
import { Vcs } from "../vcs/ports/vcs.js"
import { replayHistory } from "../workflow/domain/replay.js"
import type { TrakId } from "../workflow/domain/trak.js"
import {
  declaredServers,
  Environment,
  type EnvironmentShape,
} from "../workflow/ports/environment.js"
import { Feed } from "../workflow/ports/feed.js"
import { Ids } from "../workflow/ports/ids.js"
import { Runs } from "../workflow/ports/runs.js"
import { Store } from "../workflow/ports/store.js"

/**
 * Why a press was not answered. `Unknown` is a view the store does not hold; `NotOpen`
 * a tool the view may not call; `NoCheckout` a trak with no directory left to start a
 * CLI in; `NotStarted` a CLI that did not start or never reached the view's server;
 * `Failed` a call the CLI refused or did not answer.
 */
export class PressRefused extends Data.TaggedError("PressRefused")<{
  readonly why: "Unknown" | "NotOpen" | "NoCheckout" | "NotStarted" | "Failed"
  readonly reason: string
  /** The CLI that would have answered, as the far end names it; absent before a view is found. */
  readonly cli?: string
}> {}

export interface ViewsShape {
  /** Call `tool` for the view kept under `call`, on whichever CLI can answer. */
  readonly press: (
    id: TrakId,
    call: string,
    tool: string,
    args: unknown,
  ) => Effect.Effect<McpResult, PressRefused>
  /** Whether a CLI started for a press is still held for this trak. */
  readonly attending: (id: TrakId) => Effect.Effect<boolean>
}

export class Views extends Context.Tag("app/Views")<Views, ViewsShape>() {}

/** How long a CLI started for a press is kept once nothing has pressed. */
export const VIEW_CLI_IDLE_FOR = Duration.minutes(10)

/**
 * How long a started CLI is given to reach the view's server. It dials every server it
 * is configured with as it boots, and answers a tool list before they have connected.
 */
const SERVER_WAIT = Schedule.intersect(Schedule.spaced("400 millis"), Schedule.recurs(60))

/**
 * The transcript lines only a turn's own CLI writes as it comes up: its process, and
 * the session it announces. A CLI started for a press writes no transcript at all.
 */
const TURN_STARTS: ReadonlySet<string> = new Set(["Spawned", "Session"])

/** One started CLI: the session its pipe is held under, and the scope that ends it. */
interface Attended {
  readonly sessionId: SessionId
  readonly scope: Scope.CloseableScope
  readonly lastPress: number
}

/** The tool a press names, as the view's own server opened it — or nothing. */
export const pressable = (
  view: McpView,
  tool: string,
): { readonly name: string; readonly callName: string } | undefined =>
  view.callable.find((open) => open.name === tool)

const refused = (why: PressRefused["why"], reason: string, cli?: string): PressRefused =>
  new PressRefused({ why, reason, ...(cli === undefined ? {} : { cli }) })

/** What starting a CLI reads: where the trak's checkout is, and what a spawn there is given. */
interface Starting {
  readonly provider: Context.Tag.Service<Provider>
  readonly checkout: (id: TrakId) => Effect.Effect<string | undefined>
  readonly capture: (cwd: string) => Effect.Effect<Readonly<Record<string, string>>, PressRefused>
  readonly newSessionId: Effect.Effect<SessionId>
  /**
   * The engine's environment, which lists the host's servers the CLI dials as a turn's
   * would, fills their secrets and asks the host for each sign-in.
   */
  readonly environment: EnvironmentShape
  /** The layer's own scope, which every started CLI's scope is a child of. */
  readonly scope: Scope.Scope
}

/**
 * Start the CLI a view's turn ran on, with no prompt, and wait until it has reached the
 * view's server. Its scope is handed back with its session: closing one ends the other.
 * A start that fails closes what it opened, so nothing is left running behind a refusal.
 */
const started = (deps: Starting, id: TrakId, view: McpView, tool: string) =>
  Effect.gen(function* () {
    const cli = deps.provider.cliFor(view.model) ?? view.model
    const notStarted = (reason: string): PressRefused => refused("NotStarted", reason, cli)
    const cwd = yield* deps.checkout(id)
    if (cwd === undefined) return yield* refused("NoCheckout", "the checkout is removed", cli)
    const env = yield* deps.capture(cwd).pipe(Effect.mapError((e) => notStarted(e.reason)))
    // The declared servers, as a turn's are: a view kept from one of them has nothing to
    // answer it otherwise, and a press would wait out `SERVER_WAIT` with no reason given.
    const declared = yield* declaredServers(deps.environment)
    const skipped = declared.skipped.get(view.server)
    if (skipped !== undefined) return yield* notStarted(skipped)
    const sessionId = yield* deps.newSessionId
    const own = yield* Scope.fork(deps.scope, { _tag: "Sequential" })
    const reached = deps.provider.mcp(sessionId, McpRequest.ListTools()).pipe(
      Effect.mapError((e) => notStarted(e.reason)),
      Effect.filterOrFail(
        (answer) =>
          answer?._tag === "Tools" &&
          answer.tools.some((t) => t.server === view.server && t.name === tool),
        () => notStarted(`it has not reached the server \`${view.server}\``),
      ),
      Effect.retry(SERVER_WAIT),
    )
    yield* deps.provider
      .attend({
        prompt: "",
        cwd,
        model: view.model,
        effort: undefined,
        sessionId,
        // Nothing is asked of the model, so nothing it could do is allowed.
        toolAccess: "read-only",
        permission: "read",
        resumeFrom: undefined,
        inherited: false,
        brief: undefined,
        env,
        ...(Object.keys(declared.servers).length === 0 ? {} : { mcpServers: declared.servers }),
      })
      .pipe(
        Effect.mapError((e) => notStarted(e.reason)),
        Effect.zipRight(reached),
        Scope.extend(own),
        Effect.onError(() => Scope.close(own, Exit.void)),
      )
    return { sessionId, scope: own }
  })

/**
 * The CLIs started for presses, one per trak at most: found or started, ended when the
 * trak starts a turn, and ended after a whole idle period with no press.
 */
const attendants = (deps: Starting, idleFor: Duration.Duration) =>
  Effect.gen(function* () {
    const held = yield* Ref.make(HashMap.empty<TrakId, Attended>())
    // One start at a time: two presses arriving together on an idle trak must share
    // the CLI the first one starts, and a start is rare enough not to need a lock
    // per trak.
    const starting = yield* Effect.makeSemaphore(1)

    const end = (id: TrakId, only?: SessionId): Effect.Effect<void> =>
      Effect.gen(function* () {
        const gone = yield* Ref.modify(held, (all) => {
          const found = Option.getOrUndefined(HashMap.get(all, id))
          return found === undefined || (only !== undefined && found.sessionId !== only)
            ? [undefined, all]
            : [found, HashMap.remove(all, id)]
        })
        if (gone !== undefined) yield* Scope.close(gone.scope, Exit.void)
      })

    /** Ends the CLI once a whole idle period has passed with no press, and not before. */
    const expire = (id: TrakId, sessionId: SessionId): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Effect.sleep(idleFor)
        const found = Option.getOrUndefined(HashMap.get(yield* Ref.get(held), id))
        if (found === undefined || found.sessionId !== sessionId) return
        const idle = (yield* Clock.currentTimeMillis) - found.lastPress
        if (idle >= Duration.toMillis(idleFor)) return yield* end(id, sessionId)
        return yield* expire(id, sessionId)
      })

    /** The session of the CLI held for this trak, started first where none is. */
    const session = (id: TrakId, view: McpView, tool: string) =>
      starting.withPermits(1)(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const found = yield* Ref.modify(held, (all) => {
            const going = Option.getOrUndefined(HashMap.get(all, id))
            return going === undefined
              ? [undefined, all]
              : [going.sessionId, HashMap.set(all, id, { ...going, lastPress: now })]
          })
          if (found !== undefined) return found
          const fresh = yield* started(deps, id, view, tool)
          yield* Ref.update(held, (all) => HashMap.set(all, id, { ...fresh, lastPress: now }))
          yield* Effect.forkIn(expire(id, fresh.sessionId), deps.scope)
          return fresh.sessionId
        }),
      )

    const attending = (id: TrakId): Effect.Effect<boolean> =>
      Effect.map(Ref.get(held), (all) => HashMap.has(all, id))

    return { end, session, attending }
  })

export const viewsLayer = (idleFor: Duration.Duration = VIEW_CLI_IDLE_FOR) =>
  Layer.scoped(
    Views,
    Effect.gen(function* () {
      const store = yield* Store
      const runs = yield* Runs
      const provider = yield* Provider
      const vcs = yield* Vcs
      const environment = yield* Environment
      const scope = yield* Scope.Scope
      const checkout = (id: TrakId): Effect.Effect<string | undefined> =>
        Effect.gen(function* () {
          const worktree = replayHistory(id, yield* store.events(id)).worktree
          if (worktree === undefined) return undefined
          return (yield* vcs.hasCheckout(id)) ? worktree.path : undefined
        }).pipe(Effect.orElseSucceed(() => undefined))
      const clis = yield* attendants(
        {
          provider,
          checkout,
          capture: (cwd) =>
            environment.capture(cwd).pipe(Effect.mapError((e) => refused("NotStarted", e.reason))),
          newSessionId: (yield* Ids).newSessionId,
          environment,
          scope,
        },
        idleFor,
      )

      // A turn starting is the trak's own CLI coming up in the same checkout, with the
      // same servers behind it: the one started for a press is ended, and a press
      // from then on goes down the turn's pipe. `InFlight` says nothing until a turn
      // first reports what it spent, so the start is read off the transcript.
      //
      // Made interruptible by hand: a layer is built with interruption masked and a
      // fiber forked here inherits the mask, so the scope closing would wait without
      // end on a drain that never finishes by itself.
      const replay = yield* (yield* Feed).since(0)
      yield* replay.frames.pipe(
        Stream.runForEach(({ frame }) =>
          frame._tag === "Activity" && TURN_STARTS.has(frame.entry._tag)
            ? clis.end(frame.id)
            : Effect.void,
        ),
        Effect.interruptible,
        Effect.forkIn(scope),
      )

      const press: ViewsShape["press"] = (id, call, tool, args) =>
        Effect.gen(function* () {
          const view = yield* store
            .view(id, call)
            .pipe(Effect.mapError((e) => refused("Unknown", e.reason)))
          if (view === undefined) return yield* refused("Unknown", "no such view")
          const open = pressable(view, tool)
          if (open === undefined) return yield* refused("NotOpen", `${tool} is not open to views`)
          const request = McpRequest.CallTool({
            server: view.server,
            tool: open.name,
            callName: open.callName,
            arguments: args,
          })
          const ask = (sessionId: SessionId) =>
            provider
              .mcp(sessionId, request)
              .pipe(Effect.mapError((e) => refused("Failed", e.reason)))
          const turn = yield* runs.inFlight(id).pipe(Effect.orElseSucceed(() => undefined))
          // By the id the turn was requested under, which is what its pipe is held by.
          const during = turn === undefined ? undefined : yield* ask(turn.minted ?? turn.sessionId)
          if (during?._tag === "Result") return during.result
          const first = yield* clis.session(id, view, tool)
          const answer = yield* ask(first)
          if (answer?._tag === "Result") return answer.result
          // The pipe was gone: the CLI died since the last press. One more start.
          yield* clis.end(id, first)
          const again = yield* ask(yield* clis.session(id, view, tool))
          if (again?._tag === "Result") return again.result
          return yield* refused(
            "NotStarted",
            "it stopped before it answered",
            provider.cliFor(view.model) ?? view.model,
          )
        })

      return { press, attending: clis.attending } satisfies ViewsShape
    }),
  )
