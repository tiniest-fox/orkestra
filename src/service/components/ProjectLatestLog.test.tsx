// Tests for ProjectLatestLog — polling component that shows the latest startup log line.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { ProjectLatestLog } from "./ProjectLatestLog";

vi.mock("../api", () => ({
  fetchProjectLogs: vi.fn(),
}));

const mockFetchLogs = vi.mocked(api.fetchProjectLogs);

beforeEach(() => {
  mockFetchLogs.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderComponent(projectId = "proj-1", fallback = "Starting...") {
  return render(<ProjectLatestLog projectId={projectId} fallback={fallback} />);
}

describe("ProjectLatestLog", () => {
  // -- Fallback --

  it("shows fallback before first poll resolves", () => {
    mockFetchLogs.mockReturnValue(new Promise(() => {})); // never resolves
    renderComponent();
    expect(screen.getByText("Starting...")).toBeInTheDocument();
  });

  // -- Log line display --

  it("displays fetched log line after first poll resolves", async () => {
    vi.useFakeTimers();
    mockFetchLogs.mockResolvedValue(["Building image layers..."]);
    renderComponent();

    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("Building image layers...")).toBeInTheDocument();
  });

  it("strips ANSI codes from fetched log line", async () => {
    vi.useFakeTimers();
    mockFetchLogs.mockResolvedValue(["\x1b[32mStep 1/4 : FROM node\x1b[0m"]);
    renderComponent();

    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("Step 1/4 : FROM node")).toBeInTheDocument();
  });

  // -- Fallback cases --

  it("shows fallback when fetched lines array is empty", async () => {
    vi.useFakeTimers();
    mockFetchLogs.mockResolvedValue([]);
    renderComponent();

    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("Starting...")).toBeInTheDocument();
  });

  it("shows fallback when last line is whitespace-only", async () => {
    vi.useFakeTimers();
    mockFetchLogs.mockResolvedValue(["   "]);
    renderComponent();

    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("Starting...")).toBeInTheDocument();
  });

  it("shows fallback when fetchProjectLogs rejects", async () => {
    vi.useFakeTimers();
    mockFetchLogs.mockRejectedValue(new Error("Network error"));
    renderComponent();

    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("Starting...")).toBeInTheDocument();
  });

  // -- Polling --

  it("updates displayed text on subsequent polls", async () => {
    vi.useFakeTimers();
    mockFetchLogs.mockResolvedValueOnce(["Step 1 of 4"]).mockResolvedValueOnce(["Step 2 of 4"]);
    renderComponent();

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
  });

  it("polls at 2-second intervals", async () => {
    vi.useFakeTimers();
    mockFetchLogs.mockResolvedValue(["log line"]);
    renderComponent();

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mockFetchLogs).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mockFetchLogs).toHaveBeenCalledTimes(2);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mockFetchLogs).toHaveBeenCalledTimes(3);
  });
});
