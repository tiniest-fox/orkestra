// Mermaid diagram block — renders mermaid syntax as an SVG diagram.

import mermaid from "mermaid";
import { useEffect, useState } from "react";
import { ensureMermaidInitialized } from "../../../utils/mermaidInit";
import { ModeBadge } from "./ModeBadge";

let counter = 0;

interface MermaidBlockProps {
  content: string;
}

export function MermaidBlock({ content }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureMermaidInitialized();
    const id = `mermaid-${counter++}`;
    let cancelled = false;

    mermaid
      .render(id, content)
      .then(({ svg: renderedSvg }) => {
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setSvg(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [content]);

  if (error) {
    return (
      <div className="relative rounded-panel-sm border border-border my-2">
        <ModeBadge mode="mermaid" />
        <div className="p-4">
          <div className="text-status-error text-forge-body mb-2">{error}</div>
          <pre className="font-mono text-forge-mono-md bg-canvas rounded-panel-sm p-3 overflow-x-auto border border-border">
            {content}
          </pre>
        </div>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="relative rounded-panel-sm border border-border my-2 p-4">
        <ModeBadge mode="mermaid" />
        <div className="text-text-quaternary font-mono text-forge-mono-sm">Rendering…</div>
      </div>
    );
  }

  return (
    <div className="relative rounded-panel-sm border border-border my-2 overflow-x-auto p-4">
      <ModeBadge mode="mermaid" />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG is produced by mermaid from agent-generated content */}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
