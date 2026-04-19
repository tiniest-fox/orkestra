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
    retryInstructions: "",
    setRetryInstructions: vi.fn(),
    retryTextareaRef: createRef(),
    retrying: false,
    handleRetry: vi.fn(),
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
    chatMessage: "",
    setChatMessage: vi.fn(),
    chatTextareaRef: createRef(),
    chatSending: false,
    chatError: null,
    handleSendChat: vi.fn(),
    handleChatStop: vi.fn(),
    handleReturnToWork: vi.fn(),
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
  derivedOverrides: { is_interrupted?: boolean; is_working?: boolean; is_chatting?: boolean },
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

describe("AgentTab — is_interrupted branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFeedLogListProps();
  });

  it("renders ChatComposeArea when is_interrupted is true", () => {
    renderAgentTab({ is_interrupted: true });
    expect(screen.getByTestId("chat-compose-area")).toBeDefined();
  });

  it("does not render ChatComposeArea when task is queued (not working, chatting, reviewing, or interrupted)", () => {
    renderAgentTab({});
    expect(screen.queryByTestId("chat-compose-area")).toBeNull();
  });

  it("handleSend calls handleReturnToWork when interrupted", () => {
    const state = renderAgentTab({ is_interrupted: true });
    fireEvent.click(screen.getByTestId("send-btn"));
    expect(state.handleReturnToWork).toHaveBeenCalledTimes(1);
    expect(state.handleSendChat).not.toHaveBeenCalled();
  });

  it("handleSend calls handleSendChat when not interrupted", () => {
    const state = renderAgentTab({ is_chatting: true });
    fireEvent.click(screen.getByTestId("send-btn"));
    expect(state.handleSendChat).toHaveBeenCalledTimes(1);
    expect(state.handleReturnToWork).not.toHaveBeenCalled();
  });

  it("placeholder is 'Add instructions and resume\u2026' when interrupted", () => {
    renderAgentTab({ is_interrupted: true });
    expect(screen.getByTestId("placeholder").textContent).toBe("Add instructions and resume\u2026");
  });

  it("placeholder is 'Message the agent\u2026' when not interrupted", () => {
    renderAgentTab({ is_chatting: true });
    expect(screen.getByTestId("placeholder").textContent).toBe("Message the agent\u2026");
  });

  it("inputAgentActive is false when interrupted", () => {
    renderAgentTab({ is_interrupted: true, is_working: false });
    expect(screen.getByTestId("agent-active").textContent).toBe("false");
  });
});

describe("AgentTab — optimistic message on send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFeedLogListProps();
  });

  it("passes pendingMessage to FeedLogList when chatMessage is non-empty and send is clicked", () => {
    const task = createMockWorkflowTaskView({ derived: { is_chatting: true } });
    const state = makeState({ chatMessage: "hello optimistic" });
    render(
      <AgentTab task={task} logs={[]} logsError={null} state={state} logContainerRef={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("send-btn"));
    expect(getFeedLogListProps().pendingMessage).toBe("hello optimistic");
  });

  it("does not pass pendingMessage when chatMessage is empty", () => {
    const task = createMockWorkflowTaskView({ derived: { is_chatting: true } });
    const state = makeState({ chatMessage: "  " });
    render(
      <AgentTab task={task} logs={[]} logsError={null} state={state} logContainerRef={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("send-btn"));
    expect(getFeedLogListProps().pendingMessage).toBeUndefined();
  });
});
