// Tests for SubfolderPicker — directory listing and subfolder project creation dialog.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { SubfolderPicker } from "./SubfolderPicker";

vi.mock("../api", () => ({
  listDirectories: vi.fn(),
  addSubfolderProject: vi.fn(),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockListDirectories = vi.mocked(api.listDirectories);
const mockAddSubfolderProject = vi.mocked(api.addSubfolderProject);

function renderPicker(overrides?: Partial<React.ComponentProps<typeof SubfolderPicker>>) {
  const props = {
    projectId: "proj-1",
    projectName: "my-repo",
    onClose: vi.fn(),
    onComplete: vi.fn(),
    ...overrides,
  };
  return render(<SubfolderPicker {...props} />);
}

describe("SubfolderPicker", () => {
  beforeEach(() => {
    mockListDirectories.mockReset();
    mockAddSubfolderProject.mockReset();
  });

  it("renders loading state before directories are fetched", () => {
    mockListDirectories.mockReturnValue(new Promise(() => {}));
    renderPicker();
    expect(screen.getByText("Loading directories...")).toBeInTheDocument();
  });

  it("renders directory list after fetch", async () => {
    mockListDirectories.mockResolvedValue(["src", "docs", "tests"]);
    renderPicker();
    await waitFor(() => {
      expect(screen.getByText("src")).toBeInTheDocument();
      expect(screen.getByText("docs")).toBeInTheDocument();
      expect(screen.getByText("tests")).toBeInTheDocument();
    });
  });

  it("shows empty message when no directories exist", async () => {
    mockListDirectories.mockResolvedValue([]);
    renderPicker();
    await waitFor(() => {
      expect(screen.getByText("No subdirectories found.")).toBeInTheDocument();
    });
  });

  it("shows error when directory fetch fails", async () => {
    mockListDirectories.mockRejectedValue(new Error("permission denied"));
    renderPicker();
    await waitFor(() => {
      expect(screen.getByText("permission denied")).toBeInTheDocument();
    });
  });

  it("calls addSubfolderProject and onComplete when a directory is selected", async () => {
    const user = userEvent.setup();
    mockListDirectories.mockResolvedValue(["src", "docs"]);
    mockAddSubfolderProject.mockResolvedValue(undefined);
    const onComplete = vi.fn();
    renderPicker({ onComplete });

    await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument());
    await user.click(screen.getByText("src"));

    await waitFor(() => {
      expect(mockAddSubfolderProject).toHaveBeenCalledWith("proj-1", "src", "src");
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("shows inline error when addSubfolderProject fails", async () => {
    const user = userEvent.setup();
    mockListDirectories.mockResolvedValue(["src"]);
    mockAddSubfolderProject.mockRejectedValue(new Error("server error"));
    renderPicker();

    await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument());
    await user.click(screen.getByText("src"));

    await waitFor(() => {
      expect(screen.getByText("server error")).toBeInTheDocument();
    });
  });

  it("calls onClose when the header close button is clicked", async () => {
    const user = userEvent.setup();
    mockListDirectories.mockResolvedValue([]);
    const onClose = vi.fn();
    renderPicker({ onClose });

    await waitFor(() => expect(screen.getByText("No subdirectories found.")).toBeInTheDocument());
    await user.click(screen.getByTitle(/close/i));
    expect(onClose).toHaveBeenCalled();
  });
});
