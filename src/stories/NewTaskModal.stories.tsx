// Storybook stories for NewTaskModal — default and many-flows (scroll) variants.
import type { Meta, StoryObj } from "@storybook/react";
import { NewTaskModal } from "../components/Feed/NewTaskModal";
import { createMockFlowConfig, createMockWorkflowConfig } from "../test/mocks/fixtures";

const fewFlowsConfig = createMockWorkflowConfig({
  flows: {
    default: createMockFlowConfig(),
    bugfix: createMockFlowConfig(),
  },
});

const manyFlowsConfig = createMockWorkflowConfig({
  flows: {
    default: createMockFlowConfig(),
    bugfix: createMockFlowConfig(),
    feature: createMockFlowConfig(),
    refactor: createMockFlowConfig(),
    hotfix: createMockFlowConfig(),
    research: createMockFlowConfig(),
    migration: createMockFlowConfig(),
    security: createMockFlowConfig(),
  },
});

const meta = {
  title: "Feed/NewTaskModal",
  component: NewTaskModal,
  parameters: {
    layout: "centered",
  },
  args: {
    onClose: () => {},
    onCreate: async () => {},
  },
} satisfies Meta<typeof NewTaskModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FewFlows: Story = {
  args: {
    config: fewFlowsConfig,
  },
};

export const ManyFlows: Story = {
  args: {
    config: manyFlowsConfig,
  },
};
