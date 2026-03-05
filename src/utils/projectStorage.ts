//! Pure functions for persisting the multi-project list in localStorage.

import {
  STORAGE_AUTH_TOKEN,
  STORAGE_CURRENT_PROJECT_ID,
  STORAGE_PROJECTS,
  STORAGE_REMOTE_URL,
} from "../constants";
import type { ProjectConfig } from "../types/project";

/**
 * Load the full project list from localStorage.
 *
 * Returns an empty array on parse failure (corrupted data) rather than throwing.
 */
export function loadProjects(): ProjectConfig[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_PROJECTS);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(STORAGE_PROJECTS);
      return [];
    }
    return parsed.filter(
      (entry): entry is ProjectConfig =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).id === "string" &&
        typeof (entry as Record<string, unknown>).url === "string" &&
        typeof (entry as Record<string, unknown>).token === "string",
    );
  } catch {
    localStorage.removeItem(STORAGE_PROJECTS);
    return [];
  }
}

/**
 * Persist the project list to localStorage.
 */
export function saveProjects(projects: ProjectConfig[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(projects));
}

/**
 * Read the ID of the currently active project.
 */
export function getCurrentProjectId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(STORAGE_CURRENT_PROJECT_ID);
}

/**
 * Persist the ID of the currently active project.
 * Pass null to clear the selection.
 */
export function setCurrentProjectId(id: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (id === null) {
    localStorage.removeItem(STORAGE_CURRENT_PROJECT_ID);
  } else {
    localStorage.setItem(STORAGE_CURRENT_PROJECT_ID, id);
  }
}

/**
 * Convenience: load projects and current ID, then return the matching entry.
 */
export function loadCurrentProject(): ProjectConfig | null {
  const id = getCurrentProjectId();
  if (!id) return null;
  const projects = loadProjects();
  return projects.find((p) => p.id === id) ?? null;
}

/**
 * Resolve the active project using URL-first priority.
 *
 * Checks `?project=<id>` URL param first, then falls back to the localStorage
 * default. Returns null when no projects are configured.
 */
export function loadActiveProject(): ProjectConfig | null {
  const projects = loadProjects();
  const urlId = getProjectIdFromUrl();
  if (urlId) {
    const urlProject = projects.find((p) => p.id === urlId);
    if (urlProject) return urlProject;
  }
  const storedId = getCurrentProjectId();
  if (!storedId) return null;
  return projects.find((p) => p.id === storedId) ?? null;
}

/**
 * Read the project ID from the `?project=<id>` URL query parameter.
 *
 * Returns null when the param is absent, empty, or when running in the Tauri
 * desktop app (which uses `?project=` for file paths, not IDs).
 */
export function getProjectIdFromUrl(): string | null {
  if (import.meta.env.TAURI_ENV_PLATFORM) return null;
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("project") || null;
}

/**
 * Update the `?project=<id>` URL query parameter using `history.replaceState`
 * (no navigation, no back-button entry).
 *
 * Pass null to remove the param entirely.
 * No-op in the Tauri desktop app.
 */
export function setProjectIdInUrl(id: string | null): void {
  if (import.meta.env.TAURI_ENV_PLATFORM) return;
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id === null) {
    url.searchParams.delete("project");
  } else {
    url.searchParams.set("project", id);
  }
  history.replaceState(null, "", url.toString());
}

/**
 * Migrate from the legacy single-project storage format.
 *
 * If `orkestra.auth_token` exists and `orkestra.projects` does NOT exist,
 * wraps the legacy credentials in a single-entry project list, saves it, and
 * deletes the old keys. No-op if already migrated or no legacy data.
 */
export function migrateFromLegacy(): void {
  if (typeof localStorage === "undefined") return;

  const legacyToken = localStorage.getItem(STORAGE_AUTH_TOKEN);
  const alreadyMigrated = localStorage.getItem(STORAGE_PROJECTS) !== null;

  if (!legacyToken || alreadyMigrated) return;

  const legacyUrl = localStorage.getItem(STORAGE_REMOTE_URL) ?? "ws://localhost:3847/ws";

  const project: ProjectConfig = {
    id: crypto.randomUUID(),
    url: legacyUrl,
    token: legacyToken,
    projectName: "",
    projectRoot: "",
  };

  saveProjects([project]);
  setCurrentProjectId(project.id);

  localStorage.removeItem(STORAGE_AUTH_TOKEN);
  localStorage.removeItem(STORAGE_REMOTE_URL);
}
