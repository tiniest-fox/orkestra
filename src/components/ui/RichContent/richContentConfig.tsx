// Single source of truth for ReactMarkdown configuration across all surfaces.
// Provides shared remark plugins and component overrides for rich content rendering.

import type { Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "./MermaidBlock";
import { WireframeBlock } from "./WireframeBlock";

export const richContentPlugins = [remarkGfm, remarkBreaks];

// Track component references for robust type detection in the pre override.
const RICH_BLOCK_TYPES = new Set<unknown>([MermaidBlock, WireframeBlock]);

export const richContentComponents: Partial<Components> = {
  code({ className, children, ...props }) {
    const lang = className?.replace("language-", "");
    const content = String(children).replace(/\n$/, "");

    if (lang === "mermaid") return <MermaidBlock content={content} />;
    if (lang === "wireframe") return <WireframeBlock content={content} />;

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },

  // Unwrap <pre> when it wraps a rich block (MermaidBlock or WireframeBlock).
  // ReactMarkdown wraps fenced code in <pre><code>; when code() returns a rich
  // block, this pre override passes it through directly.
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    if (
      child != null &&
      typeof child === "object" &&
      "type" in child &&
      RICH_BLOCK_TYPES.has((child as { type: unknown }).type)
    ) {
      return <>{children}</>;
    }
    return <pre>{children}</pre>;
  },
};
