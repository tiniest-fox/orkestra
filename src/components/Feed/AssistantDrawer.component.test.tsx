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
// not available in jsdom. This mock also renders queued messages so queue
// orchestration behavior can be tested.
vi.mock("./MessageList", () => ({
  MessageList: ({
    queuedMessages,
    onEditQueued,
    onDeleteQueued,
    onInjectQueued,
  }: {
    queuedMessages?: Array<{ id: string; text: string }>;
    onEditQueued?: (id: string) => void;
    onDeleteQueued?: (id: string) => void;
    onInjectQueued?: (id: string) => void;
    [key: string]: unknown;
  }) => (
    <div data-testid="message-list">
      {(queuedMessages ?? []).map((msg) => (
        <div key={msg.id} data-testid={`queued-${msg.id}`}>
          <span>{msg.text}</span>
          {onInjectQueued && (
            <button type="button" onClick={() => onInjectQueued(msg.id)}>
              Inject
            </button>
          )}
          {onEditQueued && (
            <button type="button" onClick={() => onEditQueued(msg.id)}>
              Edit
            </button>
          )}
          {onDeleteQueued && (
            <button type="button" onClick={() => onDeleteQueued(msg.id)}>
              Delete
            </button>
          )}
        </div>
      ))}
    </div>
  ),
  buildDisplayMessages: () => [],
}));

// Simple ChatComposeArea that exposes controlled input, send, and queue buttons for tests.
vi.mock("./ChatComposeArea", () => ({
  ChatComposeArea: ({
    value,
    onChange,
    onSend,
    onQueue,
    agentActive,
    sending,
  }: {
    value: string;
    onChange: (v: string) => void;
    onSend: () => void;
    onQueue?: () => void;
    agentActive?: boolean;
    sending: boolean;
    [key: string]: unknown;
  }) => (
    <div>
      <input data-testid="compose-input" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" data-testid="compose-send" onClick={onSend} disabled={sending}>
        Send
      </button>
      {onQueue && (
        <button type="button" data-testid="compose-queue" onClick={onQueue}>
          Queue
        </button>
      )}
      {agentActive && <span data-testid="agent-active" />}
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

// Captures the polling callback so tests can manually trigger a poll cycle.
const { capturePollFn, triggerPoll } = vi.hoisted(() => {
  let pollFn: (() => Promise<void>) | null = null;
  return {
    capturePollFn: (fn: (() => Promise<void>) | null) => {
      pollFn = fn;
    },
    triggerPoll: async () => {
      if (pollFn) await pollFn();
    },
  };
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
  usePolling: (fn: (() => Promise<void>) | null) => {
    capturePollFn(fn);
  },
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
    expect(screen.queryByRole("button", { name: "New session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sessions" })).not.toBeInTheDocument();
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

// ============================================================================
// Queue orchestration
// ============================================================================

const ACTIVE_SESSION = {
  id: "s1",
  title: "Test session",
  agent_pid: 123,
  claude_session_id: null,
  spawn_count: 1,
  session_state: "active",
  session_type: "assistant" as const,
  created_at: "",
  updated_at: "",
};

const STOPPED_SESSION = { ...ACTIVE_SESSION, agent_pid: null, session_state: "completed" };

describe("AssistantDrawer — queue orchestration", () => {
  beforeEach(() => {
    mockCall.mockReset();
  });

  it("queues message when agent is running", async () => {
    mockCall.mockImplementation((method: string) => {
      if (method === "assistant_list_project_sessions") return Promise.resolve([ACTIVE_SESSION]);
      return Promise.resolve(null);
    });

    render(<AssistantDrawer onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("agent-active")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("compose-input"), { target: { value: "queued msg" } });
    fireEvent.click(screen.getByTestId("compose-queue"));

    await waitFor(() => expect(screen.getByText("queued msg")).toBeInTheDocument());
  });

  it("auto-sends queued message when agent stops", async () => {
    mockCall.mockImplementation((method: string) => {
      if (method === "assistant_list_project_sessions") return Promise.resolve([ACTIVE_SESSION]);
      return Promise.resolve(null);
    });

    render(<AssistantDrawer onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("agent-active")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("compose-input"), { target: { value: "pending send" } });
    fireEvent.click(screen.getByTestId("compose-queue"));
    await waitFor(() => expect(screen.getByText("pending send")).toBeInTheDocument());

    // Reconfigure mock: poll returns stopped session; send returns updated session.
    mockCall.mockImplementation((method: string) => {
      if (method === "assistant_list_project_sessions") return Promise.resolve([STOPPED_SESSION]);
      if (method === "assistant_send_message") return Promise.resolve(STOPPED_SESSION);
      return Promise.resolve(null);
    });

    await act(async () => {
      await triggerPoll();
    });

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith(
        "assistant_send_message",
        expect.objectContaining({ message: "pending send" }),
      );
    });
  });

  it("inject stops agent then sends message immediately", async () => {
    mockCall.mockImplementation((method: string) => {
      if (method === "assistant_list_project_sessions") return Promise.resolve([ACTIVE_SESSION]);
      if (method === "assistant_stop") return Promise.resolve(null);
      if (method === "assistant_send_message") return Promise.resolve(STOPPED_SESSION);
      return Promise.resolve(null);
    });

    render(<AssistantDrawer onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("agent-active")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("compose-input"), { target: { value: "inject me" } });
    fireEvent.click(screen.getByTestId("compose-queue"));
    await waitFor(() => expect(screen.getByText("inject me")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Inject"));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("assistant_stop", { session_id: "s1" });
    });
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith(
        "assistant_send_message",
        expect.objectContaining({ message: "inject me" }),
      );
    });
  });

  it("re-queues message at front when inject send fails", async () => {
    const sendError = new Error("send failed");
    mockCall.mockImplementation((method: string) => {
      if (method === "assistant_list_project_sessions") return Promise.resolve([ACTIVE_SESSION]);
      if (method === "assistant_stop") return Promise.resolve(null);
      if (method === "assistant_send_message") return Promise.reject(sendError);
      return Promise.resolve(null);
    });

    render(<AssistantDrawer onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("agent-active")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("compose-input"), { target: { value: "retry me" } });
    fireEvent.click(screen.getByTestId("compose-queue"));
    await waitFor(() => expect(screen.getByText("retry me")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Inject"));

    // Message must reappear after the failed send
    await waitFor(() => expect(screen.getByText("retry me")).toBeInTheDocument());
  });

  it("isSendingRef guard prevents concurrent inject calls", async () => {
    let resolveStop!: () => void;
    mockCall.mockImplementation((method: string) => {
      if (method === "assistant_list_project_sessions") return Promise.resolve([ACTIVE_SESSION]);
      if (method === "assistant_stop")
        return new Promise<null>((resolve) => {
          resolveStop = () => resolve(null);
        });
      if (method === "assistant_send_message") return Promise.resolve(STOPPED_SESSION);
      return Promise.resolve(null);
    });

    render(<AssistantDrawer onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("agent-active")).toBeInTheDocument());

    // Queue two messages
    fireEvent.change(screen.getByTestId("compose-input"), { target: { value: "msg1" } });
    fireEvent.click(screen.getByTestId("compose-queue"));
    fireEvent.change(screen.getByTestId("compose-input"), { target: { value: "msg2" } });
    fireEvent.click(screen.getByTestId("compose-queue"));
    await waitFor(() => expect(screen.getAllByText("Inject").length).toBe(2));

    // Click both inject buttons before React flushes — second is blocked by isSendingRef
    const injectBtns = screen.getAllByText("Inject");
    fireEvent.click(injectBtns[0]);
    fireEvent.click(injectBtns[1]);

    await act(async () => {});

    // Only one stop call — second inject was blocked
    expect(mockCall.mock.calls.filter((args) => args[0] === "assistant_stop").length).toBe(1);

    resolveStop();
  });

  it("clears queue when switching to a new session", async () => {
    mockCall.mockImplementation((method: string) => {
      if (method === "assistant_list_project_sessions") return Promise.resolve([ACTIVE_SESSION]);
      return Promise.resolve(null);
    });

    render(<AssistantDrawer onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("agent-active")).toBeInTheDocument());

    // Queue a message
    fireEvent.change(screen.getByTestId("compose-input"), { target: { value: "clear me" } });
    fireEvent.click(screen.getByTestId("compose-queue"));
    await waitFor(() => expect(screen.getByText("clear me")).toBeInTheDocument());

    // New session sets activeSessionId to null, triggering the queue-clear effect.
    // Use getAllByRole: the sessions panel (hidden via CSS translate) keeps its own
    // "New session" button in the DOM alongside the main header's button.
    fireEvent.click(screen.getAllByRole("button", { name: "New session" })[0]);

    await waitFor(() => expect(screen.queryByText("clear me")).not.toBeInTheDocument());
  });
});
