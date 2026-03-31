// Unit tests for mermaidInit — theme detection and singleton initialization.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function mockMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: prefersDark,
      addEventListener: vi.fn(),
    }),
  });
}

describe("ensureMermaidInitialized", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with neutral theme in light mode", async () => {
    mockMatchMedia(false);
    const mermaidMock = { initialize: vi.fn() };
    vi.doMock("mermaid", () => ({ default: mermaidMock }));

    const { ensureMermaidInitialized } = await import("./mermaidInit");
    ensureMermaidInitialized();

    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "neutral" }),
    );
  });

  it("initializes with dark theme in dark mode", async () => {
    mockMatchMedia(true);
    const mermaidMock = { initialize: vi.fn() };
    vi.doMock("mermaid", () => ({ default: mermaidMock }));

    const { ensureMermaidInitialized } = await import("./mermaidInit");
    ensureMermaidInitialized();

    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }));
  });

  it("does not re-initialize on subsequent calls", async () => {
    mockMatchMedia(false);
    const mermaidMock = { initialize: vi.fn() };
    vi.doMock("mermaid", () => ({ default: mermaidMock }));

    const { ensureMermaidInitialized } = await import("./mermaidInit");
    ensureMermaidInitialized();
    ensureMermaidInitialized();

    expect(mermaidMock.initialize).toHaveBeenCalledTimes(1);
  });

  it("registers a matchMedia change listener on first call", async () => {
    const addEventListenerMock = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: addEventListenerMock,
      }),
    });
    vi.doMock("mermaid", () => ({ default: { initialize: vi.fn() } }));

    const { ensureMermaidInitialized } = await import("./mermaidInit");
    ensureMermaidInitialized();

    expect(addEventListenerMock).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("re-initializes with updated theme when color scheme changes", async () => {
    let changeHandler: (() => void) | undefined;
    const addEventListenerMock = vi.fn((_, handler: () => void) => {
      changeHandler = handler;
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi
        .fn()
        .mockReturnValueOnce({ matches: false, addEventListener: addEventListenerMock })
        .mockReturnValue({ matches: true, addEventListener: addEventListenerMock }),
    });
    const mermaidMock = { initialize: vi.fn() };
    vi.doMock("mermaid", () => ({ default: mermaidMock }));

    const { ensureMermaidInitialized } = await import("./mermaidInit");
    ensureMermaidInitialized();
    expect(mermaidMock.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "neutral" }),
    );

    // Simulate color scheme switching to dark
    changeHandler?.();
    expect(mermaidMock.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "dark" }),
    );
    expect(mermaidMock.initialize).toHaveBeenCalledTimes(2);
  });
});
