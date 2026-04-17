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

export interface GitSyncStatus {
  ahead: number;
  behind: number;
}

export interface GitStatusInfo {
  branch: string;
  sync_status?: GitSyncStatus;
}

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  error_message?: string;
  ws_url?: string;
  token?: string;
  token_error?: string;
  git_status?: GitStatusInfo;
  cpu_limit?: number;
  memory_limit_mb?: number;
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

export async function gitFetch(id: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${id}/git/fetch`, { method: "POST" });
  await requireOk(res);
}

export async function gitPull(id: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${id}/git/pull`, { method: "POST" });
  await requireOk(res);
}

export async function gitPush(id: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${id}/git/push`, { method: "POST" });
  await requireOk(res);
}

export interface SecretEntry {
  key: string;
  created_at: string;
  updated_at: string;
}

export interface SecretValue {
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface SecretMutationResult {
  restart_required: boolean;
}

export async function listSecrets(projectId: string): Promise<SecretEntry[]> {
  const res = await apiFetch(`/api/projects/${projectId}/secrets`);
  await requireOk(res);
  return res.json();
}

export async function getSecret(projectId: string, key: string): Promise<SecretValue> {
  const res = await apiFetch(`/api/projects/${projectId}/secrets/${encodeURIComponent(key)}`);
  await requireOk(res);
  return res.json();
}

export async function setSecret(
  projectId: string,
  key: string,
  value: string,
): Promise<SecretMutationResult> {
  const res = await apiFetch(`/api/projects/${projectId}/secrets/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
  await requireOk(res);
  return res.json();
}

export async function deleteSecret(projectId: string, key: string): Promise<SecretMutationResult> {
  const res = await apiFetch(`/api/projects/${projectId}/secrets/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  await requireOk(res);
  return res.json();
}

export interface ResourceLimits {
  cpu_limit: number | null;
  memory_limit_mb: number | null;
  effective_cpu: number;
  effective_memory_mb: number;
}

export async function fetchResourceLimits(projectId: string): Promise<ResourceLimits> {
  const res = await apiFetch(`/api/projects/${projectId}/resource-limits`);
  await requireOk(res);
  return res.json();
}

export async function updateResourceLimits(
  projectId: string,
  cpuLimit: number | null,
  memoryLimitMb: number | null,
): Promise<{ restart_required: boolean }> {
  const res = await apiFetch(`/api/projects/${projectId}/resource-limits`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cpu_limit: cpuLimit, memory_limit_mb: memoryLimitMb }),
  });
  await requireOk(res);
  return res.json();
}
