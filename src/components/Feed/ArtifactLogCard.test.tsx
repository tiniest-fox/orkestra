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
  // Simple (feed) mode

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

  // Actionable mode (latest artifact in drawer with approve/reject)

  it("renders approve button when needsReview and no verdict", () => {
    const onApprove = vi.fn();
    render(
      <ArtifactLogCard artifact={baseArtifact} needsReview onApprove={onApprove} loading={false} />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("calls onApprove when approve button is clicked", () => {
    const onApprove = vi.fn();
    render(
      <ArtifactLogCard artifact={baseArtifact} needsReview onApprove={onApprove} loading={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("disables approve button when loading", () => {
    const onApprove = vi.fn();
    render(<ArtifactLogCard artifact={baseArtifact} needsReview onApprove={onApprove} loading />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("shows approve button even when verdict is set", () => {
    const onApprove = vi.fn();
    render(
      <ArtifactLogCard
        artifact={baseArtifact}
        needsReview
        verdict="approved"
        onApprove={onApprove}
        loading={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("shows verdict badge when verdict is approved", () => {
    render(
      <ArtifactLogCard
        artifact={baseArtifact}
        needsReview
        verdict="approved"
        onApprove={vi.fn()}
        loading={false}
      />,
    );
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("shows verdict badge when verdict is rejected", () => {
    render(
      <ArtifactLogCard
        artifact={baseArtifact}
        needsReview
        verdict="rejected"
        onApprove={vi.fn()}
        loading={false}
      />,
    );
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });

  // Superseded mode (earlier artifact, dimmed)

  it("applies opacity-50 when superseded", () => {
    const { container } = render(<ArtifactLogCard artifact={baseArtifact} superseded />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("opacity-50");
  });

  it("does not apply opacity-50 when not superseded", () => {
    const { container } = render(<ArtifactLogCard artifact={baseArtifact} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).not.toContain("opacity-50");
  });
});
