/**
 * The two shapes of warrant, which are not two sizes of one thing.
 *
 * An uneventful gate is three clauses — one the turn wrote and two the engine read off
 * the plan and the log; the mode is one clause and has no evidence to give beyond the
 * word the trak was started with. The temptation is to pad the second into the first's
 * shape, and what that would produce is three ticked claims nothing checked.
 *
 * Where a warrant *reaches* either card is `DrawerPane.test.tsx`, which is the wiring.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import UnattendedBand from "./UnattendedBand"

afterEach(cleanup)

describe("UnattendedBand", () => {
  it("prints the rung the turn reported, and what the engine found nothing of", () => {
    render(<UnattendedBand why={{ _tag: "Uneventful", at: 4, ambiguity: "none" }} />)

    // The rung verbatim and attributed: it is the one clause a party with an interest
    // wrote, where the other two are absences read off the plan and the log.
    expect(screen.getByText("ambiguity: none")).toBeDefined()
    expect(screen.getByText("what the turn said it ran into")).toBeDefined()
    expect(screen.getByText("one turn here")).toBeDefined()
    // **`no unplanned work`, not `nothing raised`** — a review that sent a document back
    // raised something and still comes through here, so the wider claim would contradict
    // the corrections printed under it.
    expect(screen.getByText("no unplanned work")).toBeDefined()
  })

  it("names the mode at the far end rather than a rule with a number in it", () => {
    render(<UnattendedBand why={{ _tag: "Uneventful", at: 7, ambiguity: "none" }} />)

    // Several rules could have been the one that fired, and the likeliest is the rung
    // above — so no bound is printed as if it were the one that decides.
    expect(screen.getByText("smart · nothing asked for a person")).toBeDefined()
  })

  it("gives the mode one clause and no note, because a mode does not run out", () => {
    render(<UnattendedBand why={{ _tag: "Mode", at: 2 }} />)

    expect(screen.getByText("nobody reads this trak's documents")).toBeDefined()
    expect(screen.getByText("the mode it was started in")).toBeDefined()
    expect(screen.queryByText(/^smart /)).toBeNull()
    expect(screen.queryByText("one turn here")).toBeNull()
  })

  it("says what happened to the gate, in the one phrase both surfaces use", () => {
    // *Approved* is this app's word for a thing a person did, and no `HumanActed` is
    // written when this happens — so the phrase names the gate and nothing corroborates
    // it as an act. It is the same string the map's mark carries.
    render(<UnattendedBand why={{ _tag: "Mode", at: 0 }} />)

    expect(screen.getByText("automatically approved")).toBeDefined()
  })
})
