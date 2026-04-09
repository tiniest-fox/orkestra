// Focused scenario stories isolating key Orkestra interaction points.
import type { Meta, StoryObj } from "@storybook/react";
import { TaskDrawer } from "../../components/Feed/Drawer/TaskDrawer";
import { StorybookProviders } from "../storybook-helpers";
import {
  demoTaskAwaitingApproval,
  demoTaskDone,
  demoTaskParent,
  demoTaskWithQuestions,
} from "./demoData";
import { createDemoTransport } from "./demoTransport";

const demoTransport = createDemoTransport();

const meta = {
  title: "Demo/Scenarios",
  component: TaskDrawer,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <StorybookProviders transport={demoTransport}>
        <Story />
      </StorybookProviders>
    ),
  ],
} satisfies Meta<typeof TaskDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReviewFlow: Story = {
  args: {
    task: demoTaskAwaitingApproval,
    allTasks: [demoTaskAwaitingApproval],
    onClose: () => {},
    onOpenTask: () => {},
  },
};

export const QuestionsFlow: Story = {
  args: {
    task: demoTaskWithQuestions,
    allTasks: [demoTaskWithQuestions],
    onClose: () => {},
    onOpenTask: () => {},
  },
};

export const SubtaskProgress: Story = {
  args: {
    task: demoTaskParent,
    allTasks: [demoTaskParent],
    onClose: () => {},
    onOpenTask: () => {},
  },
};

export const CompletedTask: Story = {
  args: {
    task: demoTaskDone,
    allTasks: [demoTaskDone],
    onClose: () => {},
    onOpenTask: () => {},
  },
};
