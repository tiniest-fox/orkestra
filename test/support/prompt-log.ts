// Emit the exact text every agent saw, one file per test case.
//
// The point is reviewability: these files only change when a PROMPT changes, so
// reading one after a run shows what an agent is actually told — which is
// otherwise invisible, because assertions check a few substrings while the model
// reads the whole thing. They are git-ignored: a prompt edit used to rewrite the
// same text across hundreds of committed copies, and nobody read those diffs.
//
// Not assertions. Nothing fails because a log changed; they are for humans.
//
// WRITTEN ONLY WHEN `ORKESTRA_PROMPT_LOGS` IS SET. A write into the checkout is a file a
// later run reads and a later checkout lacks, so the recording hook behind `fingerprint:`
// marks every flow test that writes one unsure and runs it every time. The transcript is
// still built on every run, so a fault in this file fails a test either way.
//
// ORDERED BY WORKTREE, NOT BY ARRIVAL, and the ids renumbered to match — because
// a spawn's children run at once. `FixedIds` hands out session ids as turns start,
// so the child that got there first took `…0001` and the flat log recorded it
// first; which child that was varied per run, and every spawn transcript churned
// on an ordinary test run. That is the one thing this file exists to prevent: a
// change here has to mean a prompt changed, and it cannot say that if it also
// fires when nothing did. Sorting on `cwd` is what makes it stable, since a child's
// worktree is its identity and does not depend on who woke up first.
//
// It costs strict chronology across worktrees: a parent that resumes after its
// children land is written above them, with its own earlier turns. Within one
// worktree the order is still exactly what happened, and a run with a single
// worktree — every test that is not a spawn — is untouched, which is why the
// renumbering leaves those files byte-identical.
//
// XML, because the old banner format had no reliable boundary: a prompt that
// contains a `───` rule or a fenced block reads exactly like the frame around it,
// and finding where one turn ends means counting. Tags close, and every header
// fact is an attribute you can grep or select.
// `<invocation>` rather than `<step>`: the composer is not a step, and `Step` is a
// domain word already spoken for.
//
// The system prompts are here too, as `<system id="s1">` blocks at the top, one
// per DISTINCT text, with each `<invocation>` naming the one it got. They used to
// be a single hoisted block, on the premise that every turn of a run shared one —
// which died when the output contract moved onto the session: a step's contract
// carries its declared sections and the stages it may route back to, so a run
// with a composer and two steps now has four different system prompts. Inlining
// each one per invocation would bury the prompts under repeated copies of a text
// that changes once per session, so they are named and referenced instead. First
// appearance order, which is deterministic for the same reason the rest is.
//
// Content is CDATA, never entity-escaped. These files exist to be read as text,
// and the prompts are full of `<title>` and `"<markdown>"` — turning those into
// `&lt;title&gt;` would make the thing unreadable in exchange for nothing, since
// CDATA parses.

import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { basename, dirname, join } from "node:path"
import { expect, onTestFinished } from "vitest"
import type { SessionRequest } from "../../src/agent/types/session.js"
import type { AgentLog } from "./scripted-agent.js"

const LOG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "e2e", "logs")

const WANTED = process.env["ORKESTRA_PROMPT_LOGS"] !== undefined

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 120)

// -- XML ---------------------------------------------------------------------

/** Attribute values are escaped; content is not — see the note at the top. */
const escapeAttr = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

/** `undefined` drops the attribute, so absence reads as absence rather than "". */
const attrs = (pairs: readonly (readonly [string, string | undefined])[]): string =>
  pairs.flatMap(([k, v]) => (v === undefined ? [] : [` ${k}="${escapeAttr(v)}"`])).join("")

/**
 * Verbatim content, on its own lines so the boundaries are unmistakable.
 *
 * The replacement is the standard escape for the one sequence CDATA cannot hold:
 * close the section, emit the `>` from a new one. No prompt contains it today,
 * and a file that silently stopped parsing later would be worse than the line.
 */
const cdata = (text: string): string =>
  `<![CDATA[\n${text.replaceAll("]]>", "]]]]><![CDATA[>")}\n]]>`

// -- one invocation ----------------------------------------------------------

/**
 * What kind of turn this was, inferred from the prompt rather than tracked: the
 * fake sits below the engine and never learns which command called it. The
 * markers are the same ones the turn matchers use.
 */
const roleOf = (
  req: SessionRequest,
): { readonly type: string; readonly artifact: string | undefined } => {
  if (req.prompt.includes("Compose a pipeline")) return { type: "composer", artifact: undefined }
  const named = /artifact named `([^`]+)`/.exec(req.prompt)
  if (named?.[1] !== undefined) return { type: "step", artifact: named[1] }
  if (req.prompt.includes("could not be used")) return { type: "retry", artifact: undefined }
  return { type: "resume", artifact: undefined }
}

/**
 * Every distinct system prompt in the run, in first-appearance order, keyed
 * `s1`, `s2`, …
 *
 * A Map on the text itself: two turns of one session get the same id, and two
 * sessions that happen to be framed identically — two steps with no declared
 * shape and nothing before them — share one too. That is the honest answer, since
 * the agent cannot tell them apart either.
 */
const systemPrompts = (
  requests: readonly SessionRequest[],
  order: readonly number[],
): ReadonlyMap<string, string> => {
  const ids = new Map<string, string>()
  for (const i of order) {
    const text = briefText(requests[i])
    if (text !== undefined && !ids.has(text)) ids.set(text, `s${ids.size + 1}`)
  }
  return ids
}

/** The brief as one text, which is how a CLI with a session prompt is handed it. */
const briefText = (req: SessionRequest | undefined): string | undefined =>
  req?.brief === undefined ? undefined : `${req.brief.core}\n\n${req.brief.contract}`

/**
 * Arrival indices, grouped by worktree — see the note at the top.
 *
 * A stable sort on `cwd` alone: within one worktree the arrival order is what
 * happened and is kept, and a run with one worktree comes back unchanged.
 */
const byWorktree = (requests: readonly SessionRequest[]): readonly number[] =>
  requests
    .map((req, i) => ({ cwd: req.cwd, i }))
    .sort((a, b) => (a.cwd === b.cwd ? a.i - b.i : a.cwd < b.cwd ? -1 : 1))
    .map(({ i }) => i)

/**
 * Every session id in the run, renumbered by first appearance in the order above.
 *
 * The ids are `FixedIds`' counter, so they carry no meaning beyond telling two
 * sessions apart — and the number a concurrent child happened to draw is the
 * churn this file is fixing. Renumbering keeps the same synthetic shape, so what
 * a reader learns from the attribute is unchanged: same id, same session; a
 * `resumes` pointing at one above it, a continued conversation.
 */
const sessionIds = (
  requests: readonly SessionRequest[],
  order: readonly number[],
): ReadonlyMap<string, string> => {
  const ids = new Map<string, string>()
  for (const i of order) {
    const req = requests[i]
    if (req !== undefined && !ids.has(req.sessionId)) {
      ids.set(req.sessionId, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, "0")}`)
    }
  }
  return ids
}

/** `system` is the id of the block above, not the text — see the note at the top. */
const invocation = (
  req: SessionRequest,
  reply: string,
  matched: string,
  n: number,
  system: string | undefined,
  sessions: ReadonlyMap<string, string>,
): string => {
  const role = roleOf(req)
  const open = attrs([
    ["n", String(n)],
    ["type", role.type],
    ["artifact", role.artifact],
    ["model", req.model],
    ["permission", req.permission],
    // Which `<system>` block above framed this turn. Two invocations differing
    // here are two differently-framed sessions, which is worth seeing.
    ["system", system],
    ["session", sessions.get(req.sessionId) ?? req.sessionId],
    // Present only on a resume, which is the whole point of looking: a turn that
    // should have continued a conversation and started a new one says so here.
    // Renumbered with the rest, or the pointer would name an id nothing carries.
    [
      "resumes",
      req.resumeFrom === undefined ? undefined : (sessions.get(req.resumeFrom) ?? req.resumeFrom),
    ],
    // Only when it is narrowed. A `write` turn is the unremarkable case, and a
    // field present on every invocation stops being something the eye catches.
    ["tools", req.toolAccess === "write" ? undefined : req.toolAccess],
  ])
  return [
    `<invocation${open}>`,
    `<message role="orkestra" type="prompt">${cdata(req.prompt)}</message>`,
    `<message${attrs([
      ["role", "agent"],
      ["type", "reply"],
      ["turn", matched],
    ])}>${cdata(reply)}</message>`,
    `</invocation>`,
    ``,
  ].join("\n")
}

/** Writes the transcript of the test that opened it — see `openPromptLog`. */
export type PromptLog = (log: AgentLog) => void

/**
 * Opens the transcript for the test running now. Called by runFlow at the top of
 * the test, so no test has to remember to do it.
 *
 * THE TEST'S IDENTITY IS TAKEN HERE, NOT AT THE WRITE, and the write is refused
 * once the test has finished without it. Both halves are about the same event: a
 * loaded machine times a flow out at 5s, vitest gives up on the test and moves
 * on, and the abandoned Effect finishes minutes later with a log of however far
 * it got. Reading `currentTestName` then names whichever test is running by that
 * point, and writing at all replaces a good transcript with a partial one.
 * A slow run is a red test; it must not also be a corrupted log.
 *
 * NOTHING IS DELETED, and no directory is cleared: a transcript is only ever
 * replaced by the test that owns it, while that test is still running. So a test
 * vitest timed out leaves its last transcript exactly as it found it. Emptying
 * the file's directory ahead of its first write would instead wipe the sibling
 * transcripts every time a run is filtered to one test with `-t`.
 *
 * A test that fails an assertion still writes: that path runs while the test is
 * live, and a failing test is exactly when somebody wants to read what the agent
 * was shown.
 *
 * The cost is that renaming or deleting a test leaves the old slug behind, and
 * because the directory is git-ignored nothing shows it. Orphans accumulate
 * silently; `git clean -xdf test/e2e/logs` before a full run is what gives a
 * directory holding only current tests.
 */
export const openPromptLog = (): PromptLog => {
  const state = expect.getState()
  const testName = state.currentTestName ?? "unknown-test"
  const file = state.testPath === undefined ? "unknown" : basename(state.testPath, ".test.ts")

  let live = true
  onTestFinished(() => {
    live = false
  })

  return (log) => {
    if (live) writeTranscript(join(LOG_ROOT, file), testName, log)
  }
}

const writeTranscript = (dir: string, testName: string, log: AgentLog): void => {
  const order = byWorktree(log.requests)
  const systems = systemPrompts(log.requests, order)
  const sessions = sessionIds(log.requests, order)
  const body = [
    `<transcript${attrs([
      ["test", testName],
      ["invocations", String(log.requests.length)],
      ["systems", String(systems.size)],
    ])}>`,
    `<!-- Generated by the test run — do not edit. -->`,
    ``,
    ...[...systems].flatMap(([text, id]) => [`<system id="${id}">${cdata(text)}</system>`, ``]),
    ...order.flatMap((i, n) => {
      const req = log.requests[i]
      return req === undefined
        ? []
        : [
            invocation(
              req,
              log.replies[i] ?? "(none)",
              log.matched[i] ?? "?",
              n + 1,
              systems.get(briefText(req) ?? ""),
              sessions,
            ),
          ]
    }),
    `</transcript>`,
    ``,
  ].join("\n")

  // Temp file then rename, the same guarantee `runs-file.ts` needs: a worker
  // killed mid-write cannot leave the transcript truncated, because the
  // half-written bytes are never at the path a reader opens.
  if (!WANTED) return
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${slug(testName)}.xml`)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, body)
  renameSync(tmp, path)
}
