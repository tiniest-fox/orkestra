// Pure splice logic for expanding diff context around hunks.

import type { HighlightedLine, HighlightedTaskDiff } from "../../hooks/useDiff";

export type ExpandPosition = "above" | "between" | "between-up" | "below";

export interface SpliceResult {
  diff: HighlightedTaskDiff;
  /** True if a "between" expansion caused two hunks to merge into one. */
  didMerge: boolean;
}

/** Pure function: applies one expansion to a diff and returns the new diff. */
export function applySplice(
  diff: HighlightedTaskDiff,
  filePath: string,
  rawLines: HighlightedLine[],
  hunkIndex: number,
  position: ExpandPosition,
  amount: number,
): SpliceResult {
  let didMerge = false;

  const files = diff.files.map((file) => {
    if (file.path !== filePath) return file;

    const hunks = file.hunks.map((h) => ({ ...h, lines: [...h.lines] }));
    const hunk = hunks[hunkIndex];
    if (!hunk) return file;

    // Constant offset between old and new line numbers for this hunk's leading context.
    const lineOffset = hunk.old_start - hunk.new_start;

    if (position === "above") {
      const actualAmount = Math.min(amount, hunk.new_start - 1);
      if (actualAmount === 0) return file;

      const newLines: HighlightedLine[] = [];
      for (let i = actualAmount; i >= 1; i--) {
        const newLineNum = hunk.new_start - i;
        const raw = rawLines[newLineNum - 1];
        if (!raw) continue;
        newLines.push({
          ...raw,
          line_type: "context",
          new_line_number: newLineNum,
          old_line_number: newLineNum + lineOffset,
        });
      }
      hunks[hunkIndex] = {
        ...hunk,
        new_start: hunk.new_start - actualAmount,
        old_start: hunk.old_start - actualAmount,
        new_count: hunk.new_count + actualAmount,
        old_count: hunk.old_count + actualAmount,
        lines: [...newLines, ...hunk.lines],
      };
    } else if (position === "below") {
      const lastLine = [...hunk.lines].reverse().find((l) => l.new_line_number !== null);
      const lastNewLine = lastLine?.new_line_number ?? hunk.new_start + hunk.new_count - 1;
      const lastOldLine =
        [...hunk.lines].reverse().find((l) => l.old_line_number !== null)?.old_line_number ??
        hunk.old_start + hunk.old_count - 1;

      const actualAmount = Math.min(amount, rawLines.length - lastNewLine);
      if (actualAmount === 0) return file;

      const newLines: HighlightedLine[] = [];
      for (let i = 1; i <= actualAmount; i++) {
        const newLineNum = lastNewLine + i;
        const raw = rawLines[newLineNum - 1];
        if (!raw) break;
        newLines.push({
          ...raw,
          line_type: "context",
          new_line_number: newLineNum,
          old_line_number: lastOldLine + i,
        });
      }
      hunks[hunkIndex] = {
        ...hunk,
        new_count: hunk.new_count + newLines.length,
        old_count: hunk.old_count + newLines.length,
        lines: [...hunk.lines, ...newLines],
      };
    } else if (position === "between-up") {
      // Expand upward from the top of hunk[hunkIndex + 1] toward hunk[hunkIndex].
      const hunkBelow = hunks[hunkIndex + 1];
      if (!hunkBelow) return file;

      const lastNewAbove = hunk.new_start + hunk.new_count - 1;
      const gapSize = hunkBelow.new_start - lastNewAbove - 1;
      const actualAmount = Math.min(amount, gapSize);
      if (actualAmount === 0) return file;

      const belowOffset = hunkBelow.old_start - hunkBelow.new_start;
      const newLines: HighlightedLine[] = [];
      for (let i = actualAmount; i >= 1; i--) {
        const newLineNum = hunkBelow.new_start - i;
        const raw = rawLines[newLineNum - 1];
        if (!raw) continue;
        newLines.push({
          ...raw,
          line_type: "context",
          new_line_number: newLineNum,
          old_line_number: newLineNum + belowOffset,
        });
      }

      const mergedBelow = {
        ...hunkBelow,
        new_start: hunkBelow.new_start - actualAmount,
        old_start: hunkBelow.old_start - actualAmount,
        new_count: hunkBelow.new_count + newLines.length,
        old_count: hunkBelow.old_count + newLines.length,
        lines: [...newLines, ...hunkBelow.lines],
      };
      hunks[hunkIndex + 1] = mergedBelow;

      // If gap is fully closed, merge the two hunks into one.
      if (actualAmount === gapSize) {
        hunks[hunkIndex] = {
          ...hunk,
          new_count: hunk.new_count + mergedBelow.new_count,
          old_count: hunk.old_count + mergedBelow.old_count,
          lines: [...hunk.lines, ...mergedBelow.lines],
        };
        hunks.splice(hunkIndex + 1, 1);
        didMerge = true;
      }
    } else {
      // "between": expand from the bottom of hunk[hunkIndex] toward hunk[hunkIndex+1].
      const hunkBelow = hunks[hunkIndex + 1];
      if (!hunkBelow) return file;

      const lastNewAbove = hunk.new_start + hunk.new_count - 1;
      const lastOldAbove = hunk.old_start + hunk.old_count - 1;
      const gapSize = hunkBelow.new_start - lastNewAbove - 1;
      const actualAmount = Math.min(amount, gapSize);
      if (actualAmount === 0) return file;

      const newLines: HighlightedLine[] = [];
      for (let i = 1; i <= actualAmount; i++) {
        const newLineNum = lastNewAbove + i;
        const raw = rawLines[newLineNum - 1];
        if (!raw) break;
        newLines.push({
          ...raw,
          line_type: "context",
          new_line_number: newLineNum,
          old_line_number: lastOldAbove + i,
        });
      }

      const mergedAbove = {
        ...hunk,
        new_count: hunk.new_count + newLines.length,
        old_count: hunk.old_count + newLines.length,
        lines: [...hunk.lines, ...newLines],
      };
      hunks[hunkIndex] = mergedAbove;

      // If gap is fully closed, merge the two hunks into one.
      const remainingGap = hunkBelow.new_start - (lastNewAbove + newLines.length) - 1;
      if (remainingGap === 0) {
        hunks[hunkIndex] = {
          ...mergedAbove,
          new_count: mergedAbove.new_count + hunkBelow.new_count,
          old_count: mergedAbove.old_count + hunkBelow.old_count,
          lines: [...mergedAbove.lines, ...hunkBelow.lines],
        };
        hunks.splice(hunkIndex + 1, 1);
        didMerge = true;
      }
    }

    return { ...file, hunks };
  });

  return { diff: { ...diff, files }, didMerge };
}
