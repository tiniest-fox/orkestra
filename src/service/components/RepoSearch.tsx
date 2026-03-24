// GitHub repo picker — fetches all accessible repos once, filters locally as you type.

import { useEffect, useMemo, useState } from "react";
import { LoadingState, Panel } from "../../components/ui";
import { DrawerHeader } from "../../components/ui/Drawer/DrawerHeader";
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
  const [allRepos, setAllRepos] = useState<GithubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Fetch all repos once when GitHub is available.
  useEffect(() => {
    if (!githubStatus?.available) return;
    setLoadingRepos(true);
    searchRepos()
      .then(setAllRepos)
      .catch(() => {})
      .finally(() => setLoadingRepos(false));
  }, [githubStatus?.available]);

  const filteredRepos = useMemo(() => {
    if (!query) return allRepos;
    const lower = query.toLowerCase();
    return allRepos.filter(
      (r) =>
        r.nameWithOwner.toLowerCase().includes(lower) ||
        (r.description ?? "").toLowerCase().includes(lower),
    );
  }, [allRepos, query]);

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
    <Panel autoFill={false}>
      <DrawerHeader title="Add Project" onClose={onClose} />
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
            ) : filteredRepos.length === 0 ? (
              <p className="text-sm text-text-secondary text-center py-4">
                {query ? "No matching repos." : "No repos found."}
              </p>
            ) : (
              <div className="max-h-[280px] overflow-y-auto -mx-4 px-4">
                {filteredRepos.map((repo) => (
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
