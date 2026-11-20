// Who sees, presses and reads each trak and goal — the port every surface that hides work
// asks, so the rule lives behind one tag: the gate in front of the per-item routes, the
// lists, the stream, push, the band, a press, and the read tools.
//
// **An engine nobody hosts serves one person**, so `PublicPeopleLayer` answers everything:
// every item at the top level, every frame, no band, no refusal, every subscription, every
// read. A host may provide its own implementation for an engine it starts, which should fail
// closed where it cannot say who sees an item — and a host must always provide one, since this
// default is wrong for more than one person.

import { Context, Effect, Layer } from "effect"
import * as Router from "@effect/platform/HttpRouter"
import type * as ServerRequest from "@effect/platform/HttpServerRequest"
import * as ServerResponse from "@effect/platform/HttpServerResponse"
import type { OwnershipDto, TrakAccessDto } from "@orkestra/shared/dto/trak"
import type { GoalId, Trak, TrakId, UserId } from "../workflow/domain/trak.js"
import type { StoreFailed } from "../workflow/ports/store-errors.js"
import { pressedBy } from "./guard.js"

/** A trak or a goal, as the rule names it. */
export type Item = { readonly trak: TrakId } | { readonly goal: GoalId }

/** What a viewer may do to an item they see. */
export type Level = TrakAccessDto["level"]

/** Which stream frames one subscriber receives. */
export interface Watching {
  readonly trak: (id: TrakId) => Effect.Effect<boolean, StoreFailed>
  /** A trak's `Appended` frame, answered from the trak it carries. */
  readonly appended: (id: TrakId, trak: Trak) => Effect.Effect<boolean, StoreFailed>
  readonly goal: (id: GoalId) => Effect.Effect<boolean, StoreFailed>
}

/**
 * Why a caller reads less than the whole project, as `trak/tool-result`'s `readsOnly` words
 * it beside a refusal or a list that left something out.
 */
export interface ReadsOnly {
  /** Who sees the caller, by login where the host named them; absent where nobody does. */
  readonly seenBy?: string
  /** Why the host could not be asked who its users are, where it could not. */
  readonly unasked?: string
}

/** What one read-tool caller may read. */
export interface Readable {
  readonly trak: (id: TrakId) => boolean
  readonly goal: (id: GoalId) => boolean
  /** `undefined` where the caller reads the whole project. */
  readonly readsOnly: ReadsOnly | undefined
}

export interface PeopleShape {
  /** What `viewer` may do with each item; `undefined` is unseen. */
  readonly levels: (
    viewer: UserId | undefined,
  ) => Effect.Effect<(item: Item) => Effect.Effect<Level | undefined, StoreFailed>>
  /** Which stream frames `viewer` receives. */
  readonly watching: (viewer: UserId | undefined) => Effect.Effect<Watching>
  /** The band's data, or `undefined` where `viewer` owns the item or nobody contests it. */
  readonly ownership: (
    viewer: UserId | undefined,
    owner: UserId | undefined,
  ) => Effect.Effect<OwnershipDto | undefined>
  /** Why a press is refused, or `undefined` where it is allowed. */
  readonly pressRefusal: (
    viewer: UserId | undefined,
    owner: UserId | undefined,
    what: "trak" | "goal",
  ) => Effect.Effect<string | undefined>
  /** Which kept push subscriptions, by the user each names, a payload about `item` reaches. */
  readonly seers: (item: Item) => Effect.Effect<(user: UserId | undefined) => boolean, StoreFailed>
  /** What a read tool called from `caller` — a trak's turn or a goal's composer — may read. */
  readonly readable: (caller: Item) => Effect.Effect<Readable>
}

export class People extends Context.Tag("app/People")<People, PeopleShape>() {}

const everything: Readable = { trak: () => true, goal: () => true, readsOnly: undefined }

const atTop = Effect.succeed((_item: Item) => Effect.succeed<Level | undefined>("owner"))
const seen = Effect.succeed(true)

/** One person's engine: every item, frame, subscription and read, and nothing refused. */
export const PublicPeopleLayer = Layer.succeed(People, {
  levels: () => atTop,
  watching: () => Effect.succeed({ trak: () => seen, appended: () => seen, goal: () => seen }),
  ownership: () => Effect.succeed(undefined),
  pressRefusal: () => Effect.succeed(undefined),
  seers: () => Effect.succeed(() => true),
  readable: () => Effect.succeed(everything),
})

/** `People.levels` for this request's viewer. */
export const levelsHere = Effect.flatMap(pressedBy, (viewer) =>
  Effect.flatMap(People, (people) => people.levels(viewer)),
)

/** The level this request's viewer holds on `item`, or `undefined` where they do not see it. */
export const levelHere = (item: Item) => Effect.flatMap(levelsHere, (of) => of(item))

/** Why this request's press on an item `owner` owns is refused, or `undefined` where it is not. */
export const refusedPress = (owner: UserId | undefined, what: "trak" | "goal") =>
  Effect.flatMap(pressedBy, (viewer) =>
    Effect.flatMap(People, (people) => people.pressRefusal(viewer, owner, what)),
  )

/** The band this request's viewer is shown on an item `owner` owns. */
export const ownershipHere = (owner: UserId | undefined) =>
  Effect.flatMap(pressedBy, (viewer) =>
    Effect.flatMap(People, (people) => people.ownership(viewer, owner)),
  )

/**
 * Every route under `prefix` — whose `:id` `item` names — answers an empty 404 to a viewer who
 * does not see that item, and runs as before for one who does. Where an implementation hides
 * a missing id as well, a missing item and someone else's answer alike, whatever the method or
 * body. A 403 would say the id exists, and the id is a trak's name. Applied with `Router.use`.
 */
export const hiddenUnseen =
  (prefix: string, item: (id: string) => Item) =>
  <E, R>(
    app: Effect.Effect<ServerResponse.HttpServerResponse, E, R>,
  ): Effect.Effect<
    ServerResponse.HttpServerResponse,
    E | StoreFailed,
    R | Router.RouteContext | ServerRequest.HttpServerRequest | People
  > =>
    Effect.gen(function* () {
      const { route, params } = yield* Router.RouteContext
      const id = params["id"]
      const under = route.path === prefix || route.path.startsWith(`${prefix}/`)
      if (!under || id === undefined) return yield* app
      if ((yield* levelHere(item(id))) === undefined) return ServerResponse.empty({ status: 404 })
      return yield* app
    })
