//! Typed API client for the Orkestra service manager.
//! All requests use the Bearer token from localStorage; 401 clears it and reloads.

const TOKEN_KEY = "orkestra.service_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ============================================================================
// Types
// ============================================================================

export type ProjectStatus =
  | "running"
  | "stopped"
  | "error"
  | "cloning"
  | "starting"
  | "stopping"
  | "rebuilding"
  | "removing";

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  error_message?: string;
  ws_url?: string;
  token?: string;
  token_error?: string;
}

export interface GithubStatus {
  available: boolean;
  error?: string;
}

export interface GithubRepo {
  name: string;
  nameWithOwner: string;
  description?: string;
  url: string;
}

export interface PairingCode {
  code: string;
}

export interface PairResult {
  token: string;
}

// ============================================================================
// Core fetch helper
// ============================================================================

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (response.status === 401) {
    clearToken();
    location.reload();
    // Throw so callers don't proceed after reload
    throw new Error("Unauthorized");
  }

  return response;
}

async function requireOk(response: Response): Promise<Response> {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`);
  }
  return response;
}

// ============================================================================
// API functions
// ============================================================================

export async function fetchProjects(): Promise<Project[]> {
  const res = await apiFetch("/api/projects");
  await requireOk(res);
  return res.json();
}

export async function addProject(repoUrl: string, name: string): Promise<void> {
  const res = await apiFetch("/api/projects", {
    method: "POST",
    body: JSON.stringify({ repo_url: repoUrl, name }),
  });
  await requireOk(res);
}

export async function removeProject(id: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
  await requireOk(res);
}

export async function startProject(id: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${id}/start`, { method: "POST" });
  await requireOk(res);
}

export async function stopProject(id: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${id}/stop`, { method: "POST" });
  await requireOk(res);
}

export async function rebuildProject(id: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${id}/rebuild`, { method: "POST" });
  await requireOk(res);
}

export async function checkGithubStatus(): Promise<GithubStatus> {
  const res = await apiFetch("/api/github/status");
  await requireOk(res);
  return res.json();
}

export async function searchRepos(query?: string): Promise<GithubRepo[]> {
  const url = query ? `/api/github/repos?search=${encodeURIComponent(query)}` : "/api/github/repos";
  const res = await apiFetch(url);
  await requireOk(res);
  return res.json();
}

export async function generatePairingCode(): Promise<PairingCode> {
  const res = await apiFetch("/api/pairing-code", { method: "POST" });
  await requireOk(res);
  return res.json();
}

export async function pairDevice(code: string): Promise<PairResult> {
  const res = await fetch("/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, device_name: "Browser" }),
  });
  await requireOk(res);
  return res.json();
}

export async function fetchProjectLogs(projectId: string, lines = 50): Promise<string[]> {
  const res = await apiFetch(`/api/projects/${projectId}/logs?lines=${lines}`);
  await requireOk(res);
  const data: { lines: string[] } = await res.json();
  return data.lines;
}
