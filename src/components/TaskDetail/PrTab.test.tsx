import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrTab } from "./PrTab";

describe("PrTab", () => {
  it("renders a link to the PR", () => {
    render(<PrTab prUrl="https://github.com/test/repo/pull/42" />);

    const link = screen.getByRole("link", { name: /view pull request/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://github.com/test/repo/pull/42");
  });

  it("opens link in new tab", () => {
    render(<PrTab prUrl="https://github.com/test/repo/pull/42" />);

    const link = screen.getByRole("link", { name: /view pull request/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
