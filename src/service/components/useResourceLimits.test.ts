// Tests for useResourceLimits hook — initial load, validation, save, and reset flows.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { useResourceLimits } from "./useResourceLimits";

vi.mock("../api", () => ({
  fetchResourceLimits: vi.fn(),
  updateResourceLimits: vi.fn(),
}));

const mockFetch = vi.mocked(api.fetchResourceLimits);
const mockUpdate = vi.mocked(api.updateResourceLimits);

const LIMITS: api.ResourceLimits = {
  cpu_limit: 2.0,
  memory_limit_mb: 4096,
  effective_cpu: 2.0,
  effective_memory_mb: 4096,
};

const DEFAULTS: api.ResourceLimits = {
  cpu_limit: null,
  memory_limit_mb: null,
  effective_cpu: 4.0,
  effective_memory_mb: 8192,
};

function renderLimits(projectStatus: api.ProjectStatus = "stopped") {
  return renderHook(() => useResourceLimits("proj-1", projectStatus));
}

describe("useResourceLimits", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockUpdate.mockReset();
  });

  // -- Initial load --

  it("starts in loading state", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderLimits();
    expect(result.current.loading).toBe(true);
    expect(result.current.limits).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("populates inputs from loaded limits", async () => {
    mockFetch.mockResolvedValue(LIMITS);
    const { result } = renderLimits();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cpuInput).toBe("2");
    expect(result.current.memoryInput).toBe("4096");
  });

  it("leaves inputs empty when limits are null", async () => {
    mockFetch.mockResolvedValue(DEFAULTS);
    const { result } = renderLimits();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cpuInput).toBe("");
    expect(result.current.memoryInput).toBe("");
  });

  it("sets error when fetch fails", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));
    const { result } = renderLimits();
    await waitFor(() => expect(result.current.error).toBe("Error: network error"));
    expect(result.current.loading).toBe(false);
  });

  // -- Validation --

  it("rejects non-numeric CPU input", async () => {
    mockFetch.mockResolvedValue(DEFAULTS);
    const { result } = renderLimits();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setCpuInput("abc"));
    await act(async () => result.current.save());

    expect(result.current.error).toBe("CPU limit must be a number");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects non-numeric memory input", async () => {
    mockFetch.mockResolvedValue(DEFAULTS);
    const { result } = renderLimits();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setMemoryInput("abc"));
    await act(async () => result.current.save());

    expect(result.current.error).toBe("Memory limit must be a number");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("treats empty CPU input as null", async () => {
    mockFetch.mockResolvedValueOnce(DEFAULTS).mockResolvedValue(DEFAULTS);
    mockUpdate.mockResolvedValue({ restart_required: false });
    const { result } = renderLimits();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.save());

    expect(mockUpdate).toHaveBeenCalledWith("proj-1", null, null);
  });

  // -- Save flow --

  it("calls updateResourceLimits with parsed values", async () => {
    mockFetch.mockResolvedValueOnce(DEFAULTS).mockResolvedValue(LIMITS);
    mockUpdate.mockResolvedValue({ restart_required: false });
    const { result } = renderLimits();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setCpuInput("2.5"));
    act(() => result.current.setMemoryInput("8192"));
    await act(async () => result.current.save());

    expect(mockUpdate).toHaveBeenCalledWith("proj-1", 2.5, 8192);
  });

  it("sets restartRequired when project is running and API returns true", async () => {
    mockFetch.mockResolvedValueOnce(LIMITS).mockResolvedValue(LIMITS);
    mockUpdate.mockResolvedValue({ restart_required: true });
    const { result } = renderHook(() => useResourceLimits("proj-1", "running"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.save());

    expect(result.current.restartRequired).toBe(true);
  });

  it("does not set restartRequired when project is stopped", async () => {
    mockFetch.mockResolvedValueOnce(LIMITS).mockResolvedValue(LIMITS);
    mockUpdate.mockResolvedValue({ restart_required: true });
    const { result } = renderLimits("stopped");
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.save());

    expect(result.current.restartRequired).toBe(false);
  });

  it("sets error on save failure", async () => {
    mockFetch.mockResolvedValueOnce(LIMITS).mockResolvedValue(LIMITS);
    mockUpdate.mockRejectedValue(new Error("server error"));
    const { result } = renderLimits();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.save());

    expect(result.current.error).toBe("Error: server error");
  });

  // -- Reset flow --

  it("reset calls updateResourceLimits with nulls and clears inputs", async () => {
    mockFetch.mockResolvedValueOnce(LIMITS).mockResolvedValue(DEFAULTS);
    mockUpdate.mockResolvedValue({ restart_required: false });
    const { result } = renderLimits();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.reset());

    expect(mockUpdate).toHaveBeenCalledWith("proj-1", null, null);
    expect(result.current.cpuInput).toBe("");
    expect(result.current.memoryInput).toBe("");
  });
});
