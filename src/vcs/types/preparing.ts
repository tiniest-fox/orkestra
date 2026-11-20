// types: what the engine is doing to give a trak somewhere to work, for a surface that
// shows a person which preparation is under way rather than one word for all of them.

import { Data } from "effect"

/**
 * One preparation, by what it does. `Checkout` is a linked worktree made on this machine.
 * `Creating`, `Resuming` and `Rebuilding` are the trak's sandbox made from the runner's
 * tools template, started again after an idle stop, or made again with its uncommitted work
 * carried across. `Seeding` is the repository sent into a new sandbox, `Copying` the files
 * a command there reads sent, `sent` of `total`. `SettingUp` is the project's setup script
 * run before the work that needs it, and `SetupBeside` the same script still running
 * beside a turn that started ahead of it.
 */
export type PreparingPhase = Data.TaggedEnum<{
  Checkout: {}
  Creating: {}
  Resuming: {}
  Rebuilding: {}
  Seeding: {}
  Copying: { readonly sent: number; readonly total: number }
  SettingUp: {}
  SetupBeside: {}
}>
export const PreparingPhase = Data.taggedEnum<PreparingPhase>()
