/**
 * The parent's plan and its spawns' pieces, as one map.
 *
 * **A spawn is a band of columns rather than a row.** Each column is one piece's own plan,
 * stacked, so the layout itself says the pieces ran at once — and the parent's detail
 * becomes the one place the whole family is navigated: the arrows walk the plan in order
 * and, at a spawn, into each piece in turn, and any step of any piece is a position the
 * pane can show.
 *
 * **A child is read as an ordinary trak.** `mapRows` is the same function the parent's own
 * rows come from, run against the child's state, log, plan and split transcript — so a
 * column is the map at a narrower width rather than a second vocabulary. Nothing new
 * crosses the wire: the ids are in the parent's own log and a child is an ordinary
 * `GET /api/traks/:id`.
 *
 * **Every child is drawn, whatever it became.** The columns *are* the plan entry, so a
 * spawn whose pieces have all merged still draws them — hiding the ones that have landed
 * is the *list*'s rule, where the band is a window onto what still wants something.
 */

import type { AgentDto, EventDto, TrakDetailDto, TrakStateDto } from "../../../api/types"
import { mapRows, opensAt, type MapRow, type Parked } from "./rows"
import { splitTurns } from "../turns/turns"

/** One position on the family map: a row, and the trak whose log and turns answer for it. */
export interface Spot {
  /**
   * Unique across the family and stable across polls, so a picked position survives the
   * poll that redraws the map.
   *
   * A child's is qualified by its trak id and **nothing here parses it back apart**: what a
   * spot is about is `row.at` and `trak`, which are carried. A surface recovering either
   * from a string it built is one rename away from asking about the wrong step. The one
   * reader outside the client is the desktop shell's `traksOpened`, which has only the URL
   * and reads the id before the first colon to close that piece's notifications — so the
   * qualifier stays `<id>:` first.
   */
  readonly key: string
  readonly row: MapRow
  readonly trak: TrakDetailDto
}

/** One piece of a spawn: that child's own plan, stacked. */
export interface Column {
  readonly id: string
  readonly spots: readonly Spot[]
}

/**
 * One entry of the parent's plan, and the pieces that ran at it.
 *
 * **`columns` empty means draw the row**, which is every entry that is not a spawn — and a
 * spawn whose children have not answered yet. That is what keeps a spawn position on the
 * map and on the walk while its pieces are still being read, and what it falls back to if
 * one of them cannot be reached at all.
 */
export interface Band {
  readonly spot: Spot
  readonly columns: readonly Column[]
}

/** What a trak is parked at, as `mapRows` takes it — nothing where it waits on nothing. */
const parkedAt = (trak: TrakDetailDto, now: number): Parked | undefined =>
  trak.waiting === undefined ? undefined : { at: trak.waiting, now }

/** The child ids each spawn position put out, keyed by the entry they belong to. */
const spawned = (log: readonly EventDto[]): ReadonlyMap<number, readonly string[]> => {
  const ids = new Map<number, readonly string[]>()
  for (const event of log) if (event._tag === "ChildrenSpawned") ids.set(event.step, event.ids)
  return ids
}

/**
 * Every child this trak has spawned, in the order its log named them.
 *
 * What `useFamily` fetches, one request each — `ChildrenSpawned.ids` is the whole of the
 * join, and it is already on the wire.
 */
export const childIds = (log: readonly EventDto[]): readonly string[] =>
  [...spawned(log).values()].flat()

/**
 * The trak this one is a piece of, by id — read off its own log rather than off a field on
 * the wire.
 *
 * **`TrakDetailDto` has no `parent`, deliberately.** `shared/src/dto/trak.ts` says plainly that the
 * relationship is on the *summary* because the list is the surface that draws it, and
 * widening the contract to answer one question in the drawer would need that reversed.
 * `TrakCreated` carries it already, which is the same read the rest of this file does from
 * the other side.
 *
 * What asks: `useParent`, which is what turns `/traks/<childId>` into the parent's drawer
 * standing at that piece — a subtrak has no drawer of its own except where the parent
 * cannot be loaded.
 */
export const parentId = (log: readonly EventDto[]): string | undefined =>
  log.flatMap((event) => (event._tag === "TrakCreated" ? [event.parent?.id] : []))[0]

/**
 * One child's plan as a column.
 *
 * **No composer row.** A spawn's child is born holding the plan its parent's composer
 * wrote, so it has no compose entry of its own — the only one `mapRows` can produce here
 * is the placeholder it draws for a trak with no plan at all, and a column headed by that
 * would say a piece was still working out what to do.
 *
 * **The ending row stays**, and it did not always. It was dropped because `DrawerPane`
 * filled that row with the ending of the trak the page was *of*, so clicking a piece's
 * ending handed a reader the parent's merge — and a piece was landed from its own page
 * instead. That page is gone: the pane's ending is built from `spot.trak`, so the row a
 * piece needs to be merged from is a position like any other, and it is the only place a
 * piece's ending can be reached at all.
 */
const columnOf = (
  id: string,
  child: TrakDetailDto,
  agents: readonly AgentDto[],
  now: number,
): Column => {
  // A piece's own gates, from the piece's own trak: it inherits its parent's mode and
  // answers for its own plan, so asking the parent would draw the parent's marks here.
  // And its own wait: a held piece's ending moves inside its column, the parent's does not.
  const rows = mapRows(
    child.state,
    child.log,
    child.plan,
    splitTurns(child.transcript, child.log),
    child.marks,
    agents,
    parkedAt(child, now),
  )
  const steps = rows[0]?.kind === "compose" ? rows.slice(1) : rows
  return {
    id,
    spots: steps.map((row) => ({
      key: `${id}:${row.key}`,
      // `continues.to` is a key on this same walk, so it is qualified exactly as the
      // spot's own key is: a piece's conversation lives at the piece's position, and the
      // bare row key would send the press to the parent's row of the same number.
      row:
        row.continues?.to === undefined
          ? row
          : { ...row, continues: { ...row.continues, to: `${id}:${row.continues.to}` } },
      trak: child,
    })),
  }
}

/**
 * The parent's plan, with each spawn's pieces gathered onto its entry.
 *
 * One band per plan entry, in plan order, so the map still reads top to bottom and the
 * spawn is the one place it goes sideways.
 */
export const familyBands = (
  parent: TrakDetailDto,
  children: ReadonlyMap<string, TrakDetailDto>,
  /** The library, for the mark each position's agent wears — `mapRows` says what empty
   *  means. One list for the parent and every piece: a child runs the same fleet. */
  agents: readonly AgentDto[],
  /** The instant a parked ending's clock is worded against — `mapRows` says why it is passed. */
  now: number,
): readonly Band[] => {
  const rows = mapRows(
    parent.state,
    parent.log,
    parent.plan,
    splitTurns(parent.transcript, parent.log),
    parent.marks,
    agents,
    parkedAt(parent, now),
  )
  const ids = spawned(parent.log)
  return rows.map((row) => ({
    spot: { key: row.key, row, trak: parent },
    // A piece nothing has answered for yet takes no slot: the band shares its width among
    // the pieces it can draw, and an empty column would be a hole where one of them is.
    columns: (ids.get(row.at) ?? [])
      .flatMap((id) => {
        const child = children.get(id)
        return child === undefined ? [] : [columnOf(id, child, agents, now)]
      })
      .filter((column) => column.spots.length > 0),
  }))
}

/** What one band contributes to the walk: its pieces' rows, or its own row. */
const spotsIn = (band: Band): readonly Spot[] =>
  band.columns.length === 0 ? [band.spot] : band.columns.flatMap((column) => column.spots)

/**
 * Every position the arrows step through, depth first: the plan in order and, at a spawn,
 * each piece in turn — piece 1's steps, then piece 2's — then on to the next entry.
 *
 * **Exactly what the map draws, and in the same order**, which is what stops an arrow
 * landing somewhere that is not on screen.
 */
export const walk = (bands: readonly Band[]): readonly Spot[] => bands.flatMap(spotsIn)

/**
 * Where one piece of a spawn is standing, as a position key — `opensAt` over that piece's
 * own column, which is the same walk its own drawer used to open at.
 *
 * `undefined` for an id that is not a column here, which is the parent's own: it is
 * standing somewhere on the whole walk rather than inside one band, and `familyFocus`
 * answers for it.
 */
const restingIn = (bands: readonly Band[], id: string): string | undefined => {
  const column = bands.flatMap((band) => band.columns).find((c) => c.id === id)
  const child = column?.spots[0]?.trak
  if (column === undefined || child === undefined) return undefined
  return column.spots[
    opensAt(
      column.spots.map((spot) => spot.row),
      child.state,
    )
  ]?.key
}

/**
 * The position the trak that *owns* `spot` is standing at — the one row of it a notice
 * saying *this stopped* belongs on, and nowhere else on that trak's chronology.
 *
 * **Two shapes, because a spawn band is two shapes.** A piece rests inside its own column,
 * which is what `restingIn` walks. The parent rests over the whole map, which at a spawn is
 * a key belonging to one of its pieces — so that answer cannot be recomputed from a column,
 * and `familyFocus` has already made it: it is handed in rather than worked out again,
 * because a second copy of that arithmetic disagrees at exactly the position this is about.
 *
 * Here rather than in the page for the same reason `familyFocus` returns `resting` at all.
 */
export const restingFor = (
  bands: readonly Band[],
  spot: Spot | undefined,
  /** `familyFocus`'s own — where the trak the page is of is standing. */
  resting: string | undefined,
): string | undefined =>
  (spot === undefined ? undefined : restingIn(bands, spot.trak.id)) ?? resting

/**
 * What a `?spot=` in the URL names, as a position key — or `undefined` where nothing in the
 * family answers to it yet.
 *
 * **Two forms, because two surfaces contribute one.** The rail and the map hand back a key
 * they read off a `Spot`, and that form is matched and returned unchanged. The *list* has
 * only a `TrakSummaryDto`, which carries no plan and no log, so the one thing it can name is
 * a piece's trak id — and the parent is the only thing that can turn that into a position.
 * This is where it happens, and it is why the param takes both.
 *
 * **A bare id resolves to where that piece is standing**, which is `restingIn` — the same
 * question, asked in one place, that decides which row of a piece its notice goes on.
 *
 * `undefined` is ordinary rather than an error and the caller must treat it so: it is what a
 * bare child id reads as for as long as `useFamily` has not answered for that piece, and it
 * is also what a key from a replaced plan tail reads as. Both fall back to wherever the trak
 * is, which is `familyFocus`'s own rule.
 */
export const resolveSpot = (bands: readonly Band[], picked: string): string | undefined =>
  walk(bands).find((spot) => spot.key === picked)?.key ?? restingIn(bands, picked)

/**
 * The spot the drawer is showing, and the two the arrows move to.
 *
 * **The position is a key, never an index into the walk.** The map may point anywhere and
 * the walk is only what the arrows follow, so a selection made from the map has to survive
 * being looked up rather than being counted to — and a key that no longer exists is
 * ordinary rather than an error, since a revision replaces the plan's unrun tail.
 *
 * With nothing picked it opens where the parent is. A spawn has no position of its own, so
 * standing at one is standing at the first step of its first piece.
 *
 * **`prev` and `next` survived the rail**, which was not the plan: a rail drawing every
 * position as its own press looked like it retired the arrows, and the built thing said
 * otherwise — a piece's tile is 14px, so stepping through a spawn by clicking is far harder
 * than pressing an arrow twice. The rail says where you are; these say what is next.
 */
export const familyFocus = (
  bands: readonly Band[],
  state: TrakStateDto,
  picked: string | undefined,
): {
  readonly spot: Spot | undefined
  readonly prev: string | undefined
  readonly next: string | undefined
  /**
   * Where the trak itself is, whatever the reader has picked — the key this opens at
   * with nothing held.
   *
   * Returned rather than recomputed by the caller, because it is `opensAt` applied to
   * the walk and a second copy of that arithmetic would disagree at a spawn. What asks:
   * the failure notice, which belongs at the position the trak stopped at and nowhere
   * else, so a reader who has stepped away is not shown it against somebody else's turns.
   * This is the answer for the trak the page is *of*; `restingFor` is the same question
   * asked about whichever trak owns a given position, and it takes this as its other half.
   *
   * **At a spawn band it is a *piece's* key**, since the band's spots are its columns' and
   * the parent has no row there — a trak that stopped on one is resting at a position it
   * does not own. That is a fact about the walk rather than a gap in it: `DrawerPane` is
   * what decides where a notice goes when the position under it belongs to somebody else.
   */
  readonly resting: string | undefined
} => {
  const spots = walk(bands)
  const held = picked === undefined ? -1 : spots.findIndex((spot) => spot.key === picked)
  const band = opensAt(
    bands.map((b) => b.spot.row),
    state,
  )
  const opens = Math.min(
    bands.slice(0, band).reduce((n, b) => n + spotsIn(b).length, 0),
    Math.max(spots.length - 1, 0),
  )
  const i = held >= 0 ? held : opens
  return {
    spot: spots[i],
    prev: spots[i - 1]?.key,
    next: spots[i + 1]?.key,
    resting: spots[opens]?.key,
  }
}
