// Drawer-scoped task cache — owns diff fetching for the drawer's lifetime.
//
// Wrap each drawer body with this provider so diff data persists while the
// drawer is open, regardless of which tab is currently visible. The cache is
// dropped automatically when the drawer closes and the provider unmounts.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { HighlightedLine, HighlightedTaskDiff } from "../../hooks/useDiff";
import { useDiff } from "../../hooks/useDiff";
import { useTransport } from "../../transport";

export type ExpandPosition = "above" | "between" | "below";

// Per-file expansion intents: key is "${hunkIndex}:${position}", value is cumulative lines.
// Persists across diff resets so expansions survive agent commits.
type FileExpansions = Map<string, number>;
type ExpansionIntents = Map<string, FileExpansions>;

interface DrawerTaskContextValue {
  diff: HighlightedTaskDiff | null;
  diffLoading: boolean;
  diffError: unknown;
  // Per-file contextLines used only for HunkLines collapse threshold.
  fileContextLines: Map<string, number>;
  expandContext: (
    filePath: string,
    hunkIndex: number,
    position: ExpandPosition,
    amount: number,
  ) => Promise<void>;
}

const DrawerTaskContext = createContext<DrawerTaskContextValue | null>(null);

interface DrawerTaskProviderProps {
  taskId: string;
  children: React.ReactNode;
}

export function DrawerTaskProvider({ taskId, children }: DrawerTaskProviderProps) {
  const transport = useTransport();
  // Always fetch 3 context lines — expansion is handled locally via file content splicing.
  const { diff: remoteDiff, loading: diffLoading, error: diffError } = useDiff(taskId, 3);
  const [localDiff, setLocalDiff] = useState<HighlightedTaskDiff | null>(null);
  const [fileContextLines, setFileContextLines] = useState<Map<string, number>>(new Map());
  const [expansionIntents, setExpansionIntents] = useState<ExpansionIntents>(new Map());

  // Ref so the replay effect always reads the latest intents without being in its dep array.
  const expansionIntentsRef = useRef<ExpansionIntents>(expansionIntents);
  expansionIntentsRef.current = expansionIntents;

  // Cancel stale replays when remoteDiff changes again before replay finishes.
  const replayIdRef = useRef(0);

  // When the remote diff changes (agent pushed new code): show the new base immediately,
  // then replay all stored expansion intents on top of it.
  useEffect(() => {
    if (!remoteDiff) {
      setLocalDiff(null);
      setFileContextLines(new Map());
      return;
    }

    // Show base diff immediately so stale content never lingers.
    setLocalDiff(remoteDiff);
    setFileContextLines(new Map());

    const intents = expansionIntentsRef.current;
    if (intents.size === 0) return;

    const replayId = ++replayIdRef.current;

    (async () => {
      let augmented = remoteDiff;
      const newFileContextLines = new Map<string, number>();

      for (const [filePath, fileIntents] of intents) {
        if (fileIntents.size === 0) continue;

        let rawLines: HighlightedLine[];
        try {
          rawLines = await transport.call<HighlightedLine[]>("get_file_content", {
            task_id: taskId,
            file_path: filePath,
          });
        } catch {
          continue;
        }

        // Sort: above first, then between ascending, then below — order matters for merge tracking.
        const ops = [...fileIntents.entries()]
          .map(([key, amount]) => {
            const sep = key.lastIndexOf(":");
            return {
              hunkIndex: parseInt(key.slice(0, sep), 10),
              position: key.slice(sep + 1) as ExpandPosition,
              amount,
            };
          })
          .sort((a, b) => {
            if (a.hunkIndex !== b.hunkIndex) return a.hunkIndex - b.hunkIndex;
            const order: Record<ExpandPosition, number> = { above: 0, between: 1, below: 2 };
            return order[a.position] - order[b.position];
          });

        // Apply each op; track hunk index shifts caused by merges.
        let mergeOffset = 0;
        let fileTotalExpansion = 0;
        for (const op of ops) {
          const { diff: next, didMerge } = applySplice(
            augmented,
            filePath,
            rawLines,
            op.hunkIndex - mergeOffset,
            op.position,
            op.amount,
          );
          augmented = next;
          if (didMerge) mergeOffset++;
          fileTotalExpansion += op.amount;
        }

        if (fileTotalExpansion > 0) {
          newFileContextLines.set(filePath, 3 + fileTotalExpansion);
        }
      }

      if (replayId !== replayIdRef.current) return; // superseded by a newer diff
      setLocalDiff(augmented);
      setFileContextLines(newFileContextLines);
    })();
  }, [remoteDiff, transport, taskId]);

  const expandContext = useCallback(
    async (
      filePath: string,
      hunkIndex: number,
      position: ExpandPosition,
      amount: number,
    ): Promise<void> => {
      let rawLines: HighlightedLine[];
      try {
        rawLines = await transport.call<HighlightedLine[]>("get_file_content", {
          task_id: taskId,
          file_path: filePath,
        });
      } catch {
        return;
      }

      // Apply splice immediately to localDiff.
      setLocalDiff((prev) => {
        if (!prev) return prev;
        return applySplice(prev, filePath, rawLines, hunkIndex, position, amount).diff;
      });

      // Store intent cumulatively so replay after the next diff reset includes this expansion.
      setExpansionIntents((prev) => {
        const next = new Map(prev);
        const fileIntents = new Map(next.get(filePath) ?? []);
        const key = `${hunkIndex}:${position}`;
        fileIntents.set(key, (fileIntents.get(key) ?? 0) + amount);
        next.set(filePath, fileIntents);
        return next;
      });

      // Raise per-file collapse threshold so HunkLines doesn't re-collapse expanded lines.
      setFileContextLines((prev) => {
        const next = new Map(prev);
        next.set(filePath, (prev.get(filePath) ?? 3) + amount);
        return next;
      });
    },
    [transport, taskId],
  );

  return (
    <DrawerTaskContext.Provider
      value={{ diff: localDiff, diffLoading, diffError, fileContextLines, expandContext }}
    >
      {children}
    </DrawerTaskContext.Provider>
  );
}

export function useDrawerDiff(): DrawerTaskContextValue {
  const ctx = useContext(DrawerTaskContext);
  if (!ctx) throw new Error("useDrawerDiff must be used inside DrawerTaskProvider");
  return ctx;
}

// ============================================================================
// Splice logic
// ============================================================================

interface SpliceResult {
  diff: HighlightedTaskDiff;
  /** True if a "between" expansion caused two hunks to merge into one. */
  didMerge: boolean;
}

/** Pure function: applies one expansion to a diff and returns the new diff. */
function applySplice(
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
