// Storybook stories for vibe mode in feed row states.
import type { Meta, StoryObj } from "@storybook/react";
import { FeedTaskRow } from "../components/Feed/FeedTaskRow";
import {
  createMockStageLogInfo,
  createMockWorkflowConfig,
  createMockWorkflowTaskView,
} from "../test/mocks/fixtures";

const meta = {
  title: "Vibe/FeedTaskRow",
  component: FeedTaskRow,
  parameters: { layout: "padded" },
  render: (args: React.ComponentProps<typeof FeedTaskRow>) => (
    <div className="max-w-[600px] mx-auto">
      <FeedTaskRow {...args} />
    </div>
  ),
} satisfies Meta<typeof FeedTaskRow>;

export default meta;
type Story = StoryObj<typeof meta>;

// Vibe button shown alongside Approve in the needs_review state.
export const VibeButtonInApprovalState: Story = {
  args: {
    task: createMockWorkflowTaskView({
      title: "Refactor auth middleware",
      state: { type: "awaiting_approval", stage: "review" },
      derived: {
        needs_review: true,
        is_vibing: false,
        stages_with_logs: [createMockStageLogInfo({ stage: "review" })],
      },
    }),
    config: createMockWorkflowConfig(),
    isFocused: false,
    onMouseEnter: () => {},
    onReview: () => {},
    onAnswer: () => {},
    onApprove: () => {},
    onVibe: () => {},
  },
};

// Vibe button shown in Done state alongside Merge/Open PR.
export const VibeButtonInDoneState: Story = {
  args: {
    task: createMockWorkflowTaskView({
      title: "Add rate limiting middleware",
      state: { type: "done" },
      derived: {
        is_done: true,
        is_terminal: true,
        current_stage: null,
        stages_with_logs: [createMockStageLogInfo({ stage: "work" })],
      },
    }),
    config: createMockWorkflowConfig(),
    isFocused: false,
    onMouseEnter: () => {},
    onReview: () => {},
    onAnswer: () => {},
    onApprove: () => {},
    onMerge: () => {},
    onOpenPr: () => {},
    onVibe: () => {},
  },
};

// Task actively in vibe mode (working) — shows as a normal working state.
export const VibeActiveWorking: Story = {
  args: {
    task: createMockWorkflowTaskView({
      title: "Explore caching options",
      state: { type: "agent_working", stage: "vibe" },
      derived: {
        is_working: true,
        is_vibing: true,
        current_stage: "vibe",
        stages_with_logs: [createMockStageLogInfo({ stage: "vibe" })],
      },
    }),
    config: createMockWorkflowConfig(),
    isFocused: false,
    onMouseEnter: () => {},
    onReview: () => {},
    onAnswer: () => {},
    onApprove: () => {},
  },
};
