// Latest log line for a transitioning project, with live polling.

import { useCallback, useState } from "react";
import { usePolling } from "../../hooks/usePolling";
import { stripAnsi } from "../../utils/ansi";
import { fetchProjectLogs } from "../api";

interface ProjectLatestLogProps {
  projectId: string;
  fallback: string;
}

export function ProjectLatestLog({ projectId, fallback }: ProjectLatestLogProps) {
  const [logLine, setLogLine] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const lines = await fetchProjectLogs(projectId, 1);
      const last = lines[lines.length - 1];
      const stripped = last ? stripAnsi(last).trim() : null;
      setLogLine(stripped || null);
    } catch {
      // Silently ignore — supplementary UI, not critical
    }
  }, [projectId]);

  usePolling(poll, 2000);

  return <span className="truncate">{logLine ?? fallback}</span>;
}
