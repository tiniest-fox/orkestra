import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowArtifact } from "../../types/workflow";
import { ArtifactLogCard } from "./ArtifactLogCard";

vi.mock("../../hooks/useRichCodeBlocks", () => ({
  useRichCodeBlocks: () => {},
}));

const baseArtifact: WorkflowArtifact = {
  name: "plan",
  content: "# My Plan\n\nSome content here.",
  stage: "planning",
  created_at: "2026-01-01T00:00:00Z",
  iteration: 1,
};

describe("ArtifactLogCard", () => {
  it("renders collapsed state with artifact name", () => {
    render(<ArtifactLogCard artifact={baseArtifact} />);
    expect(screen.getByText("Generated plan")).toBeInTheDocument();
    expect(screen.queryByText(/My Plan/)).not.toBeInTheDocument();
  });

  it("expands on click to show content", () => {
    render(<ArtifactLogCard artifact={baseArtifact} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/My Plan/)).toBeInTheDocument();
  });

  it("collapses again on second click", () => {
    render(<ArtifactLogCard artifact={baseArtifact} />);
    const header = screen.getByRole("button");
    fireEvent.click(header);
    expect(screen.getByText(/My Plan/)).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByText(/My Plan/)).not.toBeInTheDocument();
  });

  it("renders pre-rendered HTML when artifact.html is present", () => {
    const artifact: WorkflowArtifact = { ...baseArtifact, html: "<p>Hello from HTML</p>" };
    render(<ArtifactLogCard artifact={artifact} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Hello from HTML")).toBeInTheDocument();
  });

  it("renders via ReactMarkdown when no html", () => {
    render(<ArtifactLogCard artifact={baseArtifact} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("heading", { name: "My Plan" })).toBeInTheDocument();
  });

  it("shows No content when content is empty", () => {
    const artifact: WorkflowArtifact = { ...baseArtifact, content: "", html: undefined };
    render(<ArtifactLogCard artifact={artifact} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("No content")).toBeInTheDocument();
  });
});
