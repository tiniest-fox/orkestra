// Storybook stories for ProposalCard — all visual states of the Trak proposal card.
import type { Meta, StoryObj } from "@storybook/react";
import { ProposalCard } from "../components/Feed/ProposalCard";
import { storybookDecorator } from "./storybook-helpers";

const meta = {
  title: "Feed/ProposalCard",
  component: ProposalCard,
  decorators: [storybookDecorator],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ProposalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default — proposal with flow, stage, title, and markdown content. */
export const Default: Story = {
  args: {
    proposal: {
      type: "proposal",
      flow: "default",
      stage: "planning",
      title: "Add JWT Authentication",
      content:
        "## Plan\n\nImplement JWT-based authentication with refresh tokens.\n\n### Steps\n\n1. Add `jsonwebtoken` dependency\n2. Create auth middleware\n3. Wire up login/logout endpoints\n4. Add refresh token rotation",
    },
    onAccept: () => {},
    loading: false,
  },
};

/** Minimal — proposal with only a flow name (no title, no content). */
export const Minimal: Story = {
  args: {
    proposal: {
      type: "proposal",
      flow: "default",
    },
    onAccept: () => {},
    loading: false,
  },
};

/** Long Content — markdown-heavy proposal to verify scroll and collapse behaviour. */
export const LongContent: Story = {
  args: {
    proposal: {
      type: "proposal",
      flow: "default",
      stage: "planning",
      title: "Comprehensive API Redesign",
      content: [
        "## Summary",
        "",
        "This Trak redesigns the REST API to follow JSON:API conventions.",
        "",
        "## Motivation",
        "",
        "The current API has grown organically and has several inconsistencies:",
        "",
        "- Inconsistent field naming (camelCase vs snake_case)",
        "- Missing pagination on collection endpoints",
        "- No standardised error envelopes",
        "",
        "## Scope",
        "",
        "### In scope",
        "",
        "- All `/api/v1/*` endpoints",
        "- Error response format",
        "- Pagination headers",
        "",
        "### Out of scope",
        "",
        "- Authentication changes",
        "- Database schema changes",
        "",
        "## Implementation plan",
        "",
        "1. Audit existing endpoints",
        "2. Draft OpenAPI spec",
        "3. Implement adapter layer for backwards compatibility",
        "4. Update client code",
        "5. Update documentation",
      ].join("\n"),
    },
    onAccept: () => {},
    loading: false,
  },
};

/** Loading — Accept button in loading/disabled state while the action is in flight. */
export const Loading: Story = {
  args: {
    proposal: {
      type: "proposal",
      flow: "default",
      stage: "planning",
      title: "Add JWT Authentication",
      content: "Implement JWT-based auth with refresh tokens.",
    },
    onAccept: () => {},
    loading: true,
  },
};
