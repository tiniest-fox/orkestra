// Storybook stories for ResourcesTab with image and non-image resources.
import type { Meta, StoryObj } from "@storybook/react";
import { ResourcesTab } from "../components/Feed/Drawer/Sections/ResourcesTab";
import { createMockResource, createMockWorkflowTaskView } from "../test/mocks/fixtures";

const meta = {
  title: "Feed/ResourcesTab",
  component: ResourcesTab,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ResourcesTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithImageAndLink: Story = {
  args: {
    task: createMockWorkflowTaskView({
      resources: {
        screenshot: createMockResource({
          name: "Component Screenshot",
          url: "/path/to/screenshot.png",
          description: "Storybook screenshot of the updated component",
          stage: "work",
        }),
        "design-doc": createMockResource({
          name: "Design Doc",
          url: "https://docs.example.com/design",
          description: "Architecture design document",
          stage: "planning",
        }),
        "no-url": createMockResource({
          name: "Notes",
          url: undefined,
          description: "Description-only resource with no URL",
          stage: "planning",
        }),
      },
    }),
    bodyRef: { current: null },
  },
};

export const Empty: Story = {
  args: {
    task: createMockWorkflowTaskView({ resources: {} }),
    bodyRef: { current: null },
  },
};
