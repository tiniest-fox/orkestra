//! Portal page — project list, auth gate, and add-project modal.

import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/ui";
import { ModalPanel } from "../components/ui/ModalPanel";
import type { GithubStatus, Project } from "./api";
import { checkGithubStatus, fetchProjects, generatePairingCode, getToken } from "./api";
import { PairingCodeBox } from "./components/PairingCodeBox";
import { PairingForm } from "./components/PairingForm";
import { ProjectList } from "./components/ProjectList";
import { RepoSearch } from "./components/RepoSearch";
import { ServiceHeader } from "./components/ServiceHeader";
import { SERVICE_TITLE } from "./constants";

// ============================================================================
// Component
// ============================================================================

export function PortalPage() {
  const [hasToken, _setHasToken] = useState(() => Boolean(getToken()));

  // Defensively reset the title and strip any stale ?project= param on mount.
  // These can linger from previous navigation or shared URLs.
  useEffect(() => {
    document.title = SERVICE_TITLE;
    const url = new URL(window.location.href);
    if (url.searchParams.has("project")) {
      url.searchParams.delete("project");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<number | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch {
      // 401 is handled in apiFetch (reloads); other errors are silent retries
    }
  }, []);

  useEffect(() => {
    if (!hasToken) return;

    loadProjects();
    checkGithubStatus()
      .then((s) => setGithubStatus(s))
      .catch((e) =>
        setGithubStatus({ available: false, error: e instanceof Error ? e.message : String(e) }),
      );

    const interval = setInterval(() => {
      loadProjects();
    }, 5000);

    return () => clearInterval(interval);
  }, [hasToken, loadProjects]);

  async function handleGeneratePairingCode() {
    setPairingError(null);
    try {
      const result = await generatePairingCode();
      setPairingCode(result.code);
      setPairingExpiresAt(Date.now() + 5 * 60 * 1000);
    } catch (e) {
      setPairingError(e instanceof Error ? e.message : String(e));
    }
  }

  function handlePairingExpired() {
    setPairingCode(null);
    setPairingExpiresAt(null);
  }

  function handleProjectAdded() {
    setShowAddModal(false);
    loadProjects();
  }

  if (!hasToken) {
    return <PairingForm />;
  }

  return (
    <div className="min-h-screen bg-canvas py-8 px-4">
      <div className="max-w-[640px] mx-auto">
        <ServiceHeader onGeneratePairingCode={handleGeneratePairingCode} />

        {pairingCode && pairingExpiresAt && (
          <PairingCodeBox
            code={pairingCode}
            expiresAt={pairingExpiresAt}
            onExpired={handlePairingExpired}
          />
        )}
        {pairingError && <p className="text-sm text-status-error mt-2">{pairingError}</p>}

        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mt-6 mb-3">
          Projects
        </h2>

        <ProjectList projects={projects} onRefresh={loadProjects} />

        <div className="mt-3">
          <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
            + Add Project
          </Button>
        </div>

        <ModalPanel
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          className="left-1/2 -translate-x-1/2 top-[15%] w-full max-w-[520px] px-4"
        >
          <RepoSearch
            githubStatus={githubStatus}
            onClose={() => setShowAddModal(false)}
            onProjectAdded={handleProjectAdded}
          />
        </ModalPanel>
      </div>
    </div>
  );
}
