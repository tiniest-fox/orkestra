//! Hotkey navigation through stage run history ([/]).
//! Reuses [ and ] — DrawerDiffTab registers its own handlers on top of these
//! when the diff tab is active (last registered wins in HotkeyScope), so file
//! navigation takes priority on the diff tab and session navigation resumes
//! automatically when DrawerDiffTab unmounts.

import type { StageRun } from "../../utils/stageRuns";
import { useNavHandler } from "../ui/HotkeyScope";

/**
 * Register [ and ] hotkeys for navigating between stage runs.
 * Priority over DrawerDiffTab's file navigation is handled by HotkeyScope's
 * stack — no manual guard needed here.
 */
export function useRunNavigation(
  runs: StageRun[],
  selectedRunIdx: number | null,
  setSelectedRunIdx: (idx: number | null) => void,
  /** When true, all runs are past (the current "slot" is a synthetic waiting chip, not in runs). */
  hasWaitingChip = false,
) {
  // In normal mode the last run IS the current run, so past runs stop at runs.length - 2.
  // In waiting mode all runs are past, so past runs go up to runs.length - 1.
  const lastPastIdx = hasWaitingChip ? runs.length - 1 : runs.length - 2;

  useNavHandler("[", () => {
    if (selectedRunIdx === null) {
      // At current — go to the last past run.
      if (lastPastIdx >= 0) setSelectedRunIdx(lastPastIdx);
    } else if (selectedRunIdx > 0) {
      setSelectedRunIdx(selectedRunIdx - 1);
    }
  });

  useNavHandler("]", () => {
    if (selectedRunIdx === null) return; // Already at current
    if (selectedRunIdx < lastPastIdx) {
      setSelectedRunIdx(selectedRunIdx + 1);
    } else {
      setSelectedRunIdx(null); // Last past run → back to current
    }
  });
}
