/**
 * Hook for fetching syntax highlighting CSS.
 *
 * Fetches once on mount and caches the result.
 * Returns CSS for both light and dark themes.
 */

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export interface SyntaxCss {
  light: string;
  dark: string;
}

interface UseSyntaxCssResult {
  css: SyntaxCss | null;
  loading: boolean;
  error: unknown;
}

export function useSyntaxCss(): UseSyntaxCssResult {
  const [css, setCss] = useState<SyntaxCss | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchCss = async () => {
      if (cancelled) return;

      try {
        setLoading(true);
        setError(null);
        const result = await invoke<SyntaxCss>("workflow_get_syntax_css");
        if (!cancelled) {
          setCss(result);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to fetch syntax CSS:", err);
          setError(err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchCss();

    return () => {
      cancelled = true;
    };
  }, []);

  return { css, loading, error };
}
