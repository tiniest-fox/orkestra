// Hook for processing mermaid and wireframe code blocks in pre-rendered HTML containers.
//
// Used in the ArtifactView pre-rendered HTML path. Queries the container for
// language-mermaid and language-wireframe code elements and replaces their
// parent <pre> with a React-rendered component. Resilient to progressive
// rendering from useChunkedHtml — re-runs whenever content changes.

import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MermaidBlock } from "../components/ui/RichContent/MermaidBlock";
import { WireframeBlock } from "../components/ui/RichContent/WireframeBlock";
import { ensureMermaidInitialized } from "../utils/mermaidInit";

/**
 * Process mermaid/wireframe code blocks inside a pre-rendered HTML container.
 *
 * @param containerRef - Ref to the div containing dangerouslySetInnerHTML output
 * @param content      - The HTML being rendered; changing this re-triggers processing
 */
export function useRichCodeBlocks(
  containerRef: React.RefObject<HTMLDivElement | null>,
  content: string,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !content) return;

    ensureMermaidInitialized();

    const codeElements = container.querySelectorAll<HTMLElement>(
      'pre > code[class*="language-mermaid"], pre > code[class*="language-wireframe"]',
    );

    if (codeElements.length === 0) return;

    type MountedBlock = {
      wrapper: HTMLElement;
      original: HTMLElement;
      root: ReturnType<typeof createRoot>;
    };
    const mounted: MountedBlock[] = [];

    for (const codeEl of codeElements) {
      const pre = codeEl.parentElement;
      if (!pre || pre.tagName !== "PRE") continue;

      const lang = [...codeEl.classList]
        .find((c) => c.startsWith("language-"))
        ?.replace("language-", "");
      const text = codeEl.textContent ?? "";

      let component: React.ReactElement | null = null;
      if (lang === "mermaid") {
        component = createElement(MermaidBlock, { content: text });
      } else if (lang === "wireframe") {
        component = createElement(WireframeBlock, { content: text });
      } else {
        continue;
      }

      const wrapper = document.createElement("div");
      pre.parentElement?.replaceChild(wrapper, pre);
      const root = createRoot(wrapper);
      root.render(component);
      mounted.push({ wrapper, original: pre, root });
    }

    return () => {
      for (const { wrapper, original, root } of mounted) {
        root.unmount();
        wrapper.parentElement?.replaceChild(original, wrapper);
      }
    };
  }, [containerRef, content]);
}
