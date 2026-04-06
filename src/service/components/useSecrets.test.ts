// Tests for useSecrets hook — state transitions, API calls, and error handling.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as confirmModule from "../../utils/confirmAction";
import * as api from "../api";
import { useSecrets } from "./useSecrets";

vi.mock("../api", () => ({
  listSecrets: vi.fn(),
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));

vi.mock("../../utils/confirmAction", () => ({
  confirmAction: vi.fn(),
}));

const mockListSecrets = vi.mocked(api.listSecrets);
const mockGetSecret = vi.mocked(api.getSecret);
const mockSetSecret = vi.mocked(api.setSecret);
const mockDeleteSecret = vi.mocked(api.deleteSecret);
const mockConfirmAction = vi.mocked(confirmModule.confirmAction);

const SECRET_A: api.SecretEntry = {
  key: "API_KEY",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderSecrets(projectStatus: api.ProjectStatus = "stopped") {
  return renderHook(() => useSecrets("proj-1", projectStatus));
}

describe("useSecrets", () => {
  beforeEach(() => {
    mockListSecrets.mockReset();
    mockGetSecret.mockReset();
    mockSetSecret.mockReset();
    mockDeleteSecret.mockReset();
    mockConfirmAction.mockReset();
  });

  // -- Initial load --

  it("starts in loading state with empty secrets", () => {
    mockListSecrets.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderSecrets();
    expect(result.current.loading).toBe(true);
    expect(result.current.secrets).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("loads secrets on mount and clears loading", async () => {
    mockListSecrets.mockResolvedValue([SECRET_A]);
    const { result } = renderSecrets();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.secrets).toEqual([SECRET_A]);
  });

  it("sets error when listSecrets fails", async () => {
    mockListSecrets.mockRejectedValue(new Error("network error"));
    const { result } = renderSecrets();
    await waitFor(() => expect(result.current.error).toBe("network error"));
    expect(result.current.loading).toBe(false);
  });

  // -- Edit flow --

  it("enters edit mode and loads secret value", async () => {
    mockListSecrets.mockResolvedValue([SECRET_A]);
    mockGetSecret.mockResolvedValue({
      key: "API_KEY",
      value: "secret-value",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    const { result } = renderSecrets();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.startEdit("API_KEY");
    });

    expect(result.current.editingKey).toBe("API_KEY");
    expect(result.current.editValue).toBe("secret-value");
    expect(result.current.editLoading).toBe(false);
  });

  it("clears editingKey on getSecret failure", async () => {
    mockListSecrets.mockResolvedValue([SECRET_A]);
    mockGetSecret.mockRejectedValue(new Error("fetch failed"));
    const { result } = renderSecrets();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.startEdit("API_KEY");
    });

    expect(result.current.editingKey).toBeNull();
    expect(result.current.error).toBe("fetch failed");
  });

  it("saves edit and reloads secrets", async () => {
    mockListSecrets.mockResolvedValue([SECRET_A]);
    mockGetSecret.mockResolvedValue({
      key: "API_KEY",
      value: "old",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    mockSetSecret.mockResolvedValue({ restart_required: false });
    const { result } = renderSecrets();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.startEdit("API_KEY");
    });
    act(() => {
      result.current.setEditValue("new-value");
    });
    await act(async () => {
      await result.current.saveEdit();
    });

    expect(mockSetSecret).toHaveBeenCalledWith("proj-1", "API_KEY", "new-value");
    expect(result.current.editingKey).toBeNull();
    expect(mockListSecrets).toHaveBeenCalledTimes(2); // initial + after save
  });

  it("cancelEdit clears editingKey without saving", async () => {
    mockListSecrets.mockResolvedValue([SECRET_A]);
    mockGetSecret.mockResolvedValue({
      key: "API_KEY",
      value: "val",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    const { result } = renderSecrets();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.startEdit("API_KEY");
    });
    act(() => {
      result.current.cancelEdit();
    });

    expect(result.current.editingKey).toBeNull();
    expect(mockSetSecret).not.toHaveBeenCalled();
  });

  // -- Add flow --

  it("openAdd sets addMode", async () => {
    mockListSecrets.mockResolvedValue([]);
    const { result } = renderSecrets();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.openAdd();
    });
    expect(result.current.addMode).toBe(true);
  });

  it("addSave calls setSecret, closes add mode, and reloads", async () => {
    mockListSecrets.mockResolvedValue([]);
    mockSetSecret.mockResolvedValue({ restart_required: false });
    const { result } = renderSecrets();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.openAdd();
    });
    await act(async () => {
      await result.current.addSave("NEW_KEY", "new-value");
    });

    expect(mockSetSecret).toHaveBeenCalledWith("proj-1", "NEW_KEY", "new-value");
    expect(result.current.addMode).toBe(false);
    expect(mockListSecrets).toHaveBeenCalledTimes(2);
  });

  it("addSave sets error and re-throws on failure", async () => {
    mockListSecrets.mockResolvedValue([]);
    mockSetSecret.mockRejectedValue(new Error("server error"));
    const { result } = renderSecrets();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.openAdd();
    });

    // Catch the re-throw inside act so state updates are flushed before assertions.
    let threw = false;
    await act(async () => {
      try {
        await result.current.addSave("NEW_KEY", "val");
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(true);
    expect(result.current.error).toBe("server error");
    expect(result.current.addMode).toBe(true); // stays open so user can retry
  });

  it("cancelAdd clears addMode and error", async () => {
    mockListSecrets.mockResolvedValue([]);
    const { result } = renderSecrets();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.openAdd();
    });
    act(() => {
      result.current.cancelAdd();
    });

    expect(result.current.addMode).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // -- Delete flow --

  it("deleteKey does nothing when confirmation is declined", async () => {
    mockListSecrets.mockResolvedValue([SECRET_A]);
    mockConfirmAction.mockResolvedValue(false);
    const { result } = renderSecrets();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteKey("API_KEY");
    });

    expect(mockDeleteSecret).not.toHaveBeenCalled();
  });

  it("deleteKey calls deleteSecret and reloads on confirmation", async () => {
    mockListSecrets.mockResolvedValue([SECRET_A]);
    mockConfirmAction.mockResolvedValue(true);
    mockDeleteSecret.mockResolvedValue({ restart_required: false });
    const { result } = renderSecrets();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteKey("API_KEY");
    });

    expect(mockDeleteSecret).toHaveBeenCalledWith("proj-1", "API_KEY");
    expect(mockListSecrets).toHaveBeenCalledTimes(2);
  });

  // -- Restart required flag --

  it("sets restartRequired when setSecret returns restart_required=true and project is running", async () => {
    mockListSecrets.mockResolvedValue([SECRET_A]);
    mockGetSecret.mockResolvedValue({
      key: "API_KEY",
      value: "v",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    mockSetSecret.mockResolvedValue({ restart_required: true });
    const { result } = renderHook(() => useSecrets("proj-1", "running"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.startEdit("API_KEY");
    });
    await act(async () => {
      await result.current.saveEdit();
    });

    expect(result.current.restartRequired).toBe(true);
  });

  it("does not set restartRequired when project is not running", async () => {
    mockListSecrets.mockResolvedValue([SECRET_A]);
    mockGetSecret.mockResolvedValue({
      key: "API_KEY",
      value: "v",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    mockSetSecret.mockResolvedValue({ restart_required: true });
    const { result } = renderHook(() => useSecrets("proj-1", "stopped"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.startEdit("API_KEY");
    });
    await act(async () => {
      await result.current.saveEdit();
    });

    expect(result.current.restartRequired).toBe(false);
  });

  it("sets restartRequired via deleteKey when project is running", async () => {
    mockListSecrets.mockResolvedValue([SECRET_A]);
    mockConfirmAction.mockResolvedValue(true);
    mockDeleteSecret.mockResolvedValue({ restart_required: true });
    const { result } = renderHook(() => useSecrets("proj-1", "running"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteKey("API_KEY");
    });

    expect(result.current.restartRequired).toBe(true);
  });
});
