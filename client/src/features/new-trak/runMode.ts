/**
 * The remembered run mode, as this screen reads and writes it. The four modes and
 * their words are `format/runMode`, which the trak's own screen draws too.
 *
 * `remembered` is what makes the choice stick between traks. It reads a string nobody
 * validates — a person editing storage, a value written by an older build, a key
 * another app happens to share — so anything that is not one of the four is *nothing
 * was chosen*, which is `manual`. There is no error to report: a preference that
 * cannot be read is one that was never expressed.
 */

import type { RunModeDto } from "../../api/types"
import { MODES } from "../../format/runMode"

/** Where the last choice is kept. Namespaced, because the origin is shared with nothing. */
export const MODE_KEY = "orkestra.run-mode"

export const remembered = (raw: string | undefined): RunModeDto =>
  MODES.find((mode) => mode === raw) ?? "manual"

/**
 * The mode New Chat opens a trak in: the remembered one, except that `auto` is `smart`.
 *
 * A chat inherits its mode into whatever work it raises, and `auto` approves every gate
 * in advance — the chat would answer once, close, and plan and run what it raised with
 * nobody reading any of it. `smart` still holds a conversational entry at its gate
 * whatever it filed, so the chat waits for its person and the quiet steps after it go
 * past. Somebody who wants `auto` there sets it on the trak's own screen. `decider` passes
 * through: it stops at every conversation already.
 */
export const forChat = (mode: RunModeDto): RunModeDto => (mode === "auto" ? "smart" : mode)
