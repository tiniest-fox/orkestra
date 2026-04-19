// Hook for optimistic message display — shows user message instantly on send,
// self-corrects when real logs arrive or an error occurs.

import { useCallback, useEffect, useState } from "react";

/**
 * Returns optimistic message state and a scroll-trigger counter for chat send flows.
 *
 * Clears `optimisticMessage` automatically when:
 * - `logs` reference changes (real server data has arrived)
 * - `error` becomes non-null (send failed; message should not stay visible)
 */
export function useOptimisticMessage(
  logs: unknown[],
  error?: unknown,
): {
  optimisticMessage: string | null;
  setOptimisticMessage: (value: string | null) => void;
  scrollTrigger: number;
  triggerScroll: () => void;
} {
  const [optimisticMessage, setOptimisticMessage] = useState<string | null>(null);
  const [scrollTrigger, setScrollTrigger] = useState(0);

  // Clear when real logs arrive (logs reference only changes when new entries exist).
  // biome-ignore lint/correctness/useExhaustiveDependencies: logs is the trigger, not a value consumed inside
  useEffect(() => {
    setOptimisticMessage(null);
  }, [logs]);

  // Clear when an error occurs so a failed-send message does not linger.
  useEffect(() => {
    if (error != null) {
      setOptimisticMessage(null);
    }
  }, [error]);

  const triggerScroll = useCallback(() => {
    setScrollTrigger((n) => n + 1);
  }, []);

  return { optimisticMessage, setOptimisticMessage, scrollTrigger, triggerScroll };
}
