// Tests for ServiceApp — root auth gating, project polling, and GitHub status handling.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { ServiceApp } from "./ServiceApp";

function renderApp() {
  return render(
    <MemoryRouter>
      <ServiceApp />
    </MemoryRouter>,
  );
}

vi.mock("./api", () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
  fetchProjects: vi.fn(),
  checkGithubStatus: vi.fn(),
  generatePairingCode: vi.fn(),
  // PairingForm uses pairDevice — stub so its import resolves when no-token path renders
  pairDevice: vi.fn(),
}));

// ProjectPage imports providers which import main.tsx (for startup data), causing
// ReactDOM.createRoot to run before a #root element exists. Mock it out — these
// tests only exercise the portal, not the project detail page.
vi.mock("./ProjectPage", () => ({
  ProjectPage: () => null,
}));

const mockGetToken = vi.mocked(api.getToken);
const mockFetchProjects = vi.mocked(api.fetchProjects);
const mockCheckGithubStatus = vi.mocked(api.checkGithubStatus);
const mockGeneratePairingCode = vi.mocked(api.generatePairingCode);

// Preserve original location so it can be restored after each test.
const originalLocation = window.location;

describe("ServiceApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Replace window.location with a stub so location.reload() doesn't throw.
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, reload: vi.fn() },
    });
    // Default: no projects, github unavailable (safe defaults)
    mockFetchProjects.mockResolvedValue([]);
    mockCheckGithubStatus.mockResolvedValue({ available: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "location", { writable: true, value: originalLocation });
  });

  // -- Auth gating --

  it("renders PairingForm when no token", () => {
    mockGetToken.mockReturnValue(null);
    renderApp();
    expect(screen.getByText("Pair this Device")).toBeInTheDocument();
  });

  it("renders main UI when token exists", async () => {
    mockGetToken.mockReturnValue("test-token");
    renderApp();
    expect(screen.getByText("ORKESTRA")).toBeInTheDocument();
    expect(screen.getByText("SERVICE")).toBeInTheDocument();
  });

  // -- Project fetching --

  it("fetches projects on mount when authenticated", async () => {
    mockGetToken.mockReturnValue("test-token");
    renderApp();
    await waitFor(() => expect(mockFetchProjects).toHaveBeenCalledTimes(1));
  });

  it("polls projects on 5-second interval", async () => {
    vi.useFakeTimers();
    mockGetToken.mockReturnValue("test-token");
    renderApp();
    // advanceTimersByTimeAsync(0) flushes pending microtasks without triggering intervals
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetchProjects).toHaveBeenCalledTimes(1);
    // Advance one polling interval — fires the setInterval callback exactly once
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockFetchProjects).toHaveBeenCalledTimes(2);
  });

  // -- GitHub status --

  it("sets fallback githubStatus when checkGithubStatus fails", async () => {
    mockGetToken.mockReturnValue("test-token");
    mockCheckGithubStatus.mockRejectedValue(new Error("gh not found"));
    renderApp();

    // Wait for the effect to run
    await waitFor(() => expect(mockCheckGithubStatus).toHaveBeenCalled());

    // Open the add panel
    fireEvent.click(screen.getByRole("button", { name: /Add project/i }));

    // The fallback githubStatus has available: false, so GitHub CLI instructions appear
    expect(await screen.findByText("GitHub CLI not configured.")).toBeInTheDocument();
  });

  // -- Pairing code generation --

  it("shows pairing code box on successful generatePairingCode", async () => {
    mockGetToken.mockReturnValue("test-token");
    mockGeneratePairingCode.mockResolvedValue({ code: "123456" });
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Pairing code/i }));
    expect(await screen.findByText("123456")).toBeInTheDocument();
  });

  it("shows error when generatePairingCode fails", async () => {
    mockGetToken.mockReturnValue("test-token");
    mockGeneratePairingCode.mockRejectedValue(new Error("Network error"));
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Pairing code/i }));
    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  // -- Interval cleanup --

  it("clears polling interval on unmount", async () => {
    vi.useFakeTimers();
    mockGetToken.mockReturnValue("test-token");
    const { unmount } = renderApp();
    // Let initial effect settle
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetchProjects).toHaveBeenCalledTimes(1);

    unmount();

    // Advance past another interval — no additional calls expected since interval was cleared
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockFetchProjects).toHaveBeenCalledTimes(1);
  });
});
