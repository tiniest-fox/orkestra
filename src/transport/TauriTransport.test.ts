import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Override the global setup mocks with fresh per-test spies.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TauriTransport } from "./TauriTransport";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;
const mockListen = listen as ReturnType<typeof vi.fn>;

describe("TauriTransport", () => {
  let transport: TauriTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
    mockListen.mockResolvedValue(() => {});
    transport = new TauriTransport();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -- Method name mapping --

  describe("call() — method name mapping", () => {
    it("maps list_tasks to workflow_get_tasks", async () => {
      await transport.call("list_tasks");
      expect(mockInvoke).toHaveBeenCalledWith("workflow_get_tasks", {});
    });

    it("maps approve to workflow_approve with camelCase params", async () => {
      await transport.call("approve", { task_id: "abc-123" });
      expect(mockInvoke).toHaveBeenCalledWith("workflow_approve", { taskId: "abc-123" });
    });

    it("maps reject to workflow_reject with camelCase params", async () => {
      await transport.call("reject", { task_id: "abc", feedback: "needs work" });
      expect(mockInvoke).toHaveBeenCalledWith("workflow_reject", {
        taskId: "abc",
        feedback: "needs work",
      });
    });

    it("maps create_task to workflow_create_task with camelCase params", async () => {
      await transport.call("create_task", {
        title: "My task",
        description: "desc",
        base_branch: "main",
        auto_mode: false,
      });
      expect(mockInvoke).toHaveBeenCalledWith("workflow_create_task", {
        title: "My task",
        description: "desc",
        baseBranch: "main",
        autoMode: false,
      });
    });

    it("maps get_startup_data to workflow_get_startup_data", async () => {
      await transport.call("get_startup_data");
      expect(mockInvoke).toHaveBeenCalledWith("workflow_get_startup_data", {});
    });

    it("maps git_sync_status to workflow_git_sync_status", async () => {
      await transport.call("git_sync_status");
      expect(mockInvoke).toHaveBeenCalledWith("workflow_git_sync_status", {});
    });

    it("maps return_to_work to workflow_return_to_work", async () => {
      await transport.call("return_to_work", { task_id: "t1" });
      expect(mockInvoke).toHaveBeenCalledWith("workflow_return_to_work", { taskId: "t1" });
    });

    it("passes through stage_chat_send without renaming", async () => {
      await transport.call("stage_chat_send", { task_id: "t1", message: "hello" });
      expect(mockInvoke).toHaveBeenCalledWith("stage_chat_send", {
        taskId: "t1",
        message: "hello",
      });
    });

    it("passes through assistant_send_message without renaming", async () => {
      await transport.call("assistant_send_message", { message: "hi" });
      expect(mockInvoke).toHaveBeenCalledWith("assistant_send_message", { message: "hi" });
    });

    it("passes through get_project_info without renaming", async () => {
      await transport.call("get_project_info");
      expect(mockInvoke).toHaveBeenCalledWith("get_project_info", {});
    });

    it("falls back to passing the canonical name unchanged for unmapped methods", async () => {
      await transport.call("unknown_method", { foo: "bar" });
      expect(mockInvoke).toHaveBeenCalledWith("unknown_method", { foo: "bar" });
    });
  });

  // -- Event name mapping --

  describe("on() — event name mapping", () => {
    it("maps task_updated to tauri task-updated event", () => {
      const handler = vi.fn();
      transport.on("task_updated", handler);
      expect(mockListen).toHaveBeenCalledWith("task-updated", expect.any(Function));
    });

    it("maps review_ready to tauri review-ready event", () => {
      const handler = vi.fn();
      transport.on("review_ready", handler);
      expect(mockListen).toHaveBeenCalledWith("review-ready", expect.any(Function));
    });

    it("maps startup_data to tauri startup-data event", () => {
      const handler = vi.fn();
      transport.on("startup_data", handler);
      expect(mockListen).toHaveBeenCalledWith("startup-data", expect.any(Function));
    });

    it("maps startup_error to tauri startup-error event", () => {
      const handler = vi.fn();
      transport.on("startup_error", handler);
      expect(mockListen).toHaveBeenCalledWith("startup-error", expect.any(Function));
    });

    it("converts unmapped snake_case events to kebab-case", () => {
      const handler = vi.fn();
      transport.on("some_custom_event", handler);
      expect(mockListen).toHaveBeenCalledWith("some-custom-event", expect.any(Function));
    });

    it("returns a cleanup function that calls safeUnlisten", () => {
      const handler = vi.fn();
      const cleanup = transport.on("task_updated", handler);
      expect(typeof cleanup).toBe("function");
    });
  });

  // -- Connection state --

  describe("connectionState", () => {
    it("is always connected", () => {
      expect(transport.connectionState).toBe("connected");
    });

    it("supportsLocalOperations is true", () => {
      expect(transport.supportsLocalOperations).toBe(true);
    });

    it("requiresAuthentication is false", () => {
      expect(transport.requiresAuthentication).toBe(false);
    });

    it("onConnectionStateChange returns a no-op cleanup", () => {
      const handler = vi.fn();
      const cleanup = transport.onConnectionStateChange(handler);
      expect(typeof cleanup).toBe("function");
      cleanup(); // Should not throw
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
