// What a person may change about a proposed plan at its gate, without asking the
// composer again: a step's instruction, whether a step is there at all, which
// conversation a step continues, a wait the composer set on it, and which agent and
// which model an agent step runs on — and the same four of those for each step of each
// piece a spawn will create, which is the plan that piece's trak is born with.
//
// **An overlay on the proposal, never a replacement for it.** Each edit names one
// position of the plan at the gate and one change to it, so what cannot be said here
// cannot be done: no step is added and none moves. The edits ride
// the `Approve` that takes the plan, and the composer's own proposal stays in the log
// as it was written — the record of what the composer proposed is what makes its
// plans measurable against what a person approved.
//
// **Keyed by the gate's positions and keys, both as proposed.** A removal renumbers
// the entries after it and an agent swap renames the entry's own key, and every key an
// edit names — its own `at`, a `continues` it sets — is read as the composer wrote it.
// `editedPlan` is the one place a key moves.

import { Array as Arr, Schema, Struct } from "effect"
import {
  type AgentStep,
  artifactKey,
  type Child,
  type ChildStep,
  childSteps,
  isCompose,
  isSpawn,
  nonEmpty,
  type Plan,
  type Step,
  waitForOf,
  waitUntilOf,
} from "./outputs/proposal.js"

/** The step is not in the approved plan. The unrun entries after it renumber. */
const Remove = Schema.TaggedStruct("Remove", { at: Schema.Int })
/** The step's instruction, in the person's words rather than the composer's. */
const Reword = Schema.TaggedStruct("Reword", { at: Schema.Int, instruction: Schema.String })
/**
 * The conversation an agent step picks up: the key of an earlier agent step, or absent
 * for a new session. Absent is the person's choice here, where on the entry it is the
 * default — which is why this is an edit of its own rather than a field left off.
 */
const Continue = Schema.TaggedStruct("Continue", {
  at: Schema.Int,
  key: Schema.optional(Schema.String),
})
/**
 * The step's `wait_until` and `wait_for` are both dropped, so it starts when the step
 * before it is done and its agent's own conditions hold. One edit for the two, because
 * at the gate they are one thing — when this step may start — and an old log's
 * `ClearWait` still means the same thing for a step carrying only a time.
 */
const ClearWait = Schema.TaggedStruct("ClearWait", { at: Schema.Int })
/**
 * The agent that runs the step. Its brief, its sections and its checks come with it, and
 * so does its own model: a model picked for the step before the swap is dropped, unless
 * the same approval picks one again.
 */
const SwapAgent = Schema.TaggedStruct("SwapAgent", { at: Schema.Int, agent: Schema.String })
/**
 * The model the step runs on instead of its agent file's — an entry of `models.yaml`. The
 * effort follows it, from that model's own default, as it does for New Chat's pick.
 */
const PickModel = Schema.TaggedStruct("PickModel", { at: Schema.Int, model: Schema.String })

/**
 * One step of one piece of a spawn: `at` is the spawn, `piece` its index among the
 * spawn's children and `step` the index in that piece's plan, both as proposed. Kinds of
 * their own rather than a field on the four above, so no `switch` on `_tag` can apply one
 * to the spawn entry itself. A piece keeps at least one step: no piece is added or
 * removed here, and a piece is a trak whose plan is never empty.
 */
const PieceStep = { at: Schema.Int, piece: Schema.Int, step: Schema.Int }
const RemovePieceStep = Schema.TaggedStruct("RemovePieceStep", PieceStep)
const RewordPiece = Schema.TaggedStruct("RewordPiece", { ...PieceStep, instruction: Schema.String })
/** `SwapAgent`'s, on a piece step: a model picked for the step goes with the agent. */
const SwapPieceAgent = Schema.TaggedStruct("SwapPieceAgent", { ...PieceStep, agent: Schema.String })
/** `PickModel`'s, on a piece step. Nothing locks one: a piece step continues no conversation. */
const PickPieceModel = Schema.TaggedStruct("PickPieceModel", { ...PieceStep, model: Schema.String })

export const PlanEdit = Schema.Union(
  Remove,
  Reword,
  Continue,
  ClearWait,
  SwapAgent,
  PickModel,
  RemovePieceStep,
  RewordPiece,
  SwapPieceAgent,
  PickPieceModel,
)
export type PlanEdit = Schema.Schema.Type<typeof PlanEdit>

export const Edits = {
  remove: (at: number): PlanEdit => Remove.make({ at }),
  reword: (at: number, instruction: string): PlanEdit => Reword.make({ at, instruction }),
  /** `key` absent is a new session. */
  continueFrom: (at: number, key?: string): PlanEdit => Continue.make({ at, key }),
  clearWait: (at: number): PlanEdit => ClearWait.make({ at }),
  swapAgent: (at: number, agent: string): PlanEdit => SwapAgent.make({ at, agent }),
  pickModel: (at: number, model: string): PlanEdit => PickModel.make({ at, model }),
  removePieceStep: (at: number, piece: number, step: number): PlanEdit =>
    RemovePieceStep.make({ at, piece, step }),
  rewordPiece: (at: number, piece: number, step: number, instruction: string): PlanEdit =>
    RewordPiece.make({ at, piece, step, instruction }),
  swapPieceAgent: (at: number, piece: number, step: number, agent: string): PlanEdit =>
    SwapPieceAgent.make({ at, piece, step, agent }),
  pickPieceModel: (at: number, piece: number, step: number, model: string): PlanEdit =>
    PickPieceModel.make({ at, piece, step, model }),
}

type PieceEdit = Extract<PlanEdit, { readonly piece: number }>

/** The last edit of one kind at one piece step, on `lastAt`'s terms. */
const lastOn = <T extends PieceEdit["_tag"]>(
  edits: readonly PlanEdit[],
  at: number,
  piece: number,
  step: number,
  tag: T,
): Extract<PlanEdit, { readonly _tag: T }> | undefined =>
  edits.findLast(
    (e): e is Extract<PlanEdit, { readonly _tag: T }> =>
      e._tag === tag && e.at === at && e.piece === piece && e.step === step,
  )

/** The steps of piece `piece` of the spawn at `at` that an edit removes. */
const piecesRemoved = (
  edits: readonly PlanEdit[],
  at: number,
  piece: number,
): ReadonlySet<number> =>
  new Set(
    edits.flatMap((e) =>
      e._tag === "RemovePieceStep" && e.at === at && e.piece === piece ? [e.step] : [],
    ),
  )

const removedIn = (edits: readonly PlanEdit[]): ReadonlySet<number> =>
  new Set(edits.flatMap((e) => (e._tag === "Remove" ? [e.at] : [])))

/** The last edit of one kind at one position — a later press replaces an earlier one. */
const lastAt = <T extends PlanEdit["_tag"]>(
  edits: readonly PlanEdit[],
  at: number,
  tag: T,
): Extract<PlanEdit, { readonly _tag: T }> | undefined =>
  edits.findLast((e): e is Extract<PlanEdit, { readonly _tag: T }> => e._tag === tag && e.at === at)

/** An agent turn, as opposed to a spawn or the composer's own run. */
const isTurn = (s: Step): s is AgentStep => !isSpawn(s) && !isCompose(s)

/** The entry with its agent swapped, where an edit swaps it — what its new key is read off. */
const swapped = (step: Step, at: number, edits: readonly PlanEdit[]): Step => {
  const swap = lastAt(edits, at, "SwapAgent")
  return swap === undefined || !isTurn(step) ? step : { ...step, agent: swap.agent }
}

/**
 * The plan as approved: the proposal from `from` on, with the edits laid over it.
 *
 * `from` is the first entry the proposal wrote — every entry before it ran, and no edit
 * reaches one. A removed entry is dropped and the ones after it move up, and a swapped
 * entry's key takes its new agent's name, so every `continues` naming a moved or renamed
 * entry is re-pointed at its new key and one naming a removed entry is cleared, which
 * starts that step in a new session. Missing one would fail silently: a key naming no
 * entry is a fresh session, not an error. The composer's own values and the person's go
 * through the same map, because both were written against the plan as proposed.
 */
export const editedPlan = (p: Plan, from: number, edits: readonly PlanEdit[]): Plan => {
  const removed = removedIn(edits)
  const moved = new Map<string, string | undefined>()
  let next = from
  for (const [i, step] of p.steps.entries()) {
    if (i < from) continue
    const kept = removed.has(i) ? undefined : artifactKey(swapped(step, i, edits), next)
    moved.set(artifactKey(step, i), kept)
    if (!removed.has(i)) next += 1
  }
  // A key the map does not hold names an entry that ran, which never moves — or names
  // nothing, which starts the step fresh either way.
  const repoint = (key: string | undefined): string | undefined =>
    key === undefined || !moved.has(key) ? key : moved.get(key)
  const tail = p.steps
    .slice(from)
    .flatMap((step, j) => (removed.has(from + j) ? [] : [edited(step, from + j, edits, repoint)]))
  return { ...p, steps: nonEmpty([...p.steps.slice(0, from), ...tail]) ?? p.steps }
}

/**
 * One entry with its own edits applied and its `continues` re-pointed.
 *
 * A swap drops the entry's own model and a pick sets one, so where one approval does both
 * the pick stands whatever order they were sent in: the person picked it for the agent
 * the step ends up with, since a client drops a pick the moment the agent changes.
 */
const edited = (
  step: Step,
  at: number,
  edits: readonly PlanEdit[],
  repoint: (key: string | undefined) => string | undefined,
): Step => {
  const reworded = lastAt(edits, at, "Reword")
  const worded = reworded === undefined ? step : { ...step, instruction: reworded.instruction }
  if (isSpawn(worded)) {
    return { ...worded, children: Arr.map(worded.children, (c, j) => editedPiece(c, at, j, edits)) }
  }
  if (!isTurn(worded)) return worded
  const {
    continues: proposed,
    wait_until: waitUntil,
    wait_for: waitFor,
    model: own,
    ...rest
  } = worded
  const chosen = lastAt(edits, at, "Continue")
  const continues = repoint(chosen === undefined ? proposed : chosen.key)
  const cleared = lastAt(edits, at, "ClearWait") !== undefined
  const swap = lastAt(edits, at, "SwapAgent")
  const model = lastAt(edits, at, "PickModel")?.model ?? (swap === undefined ? own : undefined)
  return {
    ...rest,
    ...(swap === undefined ? {} : { agent: swap.agent }),
    ...(continues === undefined ? {} : { continues }),
    ...(cleared || waitUntil === undefined ? {} : { wait_until: waitUntil }),
    ...(cleared || waitFor === undefined ? {} : { wait_for: waitFor }),
    ...(model === undefined ? {} : { model }),
  }
}

/**
 * One piece with its steps' edits applied, on `edited`'s terms for a swap and a pick. A
 * piece no edit names is returned as it was written, whichever arm that was, so a log
 * with no piece edits replays to the plan it always did.
 */
const editedPiece = (c: Child, at: number, piece: number, edits: readonly PlanEdit[]): Child => {
  if (!edits.some((e) => "piece" in e && e.at === at && e.piece === piece)) return c
  const removed = piecesRemoved(edits, at, piece)
  const steps = childSteps(c)
  const kept = steps.flatMap((s, k): ChildStep[] => {
    if (removed.has(k)) return []
    const { model: own, ...rest } = s
    const swap = lastOn(edits, at, piece, k, "SwapPieceAgent")
    const model =
      lastOn(edits, at, piece, k, "PickPieceModel")?.model ?? (swap === undefined ? own : undefined)
    return [
      {
        ...rest,
        instruction: lastOn(edits, at, piece, k, "RewordPiece")?.instruction ?? s.instruction,
        ...(swap === undefined ? {} : { agent: swap.agent }),
        ...(model === undefined ? {} : { model }),
      },
    ]
  })
  // `editRefusal` refuses emptying a piece, so the fallback is never reached.
  const [first, ...rest] = kept
  return { steps: first === undefined ? steps : [first, ...rest] }
}

/**
 * Why these edits cannot be laid over this plan, in a sentence, or `undefined` where they
 * can. Only what an edit alone can get wrong — the plan they leave is held to the
 * composer's own rules separately, by the decode its proposal passed, and that is where a
 * swap to an agent no plan may name is refused. `models` is `models.yaml`'s list, which
 * a pick is one of.
 */
export const editRefusal = (
  p: Plan,
  from: number,
  edits: readonly PlanEdit[],
  models: readonly string[],
): string | undefined => {
  const removed = removedIn(edits)
  for (const e of edits) {
    const step = p.steps[e.at]
    if (e.at < from || step === undefined) {
      return `an edit names position ${String(e.at)}, which is not a step of this proposal`
    }
    const refused = refusalOf({ p, edits, removed, models }, e, step)
    if (refused !== undefined) return refused
  }
  return p.steps.length - from === removed.size
    ? "every step of the plan is removed, so it would do no work: chat to the composer instead"
    : undefined
}

/** What every edit's refusal is read against. */
interface Against {
  readonly p: Plan
  readonly edits: readonly PlanEdit[]
  readonly removed: ReadonlySet<number>
  readonly models: readonly string[]
}

const refusalOf = (on: Against, e: PlanEdit, step: Step): string | undefined => {
  const name = artifactKey(step, e.at)
  if ("piece" in e) return pieceRefusal(on, e, step, name)
  switch (e._tag) {
    case "Remove":
      return undefined
    case "Reword":
      return e.instruction.trim() === "" ? `${name}'s instruction may not be blank` : undefined
    case "ClearWait":
      return waitUntilOf(step) === undefined && waitForOf(step) === undefined
        ? `${name} has no wait to remove`
        : undefined
    case "Continue":
      if (!isTurn(step)) {
        return `${name} is not an agent step, so it has no conversation to continue`
      }
      return e.key === undefined || earlierTurn(on.p, e.at, e.key, on.removed)
        ? undefined
        : `${name} cannot continue \`${e.key}\`: it is not an earlier agent step still in this plan`
    case "SwapAgent":
      return isTurn(step) ? undefined : `${name} is not an agent step, so it has no agent to swap`
    case "PickModel":
      return modelRefusal(on, e, step, name)
  }
}

/**
 * What a piece edit alone can get wrong: naming a step no piece of this spawn has, a blank
 * instruction, a model `models.yaml` does not list, or removing the last step a piece
 * keeps — which would remove the piece, and no piece is removed here.
 */
const pieceRefusal = (on: Against, e: PieceEdit, step: Step, name: string): string | undefined => {
  if (!isSpawn(step)) return `${name} is not a spawn, so it has no pieces to edit`
  const piece = step.children[e.piece]
  const steps = piece === undefined ? [] : childSteps(piece)
  const mark = `step ${String(e.step + 1)} of piece ${String(e.piece + 1)} of ${name}`
  if (steps[e.step] === undefined) return `an edit names ${mark}, which this proposal does not have`
  switch (e._tag) {
    case "RemovePieceStep":
      return piecesRemoved(on.edits, e.at, e.piece).size === steps.length
        ? `piece ${String(e.piece + 1)} of ${name} would have no steps left: keep at least one, since a whole piece cannot be removed here`
        : undefined
    case "RewordPiece":
      return e.instruction.trim() === "" ? `${mark}'s instruction may not be blank` : undefined
    case "SwapPieceAgent":
      return undefined
    case "PickPieceModel":
      return on.models.includes(e.model)
        ? undefined
        : `no model \`${e.model}\` is listed in models.yaml: one of ${on.models.join(", ")}`
  }
}

/**
 * A pick is refused where the step runs on no model of its own. A step continuing an
 * earlier one's conversation runs on the model that conversation was started with — a
 * session is never resumed under another — so a pick there would be recorded and never
 * run. The `continues` asked is the one the edits leave, so choosing a new session in the
 * same approval is what frees the pick.
 */
const modelRefusal = (
  on: Against,
  e: Extract<PlanEdit, { readonly _tag: "PickModel" }>,
  step: Step,
  name: string,
): string | undefined => {
  if (!isTurn(step)) return `${name} is not an agent step, so it runs on no model to pick`
  if (!on.models.includes(e.model)) {
    return `no model \`${e.model}\` is listed in models.yaml: one of ${on.models.join(", ")}`
  }
  const chosen = lastAt(on.edits, e.at, "Continue")
  const continues = chosen === undefined ? step.continues : chosen.key
  return continues !== undefined && earlierTurn(on.p, e.at, continues, on.removed)
    ? `${name} continues \`${continues}\`, so it runs on that conversation's model: start it in a new session to pick another`
    : undefined
}

/**
 * The entry without a model a person picked — what the composer's decode reads an edited
 * plan as. That decode refuses a `model` because the composer may not write one; a pick
 * made at the gate is `editRefusal`'s to judge instead.
 */
export const unpicked = (step: Step): Step =>
  isTurn(step)
    ? Struct.omit(step, "model")
    : isSpawn(step)
      ? { ...step, children: Arr.map(step.children, unpickedPiece) }
      : step

/** A piece without the models picked for its steps, in the arm it was written in. */
const unpickedPiece = (c: Child): Child =>
  "steps" in c
    ? { steps: Arr.map(c.steps, (s) => Struct.omit(s, "model")) }
    : Struct.omit(c, "model")

/** Does `key` name an agent step before `at` that the edits keep? */
const earlierTurn = (p: Plan, at: number, key: string, removed: ReadonlySet<number>): boolean =>
  p.steps.slice(0, at).some((s, k) => isTurn(s) && !removed.has(k) && artifactKey(s, k) === key)
