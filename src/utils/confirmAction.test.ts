import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmAction } from "./confirmAction";

const mockTauriConfirm = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: mockTauriConfirm,
}));

describe("confirmAction", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("browser/PWA path (TAURI_ENV_PLATFORM absent)", () => {
    beforeEach(() => {
      vi.spyOn(window, "confirm");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("calls window.confirm with the message and returns true when confirmed", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const result = await confirmAction("Are you sure?");
      expect(window.confirm).toHaveBeenCalledWith("Are you sure?");
      expect(result).toBe(true);
    });

    it("calls window.confirm with the message and returns false when cancelled", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const result = await confirmAction("Delete this?");
      expect(window.confirm).toHaveBeenCalledWith("Delete this?");
      expect(result).toBe(false);
    });
  });

  describe("Tauri path (TAURI_ENV_PLATFORM set)", () => {
    beforeEach(() => {
      vi.stubEnv("TAURI_ENV_PLATFORM", "linux");
      mockTauriConfirm.mockReset();
    });

    it("calls Tauri confirm with message and options and returns true when confirmed", async () => {
      mockTauriConfirm.mockResolvedValue(true);
      const result = await confirmAction("Are you sure?");
      expect(mockTauriConfirm).toHaveBeenCalledWith("Are you sure?", {
        title: "Orkestra",
        kind: "warning",
      });
      expect(result).toBe(true);
    });

    it("calls Tauri confirm with message and options and returns false when cancelled", async () => {
      mockTauriConfirm.mockResolvedValue(false);
      const result = await confirmAction("Delete this?");
      expect(mockTauriConfirm).toHaveBeenCalledWith("Delete this?", {
        title: "Orkestra",
        kind: "warning",
      });
      expect(result).toBe(false);
    });
  });
});
