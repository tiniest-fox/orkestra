// Tests for isImageUrl utility and ResourceItem component rendering.
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowResource } from "../../../../types/workflow";
import { isImageUrl, ResourceItem } from "./ResourceItem";

// ============================================================================
// isImageUrl
// ============================================================================

describe("isImageUrl", () => {
  it("returns true for .png extension", () => {
    expect(isImageUrl("/path/to/screenshot.png")).toBe(true);
  });

  it("returns true for .jpg extension", () => {
    expect(isImageUrl("/path/to/photo.jpg")).toBe(true);
  });

  it("returns true for .jpeg extension", () => {
    expect(isImageUrl("/path/to/photo.jpeg")).toBe(true);
  });

  it("returns true for .gif extension", () => {
    expect(isImageUrl("/path/to/animation.gif")).toBe(true);
  });

  it("returns true for .webp extension", () => {
    expect(isImageUrl("/path/to/image.webp")).toBe(true);
  });

  it("returns true for .svg extension", () => {
    expect(isImageUrl("/path/to/icon.svg")).toBe(true);
  });

  it("returns true for uppercase extension", () => {
    expect(isImageUrl("/path/to/image.PNG")).toBe(true);
  });

  it("returns false for https:// URL", () => {
    expect(isImageUrl("https://docs.example.com/design")).toBe(false);
  });

  it("returns false for a plain text description", () => {
    expect(isImageUrl("architecture overview")).toBe(false);
  });

  it("returns false for a .pdf file", () => {
    expect(isImageUrl("/path/to/report.pdf")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isImageUrl("")).toBe(false);
  });
});

// ============================================================================
// ResourceItem — component rendering (non-Tauri mode)
// ============================================================================
// IS_TAURI is false in the test environment (TAURI_ENV_PLATFORM is not set),
// so these tests exercise the web/daemon rendering path without module resets.

const baseResource: WorkflowResource = {
  name: "my-resource",
  stage: "work",
  created_at: "2024-01-01T00:00:00Z",
};

describe("ResourceItem — no URL", () => {
  it("renders the resource name", () => {
    render(<ResourceItem resource={baseResource} />);
    expect(screen.getByText("my-resource")).toBeDefined();
  });

  it("renders the stage", () => {
    render(<ResourceItem resource={baseResource} />);
    expect(screen.getByText(/work/)).toBeDefined();
  });

  it("renders description when provided", () => {
    const resource = { ...baseResource, description: "Architecture overview doc" };
    render(<ResourceItem resource={resource} />);
    expect(screen.getByText("Architecture overview doc")).toBeDefined();
  });

  it("does not render a link or image when url is undefined", () => {
    render(<ResourceItem resource={baseResource} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("ResourceItem — non-image URL (non-Tauri)", () => {
  it("renders an anchor link with the URL as text", () => {
    const resource = { ...baseResource, url: "https://docs.example.com/design" };
    render(<ResourceItem resource={resource} />);
    const link = screen.getByRole("link");
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe("https://docs.example.com/design");
  });

  it("does not render an img tag", () => {
    const resource = { ...baseResource, url: "https://docs.example.com/design" };
    render(<ResourceItem resource={resource} />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("ResourceItem — image URL (non-Tauri)", () => {
  it("renders a link (not an img) for image-extension URLs when not in Tauri", () => {
    const resource = { ...baseResource, url: "/path/to/screenshot.png" };
    render(<ResourceItem resource={resource} />);
    // In non-Tauri mode, convertFileSrc is not called; falls through to anchor link
    expect(screen.getByRole("link")).toBeDefined();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

// ============================================================================
// ResourceItem — Tauri mode (IS_TAURI = true)
// ============================================================================
// Requires vi.resetModules() + dynamic import to re-evaluate the module-level
// IS_TAURI constant with TAURI_ENV_PLATFORM set.

describe("ResourceItem — image URL (Tauri mode)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: vi.fn(() => Promise.reject(new Error("Unmocked command"))),
      convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders an img tag for image-extension URLs in Tauri mode", async () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    const { ResourceItem: TauriResourceItem } = await import("./ResourceItem");
    const resource: WorkflowResource = {
      name: "screenshot",
      url: "/path/to/screenshot.png",
      stage: "work",
      created_at: "2024-01-01T00:00:00Z",
    };
    render(<TauriResourceItem resource={resource} />);
    const img = screen.getByRole("img");
    expect(img).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
