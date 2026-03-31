// Shared mermaid initialization — call before any mermaid.render() call.

import mermaid from "mermaid";

let initialized = false;

function getTheme(): "dark" | "neutral" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral";
}

function initializeMermaid(): void {
  mermaid.initialize({
    startOnLoad: false,
    theme: getTheme(),
    securityLevel: "strict",
  });
  initialized = true;
}

export function ensureMermaidInitialized(): void {
  if (initialized) return;
  initializeMermaid();
  // Re-initialize with updated theme when the user switches color schemes.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    initializeMermaid();
  });
}
