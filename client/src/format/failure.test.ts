// Tier 1 (`testing-tiers`): one pure function, no React and no network.
//
// The complaint this answers: `${kind} failed` said *provider failed* about a dropped
// connection, an exhausted usage limit and an expired token alike — three things a person
// does three different things about.

import { describe, expect, it } from "vitest"
import type { TrakStateDto } from "../api/types"
import { failureWords, stoppedWords } from "./failure"

type Failed = Extract<TrakStateDto, { readonly _tag: "Failed" }>

const failed = (over: Partial<Omit<Failed, "_tag">> = {}): Failed => ({
  _tag: "Failed",
  error: "API Error: Connection closed mid-response.",
  kind: "provider",
  ...over,
})

/**
 * Every classification the wire can carry, and the `Failure` kinds that carry none.
 * Hand-written for `controls.test.ts`'s reason: a list derived from the union would grow
 * silently, and the point is that a new kind is looked at by a person.
 */
const EVERY: readonly Failed[] = [
  failed({ apiKind: "interrupted" }),
  failed({ apiKind: "rate_limit" }),
  failed({ apiKind: "overloaded" }),
  failed({ apiKind: "server" }),
  failed({ apiKind: "auth" }),
  failed({ apiKind: "unclassified" }),
  failed(),
  failed({ kind: "agent", error: "I cannot do this step" }),
  failed({ kind: "worktree", error: "fatal: already exists" }),
  failed({ kind: "worktree", error: "setup failed in /w:\nno lockfile", setup: "no lockfile" }),
  failed({ kind: "archive", archiving: "closed", error: "teardown failed in /repo/x" }),
  failed({ kind: "merge", error: "merge: git merge exited 2: Your local changes" }),
  failed({ kind: "project", error: "`open-pr` could not do what it says" }),
  failed({ kind: "engine", error: "Defect: onComposerAnswers at AwaitingComposerAnswers" }),
]

/** A runner verb that failed, of `kind`. */
const runner = (kind: "limited" | "lost" | "failed") => ({
  kind,
  said: "the provider allows 5 starts a minute; try again in about a minute",
  file: ".orkestra/runner.sh",
  verb: "create",
  stderr: "refused POST /sandboxes (429): You used all 5 sandbox starts",
})

describe("failureWords, where a runner verb failed", () => {
  it("leads a failure a runner caused with its sentence, on a checkout and on a turn alike", () => {
    for (const kind of ["worktree", "provider"] as const) {
      const words = failureWords(failed({ kind, runner: runner("limited") }))
      expect(words.chip).toBe("provider limit")
      expect(words.head).toBe("the sandbox provider's limit was reached")
      expect(words.line).toBe("the provider allows 5 starts a minute; try again in about a minute")
      expect(words.runner).toEqual({
        names: ".orkestra/runner.sh create",
        printed: "refused POST /sandboxes (429): You used all 5 sandbox starts",
      })
    }
    // What the press costs is still the kind's: a checkout is prepared again.
    expect(failureWords(failed({ kind: "worktree", runner: runner("limited") })).says).toBe(
      "Prepares the checkout again.",
    )
  })

  it("names a lost sandbox and a verb that only exited by what the runner said", () => {
    expect(failureWords(failed({ kind: "worktree", runner: runner("lost") })).head).toBe(
      "the sandbox could not be reached",
    )
    const exited = failureWords(failed({ kind: "worktree", runner: runner("failed") }))
    expect(exited.head).toBe("the runner failed")
    expect(exited.chip).toBe("checkout failed")
  })

  it("names no runner where none failed", () => {
    expect(failureWords(failed({ kind: "worktree" })).runner).toBeUndefined()
  })
})

describe("failureWords", () => {
  it("gives an interruption its own words rather than the generic ones", () => {
    const words = failureWords(failed({ apiKind: "interrupted" }))
    expect(words.chip).toBe("interrupted")
    expect(words.head).toBe("the agent was interrupted")
    expect(words.chip).not.toContain("provider failed")
  })

  it("reads a usage limit differently — waiting is the fix, not pressing again", () => {
    // Two provider failures, one `Failure` kind, and opposite advice. This is the whole
    // reason the classification is carried rather than re-derived from `error`.
    const limit = failureWords(failed({ apiKind: "rate_limit" }))
    expect(limit.chip).toBe("usage limit")
    expect(limit.line).toContain("Waiting is the fix")
    expect(failureWords(failed({ apiKind: "interrupted" })).line).toContain(
      "can be run again from the top",
    )
  })

  it("says the same thing for a kind nobody classified as for one nobody recognised", () => {
    // *Nobody said* and *we do not know what this was* are the same thing to read, and
    // both must avoid naming a cause. A log written before the field existed is the first.
    expect(failureWords(failed())).toEqual(failureWords(failed({ apiKind: "unclassified" })))
    expect(failureWords(failed()).head).toBe("the agent's CLI stopped")
  })

  it("carries the provider's own text only where nothing named the failure", () => {
    // The sentence for an unnamed failure says nothing a person can act on, so the text is
    // the only thing that tells a bad `model:` from a CLI that is not signed in.
    const said = "no provider named by model `opus-9`"
    expect(failureWords(failed({ error: said })).unnamed).toBe(said)
    expect(failureWords(failed({ error: said, apiKind: "unclassified" })).unnamed).toBe(said)
    for (const apiKind of ["interrupted", "rate_limit", "overloaded", "server", "auth"] as const)
      expect(failureWords(failed({ apiKind })).unnamed).toBeUndefined()
    expect(failureWords(failed({ kind: "agent" })).unnamed).toBeUndefined()
    // A runner's stderr is already behind the press; the error would say it twice.
    expect(failureWords(failed({ runner: runner("failed") })).unnamed).toBeUndefined()
  })

  it("keeps a failure that is not the provider's off the provider's words entirely", () => {
    // `apiKind` is only ever set on a provider failure, and a surface that keyed on it
    // alone would tell somebody their checkout failed because the API stopped.
    expect(failureWords(failed({ kind: "agent" })).head).toBe("the agent gave up")
    expect(failureWords(failed({ kind: "worktree" })).head).toBe(
      "the checkout could not be prepared",
    )
    // A refused merge is the one that used to read as this: the checkout is fine.
    expect(failureWords(failed({ kind: "merge" })).head).toBe("the merge was refused")
    expect(failureWords(failed({ kind: "engine" })).head).toBe("Orkestra broke")
    expect(failureWords(failed({ kind: "project" })).head).toBe(
      "this project's own script could not do it",
    )
  })

  it("says what the press costs, and says something else where no position re-runs", () => {
    // `restartFrom` re-issues the command the failed position implies — which for a
    // checkout that was never prepared is not a position at all.
    expect(failureWords(failed()).says).toBe("Runs this position again, from the top.")
    expect(failureWords(failed({ kind: "worktree" })).says).toBe("Prepares the checkout again.")
    expect(failureWords(failed({ kind: "engine" })).says).toBe("Picks it back up where it stopped.")
  })

  it("does not call a teardown that failed at the archive a checkout that was never prepared", () => {
    // `runTeardown` in `runtime.ts` writes `WorktreeFailed` while the trak is `Closing`,
    // which `decide` turns into the same `Failed{worktree}` a failed `setup.sh` lands in.
    // The error is the engine's own wording. The work all ran, so *could not be prepared*,
    // *setup.sh* and *nothing has run yet* are each false here.
    const words = failureWords(
      failed({
        kind: "archive",
        archiving: "merged",
        error: "teardown failed in /repo/.orkestra/.worktrees/x:\ndatabase is in use",
      }),
    )
    const said = [words.chip, words.head, words.line, words.says].join(" ")
    expect(said).not.toContain("could not be prepared")
    expect(said).not.toContain("setup.sh")
    expect(said).not.toContain("Nothing has run yet")
  })

  it("says which archive did not finish, and names teardown.sh beside git", () => {
    // Beside git rather than alone: a failure while abandoning can be the commit that
    // precedes the teardown. *On its branch* for a close, never *not merged*: a pull
    // request GitHub merged arrives as `closed` too.
    const line = (archiving: Failed["archiving"]): string =>
      failureWords(failed({ kind: "archive", archiving, error: "teardown failed" })).line
    expect(line("merged")).toMatch(/^The work is merged\. /)
    expect(line("closed")).toMatch(/^The work is on its branch\. /)
    expect(line("abandoned")).toMatch(/^The trak was being abandoned\. /)
    for (const archiving of ["merged", "closed", "abandoned"] as const) {
      const words = failureWords(failed({ kind: "archive", archiving, error: "x" }))
      expect(words.head).toBe("the checkout could not be archived")
      expect(words.line).toContain("git, or this project's .orkestra/worktrees/teardown.sh")
      expect(words.says).toBe("Runs the archive again.")
      expect(words.press).toBe("Restart")
    }
  })

  it("gives every failure a distinct chip, so a list can be scanned", () => {
    const chips = EVERY.map((state) => failureWords(state).chip)
    // One repeat is expected and is the point above: unclassified and absent are one case.
    expect(new Set(chips).size).toBe(chips.length - 1)
  })

  it("calls the press the same thing at every kind, because every one re-runs a position", () => {
    expect(new Set(EVERY.map((state) => failureWords(state).press))).toEqual(new Set(["Restart"]))
  })

  it("draws the provider's own sentence nowhere", () => {
    // A rate limit's error is a 300-character JSON blob, and `ork resume` is where it is printed in full.
    for (const state of EVERY) {
      const words = failureWords(state)
      expect([words.chip, words.head, words.line, words.says].join(" ")).not.toContain(state.error)
    }
  })
})

/**
 * The stoppage with no `Failed` behind it. It is a constant, so what is worth pinning is
 * the two things that make it part of this vocabulary rather than a sentence of its own:
 * a different press from every failure's, and a head no failure already uses.
 */
describe("stoppedWords", () => {
  it("asks for the run to be picked up rather than for a position to be re-run", () => {
    expect(stoppedWords.press).toBe("Resume")
    expect(stoppedWords.says).toBe("Picks it back up where it stopped.")
  })

  it("heads it as something no failure says", () => {
    // A parent's notice and a piece's can be on screen together, so two stoppages that
    // read alike would be one sentence a reader has to work out the owner of.
    expect(EVERY.map((state) => failureWords(state).head)).not.toContain(stoppedWords.head)
  })
})

describe("failureWords, where setup failed", () => {
  const setupFailed = failed({
    kind: "worktree",
    error: "setup failed in /w:\nERR_PNPM_NO_LOCKFILE",
    setup: "ERR_PNPM_NO_LOCKFILE",
  })

  it("says setup failed, not that the checkout could not be made, and hands over what it printed", () => {
    const words = failureWords(setupFailed)
    expect(words.chip).toBe("setup failed")
    expect(words.head).toBe("the project's setup.sh failed")
    expect(words.line).toContain(".orkestra/worktrees/setup.sh")
    expect(words.says).toBe("Runs setup.sh again, then the work it stopped.")
    expect(words.setup).toBe("ERR_PNPM_NO_LOCKFILE")
  })

  it("leaves a checkout git could not make, and an old log's setup failure, on the checkout's words", () => {
    const words = failureWords(failed({ kind: "worktree", error: "setup failed in /w:\nx" }))
    expect(words.head).toBe("the checkout could not be prepared")
    expect(words.setup).toBeUndefined()
  })
})

describe("a spawn the runners-only guard refused", () => {
  const SAID =
    "--runners-only refuses `claude` on this host, and this project resolves no runner to run it in a sandbox — add a runner.sh to the project or to the host's data directory"
  const REFUSED = {
    chip: "runners only",
    head: "refused by --runners-only",
    line: SAID,
    press: "Restart",
    says: "Refused again until the project or the host has a runner.sh.",
  }

  it("leads with the guard on a refused agent CLI, not the provider's unnamed failure", () => {
    expect(failureWords(failed({ runnersOnly: SAID }))).toEqual(REFUSED)
  })

  it("leads with the guard on a refused setup.sh, not the checkout's retry line", () => {
    expect(
      failureWords(
        failed({ kind: "worktree", error: "setup failed in /repo/x", runnersOnly: SAID }),
      ),
    ).toEqual(REFUSED)
  })

  it("leads with the guard on a refused teardown.sh", () => {
    expect(
      failureWords(
        failed({
          kind: "archive",
          archiving: "merged",
          error: "teardown failed",
          runnersOnly: SAID,
        }),
      ),
    ).toEqual(REFUSED)
  })

  it("leads with the guard on a refused check or effect, not the script's printed output", () => {
    expect(
      failureWords(
        failed({ kind: "project", error: "`verify` could not be run", runnersOnly: SAID }),
      ),
    ).toEqual(REFUSED)
  })
})

describe("a remake that left the uncommitted changes behind", () => {
  const REF = "refs/orkestra/carried/t1"

  it("leads with where they are, on a checkout or a turn, and names the ref", () => {
    for (const kind of ["worktree", "provider", "project"] as const) {
      expect(failureWords(failed({ kind, carried: REF }))).toMatchObject({
        head: "the uncommitted changes did not come across",
        says: "Starts again from the trak's branch, without those changes.",
        carried: REF,
        press: "Restart",
      })
    }
  })

  it("never tells a person there is nothing to lose", () => {
    expect(failureWords(failed({ kind: "worktree", carried: REF })).line).not.toMatch(/lose/)
  })
})
