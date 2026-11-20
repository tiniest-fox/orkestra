/**
 * A turn: what the agent did, what it filed, and why it ran.
 *
 * `Turn`, `Delegation`, `Filed`, `Why` and `CheckRun` are the client's own reading of a
 * transcript, a log and the daemon's memory of a run — `turns.ts`, `filed.ts` and
 * `check.ts` compute them — so no props type can describe one, which blocks `TurnsView`,
 * `TurnSection`, `SubagentGroup`, `ActivityRow`, `ActivityGroup`, `GateStrip` and
 * `GateFace`.
 *
 * **The transcript entries are the interesting axis.** `ActivityRow` draws one entry and
 * branches on its `_tag`, so a single fixture would show an eighth of it; every tag has one
 * here. `ActivityGroup` takes the array, and gets them all at once.
 */

import type { TranscriptEntryDto } from "../../../api/types"
import {
  makeApiRetry,
  makeNote,
  makeReask,
  makeSession,
  makeSpawned,
  makeSubagent,
  makeSubagentResult,
  makeText,
  makeTool,
} from "../../../fixtures"
import type { Delegation } from "../../../format/transcriptRows"
import type { Turn } from "./turns"
import type { CheckRun } from "../checks/check"
import type { Filed, Why } from "../filed"
import { artifact, questions } from "./output.fixtures"

/* ------------------------------------------------------- one entry of a transcript */

export const spawned = makeSpawned({ pid: 48213 })
export const session = makeSession({ id: "s-1" })
export const read = makeTool({ name: "Read", kind: "Read", detail: "client/src/api/types.ts" })
export const bash = makeTool({ name: "Bash", kind: "Bash", detail: "pnpm verify" })
export const edit = makeTool({ name: "Edit", kind: "Edit", detail: "src/lib/catalogue.ts" })
export const said = makeText({
  text: "Reading the loader to see where the alias resolves, then splitting the union before deriving.",
})
export const thinking = makeNote({ text: "Thinking" })
/** A pause carrying the model's own summary, as a Codex turn writes one. */
export const thought = makeNote({ text: "Thinking: Planning file size counting method" })
export const reask = makeReask({ reason: "the answer was not valid JSON" })
/** The provider retrying, which is drawn on the pause above it rather than on a row. */
export const retried = makeApiRetry({ attempt: 2, of: 5, status: "429", waitedMs: 1200 })
/** The one with no status, which is a transport failure rather than an HTTP one. */
export const retriedQuietly = makeApiRetry({ attempt: 1, of: 5, status: undefined })
export const subagent = makeSubagent({
  call: "call-1",
  agentType: "reviewer",
  description: "check the derived panel",
  prompt: "Read the panel the walk produced and say where it disagrees with the props type.",
})
export const subagentDone = makeSubagentResult({
  call: "call-1",
  ok: true,
  summary: "Two props were classified as callbacks and are components.",
})
export const subagentFailed = makeSubagentResult({
  call: "call-2",
  ok: false,
  summary: "The reviewer ran out of context.",
})

/** Every tag, in the order a real turn tends to produce them. */
export const entries: readonly TranscriptEntryDto[] = [
  spawned,
  session,
  said,
  thinking,
  retried,
  read,
  edit,
  bash,
  reask,
  subagent,
  subagentDone,
]

/* ------------------------------------------------------------------- a whole turn */

export const turn: Turn = { session: "s-1", at: 1, entries }

/** The composer's turn, which is `at: "composer"` rather than a step number. */
export const composerTurn: Turn = {
  session: "s-composer",
  at: "composer",
  entries: [session, said, thinking],
}

/** A turn that produced nothing but a spawn — the short case a list has to not look broken on. */
export const quietTurn: Turn = { session: "s-2", at: 2, entries: [spawned, session] }

export const turns: readonly Turn[] = [composerTurn, turn, quietTurn]

/* ------------------------------------------------------------------ a delegation */

export const delegation: Delegation = {
  head: subagent,
  result: subagentDone,
  ok: true,
  backgrounded: false,
  entries: [said, read, bash],
}

export const failedDelegation: Delegation = {
  head: makeSubagent({
    call: "call-2",
    agentType: "reviewer",
    description: "check the derived panel",
  }),
  result: subagentFailed,
  ok: false,
  backgrounded: false,
  entries: [said],
}

/** Still running: no result yet, which is what `ok: undefined` means. */
export const openDelegation: Delegation = {
  head: makeSubagent({ call: "call-3", agentType: "builder", description: "port the drawer" }),
  result: undefined,
  ok: undefined,
  backgrounded: true,
  entries: [read],
}

/**
 * The one the header's fallback exists for: no agent type and no description, which is
 * what a task the CLI names neither way arrives as. It reads `background task`.
 */
export const unnamedDelegation: Delegation = {
  head: makeSubagent({ call: "call-4" }),
  result: undefined,
  ok: undefined,
  backgrounded: true,
  entries: [],
}

/* --------------------------------------------------------- what a turn filed, and why */

export const filed: Filed = { output: artifact, nth: 1, of: 2 }
export const filedQuestions: Filed = { output: questions, nth: 2, of: 2 }

export const whyChecked: Why = { _tag: "CheckFailed", name: "verify" }
export const whySaid: Why = {
  _tag: "Said",
  text: "the branch names are still setting the measure rather than being cut to it",
  attachments: [],
}
export const whyRestarted: Why = { _tag: "Restarted" }

/**
 * One run of a check, as `TurnsView` builds it out of the log and the daemon's memory.
 *
 * Three, because the three phases are what the card's strip and its Gate face are for and
 * a props type says only `CheckRun`.
 */
export const checkFailed: CheckRun = {
  name: "verify",
  command: "bash .orkestra/checks/verify.sh",
  phase: "failed",
  output:
    "knip: 2 unused exports\n  makeDocument  client/src/fixtures.ts\n  makeDecided   client/src/fixtures.ts",
  limit: 300,
  startedAt: undefined,
  took: undefined,
  exitCode: 1,
  attempts: 2,
  place: undefined,
}

export const checkRunning: CheckRun = {
  ...checkFailed,
  phase: "running",
  output: "> orkestra@0.1.0 verify\nChecked 412 files in 180ms. No fixes applied.\n",
  startedAt: 1_786_400_000_000,
  exitCode: undefined,
  attempts: 0,
}

export const checkPassed: CheckRun = {
  ...checkRunning,
  phase: "passed",
  took: 161,
}

/** Which sessions have already been read, so a turn can be drawn as seen or not. */
export const spoken: ReadonlySet<string> = new Set(["s-composer", "s-1"])
