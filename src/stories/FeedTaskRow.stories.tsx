// Storybook stories for FeedTaskRow in 3 states.
import type { Meta, StoryObj } from "@storybook/react";
import { FeedTaskRow } from "../components/Feed/FeedTaskRow";
import {
  createMockArtifact,
  createMockSubtaskProgress,
  createMockWorkflowConfig,
  createMockWorkflowTaskView,
} from "../test/mocks/fixtures";

const meta = {
  title: "Feed/FeedTaskRow",
  component: FeedTaskRow,
  parameters: {
    layout: "padded",
  },
  render: (args) => (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      <FeedTaskRow {...args} />
    </div>
  ),
} satisfies Meta<typeof FeedTaskRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    task: createMockWorkflowTaskView({
      title: "Update dependency versions",
      state: { type: "queued", stage: "planning" },
    }),
    config: createMockWorkflowConfig(),
    isFocused: false,
    onMouseEnter: () => {},
    onReview: () => {},
    onAnswer: () => {},
    onApprove: () => {},
  },
};

export const WithSubtasks: Story = {
  args: {
    task: createMockWorkflowTaskView({
      title: "Redesign settings page",
      state: { type: "waiting_on_children", stage: "breakdown" },
      derived: {
        subtask_progress: createMockSubtaskProgress(),
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

export const NeedsReview: Story = {
  args: {
    task: createMockWorkflowTaskView({
      title: "Add rate limiting middleware",
      state: { type: "awaiting_approval", stage: "review" },
      artifacts: {
        summary: createMockArtifact({ name: "summary", stage: "work" }),
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
