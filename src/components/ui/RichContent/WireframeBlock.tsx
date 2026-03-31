// Wireframe block — renders ASCII art or Tailwind HTML wireframes.

import DOMPurify from "dompurify";
import { ModeBadge } from "./ModeBadge";

interface WireframeBlockProps {
  content: string;
}

/** Detect whether content is Tailwind HTML (starts with a tag) or ASCII art. */
export function isHtmlWireframe(content: string): boolean {
  return content.trimStart().startsWith("<");
}

export function WireframeBlock({ content }: WireframeBlockProps) {
  const isHtml = isHtmlWireframe(content);

  if (isHtml) {
    return (
      <div className="relative rounded-panel-sm border border-border bg-canvas p-4 overflow-hidden my-2">
        <ModeBadge mode="tailwind" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: agent-generated wireframe HTML, sanitized via DOMPurify */}
        <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }} />
      </div>
    );
  }

  return (
    <div className="relative my-2">
      <ModeBadge mode="ascii" />
      <pre className="font-mono text-forge-mono-md bg-canvas rounded-panel-sm p-4 overflow-x-auto border border-border">
        {content}
      </pre>
    </div>
  );
}
