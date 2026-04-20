// Storybook stories for FeedSection — header and task row padding alignment.
import type { Meta, StoryObj } from "@storybook/react";
import { FeedSection } from "../components/Feed/FeedSection";
import { createMockWorkflowConfig, createMockWorkflowTaskView } from "../test/mocks/fixtures";

const mockConfig = createMockWorkflowConfig();

const mockSection = {
  name: "in_progress" as const,
  label: "IN PROGRESS",
  tasks: [
    createMockWorkflowTaskView({
      title: "Update dependency versions",
      state: { type: "queued", stage: "planning" },
    }),
    createMockWorkflowTaskView({
      title: "Add rate limiting middleware",
      state: { type: "queued", stage: "work" },
    }),
  ],
};

const meta = {
  title: "Feed/FeedSection",
  component: FeedSection,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    section: mockSection,
    config: mockConfig,
    focusedId: null,
    onFocusRow: () => {},
    onReview: () => {},
    onAnswer: () => {},
    onApprove: () => {},
  },
} satisfies Meta<typeof FeedSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "desktop" },
  },
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};
