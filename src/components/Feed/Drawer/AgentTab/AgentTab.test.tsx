// Tests for AgentTab — is_interrupted conditional branches and optimistic message.

import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockWorkflowTaskView } from "../../../../test/mocks/fixtures";
import type { TaskDrawerState } from "../useTaskDrawerState";
import { AgentTab } from "./AgentTab";

// ============================================================================
// Mocks
// ============================================================================

const { getFeedLogListProps, resetFeedLogListProps } = vi.hoisted(() => {
  let lastProps: Record<string, unknown> = {};
  return {
    getFeedLogListProps: () => lastProps,
    resetFeedLogListProps: () => {
      lastProps = {};
    },
  };
});

vi.mock("../../FeedLogList", () => ({
  FeedLogList: (props: Record<string, unknown>) => {
    Object.assign(getFeedLogListProps(), props);
    return <div data-testid="feed-log-list" />;
  },
}));

vi.mock("../../ChatComposeArea", () => ({
  ChatComposeArea: (props: {
    placeholder?: string;
    onSend?: () => void;
    agentActive?: boolean;
  }) => (
    <div data-testid="chat-compose-area">
      <span data-testid="placeholder">{props.placeholder}</span>
      <span data-testid="agent-active">{String(props.agentActive)}</span>
      <button type="button" data-testid="send-btn" onClick={props.onSend}>
        Send
      </button>
    </div>
  ),
}));

vi.mock("./InlineQuestionsCard", () => ({
  InlineQuestionsCard: () => <div data-testid="inline-questions-card" />,
}));

// ============================================================================
// Fixtures
// ============================================================================

function makeState(overrides?: Partial<TaskDrawerState>): TaskDrawerState {
  return {
    answers: [],
    setAnswer: vi.fn(),
    answeredCount: 0,
    allAnswered: false,
    updateMode: false,
    enterUpdateMode: vi.fn(),
    exitUpdateMode: vi.fn(),
    updateNotes: "",
    setUpdateNotes: vi.fn(),
    updateNotesRef: createRef(),
    handleRequestUpdate: vi.fn(),
    loading: false,
    interrupting: false,
    prTabState: { type: "loading" } as TaskDrawerState["prTabState"],
    setPrTabState: vi.fn(),
    draftComments: [],
    lineCommentGuidance: "",
    setLineCommentGuidance: vi.fn(),
    lineCommentError: null,
    addDraftComment: vi.fn(),
    removeDraftComment: vi.fn(),
    clearDraftComments: vi.fn(),
    submitLineComments: vi.fn(),
    message: "",
    setMessage: vi.fn(),
    messageTextareaRef: createRef(),
    messageSending: false,
    messageError: null,
    handleSendMessage: vi.fn(),
    submitRef: createRef(),
    handleApprove: vi.fn(),
    handleInterrupt: vi.fn(),
    handleMerge: vi.fn(),
    handleOpenPr: vi.fn(),
    handleArchive: vi.fn(),
    handleFixConflicts: vi.fn(),
    handleAddressFeedback: vi.fn(),
    handleSubmitAnswers: vi.fn(),
    handleToggleAutoMode: vi.fn(),
    optimisticAutoMode: null,
    ...overrides,
  };
}

function renderAgentTab(
  derivedOverrides: {
    is_interrupted?: boolean;
    is_working?: boolean;
    is_failed?: boolean;
    is_blocked?: boolean;
    needs_review?: boolean;
    has_questions?: boolean;
  },
  stateOverrides?: Partial<TaskDrawerState>,
) {
  const task = createMockWorkflowTaskView({ derived: derivedOverrides });
  const state = makeState(stateOverrides);
  render(
    <AgentTab task={task} logs={[]} logsError={null} state={state} logContainerRef={vi.fn()} />,
  );
  return state;
}

// ============================================================================
// Tests
// ============================================================================

describe("AgentTab — compose area visibility and behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFeedLogListProps();
  });

  it("renders ChatComposeArea when is_interrupted is true", () => {
    renderAgentTab({ is_interrupted: true });
    expect(screen.getByTestId("chat-compose-area")).toBeDefined();
  });

  it("renders ChatComposeArea when is_failed is true", () => {
    renderAgentTab({ is_failed: true });
    expect(screen.getByTestId("chat-compose-area")).toBeDefined();
  });

  it("renders ChatComposeArea when is_blocked is true", () => {
    renderAgentTab({ is_blocked: true });
    expect(screen.getByTestId("chat-compose-area")).toBeDefined();
  });

  it("renders ChatComposeArea when has_questions is true (awaiting_question_answer)", () => {
    renderAgentTab({ has_questions: true });
    expect(screen.getByTestId("chat-compose-area")).toBeDefined();
  });

  it("renders ChatComposeArea when needs_review is true (awaiting_approval)", () => {
    renderAgentTab({ needs_review: true });
    expect(screen.getByTestId("chat-compose-area")).toBeDefined();
  });

  it("does not render ChatComposeArea when task is queued (not working, reviewing, interrupted, failed, or blocked)", () => {
    renderAgentTab({});
    expect(screen.queryByTestId("chat-compose-area")).toBeNull();
  });

  it("handleSend always calls handleSendMessage", () => {
    const state = renderAgentTab({ is_interrupted: true });
    fireEvent.click(screen.getByTestId("send-btn"));
    expect(state.handleSendMessage).toHaveBeenCalledTimes(1);
  });

  it("placeholder is 'Add instructions and resume\u2026' when interrupted", () => {
    renderAgentTab({ is_interrupted: true });
    expect(screen.getByTestId("placeholder").textContent).toBe("Add instructions and resume\u2026");
  });

  it("placeholder is 'Send instructions to retry\u2026' when failed", () => {
    renderAgentTab({ is_failed: true });
    expect(screen.getByTestId("placeholder").textContent).toBe("Send instructions to retry\u2026");
  });

  it("placeholder is 'Send instructions to unblock\u2026' when blocked", () => {
    renderAgentTab({ is_blocked: true });
    expect(screen.getByTestId("placeholder").textContent).toBe(
      "Send instructions to unblock\u2026",
    );
  });

  it("placeholder is 'Message the agent\u2026' when working", () => {
    renderAgentTab({ is_working: true });
    expect(screen.getByTestId("placeholder").textContent).toBe("Message the agent\u2026");
  });

  it("inputAgentActive is false when interrupted", () => {
    renderAgentTab({ is_interrupted: true, is_working: false });
    expect(screen.getByTestId("agent-active").textContent).toBe("false");
  });

  it("inputAgentActive is true when working", () => {
    renderAgentTab({ is_working: true });
    expect(screen.getByTestId("agent-active").textContent).toBe("true");
  });
});

describe("AgentTab — optimistic message on send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFeedLogListProps();
  });

  it("passes pendingMessage to FeedLogList when message is non-empty and send is clicked", () => {
    const task = createMockWorkflowTaskView({ derived: { is_working: true } });
    const state = makeState({ message: "hello optimistic" });
    render(
      <AgentTab task={task} logs={[]} logsError={null} state={state} logContainerRef={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("send-btn"));
    expect(getFeedLogListProps().pendingMessage).toBe("hello optimistic");
  });

  it("does not pass pendingMessage when message is empty", () => {
    const task = createMockWorkflowTaskView({ derived: { is_working: true } });
    const state = makeState({ message: "  " });
    render(
      <AgentTab task={task} logs={[]} logsError={null} state={state} logContainerRef={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("send-btn"));
    expect(getFeedLogListProps().pendingMessage).toBeUndefined();
  });
});
