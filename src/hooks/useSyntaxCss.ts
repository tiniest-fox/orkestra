/**
 * Hook for injecting syntax highlighting CSS into document head.
 *
 * Fetches CSS once on mount, injects light + dark (media query) styles,
 * and cleans up on unmount.
 */

import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

// =============================================================================
// Types (matching Rust types from diff.rs)
// =============================================================================

export interface SyntaxCss {
  light: string;
  dark: string;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Inject syntax highlighting CSS into document head.
 *
 * Call this once in DiffPanel (or parent component).
 * CSS is automatically cleaned up on unmount.
 */
export function useSyntaxCss(): void {
  useEffect(() => {
    let styleElement: HTMLStyleElement | null = null;

    const injectCss = async () => {
      try {
        const css = await invoke<SyntaxCss>("workflow_get_syntax_css");

        // Create style element
        styleElement = document.createElement("style");
        styleElement.id = "orkestra-syntax-css";

        // Combine light + dark (with media query)
        const combinedCss = `
/* Syntax highlighting - light theme */
${css.light}

/* Syntax highlighting - dark theme */
@media (prefers-color-scheme: dark) {
  ${css.dark}
}
`;

        styleElement.textContent = combinedCss;
        document.head.appendChild(styleElement);
      } catch (err) {
        console.error("Failed to inject syntax CSS:", err);
      }
    };

    injectCss();

    // Cleanup on unmount
    return () => {
      if (styleElement && styleElement.parentNode) {
        styleElement.parentNode.removeChild(styleElement);
      }
    };
  }, []);
}
