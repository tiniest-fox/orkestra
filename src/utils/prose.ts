/**
 * Shared prose styling for markdown rendering.
 */

/**
 * Unified prose classes using Forge design tokens.
 * Used in feed components, artifact views, and log entries.
 */
export const PROSE_CLASSES = [
  "prose prose-sm max-w-none break-words",
  "font-sans",
  "prose-headings:font-sans prose-headings:not-italic",
  "prose-h1:text-forge-body-lg prose-h1:font-semibold prose-h1:text-text-primary",
  "prose-h2:text-forge-body-md prose-h2:font-semibold prose-h2:text-text-primary",
  "prose-h3:text-forge-body prose-h3:font-semibold prose-h3:text-text-secondary",
  "prose-h4:text-forge-body prose-h4:font-medium prose-h4:text-text-tertiary",
  "prose-h5:text-forge-body prose-h5:font-medium prose-h5:text-text-tertiary",
  "prose-h6:text-forge-body prose-h6:font-medium prose-h6:text-text-quaternary",
  "prose-headings:mt-2 prose-headings:mb-0.5",
  "prose-p:text-text-primary prose-p:my-1.5",
  "prose-strong:text-text-primary",
  "prose-em:text-text-primary",
  "prose-li:text-text-primary prose-li:my-0.5",
  "prose-ul:my-1.5 prose-ol:my-1.5",
  "prose-a:text-accent prose-a:no-underline hover:prose-a:underline",
  "prose-code:font-mono prose-code:bg-canvas prose-code:text-text-primary prose-code:px-1 prose-code:rounded",
  "prose-pre:bg-canvas prose-pre:text-text-primary prose-pre:font-mono prose-pre:my-2",
  "prose-blockquote:text-text-tertiary prose-blockquote:border-border prose-blockquote:my-1.5",
  "prose-hr:border-border prose-hr:my-2",
  "prose-th:text-text-primary prose-td:text-text-primary",
  "artifact-prose",
].join(" ");
