/**
 * Hook for fetching syntax highlighting CSS.
 *
 * Module-level cache: fetched once per app session regardless of how many
 * components call this hook. Subsequent mounts read the cached result instantly
 * with no IPC overhead.
 */

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export interface SyntaxCss {
  light: string;
  dark: string;
}

// Module-level cache — shared across all hook instances.
let cachedCss: SyntaxCss | null = null;
let fetchPromise: Promise<SyntaxCss> | null = null;

interface UseSyntaxCssResult {
  css: SyntaxCss | null;
  loading: boolean;
  error: unknown;
}

export function useSyntaxCss(): UseSyntaxCssResult {
  const [css, setCss] = useState<SyntaxCss | null>(cachedCss);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (cachedCss) {
      setCss(cachedCss);
      return;
    }

    if (!fetchPromise) {
      fetchPromise = invoke<SyntaxCss>("workflow_get_syntax_css");
    }

    let cancelled = false;
    fetchPromise
      .then((result) => {
        cachedCss = result;
        fetchPromise = null;
        if (!cancelled) setCss(result);
      })
      .catch((err) => {
        fetchPromise = null; // allow retry on next mount
        if (!cancelled) {
          console.error("Failed to fetch syntax CSS:", err);
          setError(err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { css, loading: css === null, error };
}
