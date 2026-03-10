//! Project detail page — connects to a specific project's daemon and mounts the Orkestra app.

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FeedLoadingSkeleton } from "../components/Feed/FeedLoadingSkeleton";
import { Orkestra } from "../components/Orkestra";
import {
  GitHistoryProvider,
  ProjectDetailProvider,
  PrStatusProvider,
  TasksProvider,
  WorkflowConfigProvider,
} from "../providers";
import { TransportProvider, useConnectionState } from "../transport";
import { WebSocketTransport } from "../transport/WebSocketTransport";
import type { Project } from "./api";
import { fetchProjects } from "./api";
import { SERVICE_TITLE } from "./constants";

// ============================================================================
// Connection gate
// ============================================================================

function ProjectConnectionGate({
  projectName,
  children,
}: {
  projectName: string;
  children: ReactNode;
}) {
  const connectionState = useConnectionState();

  if (connectionState === "connecting") {
    return <FeedLoadingSkeleton statusText="Connecting to daemon…" projectName={projectName} />;
  }

  if (connectionState === "disconnected") {
    return <FeedLoadingSkeleton statusText="Reconnecting to daemon…" projectName={projectName} />;
  }

  return <>{children}</>;
}

// ============================================================================
// App shell
// ============================================================================

function ProjectAppShell({ project, token }: { project: Project; token: string }) {
  const wsUrl = useMemo(() => {
    const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
    return `${wsScheme}://${window.location.host}/projects/${project.id}/ws`;
  }, [project.id]);

  const [transport, setTransport] = useState<WebSocketTransport | null>(null);

  useEffect(() => {
    const t = new WebSocketTransport(wsUrl, token);
    setTransport(t);
    return () => {
      t.close();
    };
  }, [wsUrl, token]);

  useEffect(() => {
    document.title = `Orkestra | ${project.name}`;
    return () => {
      document.title = SERVICE_TITLE;
    };
  }, [project.name]);

  if (!transport) {
    return <FeedLoadingSkeleton statusText="Connecting to daemon…" projectName={project.name} />;
  }

  return (
    <TransportProvider transport={transport}>
      <ProjectConnectionGate projectName={project.name}>
        <ProjectDetailProvider>
          <WorkflowConfigProvider>
            <TasksProvider>
              <PrStatusProvider>
                <GitHistoryProvider>
                  <Orkestra serviceProjectName={project.name} />
                </GitHistoryProvider>
              </PrStatusProvider>
            </TasksProvider>
          </WorkflowConfigProvider>
        </ProjectDetailProvider>
      </ProjectConnectionGate>
    </TransportProvider>
  );
}

// ============================================================================
// Page
// ============================================================================

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects()
      .then((projects) => {
        const found = projects.find((p) => p.id === id);
        if (found) {
          setProject(found);
        } else {
          setError("Project not found");
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return <FeedLoadingSkeleton statusText="Loading project…" />;
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-4">
        <p className="text-text-secondary">{error ?? "Project not found"}</p>
        <Link to="/" className="text-accent hover:underline text-sm">
          Back to projects
        </Link>
      </div>
    );
  }

  if (project.status !== "running") {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-4">
        <p className="text-text-secondary">
          Project &ldquo;{project.name}&rdquo; is {project.status}
        </p>
        <Link to="/" className="text-accent hover:underline text-sm">
          Back to projects
        </Link>
      </div>
    );
  }

  if (!project.token) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-4">
        <p className="text-text-secondary">{project.token_error ?? "Waiting for daemon token…"}</p>
        <Link to="/" className="text-accent hover:underline text-sm">
          Back to projects
        </Link>
      </div>
    );
  }

  return <ProjectAppShell project={project} token={project.token} />;
}
