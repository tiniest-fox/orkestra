// Manages worktree prewarm lifecycle — starts on mount (when active), cancels on unmount.

import { useCallback, useEffect, useRef, useState } from "react";
import { generatePetname } from "../lib/petname";
import { useTransport } from "../transport";

/**
 * Fires prewarm_worktree when `active` becomes true, cancels on unmount or when `active` goes false.
 * Returns the prewarmId to pass to task/chat creation calls, and an adopt() function that must be
 * called before task creation so cleanup does not fire cancel_prewarm after the worktree is adopted.
 * Returns null prewarmId if prewarm failed or has not yet started.
 */
export function usePrewarm(
  active: boolean,
  baseBranch?: string,
): { prewarmId: string | null; adopt: () => void } {
  const transport = useTransport();
  const [prewarmId, setPrewarmId] = useState<string | null>(null);
  // Ref tracks current ID for cleanup closure without depending on stale state.
  const prewarmIdRef = useRef<string | null>(null);

  const adopt = useCallback(() => {
    // Null out the ref so the cleanup effect no longer fires cancel_prewarm.
    prewarmIdRef.current = null;
  }, []);

  useEffect(() => {
    if (!active) return;

    const id = generatePetname();
    prewarmIdRef.current = id;
    setPrewarmId(id);

    transport
      .call("prewarm_worktree", {
        task_id: id,
        base_branch: baseBranch ?? null,
      })
      .catch(() => {
        prewarmIdRef.current = null;
        setPrewarmId(null);
      });

    return () => {
      if (prewarmIdRef.current) {
        transport.call("cancel_prewarm", { task_id: prewarmIdRef.current }).catch(() => {});
        prewarmIdRef.current = null;
      }
      setPrewarmId(null);
    };
  }, [active, baseBranch, transport]);

  return { prewarmId, adopt };
}
