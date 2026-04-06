// Tests for SecretsDrawer — rendering states driven by useSecrets hook state.

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { SecretsDrawer } from "./SecretsDrawer";

vi.mock("../api", () => ({
  listSecrets: vi.fn(),
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));

vi.mock("../../utils/confirmAction", () => ({
  confirmAction: vi.fn(),
}));

vi.mock("../../hooks/useIsMobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

const mockListSecrets = vi.mocked(api.listSecrets);

const SECRET_A: api.SecretEntry = {
  key: "API_KEY",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderDrawer(overrides?: { projectStatus?: api.ProjectStatus }) {
  return render(
    <SecretsDrawer
      onClose={vi.fn()}
      projectId="proj-1"
      projectName="my-project"
      projectStatus={overrides?.projectStatus ?? "stopped"}
    />,
  );
}

describe("SecretsDrawer", () => {
  beforeEach(() => {
    mockListSecrets.mockReset();
  });

  it("renders the drawer title", async () => {
    mockListSecrets.mockResolvedValue([]);
    renderDrawer();
    expect(screen.getByText("Secrets — my-project")).toBeInTheDocument();
  });

  it("shows loading state while fetching secrets", () => {
    mockListSecrets.mockReturnValue(new Promise(() => {})); // never resolves
    renderDrawer();
    expect(screen.getByText("Loading secrets…")).toBeInTheDocument();
  });

  it("shows empty state when no secrets exist", async () => {
    mockListSecrets.mockResolvedValue([]);
    renderDrawer();
    await waitFor(() => expect(screen.getByText("No secrets yet.")).toBeInTheDocument());
  });

  it("shows secret key names after load", async () => {
    mockListSecrets.mockResolvedValue([SECRET_A]);
    renderDrawer();
    await waitFor(() => expect(screen.getByText("API_KEY")).toBeInTheDocument());
  });

  it("shows Add Secret button in list view", async () => {
    mockListSecrets.mockResolvedValue([]);
    renderDrawer();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add Secret" })).toBeInTheDocument(),
    );
  });

  it("shows error banner when fetch fails", async () => {
    mockListSecrets.mockRejectedValue(new Error("network error"));
    renderDrawer();
    await waitFor(() => expect(screen.getByText("network error")).toBeInTheDocument());
  });

  it("does not show restart banner initially", async () => {
    mockListSecrets.mockResolvedValue([SECRET_A]);
    render(
      <SecretsDrawer
        onClose={vi.fn()}
        projectId="proj-1"
        projectName="my-project"
        projectStatus="running"
      />,
    );
    await waitFor(() => expect(screen.getByText("API_KEY")).toBeInTheDocument());
    expect(screen.queryByText(/Secrets have been modified/)).not.toBeInTheDocument();
  });
});
