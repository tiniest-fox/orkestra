// Storybook stories for StatusSymbol — all done-state icon variants.
import type { Meta, StoryObj } from "@storybook/react";
import { StatusSymbol } from "../components/Feed/StatusSymbol";
import { createMockWorkflowTaskView } from "../test/mocks/fixtures";
import type { PrStatus } from "../types/workflow";

const doneTask = createMockWorkflowTaskView({
  title: "Implement rate limiting",
  state: { type: "done" },
});

const doneTaskWithPr = createMockWorkflowTaskView({
  title: "Implement rate limiting",
  state: { type: "done" },
  pr_url: "https://github.com/example/repo/pull/42",
});

const basePrStatus: PrStatus = {
  url: "https://github.com/example/repo/pull/42",
  state: "open",
  checks: [],
  reviews: [],
  comments: [],
  fetched_at: "2025-01-01T00:00:00Z",
  mergeable: true,
  merge_state_status: "CLEAN",
};

const meta = {
  title: "Feed/StatusSymbol",
  component: StatusSymbol,
  parameters: {
    layout: "centered",
  },
  render: (args) => (
    <div className="p-4">
      <StatusSymbol {...args} />
    </div>
  ),
} satisfies Meta<typeof StatusSymbol>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DoneNoPr: Story = {
  name: "Done — no PR",
  args: {
    task: doneTask,
  },
};

export const DoneWithPrUrlNoStatus: Story = {
  name: "Done — PR exists, status not yet fetched",
  args: {
    task: doneTaskWithPr,
  },
};

export const DoneMerged: Story = {
  name: "Done — PR merged",
  args: {
    task: doneTaskWithPr,
    prStatus: { ...basePrStatus, state: "merged" },
  },
};

export const DoneClosed: Story = {
  name: "Done — PR closed",
  args: {
    task: doneTaskWithPr,
    prStatus: { ...basePrStatus, state: "closed" },
  },
};

export const DoneConflicts: Story = {
  name: "Done — PR has conflicts",
  args: {
    task: doneTaskWithPr,
    prStatus: { ...basePrStatus, mergeable: false, merge_state_status: "DIRTY" },
  },
};

export const DoneNeedsPush: Story = {
  name: "Done — needs push (ahead of remote)",
  args: {
    task: doneTaskWithPr,
    prStatus: { ...basePrStatus, checks: [{ name: "CI", status: "failure" }] },
    syncStatus: { ahead: 2, behind: 0, diverged: false },
  },
};

export const DoneFailingChecks: Story = {
  name: "Done — failing checks",
  args: {
    task: doneTaskWithPr,
    prStatus: { ...basePrStatus, checks: [{ name: "CI", status: "failure" }] },
  },
};

export const DonePendingChecks: Story = {
  name: "Done — pending checks",
  args: {
    task: doneTaskWithPr,
    prStatus: { ...basePrStatus, checks: [{ name: "CI", status: "pending" }] },
  },
};

export const DonePassingChecks: Story = {
  name: "Done — passing checks",
  args: {
    task: doneTaskWithPr,
    prStatus: { ...basePrStatus, checks: [{ name: "CI", status: "success" }] },
  },
};
