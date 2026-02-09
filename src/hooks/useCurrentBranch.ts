import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { BranchList } from "../types/workflow";

const POLL_INTERVAL_MS = 10_000;

export function useCurrentBranch(): string | null {
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetch = async () => {
      try {
        const result = await invoke<BranchList>("workflow_list_branches");
        if (!cancelled) setBranch(result.current);
      } catch {
        // Git not available
      }
    };

    fetch();
    const id = setInterval(fetch, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return branch;
}
