import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { BranchList } from "../types/workflow";

const POLL_INTERVAL_MS = 10_000;

export interface BranchInfo {
  branch: string | null;
  latestCommitMessage: string | null;
}

export function useCurrentBranch(): BranchInfo {
  const [branchInfo, setBranchInfo] = useState<BranchInfo>({
    branch: null,
    latestCommitMessage: null,
  });

  useEffect(() => {
    let cancelled = false;

    const fetch = async () => {
      try {
        const result = await invoke<BranchList>("workflow_list_branches");
        if (!cancelled) {
          setBranchInfo({
            branch: result.current,
            latestCommitMessage: result.latest_commit_message,
          });
        }
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

  return branchInfo;
}
