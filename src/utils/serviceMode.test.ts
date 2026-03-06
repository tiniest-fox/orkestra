//! Tests for service-mode detection and project syncing utilities.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "../types/project";
import { getCurrentProjectId, saveProjects, setCurrentProjectId } from "./projectStorage";
import { getServiceToken, isServiceMode, syncProjectsFromService } from "./serviceMode";

// ============================================================================
// Helpers
// ============================================================================

const SERVICE_TOKEN_KEY = "orkestra.service_token";

function mockFetch(status: number, body: unknown): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function makeServiceProject(
  overrides: Partial<{
    id: string;
    name: string;
    path: string;
    ws_url: string;
    token: string | null;
    status: string;
  }> = {},
) {
  return {
    id: "proj-1",
    name: "my-project",
    path: "/home/user/my-project",
    ws_url: "ws://localhost:3847/ws",
    token: "tok-abc",
    status: "running",
    ...overrides,
  };
}

// ============================================================================
// isServiceMode
// ============================================================================

describe("isServiceMode", () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", { writable: true, value: originalLocation });
  });

  function setPathname(pathname: string) {
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, pathname },
    });
  }

  it("returns true when pathname is exactly /app", () => {
    setPathname("/app");
    expect(isServiceMode()).toBe(true);
  });

  it("returns true when pathname is /app/some/path", () => {
    setPathname("/app/tasks");
    expect(isServiceMode()).toBe(true);
  });

  it("returns true for nested /app/ path", () => {
    setPathname("/app/settings/advanced");
    expect(isServiceMode()).toBe(true);
  });

  it("returns false for root pathname", () => {
    setPathname("/");
    expect(isServiceMode()).toBe(false);
  });

  it("returns false for unrelated pathname", () => {
    setPathname("/dashboard");
    expect(isServiceMode()).toBe(false);
  });

  it("returns false for /application (prefix collision)", () => {
    setPathname("/application");
    expect(isServiceMode()).toBe(false);
  });

  it("returns false for /approve (prefix collision)", () => {
    setPathname("/approve");
    expect(isServiceMode()).toBe(false);
  });
});

// ============================================================================
// getServiceToken
// ============================================================================

describe("getServiceToken", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("returns null when no token stored", () => {
    expect(getServiceToken()).toBeNull();
  });

  it("returns the stored token", () => {
    localStorage.setItem(SERVICE_TOKEN_KEY, "my-token");
    expect(getServiceToken()).toBe("my-token");
  });
});

// ============================================================================
// syncProjectsFromService
// ============================================================================

describe("syncProjectsFromService", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("throws when no service token is stored", async () => {
    await expect(syncProjectsFromService()).rejects.toThrow("No service token");
  });

  it("clears the token and throws on 401 response", async () => {
    localStorage.setItem(SERVICE_TOKEN_KEY, "expired-token");
    mockFetch(401, {});

    await expect(syncProjectsFromService()).rejects.toThrow("Service token expired");
    expect(localStorage.getItem(SERVICE_TOKEN_KEY)).toBeNull();
  });

  it("throws on other non-ok response", async () => {
    localStorage.setItem(SERVICE_TOKEN_KEY, "tok");
    mockFetch(500, {});

    await expect(syncProjectsFromService()).rejects.toThrow("Failed to fetch projects: 500");
  });

  it("filters out non-running projects", async () => {
    localStorage.setItem(SERVICE_TOKEN_KEY, "tok");
    mockFetch(200, [
      makeServiceProject({ id: "running-1", status: "running" }),
      makeServiceProject({ id: "stopped-1", status: "stopped" }),
    ]);

    const result = await syncProjectsFromService();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("running-1");
  });

  it("filters out running projects without a token", async () => {
    localStorage.setItem(SERVICE_TOKEN_KEY, "tok");
    mockFetch(200, [
      makeServiceProject({ id: "has-token", token: "tok-abc" }),
      makeServiceProject({ id: "no-token", token: null }),
    ]);

    const result = await syncProjectsFromService();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("has-token");
  });

  it("maps service projects to ProjectConfig shape", async () => {
    localStorage.setItem(SERVICE_TOKEN_KEY, "tok");
    const svc = makeServiceProject();
    mockFetch(200, [svc]);

    const result = await syncProjectsFromService();
    const cfg = result[0];
    // URL is derived from window.location (ws:// on http, wss:// on https),
    // not from the server-returned ws_url field.
    const expectedWsBase = `ws://${window.location.host}`;
    expect(cfg).toEqual<ProjectConfig>({
      id: svc.id,
      url: `${expectedWsBase}/projects/${svc.id}/ws`,
      token: svc.token ?? "",
      projectName: svc.name,
      projectRoot: svc.path,
    });
  });

  it("saves synced configs to localStorage", async () => {
    localStorage.setItem(SERVICE_TOKEN_KEY, "tok");
    mockFetch(200, [makeServiceProject({ id: "p1" })]);

    await syncProjectsFromService();
    const stored = getCurrentProjectId();
    // At least the current project ID should be set since we had none
    expect(stored).toBe("p1");
  });

  it("selects first project when no current project is set", async () => {
    localStorage.setItem(SERVICE_TOKEN_KEY, "tok");
    mockFetch(200, [makeServiceProject({ id: "first" }), makeServiceProject({ id: "second" })]);

    await syncProjectsFromService();
    expect(getCurrentProjectId()).toBe("first");
  });

  it("selects first project when current project no longer exists in results", async () => {
    localStorage.setItem(SERVICE_TOKEN_KEY, "tok");
    setCurrentProjectId("old-gone");
    mockFetch(200, [makeServiceProject({ id: "new-one" })]);

    await syncProjectsFromService();
    expect(getCurrentProjectId()).toBe("new-one");
  });

  it("keeps current project when it still exists in results", async () => {
    localStorage.setItem(SERVICE_TOKEN_KEY, "tok");
    setCurrentProjectId("kept");
    mockFetch(200, [makeServiceProject({ id: "first" }), makeServiceProject({ id: "kept" })]);

    await syncProjectsFromService();
    expect(getCurrentProjectId()).toBe("kept");
  });

  it("returns empty array and does not set current project when no valid projects", async () => {
    localStorage.setItem(SERVICE_TOKEN_KEY, "tok");
    mockFetch(200, []);

    const result = await syncProjectsFromService();
    expect(result).toEqual([]);
    expect(getCurrentProjectId()).toBeNull();
  });

  it("replaces existing stored projects with synced list", async () => {
    localStorage.setItem(SERVICE_TOKEN_KEY, "tok");
    saveProjects([
      { id: "old", url: "ws://old", token: "t", projectName: "old", projectRoot: "/old" },
    ]);
    mockFetch(200, [makeServiceProject({ id: "fresh" })]);

    const result = await syncProjectsFromService();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("fresh");
  });
});
