/**
 * A trak's preparation in words: the phrase a row and a block lead with, and the line under
 * it on the trak's own screen.
 *
 * **No provider is named here.** A sandbox's line is the runner file's own `description`,
 * which the engine sends beside the phase — the one place a project says whose sandboxes
 * these are — and the generic sentence only where the runner file went away under it.
 *
 * In `format/` because both features say it: the list's row and the trak's screen.
 */

import type { PreparingPhaseDto } from "../api/types"

export interface PhaseWords {
  /** What is being done, in a phrase. */
  readonly label: string
  /** The sentence under it. */
  readonly line: string
}

/** The runner's own words where the engine sent them, `fallback` where it did not. */
const runnerLine = (runner: string | undefined, fallback: string): string => runner ?? fallback

export const phaseWords = (phase: PreparingPhaseDto): PhaseWords => {
  switch (phase._tag) {
    case "Checkout":
      return {
        label: "Making a local worktree",
        line: "A branch of its own, checked out on the engine's machine.",
      }
    case "Creating":
      return {
        label: "Creating a sandbox from the tools template",
        line: runnerLine(phase.runner, "A sandbox of its own, made from the runner's template."),
      }
    case "Resuming":
      return {
        label: "Resuming the stopped sandbox",
        line: runnerLine(phase.runner, "The sandbox stopped while idle and is starting again."),
      }
    case "Rebuilding":
      return {
        label: "Rebuilding the stale sandbox, carrying uncommitted work",
        line: runnerLine(
          phase.runner,
          "Made again from the branch, its uncommitted changes put back.",
        ),
      }
    case "Seeding":
      return {
        label: "Seeding the repository",
        line: "The branch and its history, sent into the new sandbox.",
      }
    case "Copying":
      return {
        label: `Copying tools and the home mirror · ${String(phase.sent)} of ${String(phase.total)}`,
        line: "The files a command in the sandbox reads, sent from the engine's machine.",
      }
    case "SettingUp":
      return {
        label: "Running setup.sh",
        line: "The project's setup script, before the work that needs it.",
      }
    case "SetupBeside":
      return {
        label: "Setup still running",
        line: "The turn started ahead of setup.sh; its shell commands wait until setup ends.",
      }
  }
}
