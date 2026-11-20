/**
 * What a person has changed about a proposed plan at its gate, and what the card draws
 * from it — held on the card until Approve sends it, and dropped by anything else.
 *
 * **Keyed by the tile's index in the proposal, and every key sent is the key as
 * proposed.** A removed tile stays on the card, folded, so nothing on screen moves under
 * the person's thumb and every `continues` they read still names what they read it as.
 * The engine renumbers when it takes the plan, and re-points each `continues` with it —
 * that is its rule, and this file does not hold a second copy of it. Two consequences are
 * drawn here at once, because the person decided they should be: a step continuing a
 * removed one reads as a new session, and a swapped step's key reads with its new agent's
 * name — on its own tile and wherever a `continues` names it — while the press still
 * sends the key the composer wrote.
 *
 * **A step continuing an earlier one runs on that conversation's model**, so its own model
 * is locked: no pick is kept for it, and the model drawn is the one the step it continues
 * runs on, after that step's own edits. Choosing a new session unlocks it.
 *
 * **A spawn's pieces are edited step by step, under the spawn's tile.** Each piece step
 * takes a reword, a removal, an agent swap and a model pick, keyed by its piece and its
 * step as proposed. A piece keeps at least one step, so its last live step offers no
 * removal; nothing locks a piece step's model, since a piece step continues no
 * conversation.
 *
 * The ten edits are the engine's ten, one for one. An eleventh is a change to the wire
 * first.
 */

import type {
  AgentDto,
  ChildDto,
  EntryDto,
  PlanEditsDto,
  StepDto,
  StepEditDto,
  TrakDetailDto,
} from "../../../../api/types"
import { columnWaits } from "../../waits/waits"

/** One tile's edits. A field left off is untouched. */
export interface TileEdit {
  readonly instruction?: string
  /** The person's choice: an earlier agent step's key, or `undefined` for a new session. */
  readonly continues?: { readonly key: string | undefined }
  readonly removed?: boolean
  readonly waitCleared?: boolean
  /** The agent swapped in. Set through `withAgent`, which drops the model pick with it. */
  readonly agent?: string
  /** A `models.yaml` entry picked over the agent's own. Set through `withModel`. */
  readonly model?: string
  /** A spawn's piece steps' edits, by `cellKey`. */
  readonly pieces?: ReadonlyMap<string, CellEdit>
}

/** One piece step's edits, on `TileEdit`'s terms for the four it shares. */
export interface CellEdit {
  readonly instruction?: string
  readonly removed?: boolean
  readonly agent?: string
  readonly model?: string
}

/** Where a piece step's edits are held on its spawn's tile. */
const cellKey = (piece: number, step: number): string => `${String(piece)}.${String(step)}`

/** Every tile's edits, by its index in the proposal. */
export type PlanEdits = ReadonlyMap<number, TileEdit>

export const NO_EDITS: PlanEdits = new Map()

/** One tile as the card draws it. */
export interface Tile {
  /** The document key as proposed — `2-build`. What the press sends and what React keys on. */
  readonly key: string
  /** The key as drawn: the proposed one with a swapped agent's name — `2-experiment`. */
  readonly shown: string
  /** The entry as the edits leave it: its agent, its instruction, its `continues` and its clock. */
  readonly now: StepDto
  /** The entry as the composer proposed it. */
  readonly proposed: StepDto
  readonly removed: boolean
  /** The clock and the `waitFor` the composer set, struck out. `now` has dropped both. */
  readonly waitCleared: boolean
  /**
   * Whether it continues an earlier agent step still in the plan, and so runs on that
   * conversation's model rather than one of its own.
   */
  readonly locked: boolean
  /** The model the person picked for it, where one stands — none on a locked tile. */
  readonly picked: string | undefined
  /**
   * How many of the in-place edits the person made differ from the proposal. A
   * `continues` cleared because the step it named was removed is not one of them: the
   * removal is the edit, and it is counted where it was made.
   */
  readonly changes: number
  /** A spawn's pieces, each a list of its steps as drawn. Empty on any other entry. */
  readonly pieces: readonly (readonly Cell[])[]
}

/** One step of one piece of a spawn, as the card draws it. */
export interface Cell {
  /** The step as the edits leave it — its agent and its instruction. */
  readonly now: ChildDto
  readonly proposed: ChildDto
  readonly removed: boolean
  /** The only step of its piece still kept, which may not be removed. */
  readonly last: boolean
  /** The model the person picked for it, where one stands. */
  readonly picked: string | undefined
  /** How many of the in-place edits differ from the proposal, on `Tile.changes`' terms. */
  readonly changes: number
}

/** A step an agent step may continue: its key as proposed and as drawn, and what it was told to do. */
export interface Continuable {
  readonly key: string
  readonly shown: string
  readonly instruction: string
}

/** `artifactKey`'s shape, which `continues` is written in — `rows.ts` keeps the same. */
const keyAt = (entry: EntryDto | StepDto, at: number): string =>
  `${String(at)}-${entry.type === "agent" ? entry.agent : entry.type}`

const instructionOf = (entry: StepDto, edit: TileEdit): string =>
  edit.instruction ?? entry.instruction

/**
 * The tiles, from the proposal's steps, the plan's entries before them — the ones that
 * ran — and the edits. What a tile continues is the person's choice over the composer's,
 * and nothing where the step it names is removed.
 */
export const tilesOf = (
  steps: readonly StepDto[],
  head: readonly EntryDto[],
  edits: PlanEdits,
): Tile[] => {
  const from = head.length
  const gone = new Set(
    steps.flatMap((s, i) => (edits.get(i)?.removed === true ? [keyAt(s, from + i)] : [])),
  )
  // Every agent step a `continues` may lock to, by its position: the ones that ran, and
  // each kept tile.
  const turns = new Map<string, number>([
    ...head.flatMap((e, at): [string, number][] =>
      e.type === "agent" ? [[keyAt(e, at), at]] : [],
    ),
    ...steps.flatMap((s, i): [string, number][] =>
      s.type === "agent" && edits.get(i)?.removed !== true ? [[keyAt(s, from + i), from + i]] : [],
    ),
  ])
  return steps.map((proposed, i) => {
    const edit = edits.get(i) ?? {}
    const instruction = instructionOf(proposed, edit)
    const waitCleared = edit.waitCleared === true
    const key = keyAt(proposed, from + i)
    const pieces =
      proposed.type === "spawn" ? proposed.children.map((c, j) => cellsOf(c, j, edit)) : []
    const now = ((): StepDto => {
      if (proposed.type === "spawn") {
        return {
          ...proposed,
          instruction,
          children: pieces.map((cells) => cells.filter((c) => !c.removed).map((c) => c.now)),
        }
      }
      if (proposed.type !== "agent") return { ...proposed, instruction }
      const { continues: asked, waitUntil, waitFor, ...rest } = proposed
      const chosen = edit.continues === undefined ? asked : edit.continues.key
      return {
        ...rest,
        agent: edit.agent ?? proposed.agent,
        instruction,
        ...(chosen === undefined || gone.has(chosen) ? {} : { continues: chosen }),
        ...(waitCleared || waitUntil === undefined ? {} : { waitUntil }),
        ...(waitCleared || waitFor === undefined ? {} : { waitFor }),
      }
    })()
    const continues = now.type === "agent" ? now.continues : undefined
    // Only an earlier step: a key naming one after this tile, or nothing, starts fresh.
    const at = continues === undefined ? undefined : turns.get(continues)
    const locked = at !== undefined && at < from + i
    const picked = locked || now.type !== "agent" ? undefined : edit.model
    const swapped =
      now.type === "agent" && proposed.type === "agent" && now.agent !== proposed.agent
    return {
      key,
      shown: keyAt(now, from + i),
      now,
      proposed,
      removed: edit.removed === true,
      waitCleared,
      locked,
      picked,
      changes:
        (instruction === proposed.instruction ? 0 : 1) +
        (continuesChosen(proposed, edit) === undefined ? 0 : 1) +
        (waitCleared ? 1 : 0) +
        (swapped ? 1 : 0) +
        (picked === undefined ? 0 : 1),
      pieces,
    }
  })
}

/** One piece's steps as drawn, from its spawn's edits. */
const cellsOf = (steps: readonly ChildDto[], piece: number, edit: TileEdit): Cell[] => {
  const edits = steps.map((_, k) => edit.pieces?.get(cellKey(piece, k)) ?? {})
  const kept = edits.filter((e) => e.removed !== true).length
  return steps.map((proposed, k) => {
    const e = edits[k] ?? {}
    const removed = e.removed === true
    const now: ChildDto = {
      ...proposed,
      agent: e.agent ?? proposed.agent,
      instruction: e.instruction ?? proposed.instruction,
    }
    return {
      now,
      proposed,
      removed,
      last: !removed && kept === 1,
      picked: e.model,
      changes:
        (now.instruction === proposed.instruction ? 0 : 1) +
        (now.agent === proposed.agent ? 0 : 1) +
        (e.model === undefined ? 0 : 1),
    }
  })
}

/**
 * The conversation the person chose for a step, where it differs from the composer's —
 * `{ key: undefined }` for a new session — or `undefined` where they chose nothing new.
 */
const continuesChosen = (
  proposed: StepDto,
  edit: TileEdit,
): { readonly key: string | undefined } | undefined => {
  const chosen = edit.continues
  const asked = proposed.type === "agent" ? proposed.continues : undefined
  return chosen === undefined || chosen.key === asked ? undefined : chosen
}

/**
 * What Approve counts: a removal is one, however much else the step had — and a removed
 * spawn's piece edits go with it.
 */
export const editCount = (tiles: readonly Tile[]): number =>
  tiles.reduce(
    (n, t) =>
      n +
      (t.removed
        ? 1
        : t.changes + t.pieces.flat().reduce((m, c) => m + (c.removed ? 1 : c.changes), 0)),
    0,
  )

/**
 * What tile `i` may continue: an agent step before it that is still in the plan — one
 * that ran before this proposal, or an earlier tile nobody removed.
 */
export const continuable = (
  head: readonly EntryDto[],
  tiles: readonly Tile[],
  i: number,
): Continuable[] => [
  ...head.flatMap((e, at) => {
    const key = keyAt(e, at)
    return e.type === "agent" ? [{ key, shown: key, instruction: e.instruction }] : []
  }),
  ...tiles
    .slice(0, i)
    .flatMap((t) =>
      !t.removed && t.now.type === "agent"
        ? [{ key: t.key, shown: t.shown, instruction: t.now.instruction }]
        : [],
    ),
]

/**
 * The model tile `i` runs on, as drawn: a locked tile's is the one the step it continues
 * runs on — that tile's, after its own edits, or the resolved model of an entry that ran —
 * and any other agent tile's is its pick, else its agent's own. `undefined` for a spawn or
 * a compose, and where the library has not answered.
 */
export const modelOn = (
  head: readonly EntryDto[],
  tiles: readonly Tile[],
  agents: readonly AgentDto[],
  i: number,
): string | undefined => {
  const tile = tiles[i]
  const now = tile?.now
  if (tile === undefined || now?.type !== "agent") return undefined
  const continues = now.continues
  if (!tile.locked || continues === undefined) {
    return tile.picked ?? agents.find((a) => a.name === now.agent)?.model
  }
  const j = tiles.findIndex((t) => t.key === continues)
  if (j >= 0 && j < i) return modelOn(head, tiles, agents, j)
  const ran = head.find((e, at) => keyAt(e, at) === continues)
  return ran?.type === "agent" ? ran.model : undefined
}

/** The model a piece step runs on, as drawn: its pick, else its agent's own. */
export const cellModel = (cell: Cell, agents: readonly AgentDto[]): string | undefined =>
  cell.picked ?? agents.find((a) => a.name === cell.now.agent)?.model

/**
 * The conditions first waited on at each step of one piece — none on a removed step, which
 * runs nothing, so the next one kept is where its condition is first waited on.
 */
export const cellWaits = (
  agents: readonly AgentDto[],
  cells: readonly Cell[],
): readonly (readonly string[])[] => {
  const waits = columnWaits(
    agents,
    cells.filter((c) => !c.removed).map((c) => c.now),
  )
  return cells.map((c, k) =>
    c.removed ? [] : (waits[cells.slice(0, k).filter((d) => !d.removed).length] ?? []),
  )
}

/** One tile's edit changed, the rest of its edits kept. */
export const withEdit = (edits: PlanEdits, i: number, change: TileEdit): PlanEdits =>
  new Map(edits).set(i, { ...edits.get(i), ...change })

/**
 * The agent a tile runs, swapped — and any model picked for it dropped, since that was a
 * pick for the agent it no longer runs. Swapping back to the proposed agent is no swap.
 */
export const withAgent = (
  edits: PlanEdits,
  i: number,
  agent: string,
  proposed: string,
): PlanEdits => {
  const { agent: _was, model: _picked, ...rest } = edits.get(i) ?? {}
  return new Map(edits).set(i, agent === proposed ? rest : { ...rest, agent })
}

/** The model a tile runs on. Picking the agent's own is no pick. */
export const withModel = (
  edits: PlanEdits,
  i: number,
  model: string,
  own: string | undefined,
): PlanEdits => {
  const { model: _was, ...rest } = edits.get(i) ?? {}
  return new Map(edits).set(i, model === own ? rest : { ...rest, model })
}

/** One piece step's edits, replaced by `change` — the tile's own edits and its other piece steps' kept. */
const withCell = (
  edits: PlanEdits,
  i: number,
  piece: number,
  step: number,
  change: (was: CellEdit) => CellEdit,
): PlanEdits => {
  const tile = edits.get(i) ?? {}
  const key = cellKey(piece, step)
  const pieces = new Map(tile.pieces).set(key, change(tile.pieces?.get(key) ?? {}))
  return new Map(edits).set(i, { ...tile, pieces })
}

/** One piece step's edit changed: a reword or a removal. */
export const withCellEdit = (
  edits: PlanEdits,
  i: number,
  piece: number,
  step: number,
  change: Pick<CellEdit, "instruction" | "removed">,
): PlanEdits => withCell(edits, i, piece, step, (was) => ({ ...was, ...change }))

/** `withAgent`, on a piece step. */
export const withCellAgent = (
  edits: PlanEdits,
  i: number,
  piece: number,
  step: number,
  agent: string,
  proposed: string,
): PlanEdits =>
  withCell(edits, i, piece, step, ({ agent: _was, model: _picked, ...rest }) =>
    agent === proposed ? rest : { ...rest, agent },
  )

/** `withModel`, on a piece step. */
export const withCellModel = (
  edits: PlanEdits,
  i: number,
  piece: number,
  step: number,
  model: string,
  own: string | undefined,
): PlanEdits =>
  withCell(edits, i, piece, step, ({ model: _was, ...rest }) =>
    model === own ? rest : { ...rest, model },
  )

/** One of a piece step's edits taken back — Undo on a removal, or an emptied instruction. */
export const withoutCellEdit = (
  edits: PlanEdits,
  i: number,
  piece: number,
  step: number,
  field: "instruction" | "removed",
): PlanEdits =>
  withCell(edits, i, piece, step, (was) =>
    Object.fromEntries(Object.entries(was).filter(([name]) => name !== field)),
  )

/** One of a tile's edits taken back — Undo on a removal or a cleared clock. */
export const withoutEdit = (edits: PlanEdits, i: number, field: keyof TileEdit): PlanEdits => {
  const kept = Object.fromEntries(
    Object.entries(edits.get(i) ?? {}).filter(([name]) => name !== field),
  )
  return new Map(edits).set(i, kept)
}

/**
 * The edits as the press sends them, over the proposal at log index `proposal` — or
 * `undefined` where nothing differs, which is taking the plan as proposed.
 *
 * A removed tile sends its removal alone: whatever else was done to it goes with it. An
 * instruction or a `continues` set back to what was proposed sends nothing, and neither
 * does a pick on a tile a later `continues` choice locked.
 */
export const editsDto = (
  proposal: number,
  tiles: readonly Tile[],
  from: number,
  edits: PlanEdits,
): PlanEditsDto | undefined => {
  const steps = tiles.flatMap((t, i): StepEditDto[] => {
    const at = from + i
    if (t.removed) return [{ edit: "remove", at }]
    const chosen = continuesChosen(t.proposed, edits.get(i) ?? {})
    return [
      ...(t.now.instruction === t.proposed.instruction
        ? []
        : [{ edit: "instruction" as const, at, instruction: t.now.instruction }]),
      ...(chosen === undefined
        ? []
        : [
            chosen.key === undefined
              ? { edit: "continues" as const, at }
              : { edit: "continues" as const, at, key: chosen.key },
          ]),
      ...(t.waitCleared ? [{ edit: "clearWait" as const, at }] : []),
      ...(t.now.type === "agent" && t.proposed.type === "agent" && t.now.agent !== t.proposed.agent
        ? [{ edit: "agent" as const, at, agent: t.now.agent }]
        : []),
      ...(t.picked === undefined ? [] : [{ edit: "model" as const, at, model: t.picked }]),
      ...t.pieces.flatMap((cells, piece) =>
        cells.flatMap((c, step) => cellEdits(c, { at, piece, step })),
      ),
    ]
  })
  const [first, ...rest] = steps
  return first === undefined ? undefined : { proposal, steps: [first, ...rest] }
}

/** What one piece step sends: its removal alone, or each edit that differs from the proposal. */
const cellEdits = (
  c: Cell,
  where: { readonly at: number; readonly piece: number; readonly step: number },
): StepEditDto[] =>
  c.removed
    ? [{ edit: "pieceRemove", ...where }]
    : [
        ...(c.now.instruction === c.proposed.instruction
          ? []
          : [{ edit: "pieceInstruction" as const, ...where, instruction: c.now.instruction }]),
        ...(c.now.agent === c.proposed.agent
          ? []
          : [{ edit: "pieceAgent" as const, ...where, agent: c.now.agent }]),
        ...(c.picked === undefined
          ? []
          : [{ edit: "pieceModel" as const, ...where, model: c.picked }]),
      ]

/**
 * The proposal at a trak's plan gate: its place in the log, which the press names, and the
 * plan's entries before it — the ones that ran. `undefined` where the newest thing the
 * composer returned is not a proposal, which at the plan gate is a finish handing work off.
 *
 * The proposal is the plan's tail, so what precedes it is everything but its length.
 */
export const proposalAtGate = (
  trak: TrakDetailDto,
): { readonly proposal: number; readonly head: readonly EntryDto[] } | undefined => {
  const proposal = trak.log.findLastIndex((e) => e._tag === "ComposerReturned")
  const returned = trak.log[proposal]
  if (returned?._tag !== "ComposerReturned" || returned.output.type !== "proposal") return undefined
  const steps = trak.plan?.steps ?? []
  return { proposal, head: steps.slice(0, steps.length - returned.output.steps.length) }
}
