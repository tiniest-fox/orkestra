// Collapsible commit list panel for the diff tab.

import { ChevronDown, ChevronRight } from "lucide-react";
import type { CommitInfo } from "../../types/workflow";
import { relativeTime } from "../../utils/relativeTime";

interface DiffCommitPanelProps {
  commits: CommitInfo[];
  selectedHash: string | null; // null = "All changes"
  onSelectHash: (hash: string) => void;
  onSelectAll: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function DiffCommitPanel({
  commits,
  selectedHash,
  onSelectHash,
  onSelectAll,
  collapsed = false,
  onToggleCollapsed,
}: DiffCommitPanelProps) {
  const selectedCommit = selectedHash ? commits.find((c) => c.hash === selectedHash) : null;

  if (collapsed) {
    return (
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
        {onToggleCollapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            onKeyDown={() => {}}
            className="flex items-center gap-1.5 text-text-tertiary hover:text-text-primary transition-colors"
            aria-label="Expand commit list"
          >
            <ChevronRight size={14} />
            <span className="font-sans text-forge-mono-sm text-text-primary">
              {selectedCommit ? `${selectedCommit.hash} ${selectedCommit.message}` : "All changes"}
            </span>
            <span className="font-mono text-forge-mono-label text-text-quaternary">
              · {commits.length} commits
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-text-tertiary">
            <ChevronRight size={14} />
            <span className="font-sans text-forge-mono-sm text-text-primary">
              {selectedCommit ? `${selectedCommit.hash} ${selectedCommit.message}` : "All changes"}
            </span>
            <span className="font-mono text-forge-mono-label text-text-quaternary">
              · {commits.length} commits
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-b border-border bg-surface">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        {onToggleCollapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            onKeyDown={() => {}}
            className="flex items-center gap-1.5 text-text-tertiary hover:text-text-primary transition-colors"
            aria-label="Collapse commit list"
          >
            <ChevronDown size={14} />
            <span className="font-mono text-forge-mono-label text-text-quaternary">
              {commits.length} commits
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-text-tertiary">
            <ChevronDown size={14} />
            <span className="font-mono text-forge-mono-label text-text-quaternary">
              {commits.length} commits
            </span>
          </div>
        )}
      </div>
      <div className="max-h-[200px] overflow-y-auto">
        {commits.length === 0 ? (
          <div className="p-3 font-mono text-forge-mono-label text-text-quaternary">
            No commits yet.
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onSelectAll}
              onKeyDown={() => {}}
              className={[
                "w-full text-left px-3 py-2 border-b border-border transition-colors font-sans text-forge-mono-sm",
                selectedHash === null
                  ? "bg-accent-soft border-l-2 border-l-accent !pl-2.5 text-text-primary font-semibold"
                  : "hover:bg-canvas text-text-secondary",
              ].join(" ")}
            >
              All changes
            </button>
            {commits.map((commit) => (
              <button
                key={commit.hash}
                type="button"
                onClick={() => onSelectHash(commit.hash)}
                onKeyDown={() => {}}
                className={[
                  "w-full text-left px-3 py-2 border-b border-border transition-colors",
                  commit.hash === selectedHash
                    ? "bg-accent-soft border-l-2 border-l-accent !pl-2.5"
                    : "hover:bg-canvas",
                ].join(" ")}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-forge-mono-label text-text-quaternary bg-canvas px-1 py-0.5 rounded shrink-0">
                    {commit.hash}
                  </span>
                  <span className="font-sans text-forge-mono-sm text-text-primary truncate">
                    {commit.message}
                  </span>
                  <span className="font-mono text-forge-mono-label text-text-quaternary shrink-0">
                    {relativeTime(commit.timestamp)}
                  </span>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
