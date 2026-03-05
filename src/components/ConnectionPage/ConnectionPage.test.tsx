//! Tests for ConnectionPage — URL/code pairing flow and credential storage.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionPage } from "./ConnectionPage";

// ============================================================================
// Mock setup
// ============================================================================

const fetchMock = vi.fn();
const reloadMock = vi.fn();
const addProjectMock = vi.fn();

// Mock ProjectsProvider so ConnectionPage renders without needing a full provider tree.
vi.mock("../../providers/ProjectsProvider", () => ({
  useProjects: () => ({
    projects: [],
    currentProject: null,
    addingProject: false,
    addProject: addProjectMock,
    removeProject: vi.fn(),
    switchProject: vi.fn(),
    startAddProject: vi.fn(),
    cancelAddProject: vi.fn(),
  }),
}));

vi.stubGlobal("fetch", fetchMock);
Object.defineProperty(window, "location", {
  value: { reload: reloadMock },
  writable: true,
  configurable: true,
});

beforeEach(() => {
  fetchMock.mockReset();
  reloadMock.mockReset();
  addProjectMock.mockReset();
});

// ============================================================================
// Helpers
// ============================================================================

function renderAtCodeStep(wsUrl = "ws://localhost:3847/ws") {
  render(<ConnectionPage />);
  const urlInput = screen.getByLabelText("Daemon URL");
  if (wsUrl !== "ws://localhost:3847/ws") {
    fireEvent.change(urlInput, { target: { value: wsUrl } });
  }
  fireEvent.click(screen.getByText("Continue"));
}

// ============================================================================
// URL step
// ============================================================================

describe("ConnectionPage — URL step", () => {
  it("renders URL input with default value", () => {
    render(<ConnectionPage />);
    const input = screen.getByLabelText("Daemon URL") as HTMLInputElement;
    expect(input.value).toBe("ws://localhost:3847/ws");
  });

  it("disables Continue when URL is empty", () => {
    render(<ConnectionPage />);
    const input = screen.getByLabelText("Daemon URL");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("Continue")).toBeDisabled();
  });

  it("advances to code step on form submit", () => {
    render(<ConnectionPage />);
    fireEvent.click(screen.getByText("Continue"));
    expect(screen.getByLabelText("Pairing Code")).toBeInTheDocument();
  });

  it("clears error when navigating back from code step", async () => {
    fetchMock.mockRejectedValueOnce(new Error("pairing failed"));
    renderAtCodeStep();
    const codeInput = screen.getByLabelText("Pairing Code");
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.click(screen.getByText("Connect"));
    await waitFor(() => expect(screen.getByText("pairing failed")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Back"));
    expect(screen.queryByText("pairing failed")).not.toBeInTheDocument();
  });
});

// ============================================================================
// Code step
// ============================================================================

describe("ConnectionPage — code step", () => {
  it("strips non-digits from code input", () => {
    renderAtCodeStep();
    const input = screen.getByLabelText("Pairing Code") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc123" } });
    expect(input.value).toBe("123");
  });

  it("limits code input to 6 digits", () => {
    renderAtCodeStep();
    const input = screen.getByLabelText("Pairing Code") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1234567890" } });
    expect(input.value).toBe("123456");
  });

  it("disables Connect when code is shorter than 6 digits", () => {
    renderAtCodeStep();
    const input = screen.getByLabelText("Pairing Code");
    fireEvent.change(input, { target: { value: "12345" } });
    expect(screen.getByText("Connect")).toBeDisabled();
  });

  it("Back button returns to URL step", () => {
    renderAtCodeStep();
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByLabelText("Daemon URL")).toBeInTheDocument();
  });

  it("shows entered URL as confirmation text", () => {
    renderAtCodeStep("ws://myhost:9000/ws");
    expect(screen.getByText("ws://myhost:9000/ws")).toBeInTheDocument();
  });
});

// ============================================================================
// Pairing exchange
// ============================================================================

describe("ConnectionPage — pairing exchange", () => {
  function submitPair(wsUrl = "ws://localhost:3847/ws") {
    renderAtCodeStep(wsUrl);
    const input = screen.getByLabelText("Pairing Code");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByText("Connect"));
  }

  it("saves project via context on success", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "test-token" }),
    });
    submitPair();
    await waitFor(() => {
      expect(addProjectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "ws://localhost:3847/ws",
          token: "test-token",
          projectName: "",
          projectRoot: "",
        }),
      );
    });
  });

  it("shows server error message on non-OK response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Invalid pairing code" }),
    });
    submitPair();
    await waitFor(() => {
      expect(screen.getByText("Invalid pairing code")).toBeInTheDocument();
    });
  });

  it("shows generic error on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    submitPair();
    await waitFor(() => {
      expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    });
  });

  it("disables Back during exchange", () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); // never resolves
    submitPair();
    expect(screen.getByText("Back")).toBeDisabled();
  });
});

// ============================================================================
// Protocol translation
// ============================================================================

describe("ConnectionPage — protocol translation", () => {
  function submitWithUrl(wsUrl: string) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "t" }),
    });
    renderAtCodeStep(wsUrl);
    const input = screen.getByLabelText("Pairing Code");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByText("Connect"));
  }

  it("translates ws:// to http:// for pair endpoint", async () => {
    submitWithUrl("ws://myhost:3847/ws");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("http://myhost:3847/pair", expect.any(Object));
    });
  });

  it("translates wss:// to https:// for pair endpoint", async () => {
    submitWithUrl("wss://myhost:3847/ws");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("https://myhost:3847/pair", expect.any(Object));
    });
  });
});
