// ProjectLogsModal — displays recent debug.log lines for a project,
// polling every 3 seconds while open.

import { useCallback, useEffect, useRef, useState } from "react";
import { DrawerHeader } from "../../components/ui/Drawer/DrawerHeader";
import { ModalPanel } from "../../components/ui/ModalPanel";
import { Panel } from "../../components/ui/Panel/Panel";
import { fetchProjectLogs } from "../api";

interface ProjectLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

export function ProjectLogsModal({
  isOpen,
  onClose,
  projectId,
  projectName,
}: ProjectLogsModalProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLSpanElement>(null);

  const loadLogs = useCallback(async () => {
    try {
      const result = await fetchProjectLogs(projectId);
      setLines(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Fetch on open + poll every 3s
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setLines([]);
    setError(null);
    loadLogs();
    const interval = setInterval(loadLogs, 3000);
    return () => clearInterval(interval);
  }, [isOpen, loadLogs]);

  // Auto-scroll to bottom when lines change
  // biome-ignore lint/correctness/useExhaustiveDependencies: lines triggers re-scroll on new data
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <ModalPanel
      isOpen={isOpen}
      onClose={onClose}
      className="left-0 right-0 mx-auto top-[10%] w-full max-w-[700px] px-4"
    >
      <Panel autoFill={false}>
        <DrawerHeader title={`${projectName} — Logs`} onClose={onClose} />
        <Panel.Body scrollable className="max-h-[60vh]">
          {loading && lines.length === 0 && (
            <p className="text-text-secondary text-sm p-4">Loading logs...</p>
          )}
          {error && <p className="text-status-error text-sm p-4">{error}</p>}
          {!loading && !error && lines.length === 0 && (
            <p className="text-text-secondary text-sm p-4">
              No log file found. Logs appear once the project has been running.
            </p>
          )}
          {lines.length > 0 && (
            <pre className="text-xs font-mono text-text-primary whitespace-pre-wrap break-words p-3">
              {lines.join("\n")}
              <span ref={bottomRef} />
            </pre>
          )}
        </Panel.Body>
      </Panel>
    </ModalPanel>
  );
}
