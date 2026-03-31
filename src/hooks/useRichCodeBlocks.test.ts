// Tests for useRichCodeBlocks — DOM block detection and React root lifecycle.

import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -- Mocks --
// vi.mock is hoisted to the top of the file, so mock variables must be created
// with vi.hoisted() to be available when the factory functions execute.

const { mockUnmount, mockRender, mockCreateRoot } = vi.hoisted(() => {
  const mockUnmount = vi.fn();
  const mockRender = vi.fn();
  const mockCreateRoot = vi.fn(() => ({ render: mockRender, unmount: mockUnmount }));
  return { mockUnmount, mockRender, mockCreateRoot };
});

vi.mock("react-dom/client", () => ({
  createRoot: mockCreateRoot,
}));

vi.mock("../utils/mermaidInit", () => ({
  ensureMermaidInitialized: vi.fn(),
}));

// Stable function references so createElement type checks can compare .type
function MockMermaidBlock() {
  return null;
}
function MockWireframeBlock() {
  return null;
}

vi.mock("../components/ui/RichContent/MermaidBlock", () => ({
  MermaidBlock: MockMermaidBlock,
}));

vi.mock("../components/ui/RichContent/WireframeBlock", () => ({
  WireframeBlock: MockWireframeBlock,
}));

import { useRichCodeBlocks } from "./useRichCodeBlocks";

// ============================================================================
// Helpers
// ============================================================================

function makePreCode(lang: string, text: string): HTMLElement {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = `language-${lang}`;
  code.textContent = text;
  pre.appendChild(code);
  return pre;
}

function makeContainer(...children: HTMLElement[]): HTMLDivElement {
  const div = document.createElement("div");
  for (const child of children) div.appendChild(child);
  document.body.appendChild(div);
  return div;
}

// ============================================================================
// Tests
// ============================================================================

describe("useRichCodeBlocks", () => {
  beforeEach(() => {
    mockCreateRoot.mockClear();
    mockRender.mockClear();
    mockUnmount.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("no-ops when containerRef.current is null", () => {
    const ref = createRef<HTMLDivElement>();
    renderHook(() => useRichCodeBlocks(ref, "<p>content</p>"));
    expect(mockCreateRoot).not.toHaveBeenCalled();
  });

  it("no-ops when content is empty string", () => {
    const div = makeContainer();
    const ref = { current: div };
    renderHook(() => useRichCodeBlocks(ref, ""));
    expect(mockCreateRoot).not.toHaveBeenCalled();
  });

  it("no-ops when container has no mermaid or wireframe blocks", () => {
    const pre = makePreCode("javascript", "const x = 1;");
    const ref = { current: makeContainer(pre) };
    renderHook(() => useRichCodeBlocks(ref, "<pre><code>const x = 1;</code></pre>"));
    expect(mockCreateRoot).not.toHaveBeenCalled();
  });

  it("replaces a mermaid pre with a wrapper div and mounts a MermaidBlock root", () => {
    const pre = makePreCode("mermaid", "graph LR\n  A-->B");
    const container = makeContainer(pre);
    const ref = { current: container };

    renderHook(() => useRichCodeBlocks(ref, "<p>html</p>"));

    // createRoot called with a wrapper div (not the original pre)
    expect(mockCreateRoot).toHaveBeenCalledTimes(1);
    const wrapper = (mockCreateRoot.mock.calls[0] as unknown[])[0] as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    expect(container.contains(wrapper)).toBe(true);
    expect(container.contains(pre)).toBe(false);

    // render called with a MermaidBlock element
    expect(mockRender).toHaveBeenCalledTimes(1);
    const element = (mockRender.mock.calls[0] as unknown[])[0] as {
      type: unknown;
      props: { content: string };
    };
    expect(element.type).toBe(MockMermaidBlock);
    expect(element.props.content).toBe("graph LR\n  A-->B");
  });

  it("replaces a wireframe pre with a wrapper div and mounts a WireframeBlock root", () => {
    const pre = makePreCode("wireframe", "<div>layout</div>");
    const container = makeContainer(pre);
    const ref = { current: container };

    renderHook(() => useRichCodeBlocks(ref, "<p>html</p>"));

    expect(mockCreateRoot).toHaveBeenCalledTimes(1);
    const wrapper = (mockCreateRoot.mock.calls[0] as unknown[])[0] as HTMLElement;
    expect(container.contains(wrapper)).toBe(true);
    expect(container.contains(pre)).toBe(false);

    const element = (mockRender.mock.calls[0] as unknown[])[0] as {
      type: unknown;
      props: { content: string };
    };
    expect(element.type).toBe(MockWireframeBlock);
    expect(element.props.content).toBe("<div>layout</div>");
  });

  it("handles multiple rich blocks in the same container", () => {
    const mermaidPre = makePreCode("mermaid", "graph LR\n  A-->B");
    const wireframePre = makePreCode("wireframe", "┌──┐");
    const container = makeContainer(mermaidPre, wireframePre);
    const ref = { current: container };

    renderHook(() => useRichCodeBlocks(ref, "<p>html</p>"));

    expect(mockCreateRoot).toHaveBeenCalledTimes(2);
    expect(mockRender).toHaveBeenCalledTimes(2);
  });

  it("unmounts roots and restores original pre elements on cleanup", () => {
    const pre = makePreCode("mermaid", "graph LR\n  A-->B");
    const container = makeContainer(pre);
    const ref = { current: container };

    const { unmount } = renderHook(() => useRichCodeBlocks(ref, "<p>html</p>"));

    // Wrapper is in the DOM before cleanup
    const wrapper = (mockCreateRoot.mock.calls[0] as unknown[])[0] as HTMLElement;
    expect(container.contains(wrapper)).toBe(true);

    act(() => unmount());

    expect(mockUnmount).toHaveBeenCalledTimes(1);
    // Original pre is restored after cleanup
    expect(container.contains(pre)).toBe(true);
    expect(container.contains(wrapper)).toBe(false);
  });

  it("re-runs when content changes", () => {
    const pre = makePreCode("mermaid", "graph LR\n  A-->B");
    const container = makeContainer(pre);
    const ref = { current: container };

    const { rerender } = renderHook(({ html }: { html: string }) => useRichCodeBlocks(ref, html), {
      initialProps: { html: "<p>first</p>" },
    });

    expect(mockCreateRoot).toHaveBeenCalledTimes(1);

    // Add a new block and re-render with new content
    const pre2 = makePreCode("wireframe", "┌──┐");
    container.appendChild(pre2);

    rerender({ html: "<p>second</p>" });

    // cleanup + re-mount: first root unmounted, both now re-mounted
    expect(mockUnmount).toHaveBeenCalledTimes(1);
    expect(mockCreateRoot).toHaveBeenCalledTimes(3); // 1 initial + 2 after rerender
  });
});
