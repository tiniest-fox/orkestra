// Git sync status section in the PR tab — shows branch name, ahead/behind/diverged state, and action buttons.

import { useCallback, useEffect, useState } from "react";
import { useTransport } from "../../../transport";
import type { SyncStatus } from "../../../types/workflow";
import { confirmAction } from "../../../utils/confirmAction";
import { extractErrorMessage } from "../../../utils/errors";
import { isDisconnectError } from "../../../utils/transportErrors";
import { Button } from "../../ui/Button";

// ============================================================================
// Types
// ============================================================================

type ActionLoading = "fetch" | "pull" | "push" | "force_push" | null;

interface PrGitSectionProps {
  taskId: string;
  branchName: string;
}

// ============================================================================
// Component
// ============================================================================

export function PrGitSection({ taskId, branchName }: PrGitSectionProps) {
  const transport = useTransport();
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<ActionLoading>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const status = await transport.call<SyncStatus | null>("task_sync_status", {
        task_id: taskId,
      });
      setSyncStatus(status);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }, [transport, taskId]);

  useEffect(() => {
    setLoading(true);
    setSyncStatus(undefined);
    setError(null);
    fetchSyncStatus().finally(() => setLoading(false));
  }, [fetchSyncStatus]);

  const handleFetch = useCallback(async () => {
    setActionLoading("fetch");
    setError(null);
    try {
      await transport.call("git_fetch");
      await fetchSyncStatus();
    } catch (err) {
      if (!isDisconnectError(err)) {
        setError(extractErrorMessage(err));
      }
    } finally {
      setActionLoading(null);
    }
  }, [transport, fetchSyncStatus]);

  const handlePull = useCallback(async () => {
    setActionLoading("pull");
    setError(null);
    try {
      await transport.call("pull_pr_changes", { task_id: taskId });
      await fetchSyncStatus();
    } catch (err) {
      if (!isDisconnectError(err)) {
        setError(extractErrorMessage(err));
      }
    } finally {
      setActionLoading(null);
    }
  }, [transport, taskId, fetchSyncStatus]);

  const handlePush = useCallback(async () => {
    setActionLoading("push");
    setError(null);
    try {
      await transport.call("push_pr_changes", { task_id: taskId });
      await fetchSyncStatus();
    } catch (err) {
      if (!isDisconnectError(err)) {
        setError(extractErrorMessage(err));
      }
    } finally {
      setActionLoading(null);
    }
  }, [transport, taskId, fetchSyncStatus]);

  const handleForcePush = useCallback(async () => {
    const confirmed = await confirmAction(
      "Force push will overwrite the remote branch. This cannot be undone. Continue?",
    );
    if (!confirmed) return;
    setActionLoading("force_push");
    setError(null);
    try {
      await transport.call("force_push_pr_changes", { task_id: taskId });
      await fetchSyncStatus();
    } catch (err) {
      if (!isDisconnectError(err)) {
        setError(extractErrorMessage(err));
      }
    } finally {
      setActionLoading(null);
    }
  }, [transport, taskId, fetchSyncStatus]);

  const isActionBusy = actionLoading !== null;

  if (loading) {
    return (
      <div className="px-6 py-3 border-b border-border">
        <span className="font-mono text-forge-mono-sm text-text-quaternary">
          Loading sync status…
        </span>
      </div>
    );
  }

  // Remote branch not found
  if (syncStatus === null) {
    return (
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border">
        <span className="font-mono text-forge-mono-sm text-text-tertiary">
          Remote branch not found
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={handlePush}
          disabled={isActionBusy}
          loading={actionLoading === "push"}
        >
          Push
        </Button>
        {error && (
          <span className="ml-auto font-mono text-forge-mono-sm text-status-error truncate">
            {error}
          </span>
        )}
      </div>
    );
  }

  // Show error if initial fetch failed (syncStatus never populated)
  if (syncStatus === undefined && error) {
    return (
      <div className="px-6 py-3 border-b border-border">
        <span className="font-mono text-forge-mono-sm text-status-error">{error}</span>
      </div>
    );
  }

  if (syncStatus === undefined) return null;
  const { ahead, behind, diverged } = syncStatus;
  const inSync = ahead === 0 && behind === 0 && !diverged;

  return (
    <div className="px-6 py-3 border-b border-border">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Branch name */}
        <span className="font-mono text-forge-mono-sm text-accent">{branchName}</span>

        {/* Status indicators */}
        {diverged ? (
          <span className="font-mono text-forge-mono-sm text-status-warning bg-status-warning-bg border border-status-warning/40 px-2 py-0.5 rounded">
            Diverged
          </span>
        ) : inSync ? (
          <span className="font-mono text-forge-mono-sm text-text-quaternary">In sync</span>
        ) : (
          <span className="font-mono text-forge-mono-sm text-text-tertiary">
            {ahead > 0 && <span>↑{ahead}</span>}
            {ahead > 0 && behind > 0 && <span className="mx-1">·</span>}
            {behind > 0 && <span>↓{behind}</span>}
          </span>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 ml-auto">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleFetch}
            disabled={isActionBusy}
            loading={actionLoading === "fetch"}
          >
            Fetch
          </Button>
          {behind > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handlePull}
              disabled={isActionBusy}
              loading={actionLoading === "pull"}
            >
              Pull
            </Button>
          )}
          {ahead > 0 && !diverged && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handlePush}
              disabled={isActionBusy}
              loading={actionLoading === "push"}
            >
              Push
            </Button>
          )}
          {diverged && (
            <Button
              size="sm"
              variant="warning"
              onClick={handleForcePush}
              disabled={isActionBusy}
              loading={actionLoading === "force_push"}
            >
              Force Push
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-2">
          <span className="font-mono text-forge-mono-sm text-status-error">{error}</span>
        </div>
      )}
    </div>
  );
}
