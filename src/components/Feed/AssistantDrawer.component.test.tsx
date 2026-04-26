// Component-level tests for AssistantDrawer draft chat behavior.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Module mocks
// ============================================================================

// framer-motion uses requestAnimationFrame animation loops that keep the
// jsdom event loop alive after tests complete, preventing the worker from
// exiting cleanly. Replace with static passthrough components.
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => children ?? null,
  motion: {
    span: ({
      children,
      initial: _i,
      animate: _a,
      exit: _e,
      transition: _t,
      ...rest
    }: Record<string, unknown>) => (
      <span {...(rest as React.HTMLAttributes<HTMLSpanElement>)}>
        {children as React.ReactNode}
      </span>
    ),
    div: ({
      children,
      initial: _i,
      animate: _a,
      exit: _e,
      transition: _t,
      ...rest
    }: Record<string, unknown>) => (
      <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>
    ),
  },
}));

// MessageList uses Virtualizer (virtua) which requires DOM layout measurements
// not available in jsdom.
vi.mock("./MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
  buildDisplayMessages: () => [],
}));

// Simple ChatComposeArea that exposes controlled input and send button for tests.
vi.mock("./ChatComposeArea", () => ({
  ChatComposeArea: ({
    value,
    onChange,
    onSend,
    sending,
  }: {
    value: string;
    onChange: (v: string) => void;
    onSend: () => void;
    sending: boolean;
    [key: string]: unknown;
  }) => (
    <div>
      <input data-testid="compose-input" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" data-testid="compose-send" onClick={onSend} disabled={sending}>
        Send
      </button>
    </div>
  ),
}));

// mockTransport must be a stable object reference — useTransport() is called on
// every render, so returning a new object each call puts `transport` in the
// useEffect dep arrays every render, triggering an infinite effect loop.
const { mockCall, mockTransport } = vi.hoisted(() => {
  const mockCall = vi.fn();
  const mockTransport = { call: mockCall, on: vi.fn(() => () => {}) };
  return { mockCall, mockTransport };
});

// All four exports required — per CLAUDE.md transport mock guidance.
vi.mock("../../transport", () => ({
  useConnectionState: () => "connected",
  useHasConnected: () => true,
  useTransport: () => mockTransport,
  useTransportListener: vi.fn(),
}));

vi.mock("../../hooks/useSessionLogs", () => ({
  useSessionLogs: () => ({ logs: [], fetchLogs: vi.fn() }),
}));

vi.mock("../../hooks/usePolling", () => ({
  usePolling: vi.fn(),
}));

vi.mock("../../hooks/useOptimisticMessage", () => ({
  useOptimisticMessage: () => ({
    optimisticMessage: null,
    setOptimisticMessage: vi.fn(),
    scrollTrigger: 0,
    triggerScroll: vi.fn(),
  }),
}));

vi.mock("../../providers/ToastProvider", () => ({
  useToast: () => ({ showError: vi.fn() }),
}));

vi.mock("../../hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

import { AssistantDrawer } from "./AssistantDrawer";

// ============================================================================
// Draft chat mode
// ============================================================================

describe("AssistantDrawer — draft chat mode", () => {
  beforeEach(() => {
    mockCall.mockReset();
  });

  it("shows 'New Chat' as the title", () => {
    render(<AssistantDrawer draftChat onClose={vi.fn()} />);
    expect(screen.getByText("New Chat")).toBeInTheDocument();
  });

  it("skips session fetch when draftChat is true", async () => {
    render(<AssistantDrawer draftChat onClose={vi.fn()} />);
    await act(async () => {});
    expect(mockCall).not.toHaveBeenCalledWith("assistant_list_sessions", expect.anything());
    expect(mockCall).not.toHaveBeenCalledWith("assistant_list_project_sessions", expect.anything());
  });

  it("calls create_chat_and_send and fires onTaskCreated on first message", async () => {
    const onTaskCreated = vi.fn();
    mockCall.mockResolvedValue({
      task: { id: "task-123", is_chat: true },
      session: {
        id: "session-1",
        title: null,
        agent_pid: null,
        task_id: "task-123",
        updated_at: "",
      },
    });

    render(<AssistantDrawer draftChat onClose={vi.fn()} onTaskCreated={onTaskCreated} />);

    fireEvent.change(screen.getByTestId("compose-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("compose-send"));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("create_chat_and_send", { message: "hello world" });
    });
    expect(onTaskCreated).toHaveBeenCalledWith("task-123");
  });
});

// ============================================================================
// Chat task header actions
// ============================================================================

describe("AssistantDrawer — chat task header actions", () => {
  beforeEach(() => {
    mockCall.mockReset();
  });

  it("shows Archive and Delete Trak buttons when taskId refers to a chat task", async () => {
    mockCall.mockImplementation((method: string) => {
      if (method === "get_task")
        return Promise.resolve({ id: "chat-task-1", is_chat: true, title: "My Chat" });
      if (method === "assistant_list_sessions") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<AssistantDrawer taskId="chat-task-1" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Delete Trak" })).toBeInTheDocument();
  });

  it("does not show Archive or Delete Trak buttons when taskId refers to a regular workflow task", async () => {
    mockCall.mockImplementation((method: string) => {
      if (method === "get_task")
        return Promise.resolve({ id: "wf-task-1", is_chat: false, title: "Feature work" });
      if (method === "assistant_list_sessions") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<AssistantDrawer taskId="wf-task-1" onClose={vi.fn()} />);

    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Trak" })).not.toBeInTheDocument();
  });

  it("opens delete confirmation modal when Delete Trak button is clicked", async () => {
    mockCall.mockImplementation((method: string) => {
      if (method === "get_task")
        return Promise.resolve({ id: "chat-task-1", is_chat: true, title: "My Chat" });
      if (method === "assistant_list_sessions") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<AssistantDrawer taskId="chat-task-1" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete Trak" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Trak" }));

    expect(screen.getByText("Delete Trak?")).toBeInTheDocument();
  });
});
