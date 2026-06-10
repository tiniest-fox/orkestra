// Tests for TokenUsageSummary — renders token counts from TaskTokenUsage.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TaskTokenUsage } from "../../types/workflow";
import { TokenUsageSummary } from "./TokenUsageSummary";

function makeTokenUsage(overrides?: Partial<TaskTokenUsage["total"]>): TaskTokenUsage {
  return {
    task_id: "task-1",
    stages: [],
    total: {
      input_tokens: 30000,
      output_tokens: 9200,
      cache_creation_input_tokens: 4500,
      cache_read_input_tokens: 12000,
      ...overrides,
    },
  };
}

describe("TokenUsageSummary", () => {
  it("renders input and output token counts", () => {
    render(<TokenUsageSummary tokenUsage={makeTokenUsage()} />);
    expect(screen.getByText(/In:/)).toBeInTheDocument();
    expect(screen.getByText(/Out:/)).toBeInTheDocument();
  });

  it("renders localized numbers", () => {
    render(<TokenUsageSummary tokenUsage={makeTokenUsage()} />);
    // 30,000 input tokens should appear formatted
    const text = screen.getByText(/30,000/);
    expect(text).toBeInTheDocument();
  });

  it("renders zero counts when all tokens are zero", () => {
    render(
      <TokenUsageSummary
        tokenUsage={makeTokenUsage({
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        })}
      />,
    );
    // total should be 0 — multiple zeros present in the output
    const text = document.querySelector(".font-mono")?.textContent ?? "";
    expect(text).toContain("0");
  });

  it("includes a total token count", () => {
    // 30000 + 9200 + 4500 + 12000 = 55700
    render(<TokenUsageSummary tokenUsage={makeTokenUsage()} />);
    expect(screen.getByText(/55,700/)).toBeInTheDocument();
  });
});
