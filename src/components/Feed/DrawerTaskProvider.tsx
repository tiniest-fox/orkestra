// Drawer-scoped task cache — owns diff fetching for the drawer's lifetime.
//
// Wrap each drawer body with this provider so diff data persists while the
// drawer is open, regardless of which tab is currently visible. The cache is
// dropped automatically when the drawer closes and the provider unmounts.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { prefetchCommitDiff } from "../../hooks/useCommitDiff";
import type { HighlightedLine, HighlightedTaskDiff } from "../../hooks/useDiff";
import { useDiff } from "../../hooks/useDiff";
import { usePolling } from "../../hooks/usePolling";
import { useTransport } from "../../transport";
import type { CommitInfo } from "../../types/workflow";
import { isDisconnectError } from "../../utils/transportErrors";
import { applySplice, type ExpandPosition } from "./applySplice";

export type { ExpandPosition } from "./applySplice";

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
  taskId: string;
  branchCommits: CommitInfo[];
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
  const [branchCommits, setBranchCommits] = useState<CommitInfo[]>([]);

  const fetchBranchCommits = useCallback(async () => {
    try {
      const commits = await transport.call<CommitInfo[]>("get_branch_commits", {
        task_id: taskId,
      });
      setBranchCommits(commits);
      if (commits.length > 0) {
        prefetchCommitDiff(commits[0].hash, transport);
      }
    } catch (err) {
      if (!isDisconnectError(err)) {
        console.error("Failed to fetch branch commits:", err);
      }
    }
  }, [transport, taskId]);

  usePolling(fetchBranchCommits, 2000);

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
            const order: Record<ExpandPosition, number> = {
              above: 0,
              between: 1,
              "between-up": 2,
              below: 3,
            };
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
      value={{
        diff: localDiff,
        diffLoading,
        diffError,
        fileContextLines,
        expandContext,
        taskId,
        branchCommits,
      }}
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
