// Storybook stories for the TokenUsageSummary component.
import type { Meta, StoryObj } from "@storybook/react";
import { TokenUsageSummary } from "../components/Feed/TokenUsageSummary";
import { storybookDecorator } from "./storybook-helpers";

const meta = {
  title: "Feed/TokenUsageSummary",
  component: TokenUsageSummary,
  decorators: [storybookDecorator],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof TokenUsageSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Multi-stage usage with realistic numbers. */
export const Default: Story = {
  args: {
    tokenUsage: {
      task_id: "task-1",
      stages: [
        {
          stage: "planning",
          sessions: [
            {
              session_id: "ses-1",
              stage: "planning",
              usage: {
                input_tokens: 5000,
                output_tokens: 1200,
                cache_creation_input_tokens: 800,
                cache_read_input_tokens: 3000,
              },
            },
          ],
          total: {
            input_tokens: 5000,
            output_tokens: 1200,
            cache_creation_input_tokens: 800,
            cache_read_input_tokens: 3000,
          },
        },
        {
          stage: "work",
          sessions: [
            {
              session_id: "ses-2",
              stage: "work",
              usage: {
                input_tokens: 25000,
                output_tokens: 8000,
                cache_creation_input_tokens: 3700,
                cache_read_input_tokens: 9000,
              },
            },
          ],
          total: {
            input_tokens: 25000,
            output_tokens: 8000,
            cache_creation_input_tokens: 3700,
            cache_read_input_tokens: 9000,
          },
        },
      ],
      total: {
        input_tokens: 30000,
        output_tokens: 9200,
        cache_creation_input_tokens: 4500,
        cache_read_input_tokens: 12000,
      },
    },
  },
};

/** Single stage with usage data. */
export const SingleStage: Story = {
  args: {
    tokenUsage: {
      task_id: "task-2",
      stages: [
        {
          stage: "planning",
          sessions: [
            {
              session_id: "ses-1",
              stage: "planning",
              usage: {
                input_tokens: 4200,
                output_tokens: 950,
                cache_creation_input_tokens: 600,
                cache_read_input_tokens: 2100,
              },
            },
          ],
          total: {
            input_tokens: 4200,
            output_tokens: 950,
            cache_creation_input_tokens: 600,
            cache_read_input_tokens: 2100,
          },
        },
      ],
      total: {
        input_tokens: 4200,
        output_tokens: 950,
        cache_creation_input_tokens: 600,
        cache_read_input_tokens: 2100,
      },
    },
  },
};

/** All token counts are zero. */
export const EmptyUsage: Story = {
  args: {
    tokenUsage: {
      task_id: "task-3",
      stages: [],
      total: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  },
};
