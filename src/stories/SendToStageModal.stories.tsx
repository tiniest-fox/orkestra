// Storybook stories for SendToStageModal — default and Finished-selected variants.
import type { Meta, StoryObj } from "@storybook/react";
import { SendToStageModal } from "../components/Feed/SendToStageModal";
import { createMockStageConfig } from "../test/mocks/fixtures";
import { createMockTransport } from "./storybook-helpers";

const stages = [
  createMockStageConfig({ name: "planning", artifact: "plan" }),
  createMockStageConfig({ name: "work", artifact: "summary" }),
  createMockStageConfig({ name: "review", artifact: "verdict" }),
];

const meta = {
  title: "Feed/SendToStageModal",
  component: SendToStageModal,
  parameters: {
    layout: "centered",
  },
  args: {
    isOpen: true,
    onClose: () => {},
    taskId: "mock-task-1",
    onSuccess: () => {},
    transport: createMockTransport(),
    stages,
    currentStage: "work",
  },
} satisfies Meta<typeof SendToStageModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const RestartCurrent: Story = {
  args: {
    currentStage: "planning",
    stages: [stages[0]],
  },
};

export const FinishedSelected: Story = {
  play: async ({ canvasElement }) => {
    const select = canvasElement.querySelector("select");
    if (select) {
      select.value = "__finished__";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  },
};
