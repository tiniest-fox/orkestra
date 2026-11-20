/**
 * Tier 1: what a position filed and why it ran again, both projected off the log.
 *
 * The thing that could go wrong quietly here is attribution across positions — a check
 * that failed at step 2 explaining a second turn at step 3, or an artifact from an
 * earlier attempt showing as the live one. Both look plausible on screen, so they are
 * what is asserted.
 */

import { describe, expect, it } from "vitest"
import type { EventDto } from "../../api/types"
import {
  makeAbandoned,
  makeAgentReturned,
  makeCheckFailed,
  makeChecksCancelled,
  makeChecksPassed,
  makeComposerReturned,
  makeEffectFailed,
  makeEffectsRan,
  makeFilingAsked,
  makeHumanActed,
  makeRestarted,
  makeStopped,
  makeTurnFailed,
  makeWorkCommitted,
} from "../../fixtures"
import {
  composerAnswersIn,
  composerEndedIn,
  composerEnvelopesIn,
  effectsAt,
  endedAt,
  envelopesAt,
  filedAt,
  filedByTurn,
  lastFiledAt,
  settledByTurn,
  whyRan,
} from "./filed"

// Positional, because what every case here is about is which step filed what — the
// arguments are the subject and a named object at 44 call sites would bury it.

/** What an effect prints that exists nowhere else on the surface. */
const PR_URL = "https://example.invalid/pull/7"

const returned = (step: number, summary: string): EventDto =>
  makeAgentReturned({
    step,
    sessionId: `s-${step}-${summary}`,
    output: { type: "artifact", sections: { Summary: summary } },
  })

const failed = (step: number, name: string, output: string): EventDto =>
  makeCheckFailed({ step, name, output })

const said = (step: number, message: string): EventDto =>
  makeHumanActed({ step, action: { _tag: "Chat", message } })

const approved = (step: number): EventDto => makeHumanActed({ step })

/** A turn cut off with its engine. The step is what makes it that turn's ending. */
const restarted = (step: number): EventDto => makeRestarted({ step, sessionId: "s-cut" })

/** A turn a person killed. The same shape, and the same reason the step is on it. */
const stopped = (step: number): EventDto => makeStopped({ step, sessionId: "s-cut" })

/** A position that asked, rather than filed. One question, named so the pairing is legible. */
const asked = (step: number, question: string): EventDto =>
  makeAgentReturned({
    step,
    sessionId: `s-${step}-${question}`,
    output: { type: "questions", questions: [{ question, options: [] }] },
  })

/** The composer asking, which carries no position at all. */
const composerAsked = (session: string, question: string): EventDto =>
  makeComposerReturned({
    sessionId: session,
    output: { type: "questions", questions: [{ question, options: [] }] },
  })

/**
 * What a person sent back. **The `step` is deliberately wrong-looking**: the server writes
 * a nominal `0` at a composer gate, so every case here passes a position that would
 * misattribute the answers if anything keyed on it.
 */
const answered = (step: number, ...answers: string[]): EventDto =>
  makeHumanActed({ step, action: { _tag: "AnswerQuestions", answers } })

/** The same send, with the free-form note that belongs to none of the answers. */
const noted = (step: number, note: string, ...answers: string[]): EventDto =>
  makeHumanActed({ step, action: { _tag: "AnswerQuestions", answers, note } })

/** A position that asked to run a command, rather than filed. */
const permission = (step: number, command: string): EventDto =>
  makeAgentReturned({
    step,
    sessionId: `s-${step}-${command}`,
    output: { type: "permission", command, reason: "needed" },
  })

/** A person allowing or refusing it. */
const permit = (step: number, granted: boolean): EventDto =>
  makeHumanActed({ step, action: { _tag: "Permit", granted } })

const committed: EventDto = makeWorkCommitted({ step: 3 })

describe("filedAt", () => {
  it("collects every output a position filed, in log order", () => {
    const log = [returned(3, "first"), failed(3, "verify", "boom"), returned(3, "second")]
    expect(filedAt(log, 3)).toHaveLength(2)
  })

  it("takes the last as the live one, because the rest are superseded", () => {
    const log = [returned(3, "first"), returned(3, "second")]
    const live = lastFiledAt(log, 3)
    expect(live?.type === "artifact" ? live.sections["Summary"] : undefined).toBe("second")
  })

  it("does not take another position's work", () => {
    expect(filedAt([returned(2, "two"), returned(4, "four")], 3)).toEqual([])
    expect(lastFiledAt([returned(2, "two")], 3)).toBeUndefined()
  })

  it("is empty for a position that has not run", () => {
    expect(filedAt([], 3)).toEqual([])
  })
})

/**
 * Pairing an output with the turn that produced it, which is what stops two of an agent's
 * messages stacking at the bottom of a position with the reply to the first one above
 * them.
 */
describe("filedByTurn", () => {
  it("gives each turn its own output, in the order the turns ran", () => {
    const paired = filedByTurn(
      [returned(3, "first"), said(3, "again"), returned(3, "second")],
      3,
      2,
    )
    const summary = (i: number): string | undefined => {
      const o = paired[i]?.output
      return o?.type === "artifact" ? o.sections["Summary"] : undefined
    }
    expect(paired).toHaveLength(2)
    expect(summary(0)).toBe("first")
    expect(summary(1)).toBe("second")
  })

  it("numbers the attempts, so a superseded one can say which it was", () => {
    const paired = filedByTurn([returned(3, "first"), returned(3, "second")], 3, 2)
    expect(paired.map((f) => `${String(f?.nth)}/${String(f?.of)}`)).toEqual(["1/2", "2/2"])
  })

  it("says one attempt where there is one, which is what asks for no heading", () => {
    expect(filedByTurn([returned(3, "only")], 3, 1)[0]?.of).toBe(1)
  })

  it("holds a slot for a turn that died, so every card after it keeps its own turn", () => {
    // The failure files nothing. Skipping it would draw the second turn's document under
    // the first turn's log, which is the bug this function exists to make unrepresentable.
    const log: EventDto[] = [
      makeTurnFailed({ step: 3, sessionId: "s-dead", reason: "the CLI never started" }),
      returned(3, "after the retry"),
    ]
    const paired = filedByTurn(log, 3, 2)
    expect(paired[0]).toBeUndefined()
    expect(paired[1]?.nth).toBe(1)
  })

  it("leaves a running turn with nothing, rather than the last turn's document", () => {
    expect(filedByTurn([returned(3, "first"), said(3, "again")], 3, 2)).toEqual([
      { output: { type: "artifact", sections: { Summary: "first" } }, nth: 1, of: 1 },
      undefined,
    ])
  })

  /**
   * The shape that shipped the bug, taken off a real trak: four turns at one position,
   * two of them killed with the engine and two that filed. A turn cut off writes no
   * `TurnFailed` — the process that writes one is the process that died — so `Restarted`
   * is its only ending, and skipping it drew both documents two turns above the turns
   * that produced them and left the newest turn, the one at the gate, with no card at
   * all. Which also took the Approve press off the screen, since it is handed to the last
   * section and lands on the document there.
   */
  it("holds a slot for a turn the engine died under, which files nothing and says nothing", () => {
    const log: EventDto[] = [
      restarted(3),
      returned(3, "filed, then verify failed"),
      failed(3, "verify", "4 failed"),
      restarted(3),
      returned(3, "filed again, verify green"),
    ]
    const paired = filedByTurn(log, 3, 4)

    expect(paired.map((f) => (f === undefined ? "-" : `${String(f.nth)}/${String(f.of)}`))).toEqual(
      ["-", "1/2", "-", "2/2"],
    )
  })

  /**
   * The near-miss in the other direction. `restartFrom` re-parks a gate unchanged — no
   * command, no turn — so a restart there ends nothing, and counting it would push every
   * card *down* a turn. Absent `step` is what says so, and it is the same absence
   * `TurnFailed` uses.
   */
  it("ignores a restart that ended no turn, which is one at a gate", () => {
    const log: EventDto[] = [returned(3, "first"), makeRestarted()]
    expect(filedByTurn(log, 3, 1)).toEqual([
      { output: { type: "artifact", sections: { Summary: "first" } }, nth: 1, of: 1 },
    ])
  })

  it("does not take a restart from another position", () => {
    const log: EventDto[] = [restarted(2), returned(3, "first")]
    expect(filedByTurn(log, 3, 1)[0]?.nth).toBe(1)
  })

  it("keeps a document the transcript has no turn for, rather than dropping it", () => {
    // Every file written before the engine stamped positions is this shape.
    expect(filedByTurn([returned(3, "first"), returned(3, "second")], 3, 0)).toHaveLength(2)
  })

  it("does not take another position's work", () => {
    expect(filedByTurn([returned(2, "two"), returned(4, "four")], 3, 1)).toEqual([undefined])
  })
})

/**
 * Pairing an ask with what came back. Every failure here is the same shape and it is the
 * worst one this projection has: an answer drawn under a question it does not answer, which
 * is specific, plausible, and wrong.
 */
describe("the answers an ask got", () => {
  it("gives the nth ask at a position the nth set of answers", () => {
    const log = [
      asked(3, "which port?"),
      answered(3, "8080"),
      asked(3, "and the host?"),
      answered(3, "localhost"),
    ]
    expect(filedByTurn(log, 3, 2).map((f) => f?.answered?.answers)).toEqual([
      ["8080"],
      ["localhost"],
    ])
  })

  it("leaves an ask nobody answered with none, rather than the next ask's", () => {
    // Skipped, superseded or replanned past. A count-the-asks join would slide every
    // answer up one and put "8080" under a question it does not answer.
    const log = [asked(3, "which port?"), asked(3, "and the host?"), answered(3, "localhost")]
    expect(filedByTurn(log, 3, 2).map((f) => f?.answered?.answers)).toEqual([
      undefined,
      ["localhost"],
    ])
  })

  it("does not hand an artifact the answers that followed it", () => {
    const log = [returned(3, "first"), answered(3, "8080")]
    expect(filedByTurn(log, 3, 1)[0]?.answered).toBeUndefined()
  })

  it("keeps the answers a person sent, whatever the length of the list", () => {
    // The schema refuses an empty list and nothing else, so both mismatches reach here.
    const log = [asked(3, "which port?"), answered(3, "8080", "and localhost")]
    expect(filedByTurn(log, 3, 1)[0]?.answered?.answers).toEqual(["8080", "and localhost"])
  })

  it("carries the note on the same value as the answers, rather than in the list", () => {
    // One value, so nothing downstream has to join two maps keyed the same way — and the
    // list stays exactly as long as the answers, which is what the numbering reads.
    const log = [asked(3, "which port?"), noted(3, "we ship on Friday", "8080")]
    expect(filedByTurn(log, 3, 1)[0]?.answered).toEqual({
      answers: ["8080"],
      note: "we ship on Friday",
    })
  })

  it("takes the answers submitted at the composer's gate, not position zero's", () => {
    // The event says `step: 0`, which is the composer gate's nominal position and would
    // read as step zero's answers under a position-keyed join.
    const log = [composerAsked("s-plan", "which subcommands?"), answered(0, "list only")]
    expect(composerAnswersIn(log, "s-plan")).toEqual({ answers: ["list only"], note: undefined })
  })

  it("does not let a step's answers land on a composer ask nobody answered", () => {
    const log = [
      composerAsked("s-plan", "which subcommands?"),
      asked(3, "which port?"),
      answered(0, "8080"),
    ]
    expect(composerAnswersIn(log, "s-plan")).toBeUndefined()
    expect(filedByTurn(log, 3, 1)[0]?.answered?.answers).toEqual(["8080"])
  })

  it("says nothing for a run that ended on a proposal, whatever it asked earlier", () => {
    const log: EventDto[] = [
      composerAsked("s-plan", "which subcommands?"),
      answered(0, "list only"),
      makeComposerReturned({ sessionId: "s-plan" }),
    ]
    expect(composerAnswersIn(log, "s-plan")).toBeUndefined()
  })

  it("says nothing for a run with no session to key on", () => {
    const log = [composerAsked("s-plan", "which subcommands?"), answered(0, "list only")]
    expect(composerAnswersIn(log, undefined)).toBeUndefined()
  })
})

describe("the verdict a permission ask got", () => {
  it("gives each ask the Permit that followed it", () => {
    const log = [permission(3, "rm a"), permit(3, true), permission(3, "rm b"), permit(3, false)]
    expect(filedByTurn(log, 3, 2).map((f) => f?.permitted)).toEqual([true, false])
  })

  it("leaves an ask nobody answered with none, rather than the next ask's", () => {
    const log = [permission(3, "rm a"), permission(3, "rm b"), permit(3, true)]
    expect(filedByTurn(log, 3, 2).map((f) => f?.permitted)).toEqual([undefined, true])
  })

  it("keeps a question's answers and an ask's verdict on their own outputs", () => {
    const log = [
      asked(3, "which port?"),
      answered(3, "8080"),
      permission(3, "rm a"),
      permit(3, false),
    ]
    expect(filedByTurn(log, 3, 2).map((f) => [f?.answered?.answers, f?.permitted])).toEqual([
      [["8080"], undefined],
      [undefined, false],
    ])
  })
})

describe("whyRan", () => {
  it("says nothing about a first turn, because there is nothing to explain", () => {
    expect(whyRan([returned(3, "first")], 3, 0)).toBeUndefined()
  })

  it("names the check that sent the agent back", () => {
    const log = [returned(3, "first"), failed(3, "verify", "boom"), returned(3, "second")]
    expect(whyRan(log, 3, 1)).toEqual({ _tag: "CheckFailed", name: "verify" })
  })

  it("carries the files the engine recorded on the chat action", () => {
    const shot = {
      name: "shot.png",
      type: "image/png",
      size: 10,
      path: ".orkestra/.attachments/0a1b2c3d-shot.png",
    }
    const sent = makeHumanActed({
      step: 3,
      action: { _tag: "Chat", message: "look", attachments: [shot] },
    })
    const log = [returned(3, "first"), sent, returned(3, "second")]
    expect(whyRan(log, 3, 1)).toEqual({ _tag: "Said", text: "look", attachments: [shot] })
  })

  it("carries what the person typed, verbatim", () => {
    const log = [returned(3, "first"), said(3, "use a copy instead"), returned(3, "second")]
    expect(whyRan(log, 3, 1)).toEqual({ _tag: "Said", text: "use a copy instead", attachments: [] })
  })

  /**
   * The shape a restart is actually offered from, and the one the old window could not
   * read. A turn the provider cut off ends in `TurnFailed`, not `AgentReturned`, so a
   * count of returns never reached the second turn's window and the restart was drawn
   * nowhere — on every log this feature's Restart writes.
   *
   * All three endings the retry can have, because the window is the same arithmetic in
   * each: it came back, it dropped again, and it is still going.
   */
  it("reports the restart that headed a turn the last one dropped out of", () => {
    const dropped: EventDto[] = [
      makeTurnFailed({ step: 3, sessionId: "s-a", reason: "connection closed" }),
      // No `step`: the engine writes one only for a turn still in flight, and this turn
      // ended when the failure was recorded.
      makeRestarted({ sessionId: "s-b" }),
    ]
    expect(whyRan([...dropped, returned(3, "second")], 3, 1)).toEqual({ _tag: "Restarted" })
    expect(
      whyRan([...dropped, makeTurnFailed({ step: 3, reason: "dropped again" })], 3, 1),
    ).toEqual({ _tag: "Restarted" })
    expect(whyRan(dropped, 3, 1)).toEqual({ _tag: "Restarted" })
  })

  it("does not head a retry with something recorded after it came back", () => {
    // The window shuts at the ending, so what a person typed next explains the turn *after*
    // the retry — read into the retry's own heading it would explain a turn with something
    // that postdates it.
    const log: EventDto[] = [
      makeTurnFailed({ step: 3, sessionId: "s-a", reason: "connection closed" }),
      makeRestarted({ sessionId: "s-b" }),
      returned(3, "second"),
      said(3, "not like that"),
    ]
    expect(whyRan(log, 3, 1)).toEqual({ _tag: "Restarted" })
    expect(whyRan(log, 3, 2)).toEqual({ _tag: "Said", text: "not like that", attachments: [] })
  })

  it("answers one past the last turn, which is where a message with no turn yet is drawn", () => {
    // `TurnsView` asks for the turn *after* the last one to find something the engine has
    // recorded that no turn has taken up. Past a turn that failed rather than returned that
    // question was unanswerable, and a person's own paragraph disappeared until the retry
    // wrote its first line.
    const log: EventDto[] = [
      makeTurnFailed({ step: 3, sessionId: "s-a", reason: "connection closed" }),
      makeRestarted({ sessionId: "s-b" }),
      said(3, "try it with haiku"),
    ]
    expect(whyRan(log, 3, 1)).toEqual({ _tag: "Said", text: "try it with haiku", attachments: [] })
  })

  it("ignores a check that failed at another position", () => {
    // The attribution that would look right and be wrong: step 2's failing check has
    // nothing to do with step 3 running twice.
    const log = [returned(3, "first"), failed(2, "verify", "boom"), returned(3, "second")]
    expect(whyRan(log, 3, 1)).toBeUndefined()
  })

  it("ignores an approval, which moves past a position rather than re-running it", () => {
    const log = [returned(3, "first"), approved(3), returned(3, "second")]
    expect(whyRan(log, 3, 1)).toBeUndefined()
  })

  it("keeps each turn's own cause when a position ran three times", () => {
    const log = [
      returned(3, "first"),
      failed(3, "verify", "boom"),
      returned(3, "second"),
      said(3, "not like that"),
      returned(3, "third"),
    ]
    expect(whyRan(log, 3, 1)).toEqual({ _tag: "CheckFailed", name: "verify" })
    expect(whyRan(log, 3, 2)).toEqual({ _tag: "Said", text: "not like that", attachments: [] })
  })

  it("is unmoved by events between the turns that mean nothing here", () => {
    const log = [
      returned(3, "first"),
      committed,
      returned(1, "elsewhere"),
      failed(3, "verify", "boom"),
      returned(3, "second"),
    ]
    expect(whyRan(log, 3, 1)).toEqual({ _tag: "CheckFailed", name: "verify" })
  })
})

/** What each turn filed, as one word — `-` where it filed nothing. */
const placedAt = (log: readonly EventDto[], turns: number): readonly string[] =>
  filedByTurn(log, 3, turns).map((f) =>
    f === undefined
      ? "-"
      : f.output.type === "artifact"
        ? (f.output.sections["Summary"] ?? "?")
        : f.output.type,
  )

/**
 * A turn killed with its engine, by whichever of the five things started it.
 *
 * `Restarted` is that turn's only ending — the process that would write a `TurnFailed` is
 * the one that died — so dropping it costs both cards at once: the document lands a
 * section above the turn that filed it, and the restart heads nothing. There is a case per
 * trigger `decide` spawns a turn on, because a rule reading openness off the position's
 * own re-entries can see only two of them, and a person answering an ask is not one.
 *
 * Asserted at `filedByTurn` and `whyRan` together, because they read one list of endings:
 * a dropped ending misplaces the document and the heading in the same move.
 */
describe("a turn cut off with its engine, by what started it", () => {
  const cases = [
    {
      started: "its first entry at the position",
      log: [restarted(3), returned(3, "after")],
      filed: ["-", "after"],
    },
    {
      started: "a failing check",
      log: [returned(3, "first"), failed(3, "verify", "boom"), restarted(3), returned(3, "after")],
      filed: ["first", "-", "after"],
    },
    {
      started: "a person's message",
      log: [returned(3, "first"), said(3, "again"), restarted(3), returned(3, "after")],
      filed: ["first", "-", "after"],
    },
    {
      // The shape that had no ending at all: `AnswerQuestions` re-enters the position and
      // writes nothing the client can read as a re-entry, so the turn it starts is invisible
      // to any rule but the engine's own `step`.
      started: "answers to the ask it filed",
      log: [asked(3, "which port?"), answered(3, "8080"), restarted(3), returned(3, "after")],
      filed: ["questions", "-", "after"],
    },
    {
      started: "the restart before it",
      log: [restarted(3), restarted(3), returned(3, "after")],
      filed: ["-", "-", "after"],
    },
  ] as const satisfies readonly {
    readonly started: string
    readonly log: readonly EventDto[]
    readonly filed: readonly string[]
  }[]

  for (const { started, log, filed } of cases)
    it(`ends the turn ${started} started, and heads the one after it`, () => {
      expect(placedAt(log, filed.length)).toEqual(filed)
      // The restart is the last turn's cause and the one before it ended, read once as each.
      expect(whyRan(log, 3, filed.length - 1)).toEqual({ _tag: "Restarted" })
    })

  it("passes over a restart the engine had already written a `TurnFailed` for", () => {
    // The one race the suppression exists for: killed between recording the failure and
    // letting the in-flight record go, so the restart carries a step for a closed turn.
    // Counting it would draw the retry's document a section below the retry's own rows.
    const log: EventDto[] = [
      makeTurnFailed({ step: 3, sessionId: "s-a", reason: "connection closed" }),
      restarted(3),
      returned(3, "second"),
    ]
    expect(placedAt(log, 2)).toEqual(["-", "second"])
    expect(whyRan(log, 3, 1)).toEqual({ _tag: "Restarted" })
  })

  it("counts the restart after the one it passed over, which ends a turn of its own", () => {
    // The retry the race's restart began is itself killed with the engine. Its restart is a
    // real ending — the suppression is spent, not sticky.
    const log: EventDto[] = [
      makeTurnFailed({ step: 3, sessionId: "s-a", reason: "connection closed" }),
      restarted(3),
      restarted(3),
      returned(3, "third"),
    ]
    expect(placedAt(log, 3)).toEqual(["-", "-", "third"])
    expect(whyRan(log, 3, 1)).toEqual({ _tag: "Restarted" })
    expect(whyRan(log, 3, 2)).toEqual({ _tag: "Restarted" })
  })
})

describe("a turn a person stopped", () => {
  it("ends the turn it interrupted, so the redirected turn's document is its own", () => {
    // Nothing else closes that turn — the process that would have written a `TurnFailed`
    // is the one the stop killed — so a rule that read only `Restarted` would place the
    // work the agent went on to file one section above the turn that filed it.
    const log: EventDto[] = [returned(3, "first"), stopped(3), returned(3, "after")]
    expect(placedAt(log, 3)).toEqual(["first", "-", "after"])
  })

  it("heads the turn after it with what the person said, not with the stop", () => {
    // A stop opens the window and the message that follows it is what caused the turn —
    // so the sentence wins, and *the turn was cut off* never covers it.
    const log: EventDto[] = [stopped(3), said(3, "do the other thing"), returned(3, "after")]
    expect(whyRan(log, 3, 1)).toEqual({ _tag: "Said", text: "do the other thing", attachments: [] })
  })

  it("ends a composer run rather than a step's, because it carries no position", () => {
    // A stopped composer's has no `step` — the same convention `TurnFailed` uses, read by
    // the same predicate — so it must count against the run it was in and never against
    // a step that happens to sit beside it in the log.
    const log: EventDto[] = [
      returned(3, "first"),
      makeStopped({ sessionId: "s-plan" }),
      returned(3, "second"),
    ]
    expect(placedAt(log, 2)).toEqual(["first", "second"])
    expect(composerEndedIn(log, "s-plan", 0).length).toBe(1)
  })
})

/** What each turn's settlement is, as a word per turn — the shape most cases are about. */
const outcomes = (log: readonly EventDto[], step: number, turns: number): readonly string[] =>
  settledByTurn(log, step, turns).map((s) => s?._tag ?? "none")

describe("settledByTurn", () => {
  it("carries the name and the output, which is what the gate cannot be judged without", () => {
    const log = [returned(3, "first"), failed(3, "verify", "1 failed | 411 passed")]
    expect(settledByTurn(log, 3, 1)).toEqual([
      {
        _tag: "Failed",
        failed: {
          name: "verify",
          output: "1 failed | 411 passed",
          attempts: 1,
          command: undefined,
          exitCode: undefined,
        },
      },
    ])
  })

  it("reports a pass as well, because it is what says which document a run judged", () => {
    // The point of naming both: the daemon holds one run with a position on it and no
    // turn, so *which document did this judge* is answered here or guessed at.
    const log: EventDto[] = [returned(3, "first"), makeChecksPassed({ step: 3, ran: ["verify"] })]
    expect(settledByTurn(log, 3, 1)).toEqual([{ _tag: "Passed" }])
  })

  it("carries the line it was spawned as and what it exited with, where the log has them", () => {
    const log = [
      returned(3, "first"),
      makeCheckFailed({
        step: 3,
        name: "verify",
        output: "boom",
        command: "bash /repo/.orkestra/checks/verify.sh",
        exitCode: 1,
      }),
    ]
    const first = settledByTurn(log, 3, 1)[0]
    expect(first?._tag === "Failed" && first.failed.command).toBe(
      "bash /repo/.orkestra/checks/verify.sh",
    )
    expect(first?._tag === "Failed" && first.failed.exitCode).toBe(1)
  })

  it("puts each settlement on the attempt it was about rather than on the newest", () => {
    // The ordinary shape of a re-run position: the first document is what the check
    // disagreed with, the second exists because it did, and the third has not been
    // checked at all yet.
    const log: EventDto[] = [
      returned(3, "first"),
      failed(3, "verify", "one"),
      returned(3, "second"),
      failed(3, "verify", "two"),
      returned(3, "third"),
    ]
    expect(outcomes(log, 3, 3)).toEqual(["Failed", "Failed", "none"])
  })

  it("leaves a document filed after a pass unsettled, since nothing has judged it", () => {
    // **The regression this shape exists for.** A person chatted at the approval gate, the
    // agent filed again, and the pass on the log is about the document below — so the new
    // one settles as nothing until its own check runs.
    const log: EventDto[] = [
      returned(3, "first"),
      makeChecksPassed({ step: 3, ran: ["verify"] }),
      returned(3, "second"),
    ]
    expect(outcomes(log, 3, 2)).toEqual(["Passed", "none"])
  })

  it("counts the attempts, because arriving at the gate means they ran out", () => {
    const log: EventDto[] = [
      returned(3, "a"),
      failed(3, "verify", "one"),
      returned(3, "b"),
      failed(3, "verify", "two"),
      returned(3, "c"),
      failed(3, "verify", "three"),
    ]
    expect(
      settledByTurn(log, 3, 3).map((s) => (s?._tag === "Failed" ? s.failed.attempts : undefined)),
    ).toEqual([1, 2, 3])
  })

  it("does not report another position's settlement", () => {
    const log: EventDto[] = [
      returned(3, "first"),
      failed(2, "verify", "boom"),
      makeChecksPassed({ step: 2, ran: ["verify"] }),
    ]
    expect(outcomes(log, 3, 1)).toEqual(["none"])
  })

  it("keeps a failure the agent went back and fixed, on the attempt it was about", () => {
    // **Deliberately not withdrawn.** A failure is a fact about the attempt that earned
    // it; what stops it reading as the reason you are being asked *now* is that the card
    // carrying it is a superseded one, folded under its own attempt number.
    const log: EventDto[] = [
      returned(3, "first"),
      failed(3, "verify", "boom"),
      returned(3, "second"),
      makeChecksPassed({ step: 3, ran: ["verify"] }),
    ]
    expect(outcomes(log, 3, 2)).toEqual(["Failed", "Passed"])
  })

  it("drops a settlement standing in front of every turn, since it belongs to none", () => {
    // Cannot happen against a real log — a check runs on what a turn filed — and
    // attributing it to turn zero would put an earlier position's verdict on this one.
    expect(outcomes([failed(3, "verify", "boom"), returned(3, "first")], 3, 1)).toEqual(["none"])
  })

  it("pads to the turns the transcript has, so no card is drawn a run short", () => {
    expect(settledByTurn([], 3, 2)).toEqual([undefined, undefined])
  })
})

// The two settlements a person causes, beside the two a script does.
describe("settledByTurn, on what a person did to the check", () => {
  it("tells a pass whose checks were skipped from one whose checks ran, by name", () => {
    // The same event, and the card has to say the opposite thing about each: a step
    // nobody checked drawn as a pass is how it comes to look like one.
    const log: EventDto[] = [
      returned(3, "first"),
      makeChecksPassed({ step: 3, ran: [], skipped: ["verify"] }),
    ]
    expect(settledByTurn(log, 3, 1)).toEqual([{ _tag: "Skipped", names: ["verify"] }])
  })

  it("tells a pass where nothing ran this time from one where something did", () => {
    const reused: EventDto[] = [
      returned(3, "first"),
      makeChecksPassed({ step: 3, ran: [], reused: ["verify"] }),
    ]
    expect(settledByTurn(reused, 3, 1)).toEqual([{ _tag: "Reused", names: ["verify"] }])
    // One check ran, so the daemon holds this pass's run, and it is drawn as any pass is.
    const mixed: EventDto[] = [
      returned(3, "first"),
      makeChecksPassed({ step: 3, ran: ["lint"], reused: ["verify"] }),
    ]
    expect(settledByTurn(mixed, 3, 1)).toEqual([{ _tag: "Passed" }])
  })

  it("reports a run a person ended, with the name where the engine had it", () => {
    const named: EventDto[] = [returned(3, "first"), makeChecksCancelled({ step: 3 })]
    expect(settledByTurn(named, 3, 1)).toEqual([{ _tag: "Cancelled", name: "verify" }])
    const raced: EventDto[] = [returned(3, "first"), { _tag: "ChecksCancelled", step: 3 }]
    expect(settledByTurn(raced, 3, 1)).toEqual([{ _tag: "Cancelled", name: undefined }])
  })
})

/** A turn that filed, and the text it wrote its output as. */
const wrote = (step: number, envelope: string): EventDto =>
  makeAgentReturned({ step, sessionId: `s-${step}`, envelope })

describe("envelopesAt and composerEnvelopesIn", () => {
  it("takes every envelope a position wrote, not only the live one", () => {
    // A position that filed twice has both turns on screen, and each row holds its own.
    const log: EventDto[] = [wrote(3, "{first}"), failed(3, "verify", "boom"), wrote(3, "{second}")]
    expect(envelopesAt(log, 3)).toEqual(new Set(["{first}", "{second}"]))
  })

  it("does not take another position's, which would delete words no card is showing", () => {
    expect(envelopesAt([wrote(2, "{elsewhere}")], 3).size).toBe(0)
  })

  it("holds nothing for a turn that reported none — a prose answer, or a re-ask", () => {
    expect(envelopesAt([returned(3, "first")], 3).size).toBe(0)
  })

  it("keys a composer run by its session, because the event carries no position", () => {
    const log: EventDto[] = [
      makeComposerReturned({ sessionId: "s-plan", envelope: "{plan}" }),
      makeComposerReturned({ sessionId: "s-other", envelope: "{other}" }),
    ]
    expect(composerEnvelopesIn(log, "s-plan")).toEqual(new Set(["{plan}"]))
  })

  it("holds nothing for a turn with no session to key on", () => {
    const log: EventDto[] = [makeComposerReturned({ sessionId: "s-plan", envelope: "{plan}" })]
    expect(composerEnvelopesIn(log, undefined).size).toBe(0)
  })
})

/**
 * How each turn ended — the question the trak's *state* stops being able to answer the
 * moment somebody restarts it.
 *
 * The state names the newest ending and nothing else, so a restart takes the only account
 * of an interruption off the screen with it. Everything here is about the answer surviving
 * that, and about it landing on the turn that earned it rather than on whichever one is
 * last.
 */
describe("endedAt and composerEndedIn", () => {
  const DROPPED = "API Error: Connection closed mid-response."

  const dropped = (step: number, session: string): EventDto =>
    makeTurnFailed({ step, sessionId: session, reason: DROPPED, apiKind: "interrupted" })

  it("keeps the interruption on its own turn after a restart has moved past it", () => {
    // The shape the live database holds: interrupted, picked back up, and it filed.
    const log: EventDto[] = [dropped(2, "s-a"), makeRestarted({ step: 2, sessionId: "s-a" })]
    expect(endedAt([...log, returned(2, "the work")], 2, 2)).toEqual([
      { reason: DROPPED, apiKind: "interrupted" },
      undefined,
    ])
  })

  it("says nothing for a turn that filed, one still running, or an engine death", () => {
    // Three endings, none of them the engine saying a turn died: one output, one restart
    // with no failure behind it, and a turn the transcript has that the log has not.
    const log: EventDto[] = [returned(2, "first"), restarted(2)]
    expect(endedAt(log, 2, 3)).toEqual([undefined, undefined, undefined])
  })

  it("does not take another position's ending, which would name the wrong turn", () => {
    expect(endedAt([dropped(3, "s-a")], 2, 1)).toEqual([undefined])
  })

  it("carries no kind where the provider reported nothing to classify", () => {
    // A non-zero exit: absent stays absent, so the words fall to *nobody said* rather than
    // to `unclassified`, which would be putting a name in the provider's mouth.
    const log: EventDto[] = [makeTurnFailed({ step: 2, sessionId: "s-a", reason: "exited 1" })]
    expect(endedAt(log, 2, 1)).toEqual([{ reason: "exited 1", apiKind: undefined }])
  })

  /**
   * The composer has no position at all, so its endings are keyed by the session the run
   * is — and the absent `step` is what tells them from a step's, which carry the same
   * session id whenever a position was resumed from that conversation.
   */
  it("keys a run of the composer by its session, since the event carries no position", () => {
    const log: EventDto[] = [
      makeTurnFailed({ sessionId: "s-plan", reason: DROPPED, apiKind: "interrupted" }),
      makeRestarted({ sessionId: "s-plan" }),
      makeComposerReturned({ sessionId: "s-plan" }),
    ]
    expect(composerEndedIn(log, "s-plan", 2)).toEqual([
      { reason: DROPPED, apiKind: "interrupted" },
      undefined,
    ])
  })

  it("does not take a step's ending under the same session, which is a different turn", () => {
    // One conversation, two positions: the composer's plan gate resumed into a step. A
    // rule keying on the session alone would end the composer's run with the step's drop.
    const log: EventDto[] = [makeComposerReturned({ sessionId: "s-plan" }), dropped(2, "s-plan")]
    expect(composerEndedIn(log, "s-plan", 1)).toEqual([undefined])
  })

  it("attributes nothing to a run that died before a session existed", () => {
    const log: EventDto[] = [makeTurnFailed({ reason: "claude: not found" })]
    expect(composerEndedIn(log, undefined, 1)).toEqual([undefined])
  })
})

/**
 * What a position sent outside the checkout — the one thing on the pane that cannot be
 * re-derived by looking again, so the failure that matters is drawing a *stale* run
 * beside a document that has since been sent afresh.
 */
describe("effectsAt", () => {
  it("carries every effect's output, which is the only record it acted", () => {
    const log: EventDto[] = [
      makeEffectsRan({ step: 2, ran: [{ name: "open-pr", output: PR_URL }] }),
    ]
    expect(effectsAt(log, 2)).toEqual({
      effects: [{ name: "open-pr", output: PR_URL, failed: false }],
      at: undefined,
    })
  })

  it("carries the time the engine wrote it down, so nothing reads as a claim about now", () => {
    const log: EventDto[] = [makeEffectsRan({ step: 2, at: 1_700_000_000_000 })]
    expect(effectsAt(log, 2)?.at).toBe(1_700_000_000_000)
  })

  it("says nothing where the step declared none, which is almost every position", () => {
    // `Effecting` is entered at every step boundary, so an empty run is what the log
    // holds for a plan with no effects anywhere in it — and a card on every position
    // saying nothing acted is worse than no card.
    expect(effectsAt([makeEffectsRan({ step: 2, ran: [] })], 2)).toBeUndefined()
    expect(effectsAt([], 2)).toBeUndefined()
  })

  it("marks the one that could not do it, and reports nothing that ran before it", () => {
    // Fail-fast, so the run stopped there. What the earlier ones printed is not in the
    // log at all — `EffectFailed` is the whole event.
    const log: EventDto[] = [makeEffectFailed({ step: 2, name: "open-pr", output: "gh: no auth" })]
    expect(effectsAt(log, 2)).toEqual({
      effects: [{ name: "open-pr", output: "gh: no auth", failed: true }],
      at: undefined,
    })
  })

  it("takes the newest run whole, because an earlier one describes a world that moved", () => {
    // A restart re-issues the effects. The failure it recovered from is not a second
    // attempt to show beside this one; it is a description of what was true before.
    const log: EventDto[] = [
      makeEffectFailed({ step: 2, name: "open-pr", output: "gh: no auth" }),
      makeEffectsRan({ step: 2, ran: [{ name: "open-pr", output: PR_URL }] }),
    ]
    expect(effectsAt(log, 2)?.effects).toEqual([{ name: "open-pr", output: PR_URL, failed: false }])
  })

  it("does not take another position's run", () => {
    expect(effectsAt([makeEffectsRan({ step: 3 })], 2)).toBeUndefined()
  })

  it("names what a skip kept from running, though nothing ran", () => {
    const log: EventDto[] = [
      makeEffectFailed({ step: 2, name: "open-pr", output: "gh: no auth" }),
      makeEffectsRan({ step: 2, ran: [], skipped: ["open-pr", "notify"] }),
    ]
    expect(effectsAt(log, 2)).toEqual({
      effects: [],
      skipped: ["open-pr", "notify"],
      at: undefined,
    })
  })
})

/**
 * A filing asked of a step, in both shapes the engine writes it. The session is what
 * tells them apart: with one, a turn was killed for it and the ask is that turn's only
 * ending; without one, the step was parked in a conversation and its turn had already
 * ended, so counting the ask again would invent a turn and shift every card after it.
 */
describe("a filing asked", () => {
  it("ends the turn it killed, and heads the next one with why it ran", () => {
    const log: EventDto[] = [
      makeFilingAsked({ step: 3, sessionId: "s-cut" }),
      returned(3, "what it had"),
    ]
    expect(placedAt(log, 2)).toEqual(["-", "what it had"])
    expect(whyRan(log, 3, 1)).toEqual({ _tag: "Filing" })
  })

  it("ends nothing at a parked conversation, and still heads the turn it starts", () => {
    const log: EventDto[] = [
      returned(3, "a reply in prose"),
      makeFilingAsked({ step: 3 }),
      returned(3, "what it had"),
    ]
    expect(placedAt(log, 2)).toEqual(["a reply in prose", "what it had"])
    expect(whyRan(log, 3, 1)).toEqual({ _tag: "Filing" })
  })

  it("is another position's business when its step is another's", () => {
    const log: EventDto[] = [
      returned(3, "first"),
      makeFilingAsked({ step: 4, sessionId: "s-cut" }),
      returned(3, "second"),
    ]
    expect(placedAt(log, 2)).toEqual(["first", "second"])
    expect(whyRan(log, 3, 1)).toBeUndefined()
  })
})

/**
 * The two other presses that kill a turn: a recompose while the step's turn runs, and an
 * archive. Each is that turn's only ending — the process that would have written one is
 * the one it killed — and the session on the event is what says a turn was killed at all.
 */
describe("a recompose pressed mid-turn", () => {
  it("ends the turn it killed, and a press at a gate ends nothing", () => {
    const log: EventDto[] = [
      returned(3, "first"),
      // At the gate: the step is on it and no session, and the turn already ended above.
      makeHumanActed({ step: 3, action: { _tag: "Replan", reason: "smaller" } }),
      returned(3, "second"),
      // Off the gate: the route killed the turn and carries its session.
      makeHumanActed({ step: 3, action: { _tag: "Replan", reason: "other" }, sessionId: "s-cut" }),
      returned(3, "third"),
    ]
    expect(placedAt(log, 4)).toEqual(["first", "second", "-", "third"])
  })
})

describe("an archive", () => {
  it("ends the step's turn it killed, keyed by the step it carries", () => {
    const log: EventDto[] = [returned(3, "first"), makeAbandoned({ step: 3, sessionId: "s-cut" })]
    expect(placedAt(log, 2)).toEqual(["first", "-"])
  })

  it("ends the composer's turn it killed, which carries no step", () => {
    const log: EventDto[] = [
      makeComposerReturned({ sessionId: "s-plan" }),
      makeAbandoned({ sessionId: "s-plan" }),
    ]
    expect(composerEndedIn(log, "s-plan", 0).length).toBe(2)
  })

  it("ends nothing on a trak archived while parked", () => {
    const log: EventDto[] = [returned(3, "first"), makeAbandoned()]
    expect(placedAt(log, 1)).toEqual(["first"])
  })
})
