// Tests for useBrowserNotifications — verifies notification firing conditions
// and payload formatting for review_ready, task_error, and merge_conflict events.

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture handlers registered by useTransportListener keyed by event name.
const { capturedHandlers } = vi.hoisted(() => ({
  capturedHandlers: new Map<string, (data: unknown) => void>(),
}));

vi.mock("../transport/useTransportListener", () => ({
  useTransportListener: <T>(event: string, handler: (data: T) => void) => {
    capturedHandlers.set(event, handler as (data: unknown) => void);
  },
}));

function fireEvent(event: string, data: unknown) {
  const handler = capturedHandlers.get(event);
  if (!handler) throw new Error(`No handler registered for event "${event}"`);
  handler(data);
}

// MockNotification typed to allow setting the static `permission` property.
type MockNotificationType = ReturnType<typeof vi.fn> & { permission: NotificationPermission };

describe("useBrowserNotifications", () => {
  let MockNotification: MockNotificationType;

  beforeEach(() => {
    vi.resetModules();
    capturedHandlers.clear();

    MockNotification = Object.assign(vi.fn(), {
      permission: "granted" as NotificationPermission,
    });
    vi.stubGlobal("Notification", MockNotification);

    // Default: tab is hidden (backgrounded)
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function renderHookInPwaMode() {
    vi.stubEnv("TAURI_ENV_PLATFORM", "");
    const { useBrowserNotifications } = await import("./useBrowserNotifications");
    renderHook(() => useBrowserNotifications());
  }

  async function renderHookInTauriMode() {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    const { useBrowserNotifications } = await import("./useBrowserNotifications");
    renderHook(() => useBrowserNotifications());
  }

  describe("review_ready event", () => {
    it("fires notification when hidden and permission granted", async () => {
      await renderHookInPwaMode();

      fireEvent("review_ready", {
        task_id: "t1",
        parent_id: null,
        task_title: "My Task",
        stage: "work",
        output_type: "default",
      });

      expect(MockNotification).toHaveBeenCalledWith("Ready for review", {
        body: "My Task — work stage output ready",
      });
    });

    it("does not fire when tab is visible", async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      await renderHookInPwaMode();

      fireEvent("review_ready", {
        task_id: "t1",
        parent_id: null,
        task_title: "My Task",
        stage: "work",
        output_type: "default",
      });

      expect(MockNotification).not.toHaveBeenCalled();
    });

    it("does not fire when permission is denied", async () => {
      MockNotification.permission = "denied";
      await renderHookInPwaMode();

      fireEvent("review_ready", {
        task_id: "t1",
        parent_id: null,
        task_title: "My Task",
        stage: "work",
        output_type: "default",
      });

      expect(MockNotification).not.toHaveBeenCalled();
    });

    it("does not fire in Tauri builds", async () => {
      await renderHookInTauriMode();

      fireEvent("review_ready", {
        task_id: "t1",
        parent_id: null,
        task_title: "My Task",
        stage: "work",
        output_type: "default",
      });

      expect(MockNotification).not.toHaveBeenCalled();
    });

    it("formats questions output_type correctly", async () => {
      await renderHookInPwaMode();

      fireEvent("review_ready", {
        task_id: "t1",
        parent_id: null,
        task_title: "My Task",
        stage: "planning",
        output_type: "questions",
      });

      expect(MockNotification).toHaveBeenCalledWith("Questions need answers", {
        body: "My Task — planning agent has questions",
      });
    });

    it("formats subtasks output_type correctly", async () => {
      await renderHookInPwaMode();

      fireEvent("review_ready", {
        task_id: "t1",
        parent_id: null,
        task_title: "My Task",
        stage: "breakdown",
        output_type: "subtasks",
      });

      expect(MockNotification).toHaveBeenCalledWith("Subtasks need approval", {
        body: "My Task — review proposed subtask breakdown",
      });
    });

    it("formats approval output_type correctly", async () => {
      await renderHookInPwaMode();

      fireEvent("review_ready", {
        task_id: "t1",
        parent_id: null,
        task_title: "My Task",
        stage: "review",
        output_type: "approval",
      });

      expect(MockNotification).toHaveBeenCalledWith("Rejection needs review", {
        body: "My Task — reviewer rejected, needs your decision",
      });
    });
  });

  describe("task_error event", () => {
    it("fires notification with error body", async () => {
      await renderHookInPwaMode();

      fireEvent("task_error", { task_id: "t1", error: "Something went wrong" });

      expect(MockNotification).toHaveBeenCalledWith("Task error", {
        body: "Something went wrong",
      });
    });

    it("truncates error at 200 chars", async () => {
      await renderHookInPwaMode();

      const longError = "x".repeat(250);
      fireEvent("task_error", { task_id: "t1", error: longError });

      expect(MockNotification).toHaveBeenCalledWith("Task error", {
        body: "x".repeat(200),
      });
    });

    it("does not truncate errors at exactly 200 chars", async () => {
      await renderHookInPwaMode();

      const exactError = "x".repeat(200);
      fireEvent("task_error", { task_id: "t1", error: exactError });

      expect(MockNotification).toHaveBeenCalledWith("Task error", {
        body: "x".repeat(200),
      });
    });

    it("does not fire when tab is visible", async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      await renderHookInPwaMode();

      fireEvent("task_error", { task_id: "t1", error: "oops" });

      expect(MockNotification).not.toHaveBeenCalled();
    });
  });

  describe("merge_conflict event", () => {
    it("formats merge_conflict notification correctly", async () => {
      await renderHookInPwaMode();

      fireEvent("merge_conflict", { task_id: "t1", conflict_count: 3 });

      expect(MockNotification).toHaveBeenCalledWith("Merge conflict", {
        body: "t1 — 3 conflicting files",
      });
    });

    it("does not fire when tab is visible", async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      await renderHookInPwaMode();

      fireEvent("merge_conflict", { task_id: "t1", conflict_count: 3 });

      expect(MockNotification).not.toHaveBeenCalled();
    });
  });
});
