//! Tests for ProjectLogsModal — project log viewer with polling and auto-scroll.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { ProjectLogsModal } from "./ProjectLogsModal";

vi.mock("../api", () => ({
  fetchProjectLogs: vi.fn(),
}));

vi.mock("../../hooks/useAutoScroll", () => ({
  useAutoScroll: () => ({
    containerRef: vi.fn(),
    handleScroll: vi.fn(),
    resetAutoScroll: vi.fn(),
  }),
}));

const mockFetchLogs = vi.mocked(api.fetchProjectLogs);

beforeEach(() => {
  mockFetchLogs.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderModal(isOpen = true) {
  const onClose = vi.fn();
  const result = render(
    <ProjectLogsModal isOpen={isOpen} onClose={onClose} projectId="proj-1" projectName="my-repo" />,
  );
  return { ...result, onClose };
}

describe("ProjectLogsModal", () => {
  // -- Loading state --

  it("renders loading state on initial open", () => {
    mockFetchLogs.mockReturnValue(new Promise(() => {}));
    renderModal();
    expect(screen.getByText("Loading logs...")).toBeInTheDocument();
  });

  // -- Log lines --

  it("renders log lines after fetch resolves", async () => {
    mockFetchLogs.mockResolvedValue(["line one", "line two"]);
    renderModal();
    expect(await screen.findByText(/line one/)).toBeInTheDocument();
    expect(screen.getByText(/line two/)).toBeInTheDocument();
  });

  // -- Error --

  it("renders error message on fetch failure", async () => {
    mockFetchLogs.mockRejectedValue(new Error("Network error"));
    renderModal();
    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  // -- Empty state --

  it("renders empty-state message when logs array is empty", async () => {
    mockFetchLogs.mockResolvedValue([]);
    renderModal();
    expect(
      await screen.findByText("No log file found. Logs appear once the project has been running."),
    ).toBeInTheDocument();
  });

  // -- Polling --

  it("polls every 3 seconds while open", async () => {
    vi.useFakeTimers();
    mockFetchLogs.mockResolvedValue([]);
    renderModal();

    // Initial fetch on mount
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mockFetchLogs).toHaveBeenCalledTimes(1);

    // First poll interval
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(mockFetchLogs).toHaveBeenCalledTimes(2);

    // Second poll interval
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(mockFetchLogs).toHaveBeenCalledTimes(3);
  });

  it("stops polling when modal closes", async () => {
    vi.useFakeTimers();
    mockFetchLogs.mockResolvedValue([]);
    const { rerender } = renderModal(true);

    await act(() => vi.advanceTimersByTimeAsync(0));
    const callsWhileOpen = mockFetchLogs.mock.calls.length;

    // Close the modal
    rerender(
      <ProjectLogsModal
        isOpen={false}
        onClose={vi.fn()}
        projectId="proj-1"
        projectName="my-repo"
      />,
    );

    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(mockFetchLogs).toHaveBeenCalledTimes(callsWhileOpen);
  });
});
