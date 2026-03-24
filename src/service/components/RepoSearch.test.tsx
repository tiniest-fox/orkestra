//! Tests for RepoSearch — GitHub repo picker with debounced search and abort controller.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { RepoSearch } from "./RepoSearch";

vi.mock("../api", () => ({
  searchRepos: vi.fn(),
  addProject: vi.fn(),
}));

const mockSearchRepos = vi.mocked(api.searchRepos);
const mockAddProject = vi.mocked(api.addProject);

const githubAvailable: api.GithubStatus = { available: true };
const githubUnavailable: api.GithubStatus = { available: false, error: "gh not found" };

const sampleRepos: api.GithubRepo[] = [
  { name: "my-repo", nameWithOwner: "owner/my-repo", url: "https://github.com/owner/my-repo" },
  {
    name: "other-repo",
    nameWithOwner: "owner/other-repo",
    url: "https://github.com/owner/other-repo",
  },
];

const noop = () => {};

describe("RepoSearch", () => {
  beforeEach(() => {
    mockSearchRepos.mockReset();
    mockAddProject.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -- GitHub CLI unavailable --

  it("renders GitHub CLI instructions when githubStatus.available is false", () => {
    render(<RepoSearch githubStatus={githubUnavailable} onClose={noop} onProjectAdded={noop} />);
    expect(screen.getByText("GitHub CLI not configured.")).toBeInTheDocument();
    expect(screen.getByText("gh not found")).toBeInTheDocument();
  });

  // -- GitHub available --

  it("renders search input when GitHub is available", () => {
    mockSearchRepos.mockResolvedValue([]);
    render(<RepoSearch githubStatus={githubAvailable} onClose={noop} onProjectAdded={noop} />);
    expect(screen.getByPlaceholderText("Search repos...")).toBeInTheDocument();
  });

  it("shows loading state while search is in flight", async () => {
    // Never resolves so loading state persists
    mockSearchRepos.mockReturnValue(new Promise(() => {}));
    render(<RepoSearch githubStatus={githubAvailable} onClose={noop} onProjectAdded={noop} />);
    // Empty query debounce is 0ms — loading state appears after the timer fires
    expect(await screen.findByText("Loading repos...")).toBeInTheDocument();
  });

  it("renders repo list after search resolves", async () => {
    mockSearchRepos.mockResolvedValue(sampleRepos);
    render(<RepoSearch githubStatus={githubAvailable} onClose={noop} onProjectAdded={noop} />);
    expect(await screen.findByText("owner/my-repo")).toBeInTheDocument();
    expect(screen.getByText("owner/other-repo")).toBeInTheDocument();
  });

  it("shows empty state when no repos match query", async () => {
    mockSearchRepos.mockResolvedValue([]);
    render(<RepoSearch githubStatus={githubAvailable} onClose={noop} onProjectAdded={noop} />);
    // Wait for the initial fetch to resolve (allRepos = [])
    await waitFor(() => expect(mockSearchRepos).toHaveBeenCalled());
    const input = screen.getByPlaceholderText("Search repos...");
    fireEvent.change(input, { target: { value: "nonexistent" } });
    // Query is set + no matching repos → "No matching repos."
    expect(screen.getByText("No matching repos.")).toBeInTheDocument();
  });

  it("calls addProject on repo click and fires onProjectAdded", async () => {
    mockSearchRepos.mockResolvedValue(sampleRepos);
    mockAddProject.mockResolvedValue(undefined);
    const onProjectAdded = vi.fn();
    render(
      <RepoSearch githubStatus={githubAvailable} onClose={noop} onProjectAdded={onProjectAdded} />,
    );
    fireEvent.click(await screen.findByText("owner/my-repo"));
    await waitFor(() =>
      expect(mockAddProject).toHaveBeenCalledWith(
        "https://github.com/owner/my-repo",
        "owner/my-repo",
      ),
    );
    expect(onProjectAdded).toHaveBeenCalled();
  });

  it("shows error when addProject fails", async () => {
    mockSearchRepos.mockResolvedValue(sampleRepos);
    mockAddProject.mockRejectedValue(new Error("Already exists"));
    render(<RepoSearch githubStatus={githubAvailable} onClose={noop} onProjectAdded={noop} />);
    fireEvent.click(await screen.findByText("owner/my-repo"));
    expect(await screen.findByText("Already exists")).toBeInTheDocument();
  });

  it("filters repos locally as the query changes", async () => {
    mockSearchRepos.mockResolvedValue(sampleRepos);
    render(<RepoSearch githubStatus={githubAvailable} onClose={noop} onProjectAdded={noop} />);

    // Wait for the initial fetch to resolve and display all repos
    expect(await screen.findByText("owner/my-repo")).toBeInTheDocument();
    expect(screen.getByText("owner/other-repo")).toBeInTheDocument();

    // Type a query — filtering happens client-side immediately
    const input = screen.getByPlaceholderText("Search repos...");
    fireEvent.change(input, { target: { value: "my-repo" } });

    expect(screen.getByText("owner/my-repo")).toBeInTheDocument();
    expect(screen.queryByText("owner/other-repo")).not.toBeInTheDocument();
  });

  it("renders search input when githubStatus is null (status still loading)", () => {
    // null means github status hasn't been fetched yet — not unavailable, show search UI
    render(<RepoSearch githubStatus={null} onClose={noop} onProjectAdded={noop} />);
    expect(screen.getByPlaceholderText("Search repos...")).toBeInTheDocument();
  });
});
