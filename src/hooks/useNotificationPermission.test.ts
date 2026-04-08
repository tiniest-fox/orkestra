// Tests for useNotificationPermission — verifies browser PWA path does not auto-request,
// user action triggers Notification.requestPermission, and Tauri path still auto-requests.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted runs before vi.mock factories, so these refs are available when the factory executes.
const { mockIsPermissionGranted, mockTauriRequestPermission } = vi.hoisted(() => ({
  mockIsPermissionGranted: vi.fn(),
  mockTauriRequestPermission: vi.fn(),
}));

// Module-level mock intercepts ALL imports (static + dynamic) of this module.
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: mockIsPermissionGranted,
  requestPermission: mockTauriRequestPermission,
}));

// MockNotification lets us set the static `permission` property.
type MockNotificationType = {
  new (title: string, options?: NotificationOptions): Notification;
  permission: NotificationPermission;
  requestPermission: ReturnType<typeof vi.fn>;
};

describe("useNotificationPermission", () => {
  let MockNotification: MockNotificationType;

  beforeEach(() => {
    vi.resetModules();
    mockIsPermissionGranted.mockReset().mockResolvedValue(false);
    mockTauriRequestPermission.mockReset().mockResolvedValue("granted");
    // Re-register after resetModules in case the module-level vi.mock factory was evicted.
    vi.doMock("@tauri-apps/plugin-notification", () => ({
      isPermissionGranted: mockIsPermissionGranted,
      requestPermission: mockTauriRequestPermission,
    }));
    const mockRequestPermission = vi.fn().mockResolvedValue("granted");
    MockNotification = Object.assign(vi.fn(), {
      permission: "default" as NotificationPermission,
      requestPermission: mockRequestPermission,
    }) as unknown as MockNotificationType;
    vi.stubGlobal("Notification", MockNotification);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("browser/PWA mode", () => {
    it("does not request permission on mount", async () => {
      vi.stubEnv("TAURI_ENV_PLATFORM", "");
      const { useNotificationPermission } = await import("./useNotificationPermission");

      renderHook(() => useNotificationPermission());

      expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    });

    it("returns permission state initialized from Notification.permission", async () => {
      MockNotification.permission = "granted";
      vi.stubEnv("TAURI_ENV_PLATFORM", "");
      const { useNotificationPermission } = await import("./useNotificationPermission");

      const { result } = renderHook(() => useNotificationPermission());

      expect(result.current.permission).toBe("granted");
    });

    it("returns unsupported when Notification API is not available", async () => {
      vi.stubGlobal("Notification", undefined);
      vi.stubEnv("TAURI_ENV_PLATFORM", "");
      const { useNotificationPermission } = await import("./useNotificationPermission");

      const { result } = renderHook(() => useNotificationPermission());

      expect(result.current.permission).toBe("unsupported");
    });

    it("calling requestPermission triggers Notification.requestPermission", async () => {
      vi.stubEnv("TAURI_ENV_PLATFORM", "");
      const { useNotificationPermission } = await import("./useNotificationPermission");

      const { result } = renderHook(() => useNotificationPermission());

      await act(async () => {
        result.current.requestPermission();
      });

      expect(MockNotification.requestPermission).toHaveBeenCalledOnce();
    });

    it("permission state updates after request resolves to granted", async () => {
      vi.stubEnv("TAURI_ENV_PLATFORM", "");
      MockNotification.requestPermission.mockResolvedValue("granted");
      const { useNotificationPermission } = await import("./useNotificationPermission");

      const { result } = renderHook(() => useNotificationPermission());
      expect(result.current.permission).toBe("default");

      await act(async () => {
        result.current.requestPermission();
      });

      expect(result.current.permission).toBe("granted");
    });

    it("permission state updates after request resolves to denied", async () => {
      vi.stubEnv("TAURI_ENV_PLATFORM", "");
      MockNotification.requestPermission.mockResolvedValue("denied");
      const { useNotificationPermission } = await import("./useNotificationPermission");

      const { result } = renderHook(() => useNotificationPermission());

      await act(async () => {
        result.current.requestPermission();
      });

      expect(result.current.permission).toBe("denied");
    });

    it("requestPermission is a no-op when permission is already granted", async () => {
      MockNotification.permission = "granted";
      vi.stubEnv("TAURI_ENV_PLATFORM", "");
      const { useNotificationPermission } = await import("./useNotificationPermission");

      const { result } = renderHook(() => useNotificationPermission());

      await act(async () => {
        result.current.requestPermission();
      });

      expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    });
  });

  describe("Tauri mode", () => {
    it("auto-requests permission on mount via Tauri plugin", async () => {
      vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
      const { useNotificationPermission } = await import("./useNotificationPermission");

      renderHook(() => useNotificationPermission());

      // The Tauri path is fire-and-forget: useEffect calls requestTauriPermission()
      // which does two awaits (dynamic import + isPermissionGranted). waitFor retries
      // every 50ms until the async chain completes.
      await waitFor(() => {
        expect(mockIsPermissionGranted).toHaveBeenCalled();
      });
    });

    it("does not call browser Notification.requestPermission in Tauri mode", async () => {
      vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
      const { useNotificationPermission } = await import("./useNotificationPermission");

      const { result } = renderHook(() => useNotificationPermission());

      // Calling requestPermission in Tauri mode is a no-op for the browser API
      await act(async () => {
        result.current.requestPermission();
      });

      expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    });
  });
});
