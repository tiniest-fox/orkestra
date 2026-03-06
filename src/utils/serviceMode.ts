//! Utilities for service-mode detection and project syncing.
//!
//! When the PWA is served by ork-service at /app, it auto-discovers projects
//! from the service API instead of requiring manual URL/token entry.

import type { ProjectConfig } from "../types/project";
import { getCurrentProjectId, saveProjects, setCurrentProjectId } from "./projectStorage";

const SERVICE_TOKEN_KEY = "orkestra.service_token";

/** Whether the PWA is running under the Orkestra service (served at /app). */
export function isServiceMode(): boolean {
  const { pathname } = window.location;
  return pathname === "/app" || pathname.startsWith("/app/");
}

/** Get the service bearer token from localStorage. */
export function getServiceToken(): string | null {
  return localStorage.getItem(SERVICE_TOKEN_KEY);
}

interface ServiceProject {
  id: string;
  name: string;
  path: string;
  ws_url: string;
  token: string | null;
  status: string;
}

/**
 * Fetch projects from the service API and sync to localStorage.
 * Only called in service mode. Returns the synced project configs.
 */
export async function syncProjectsFromService(): Promise<ProjectConfig[]> {
  const serviceToken = getServiceToken();
  if (!serviceToken) {
    throw new Error("No service token — pair with the service first");
  }

  const baseUrl = `${window.location.protocol}//${window.location.host}`;
  const response = await fetch(`${baseUrl}/api/projects`, {
    headers: { Authorization: `Bearer ${serviceToken}` },
  });

  if (response.status === 401) {
    localStorage.removeItem(SERVICE_TOKEN_KEY);
    throw new Error("Service token expired — please pair again");
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch projects: ${response.status}`);
  }

  const serviceProjects: ServiceProject[] = await response.json();

  // Convert to ProjectConfig entries — only include running projects with tokens
  const configs: ProjectConfig[] = serviceProjects
    .filter((p) => p.status === "running" && p.token)
    .map((p) => ({
      id: p.id,
      url: p.ws_url,
      token: p.token ?? "",
      projectName: p.name,
      projectRoot: p.path,
    }));

  // Save to localStorage (full replace — service is source of truth)
  saveProjects(configs);

  // Set current project if none selected or current no longer exists
  const currentId = getCurrentProjectId();
  if (!currentId || !configs.find((c) => c.id === currentId)) {
    if (configs.length > 0) {
      setCurrentProjectId(configs[0].id);
    }
  }

  return configs;
}
