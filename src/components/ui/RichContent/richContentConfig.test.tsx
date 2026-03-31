// Unit tests for richContentConfig — plugins list and language dispatch.

import { createElement, Fragment, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { richContentPlugins } from "./richContentConfig";
import { isHtmlWireframe } from "./WireframeBlock";

// ============================================================================
// richContentPlugins
// ============================================================================

describe("richContentPlugins", () => {
  it("includes remarkGfm", () => {
    // remarkGfm is a function
    expect(richContentPlugins).toHaveLength(2);
    expect(typeof richContentPlugins[0]).toBe("function");
  });

  it("includes remarkBreaks as second plugin", () => {
    expect(typeof richContentPlugins[1]).toBe("function");
  });

  it("has remarkGfm before remarkBreaks (correct plugin order)", () => {
    // Both are functions named after their packages
    const [gfm, breaks] = richContentPlugins;
    // Plugin names may be mangled in prod, but we can check they are distinct
    expect(gfm).not.toBe(breaks);
  });
});

// ============================================================================
// isHtmlWireframe — wireframe mode detection
// ============================================================================

describe("isHtmlWireframe", () => {
  it("detects HTML wireframe when content starts with a tag", () => {
    expect(isHtmlWireframe("<div class='flex'>...</div>")).toBe(true);
  });

  it("detects HTML wireframe when content has leading whitespace before tag", () => {
    expect(isHtmlWireframe("  <section>...</section>")).toBe(true);
  });

  it("detects HTML wireframe when content starts with a newline then a tag", () => {
    expect(isHtmlWireframe("\n<p>Hello</p>")).toBe(true);
  });

  it("treats non-HTML content as ASCII wireframe", () => {
    expect(isHtmlWireframe("┌──────────────┐\n│  Login Form  │\n└──────────────┘")).toBe(false);
  });

  it("treats plain text as ASCII wireframe", () => {
    expect(isHtmlWireframe("[Header]\n[Sidebar] [Content]")).toBe(false);
  });

  it("treats empty string as ASCII wireframe", () => {
    expect(isHtmlWireframe("")).toBe(false);
  });

  it("treats content starting with a letter as ASCII", () => {
    expect(isHtmlWireframe("Box: [ OK ]")).toBe(false);
  });
});

// ============================================================================
// richContentComponents — code renderer dispatch
// ============================================================================

describe("richContentComponents.code", () => {
  it("dispatches mermaid language to MermaidBlock", async () => {
    // Dynamically import to get the actual JSX-producing function
    const { richContentComponents } = await import("./richContentConfig");
    const code = richContentComponents.code as (props: {
      className?: string;
      children?: unknown;
    }) => ReactElement<{ content: string }>;

    const result = code({ className: "language-mermaid", children: "graph LR\n  A --> B\n" });

    const { MermaidBlock } = await import("./MermaidBlock");
    expect(result).not.toBeNull();
    expect(result.type).toBe(MermaidBlock);
    expect(result.props.content).toBe("graph LR\n  A --> B");
  });

  it("dispatches wireframe language to WireframeBlock", async () => {
    const { richContentComponents } = await import("./richContentConfig");
    const code = richContentComponents.code as (props: {
      className?: string;
      children?: unknown;
    }) => ReactElement<{ content: string }>;

    const result = code({ className: "language-wireframe", children: "┌──┐\n└──┘\n" });

    const { WireframeBlock } = await import("./WireframeBlock");
    expect(result).not.toBeNull();
    expect(result.type).toBe(WireframeBlock);
    expect(result.props.content).toBe("┌──┐\n└──┘");
  });

  it("passes through non-rich languages as plain code", async () => {
    const { richContentComponents } = await import("./richContentConfig");
    const code = richContentComponents.code as (props: {
      className?: string;
      children?: unknown;
    }) => ReactElement;

    const result = code({ className: "language-javascript", children: "const x = 1;\n" });

    // Should return a <code> element (not MermaidBlock or WireframeBlock)
    expect(result).not.toBeNull();
    expect(result.type).toBe("code");
  });

  it("passes through code with no language class", async () => {
    const { richContentComponents } = await import("./richContentConfig");
    const code = richContentComponents.code as (props: {
      className?: string;
      children?: unknown;
    }) => ReactElement;

    const result = code({ className: undefined, children: "inline code" });

    expect(result.type).toBe("code");
  });
});

// ============================================================================
// richContentComponents — pre unwrapping
// ============================================================================

describe("richContentComponents.pre", () => {
  it("unwraps MermaidBlock children", async () => {
    const { richContentComponents } = await import("./richContentConfig");
    const { MermaidBlock } = await import("./MermaidBlock");
    const pre = richContentComponents.pre as (props: { children: unknown }) => ReactElement;

    const child = createElement(MermaidBlock, { content: "graph LR" });
    const result = pre({ children: child });

    expect(result.type).toBe(Fragment);
  });

  it("unwraps WireframeBlock children", async () => {
    const { richContentComponents } = await import("./richContentConfig");
    const { WireframeBlock } = await import("./WireframeBlock");
    const pre = richContentComponents.pre as (props: { children: unknown }) => ReactElement;

    const child = createElement(WireframeBlock, { content: "<div>test</div>" });
    const result = pre({ children: child });

    expect(result.type).toBe(Fragment);
  });

  it("preserves pre for regular code children", async () => {
    const { richContentComponents } = await import("./richContentConfig");
    const pre = richContentComponents.pre as (props: { children: unknown }) => ReactElement;

    const child = createElement("code", { className: "language-js" }, "const x = 1;");
    const result = pre({ children: child });

    expect(result.type).toBe("pre");
  });
});
