// The trak as files: what a turn can open, and what the prompt lists paths to.
//
// Pure, like every other file here — it says what should be on disk, and
// `runtime.ts` puts it there through the `Workspace` port. The log stays the
// source of truth and this is a view of it, rebuilt before every spawn.

import { Array as Arr } from "effect"
import { artifactText, type Document } from "./outputs/artifact.js"
import {
  type Decided,
  decidedOf,
  decisionsText,
  identified,
  type Identified,
  type Recorded,
  supersededText,
} from "./outputs/decided.js"
import {
  artifactKey,
  childKey,
  inPiece,
  isSpawn,
  splitText,
  type Step,
} from "./outputs/proposal.js"
import { splitWithSiblings, type Trak } from "./trak.js"

/**
 * Where the projection goes, relative to the worktree root — which is every
 * agent's cwd, so a plain relative path works from a turn.
 *
 * Dot-prefixed, beside `.database` and `.worktrees`: policy without the dot,
 * runtime data with it. Kept out of git by `Vcs.ensureIgnored`, in the repository's
 * common `info/exclude`, which every linked worktree reads.
 */
export const TRAK_DIR = ".orkestra/.trak"

/**
 * Where a child's inherited artifacts go, under `TRAK_DIR`.
 *
 * A subdirectory rather than the top level because the keys collide: a child's
 * one-step plan files under `0-<agent>`, and a spawn of four `review` lenses off a
 * parent whose step 0 was `review` would have the inherited document and the
 * child's own claiming one name. It also reads as what it is — the work this is a
 * piece of, kept apart from the work this trak did.
 */
const FROM_PARENT = "from-parent"

/**
 * The key an inherited document is listed under, which is also the name a
 * `supersedes` entry uses for one: the file's own name under `TRAK_DIR`, so an agent
 * writes down what it opened rather than a key it has to derive.
 */
export const inheritedKey = (key: string): string => `${FROM_PARENT}/${key}`

/**
 * A parent's entries as a child is born holding them: one that supersedes a
 * document names that document by the key the child files it under, so the note
 * follows the document down. The join undoes this on the way back up — `parentKeyOf`.
 *
 * A requirement id is left alone: the child holds the whole list in the parent's
 * order, so every inherited entry has the same id on both traks. Told apart by
 * membership rather than by shape, which is why this takes the list and not one
 * entry — a document key can end in a dot and a number too.
 */
export const inheritedDecisions = (decisions: readonly Recorded[]): readonly Recorded[] => {
  const ids = new Set(identified(decisions).map((d) => d.id))
  return decisions.map((d) => renaming(d, (name) => (ids.has(name) ? name : inheritedKey(name))))
}

/** The entry with every name it supersedes put through `f`, or the entry itself when it names none. */
const renaming = <D extends Decided | Recorded>(d: D, f: (name: string) => string): D =>
  d.supersedes === undefined ? d : { ...d, supersedes: Arr.map(d.supersedes, f) }

/**
 * A child's own entries as its parent will record them: what the child filed since
 * `from`, with each `supersedes` naming one of the child's own entries rewritten to
 * the id the parent gives it. Everything else it names is left for the join to
 * re-key.
 *
 * The parent stamps a piece's entries with the piece's key in the child's own
 * order — at the join, and on every refile after it — so the id it gives the
 * child's *k*th own entry is `<piece>.<k>`, whatever the parent has recorded so
 * far. The map is built over every own entry from `inherited` on, not over the
 * slice going up on this event: a refile names entries that landed already, and
 * counting from the slice would give those the wrong number or none. This is the
 * one place that knows both the child's ids and the parent's. Left as written, a
 * child's `0-build.2` would fold the parent's own `0-build.2` on a parent whose
 * first step was also `build`. `piece` is absent for a parent whose plan no longer
 * holds the spawn, and then the names go up as written.
 */
export const handedDecisions = (
  child: Trak,
  inherited: number,
  from: number,
  piece: string | undefined,
): readonly Decided[] => {
  const own = identified(child.decisions).slice(inherited)
  const ids = new Map(own.map((d, i) => [d.id, `${piece}.${i + 1}`]))
  return own
    .slice(from - inherited)
    .map((d) =>
      piece === undefined ? decidedOf(d) : renaming(decidedOf(d), (name) => ids.get(name) ?? name),
    )
}

/** What a spawn position's piece is called on the parent, or `undefined` where the plan no longer holds the spawn. */
export const pieceOn = (
  parent: Trak,
  at: { readonly step: number; readonly child: number },
): string | undefined => {
  const step = parent.plan?.steps[at.step]
  const c = step !== undefined && isSpawn(step) ? step.children[at.child] : undefined
  return c === undefined ? undefined : childKey(at.step, at.child, c)
}

/**
 * The parent's own key behind an inherited one, and `undefined` for a key that is
 * this trak's. What the join uses to land a child's `supersedes` on the document the
 * parent filed — `from-parent/1-investigate` on the child is `1-investigate` here.
 */
export const parentKeyOf = (key: string): string | undefined =>
  key.startsWith(`${FROM_PARENT}/`) ? key.slice(FROM_PARENT.length + 1) : undefined

/**
 * `trak.md` — the one document every turn needs. The request and the requirements
 * since, in one file, which is the whole of *request plus requirements is the
 * current intent* made into something you can open.
 *
 * The title once the composer has written one; the composer's own first turn
 * correctly reads a titleless file, because it is about to write that line.
 *
 * `How this work was asked for` is the heading the prompts put the same message
 * under — one name for one thing. They fold the requirements under it too, since a
 * prompt is read start to finish; here the two stay separate headings, because this
 * is a file somebody navigates. `Requirements` is the word in both.
 *
 * **The heading is the name of the channel a step files into**, and both are
 * `Trak.decisions` inside the engine — see `decided.ts` for why the stored name
 * cannot move. What an agent writes and what it reads back have to be one word.
 *
 * **The heading is absent when there are none.** Not *"No requirements."* — a line
 * every turn reads and nothing acts on is the beginning of boilerplate blindness,
 * and its absence says the same thing.
 *
 * **The pieces sit between the two**, because a child's request is the parent's
 * whole request and the partition is what says which part of it is this trak's — so
 * it is read with the request rather than after the requirements. Data and no prose,
 * like everything else here: who was asked for what, in the words the parent's
 * composer used. What an agent should *do* about it is prompt text and lives in the
 * step and composer templates. Absent unless there is another piece — see
 * `splitWithSiblings`.
 */
const trakDocument = (trak: Trak): string => {
  const title = trak.plan?.title
  const split = splitWithSiblings(trak)
  const pieces =
    split === undefined
      ? ""
      : `\n## The pieces this was split into\n\n${splitText(split, trak.parent?.child)}\n`
  const requirements =
    trak.decisions.length === 0
      ? ""
      : `\n## Requirements\n\n${decisionsText(identified(trak.decisions))}\n`
  return `${title === undefined ? "" : `# ${title}\n\n`}## How this work was asked for\n\n${trak.description.trim()}\n${pieces}${requirements}`
}

/**
 * The artifacts a turn at `step` may see: the ones filed by a step before it,
 * in plan order. `undefined` — the composer, which has no position — sees all.
 *
 * Ordered by the plan rather than by the map, and filtered by position rather
 * than by presence, because those are the same thing only until the plan
 * changes. A new plan replaces the steps from its join onward, so a
 * document filed by a step that is no longer there is harmless history in the
 * log and a trap in a directory an agent has been told to browse — walking the
 * plan is what makes it invisible without deleting it.
 *
 * **A spawn position emits every document its children filed**, not one per
 * position: there is no single document behind it, and the step after a spawn is
 * meant to read them all. Which is also the gap this phase does not close —
 * nothing here reconciles N documents, and the instruction the composer writes is
 * what asks for it.
 */
export const visibleArtifacts = (
  trak: Trak,
  step: number | undefined,
): readonly (readonly [string, Document])[] => {
  const steps = trak.plan?.steps ?? []
  const found: (readonly [string, Document])[] = []
  for (const [i, s] of steps.entries()) {
    if (step !== undefined && i >= step) break
    found.push(...filedAt(trak, s, i))
  }
  return found
}

/**
 * What an entry filed: its one document, or — for a spawn — every document under
 * each of its pieces, piece by piece.
 *
 * A piece's documents are found by their prefix rather than by name, because their
 * names are the *child's* plan's and the parent cannot enumerate them; within one
 * piece they come back in the order the join wrote them, which is the child's plan
 * order.
 */
const filedAt = (trak: Trak, s: Step, i: number): readonly (readonly [string, Document])[] => {
  if (!isSpawn(s)) {
    const key = artifactKey(s, i)
    const doc = trak.artifacts.get(key)
    return doc === undefined ? [] : [[key, doc]]
  }
  return s.children.flatMap((c, j) => {
    const piece = childKey(i, j, c)
    return [...trak.artifacts].filter(([key]) => inPiece(piece, key))
  })
}

/** The path an artifact is projected to, as the prompt states it. */
export const artifactPath = (key: string): string => `${TRAK_DIR}/${key}.md`

/** The same, for a document this trak was born holding rather than filed. */
export const inheritedPath = (key: string): string => artifactPath(inheritedKey(key))

/**
 * Every name a turn at `step` may put in a `supersedes`: each document it can open,
 * own and inherited alike, under the name it is listed by, and the id of every
 * requirement recorded so far — folded ones included, since naming one twice is
 * harmless. What `StepOutputFor` holds the entry to, so one naming nothing is
 * re-prompted rather than filed.
 */
export const supersedable = (trak: Trak, step: number | undefined): readonly string[] => [
  ...trak.inherited.map(([key]) => inheritedKey(key)),
  ...visibleArtifacts(trak, step).map(([key]) => key),
  ...identified(trak.decisions).map((d) => d.id),
]

/**
 * A document as the file it is projected to: the note from every entry that
 * supersedes it, then its sections.
 *
 * The one renderer for a document on disk, live and archived — `projection` and
 * `recordFiles` both go through it, so the worktree and the corpus cannot disagree
 * about what a superseded document looks like. Above the first section rather than
 * in `trak.md` alone, because the reader this is for is the one who opened this
 * file and may never open that list.
 */
export const documentFile = (
  key: string,
  doc: Document,
  decisions: readonly Identified[],
): string => {
  const note = supersededText(decisions.filter((d) => d.supersedes?.includes(key) === true))
  return `${note === "" ? "" : `${note}\n\n`}${artifactText(doc)}\n`
}

/**
 * Everything under `TRAK_DIR`, keyed by filename.
 *
 * A listing reads as *what we are doing, then everything produced so far, in
 * order* — which is why the artifact filename is its key, and why the key is a
 * position rather than a slug.
 *
 * **Inherited documents are not filtered by position**, unlike the rest: they were
 * complete before this trak existed, and there is no position of this trak's they
 * could be before or after. So the composer and every step see the same set.
 */
export const projection = (trak: Trak, step: number | undefined): ReadonlyMap<string, string> => {
  const files = new Map<string, string>([["trak.md", trakDocument(trak)]])
  const decisions = identified(trak.decisions)
  for (const [key, doc] of trak.inherited) {
    files.set(`${inheritedKey(key)}.md`, documentFile(inheritedKey(key), doc, decisions))
  }
  for (const [key, doc] of visibleArtifacts(trak, step)) {
    files.set(`${key}.md`, documentFile(key, doc, decisions))
  }
  return files
}
