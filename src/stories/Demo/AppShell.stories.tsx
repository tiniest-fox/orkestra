// Interactive demo of the full Orkestra app shell.
import type { Meta, StoryObj } from "@storybook/react";
import { Orkestra } from "../../components/Orkestra";
import { StorybookProviders } from "../storybook-helpers";
import { createDemoTransport } from "./demoTransport";

const demoTransport = createDemoTransport();

const meta = {
  title: "Demo/App Shell",
  component: Orkestra,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <StorybookProviders transport={demoTransport}>
        <div className="w-full h-screen bg-canvas">
          <Story />
        </div>
      </StorybookProviders>
    ),
  ],
} satisfies Meta<typeof Orkestra>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
