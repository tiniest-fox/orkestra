import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OrkBlock } from "../../utils/orkBlocks";
import { ProposalCard } from "./ProposalCard";

type TrakProposal = Extract<OrkBlock, { type: "proposal" }>;

const baseProposal: TrakProposal = {
  type: "proposal",
  flow: "default",
  stage: "planning",
  title: "Add user authentication",
  content: "## Plan\n\nImplement JWT-based auth with refresh tokens.",
};

describe("ProposalCard", () => {
  it("renders proposal content as markdown", () => {
    render(<ProposalCard proposal={baseProposal} onAccept={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
  });

  it("shows flow and stage info in header", () => {
    render(<ProposalCard proposal={baseProposal} onAccept={vi.fn()} />);
    expect(screen.getByText("default > planning")).toBeInTheDocument();
  });

  it("shows only flow when stage is absent", () => {
    const proposal: TrakProposal = { type: "proposal", flow: "default" };
    render(<ProposalCard proposal={proposal} onAccept={vi.fn()} />);
    expect(screen.getByText("default")).toBeInTheDocument();
  });

  it("shows title when present", () => {
    render(<ProposalCard proposal={baseProposal} onAccept={vi.fn()} />);
    expect(screen.getByText("Add user authentication")).toBeInTheDocument();
  });

  it("Accept button calls onAccept", () => {
    const onAccept = vi.fn();
    render(<ProposalCard proposal={baseProposal} onAccept={onAccept} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("Accept button shows loading state", () => {
    render(<ProposalCard proposal={baseProposal} onAccept={vi.fn()} loading />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
  });

  it("renders without content — minimal proposal", () => {
    const minimal: TrakProposal = { type: "proposal", flow: "default" };
    render(<ProposalCard proposal={minimal} onAccept={vi.fn()} />);
    expect(screen.getByText("Proposed Trak")).toBeInTheDocument();
    expect(screen.getByText("No content")).toBeInTheDocument();
  });

  it("does not show No content when title is present but content absent", () => {
    const proposal: TrakProposal = { type: "proposal", title: "My Trak" };
    render(<ProposalCard proposal={proposal} onAccept={vi.fn()} />);
    expect(screen.queryByText("No content")).not.toBeInTheDocument();
    expect(screen.getByText("My Trak")).toBeInTheDocument();
  });

  it("collapses body and Accept button on header click", () => {
    render(<ProposalCard proposal={baseProposal} onAccept={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Proposed Trak").closest("button") as HTMLElement);
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
  });

  it("re-expands on second header click", () => {
    render(<ProposalCard proposal={baseProposal} onAccept={vi.fn()} />);
    const header = screen.getByText("Proposed Trak").closest("button") as HTMLElement;
    fireEvent.click(header);
    fireEvent.click(header);
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
  });
});
