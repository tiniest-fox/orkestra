/**
 * The four ways to run a trak, and what each is called on screen.
 *
 * **One vocabulary for the two surfaces that draw it.** New Trak asks the mode once as
 * the trak starts, and the trak's own screen reads it out and changes it afterwards —
 * two features, so the words live here rather than in either, for the reason `tone` does:
 * two lists of four would be a drift no compiler catches.
 *
 * **The order is the order they are offered in**, and it is deliberate: every gate first,
 * because it is the default and the safe one, then the three that give some of them up,
 * ending on the one that gives up all of them.
 *
 * **Title case on screen, the identifier in the record.** A trak's mode is `manual`,
 * `smart`, `decider` or `auto` in its own log and on the wire, and both are unchanged — what
 * a person reads is a name beside a phrase. The mark says *who approves*: a person, a person
 * for the parts that matter, a person only where the work could go different ways, nobody.
 */

import type { LucideIcon } from "lucide-react"
import { Bot, Signpost, User, UserCheck } from "lucide-react"
import type { RunModeDto } from "../api/types"

export const MODES: readonly RunModeDto[] = ["manual", "smart", "decider", "auto"]

export interface ModeWords {
  readonly name: string
  readonly phrase: string
  readonly mark: LucideIcon
}

export const MODE_WORDS: Record<RunModeDto, ModeWords> = {
  manual: { name: "Manual", phrase: "You review everything", mark: User },
  smart: { name: "Smart", phrase: "Only what matters", mark: UserCheck },
  decider: { name: "Decider", phrase: "You make the calls", mark: Signpost },
  auto: { name: "Auto", phrase: "Runs on its own", mark: Bot },
}
