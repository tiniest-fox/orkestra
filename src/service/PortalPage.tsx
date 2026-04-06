// Portal page — full-viewport row-based service manager with navigation and filtering.

import { Inbox } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFeedNavigation } from "../components/Feed/useFeedNavigation";
import { EmptyState } from "../components/ui";
import { ModalPanel } from "../components/ui/ModalPanel";
import { NavigationScope } from "../components/ui/NavigationScope";
import { useIsMobile } from "../hooks/useIsMobile";
import { groupProjectsForService } from "../utils/projectGrouping";
import type { GithubStatus, Project, ProjectStatus } from "./api";
import {
  checkGithubStatus,
  fetchProjects,
  generatePairingCode,
  getToken,
  gitFetch,
  gitPull,
  gitPush,
  rebuildProject,
  removeProject,
  startProject,
  stopProject,
} from "./api";
import { PairingCodeBox } from "./components/PairingCodeBox";
import { PairingForm } from "./components/PairingForm";
import { ProjectList } from "./components/ProjectList";
import type { ProjectRowActions } from "./components/ProjectRow";
import { RepoSearch } from "./components/RepoSearch";
import { SecretsDrawer } from "./components/SecretsDrawer";
import { ServiceFilterBar } from "./components/ServiceFilterBar";
import { ServiceHeader } from "./components/ServiceHeader";
import { ServiceMobileTabBar } from "./components/ServiceMobileTabBar";
import { ServiceStatusLine } from "./components/ServiceStatusLine";
import { SERVICE_TITLE } from "./constants";

// ============================================================================
// Component
// ============================================================================

export function PortalPage() {
  const [hasToken, _setHasToken] = useState(() => Boolean(getToken()));
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const feedBodyRef = useRef<HTMLDivElement>(null);
  const commandBarInputRef = useRef<HTMLInputElement>(null);

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

  // -- Data state --
  const [projects, setProjects] = useState<Project[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<number | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [secretsProjectId, setSecretsProjectId] = useState<string | null>(null);

  // -- New state --
  const [filterText, setFilterText] = useState("");
  const [optimisticStatuses, setOptimisticStatuses] = useState<Map<string, ProjectStatus>>(
    new Map(),
  );
  const [actionErrors, setActionErrors] = useState<Map<string, string>>(new Map());

  const loadProjects = useCallback(async () => {
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch {
      // 401 is handled in apiFetch (reloads); other errors are silent retries
    } finally {
      setHasLoaded(true);
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

  // -- Derived state --

  // Apply optimistic status overrides to the project list
  const effectiveProjects = useMemo(
    () =>
      projects.map((p) => {
        const optimistic = optimisticStatuses.get(p.id);
        return optimistic ? { ...p, status: optimistic } : p;
      }),
    [projects, optimisticStatuses],
  );

  // Filter by project name (case-insensitive substring match)
  const filteredProjects = useMemo(() => {
    if (!filterText) return effectiveProjects;
    const lower = filterText.toLowerCase();
    return effectiveProjects.filter((p) => p.name.toLowerCase().includes(lower));
  }, [effectiveProjects, filterText]);

  const sections = useMemo(() => groupProjectsForService(filteredProjects), [filteredProjects]);
  const showSectionHeaders = sections.length >= 1;

  const orderedIds = useMemo(
    () => sections.flatMap((s) => s.projects.map((p) => p.id)),
    [sections],
  );

  const modalOpen = showAddModal || pairingCode !== null || secretsProjectId !== null;

  // -- Navigation --

  const onEnter = useCallback(
    (id: string) => {
      const status = optimisticStatuses.get(id) ?? projects.find((p) => p.id === id)?.status;
      if (status === "running") navigate(`/project/${id}`);
    },
    [projects, optimisticStatuses, navigate],
  );

  const { focusedId, setFocusedId, scrollSeq } = useFeedNavigation(orderedIds, modalOpen, onEnter);

  // -- Action handlers --

  const runAction = useCallback(
    async (id: string, optimistic: ProjectStatus, action: () => Promise<void>) => {
      setActionErrors((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setOptimisticStatuses((prev) => new Map(prev).set(id, optimistic));
      try {
        await action();
        setOptimisticStatuses((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        loadProjects();
      } catch (e) {
        setOptimisticStatuses((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        setActionErrors((prev) =>
          new Map(prev).set(id, e instanceof Error ? e.message : String(e)),
        );
      }
    },
    [loadProjects],
  );

  const projectActions = useMemo(() => {
    const map = new Map<string, ProjectRowActions>();
    for (const project of projects) {
      const id = project.id;
      const effectiveStatus = optimisticStatuses.get(id) ?? project.status;
      map.set(id, {
        effectiveStatus,
        busy: optimisticStatuses.has(id),
        actionError: actionErrors.get(id) ?? null,
        onStart: () => runAction(id, "starting", () => startProject(id)),
        onStop: () => runAction(id, "stopping", () => stopProject(id)),
        onRebuild: () => runAction(id, "rebuilding", () => rebuildProject(id)),
        onRemove: async () => {
          if (!window.confirm(`Remove project "${project.name}"? This cannot be undone.`)) return;
          await runAction(id, "removing", () => removeProject(id));
        },
        onOpen: () => navigate(`/project/${id}`),
        onGitFetch: () => runAction(id, project.status, () => gitFetch(id)),
        onGitPull: () => runAction(id, project.status, () => gitPull(id)),
        onGitPush: () => runAction(id, project.status, () => gitPush(id)),
        onCancel: () => runAction(id, "stopping", () => stopProject(id)),
        onManageSecrets: () => setSecretsProjectId(id),
      });
    }
    return map;
  }, [projects, optimisticStatuses, actionErrors, runAction, navigate]);

  // -- Pairing --

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

  function handlePairingDismissed() {
    setPairingCode(null);
    setPairingExpiresAt(null);
  }

  function handleProjectAdded() {
    setShowAddModal(false);
    loadProjects();
  }

  // Cmd+K focuses filter bar; Esc clears and blurs when focused.
  useEffect(() => {
    if (isMobile) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.key === "k") {
        e.preventDefault();
        commandBarInputRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && document.activeElement === commandBarInputRef.current) {
        e.preventDefault();
        setFilterText("");
        commandBarInputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile]);

  // -- Auth gate --
  if (!hasToken) {
    return <PairingForm />;
  }

  const hasNoProjects = hasLoaded && projects.length === 0;
  const hasNoFilterMatches = filterText.length > 0 && !hasNoProjects && sections.length === 0;

  return (
    <div className="h-full flex flex-col bg-canvas relative">
      <ServiceHeader
        hotkeyActive={!modalOpen}
        onAddProject={() => setShowAddModal(true)}
        onGeneratePairingCode={handleGeneratePairingCode}
      />
      <ServiceFilterBar
        filterText={filterText}
        onFilterChange={setFilterText}
        inputRef={commandBarInputRef}
      />
      {pairingError && <p className="px-6 py-2 text-sm text-status-error">{pairingError}</p>}
      <div ref={feedBodyRef} className="flex-1 overflow-y-auto">
        <NavigationScope activeId={focusedId} containerRef={feedBodyRef} scrollSeq={scrollSeq}>
          {!hasLoaded ? (
            // biome-ignore lint/a11y/useSemanticElements: status div is not a form output
            <div role="status" aria-label="Loading projects">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`grid grid-cols-[24px_minmax(0,1fr)_auto_auto] gap-4 px-6 py-2 ${isMobile ? "min-h-[48px]" : "min-h-[40px]"} items-center border-l-2 border-l-transparent animate-pulse`}
                >
                  <div className="flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-surface-2" />
                  </div>
                  <div className="min-w-0 flex flex-col gap-1">
                    <div className="h-3 w-40 rounded bg-surface-2" />
                    <div className="h-2 w-16 rounded bg-surface-2" />
                  </div>
                  <div className="h-6 w-14 rounded bg-surface-2" />
                  <div className="h-6 w-6 rounded bg-surface-2" />
                </div>
              ))}
            </div>
          ) : hasNoProjects && !filterText ? (
            <EmptyState
              className="flex-1"
              icon={Inbox}
              message="No projects yet."
              description={isMobile ? "Tap + to add a project." : "Press A to add a project."}
            />
          ) : hasNoFilterMatches ? (
            <EmptyState className="flex-1" icon={Inbox} message="No matching projects." />
          ) : (
            <ProjectList
              sections={sections}
              showSectionHeaders={showSectionHeaders}
              focusedId={focusedId}
              onFocusRow={setFocusedId}
              projectActions={projectActions}
            />
          )}
        </NavigationScope>
      </div>
      <ServiceStatusLine projects={projects} modalOpen={modalOpen} />
      {isMobile && (
        <ServiceMobileTabBar
          onAddProject={() => setShowAddModal(true)}
          onGeneratePairingCode={handleGeneratePairingCode}
        />
      )}
      <ModalPanel
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        className="left-0 right-0 mx-auto top-[15%] w-full max-w-[520px] px-4"
      >
        <RepoSearch
          githubStatus={githubStatus}
          onClose={() => setShowAddModal(false)}
          onProjectAdded={handleProjectAdded}
        />
      </ModalPanel>
      <ModalPanel
        isOpen={pairingCode !== null && pairingExpiresAt !== null}
        onClose={handlePairingDismissed}
        className="left-0 right-0 mx-auto top-[15%] w-full max-w-[380px] px-4"
      >
        {pairingCode && pairingExpiresAt && (
          <PairingCodeBox
            code={pairingCode}
            expiresAt={pairingExpiresAt}
            onExpired={handlePairingExpired}
            onDismiss={handlePairingDismissed}
          />
        )}
      </ModalPanel>
      {secretsProjectId &&
        (() => {
          const project = projects.find((p) => p.id === secretsProjectId);
          if (!project) return null;
          return (
            <SecretsDrawer
              onClose={() => setSecretsProjectId(null)}
              projectId={project.id}
              projectName={project.name}
              projectStatus={optimisticStatuses.get(project.id) ?? project.status}
            />
          );
        })()}
    </div>
  );
}
