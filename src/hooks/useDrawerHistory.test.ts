import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IS_TAURI is a module-level constant evaluated at import time, so we use
// dynamic imports and vi.resetModules() to test both paths.

describe("useDrawerHistory — browser mode", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("TAURI_ENV_PLATFORM", "");
    vi.spyOn(history, "pushState");
    vi.spyOn(history, "back");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("pushes a history sentinel when drawer opens", async () => {
    const { useDrawerHistory } = await import("./useDrawerHistory");
    const closeAll = vi.fn();

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useDrawerHistory(open, closeAll),
      { initialProps: { open: false } },
    );

    expect(history.pushState).not.toHaveBeenCalled();

    rerender({ open: true });

    expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(history.pushState).toHaveBeenCalledWith({ orkestra_drawer: true }, "");
  });

  it("calls history.back() when drawer closes via UI", async () => {
    const { useDrawerHistory } = await import("./useDrawerHistory");
    const closeAll = vi.fn();

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useDrawerHistory(open, closeAll),
      { initialProps: { open: false } },
    );

    rerender({ open: true });
    expect(history.pushState).toHaveBeenCalledTimes(1);

    rerender({ open: false });
    expect(history.back).toHaveBeenCalledTimes(1);
  });

  it("does not call history.back() when drawer was never opened", async () => {
    const { useDrawerHistory } = await import("./useDrawerHistory");
    const closeAll = vi.fn();

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useDrawerHistory(open, closeAll),
      { initialProps: { open: false } },
    );

    rerender({ open: false });
    expect(history.back).not.toHaveBeenCalled();
  });

  it("calls closeAll when popstate fires while sentinel is pushed", async () => {
    const { useDrawerHistory } = await import("./useDrawerHistory");
    const closeAll = vi.fn();

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useDrawerHistory(open, closeAll),
      { initialProps: { open: false } },
    );

    rerender({ open: true });

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });

    expect(closeAll).toHaveBeenCalledTimes(1);
  });

  it("ignores popstate when no sentinel was pushed", async () => {
    const { useDrawerHistory } = await import("./useDrawerHistory");
    const closeAll = vi.fn();

    renderHook(({ open }: { open: boolean }) => useDrawerHistory(open, closeAll), {
      initialProps: { open: false },
    });

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });

    expect(closeAll).not.toHaveBeenCalled();
  });

  it("does not double-close when UI closes drawer (popstate from history.back is ignored)", async () => {
    const { useDrawerHistory } = await import("./useDrawerHistory");
    const closeAll = vi.fn();

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useDrawerHistory(open, closeAll),
      { initialProps: { open: false } },
    );

    rerender({ open: true });
    rerender({ open: false }); // ref cleared, then history.back() called

    // Simulate the popstate that results from history.back() above.
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });

    // Ref was already cleared before history.back(), so closeAll must not fire.
    expect(closeAll).not.toHaveBeenCalled();
  });

  it("does not push multiple sentinels when drawerOpen stays true", async () => {
    const { useDrawerHistory } = await import("./useDrawerHistory");
    const closeAll = vi.fn();

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useDrawerHistory(open, closeAll),
      { initialProps: { open: false } },
    );

    rerender({ open: true });
    rerender({ open: true }); // switching drawers — open stays true, no second push

    expect(history.pushState).toHaveBeenCalledTimes(1);
  });

  it("cleans up popstate listener on unmount", async () => {
    const { useDrawerHistory } = await import("./useDrawerHistory");
    const closeAll = vi.fn();
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(
      ({ open }: { open: boolean }) => useDrawerHistory(open, closeAll),
      { initialProps: { open: false } },
    );

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("popstate", expect.any(Function));
  });
});

describe("useDrawerHistory — Tauri mode", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("TAURI_ENV_PLATFORM", "macos");
    vi.spyOn(history, "pushState");
    vi.spyOn(history, "back");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not push history sentinel when drawer opens", async () => {
    const { useDrawerHistory } = await import("./useDrawerHistory");
    const closeAll = vi.fn();

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useDrawerHistory(open, closeAll),
      { initialProps: { open: false } },
    );

    rerender({ open: true });

    expect(history.pushState).not.toHaveBeenCalled();
  });

  it("does not call history.back() when drawer closes", async () => {
    const { useDrawerHistory } = await import("./useDrawerHistory");
    const closeAll = vi.fn();

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useDrawerHistory(open, closeAll),
      { initialProps: { open: false } },
    );

    rerender({ open: true });
    rerender({ open: false });

    expect(history.back).not.toHaveBeenCalled();
  });

  it("does not call closeAll on popstate", async () => {
    const { useDrawerHistory } = await import("./useDrawerHistory");
    const closeAll = vi.fn();

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useDrawerHistory(open, closeAll),
      { initialProps: { open: false } },
    );

    rerender({ open: true });

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });

    expect(closeAll).not.toHaveBeenCalled();
  });
});
