//! GitHub repo picker panel with debounced search and focus-stable input.
//! Uses a controlled React input to prevent focus loss during re-renders.

import { useEffect, useRef, useState } from "react";
import { Button, LoadingState, Panel } from "../../components/ui";
import type { GithubRepo, GithubStatus } from "../api";
import { addProject, searchRepos } from "../api";

// ============================================================================
// Types
// ============================================================================

interface RepoSearchProps {
  githubStatus: GithubStatus | null;
  onClose: () => void;
  onProjectAdded: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function RepoSearch({ githubStatus, onClose, onProjectAdded }: RepoSearchProps) {
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load repos on open and debounce subsequent searches
  useEffect(() => {
    if (!githubStatus?.available) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(
      async () => {
        // Cancel any in-flight request
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoadingRepos(true);
        try {
          const results = await searchRepos(query || undefined);
          if (!controller.signal.aborted) {
            setRepos(results);
          }
        } catch {
          // Silent — show stale results (ignore abort errors)
        } finally {
          if (!controller.signal.aborted) {
            setLoadingRepos(false);
          }
        }
      },
      query ? 300 : 0,
    );

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [query, githubStatus?.available]);

  async function handleSelectRepo(repo: GithubRepo) {
    setAddError(null);
    setAdding(true);
    try {
      await addProject(repo.url, repo.nameWithOwner);
      onProjectAdded();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
      setAdding(false);
    }
  }

  return (
    <Panel autoFill={false} className="mt-3">
      <Panel.Header>
        <Panel.Title>Add Project</Panel.Title>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </Panel.Header>
      <Panel.Body>
        {githubStatus && !githubStatus.available ? (
          <div className="text-sm text-text-secondary space-y-1">
            <p className="font-medium">GitHub CLI not configured.</p>
            <p>
              Install:{" "}
              <code className="bg-surface-3 px-1 py-0.5 rounded text-xs">brew install gh</code>
            </p>
            <p>
              Authenticate:{" "}
              <code className="bg-surface-3 px-1 py-0.5 rounded text-xs">gh auth login</code>
            </p>
            {githubStatus.error && (
              <p className="text-status-error text-xs mt-2">{githubStatus.error}</p>
            )}
          </div>
        ) : (
          <>
            <input
              type="text"
              placeholder="Search repos..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full mb-3 px-3 py-2 bg-canvas border border-border rounded-panel-sm text-text-primary text-sm focus:outline-none focus:border-accent"
            />
            {loadingRepos ? (
              <LoadingState message="Loading repos..." />
            ) : repos.length === 0 ? (
              <p className="text-sm text-text-secondary text-center py-4">
                {query ? "No repos found." : "Start typing to search repos."}
              </p>
            ) : (
              <div className="max-h-[280px] overflow-y-auto -mx-4 px-4">
                {repos.map((repo) => (
                  <button
                    key={repo.nameWithOwner}
                    type="button"
                    className="w-full text-left flex items-start justify-between gap-4 px-2 py-2 rounded-panel-sm hover:bg-surface-2"
                    onClick={() => handleSelectRepo(repo)}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">
                        {repo.nameWithOwner}
                      </div>
                      {repo.description && (
                        <div className="text-xs text-text-secondary truncate mt-0.5">
                          {repo.description}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {addError && <p className="mt-2 text-xs text-status-error">{addError}</p>}
            {adding && !addError && (
              <p className="mt-2 text-xs text-text-secondary">Adding project...</p>
            )}
          </>
        )}
      </Panel.Body>
    </Panel>
  );
}
