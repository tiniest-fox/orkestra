// Hook for managing search state and match indices across a highlighted diff.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HighlightedFileDiff } from "../../hooks/useDiff";

export interface DiffMatch {
  fileIndex: number;
  hunkIndex: number;
  lineIndex: number; // index within hunk.lines array
  charStart: number; // start offset in line.content
  charEnd: number; // exclusive end offset
}

export interface UseDiffSearchResult {
  matches: DiffMatch[];
  currentIndex: number; // -1 when no matches
  count: number;
  currentMatch: DiffMatch | null;
  next: () => void;
  prev: () => void;
  setQuery: (query: string) => void;
  query: string;
}

export function useDiffSearch(files: HighlightedFileDiff[]): UseDiffSearchResult {
  const [query, setQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(-1);

  const matches = useMemo(() => {
    if (!query) return [];
    const results: DiffMatch[] = [];
    const lowerQuery = query.toLowerCase();
    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi];
      if (file.is_binary) continue;
      for (let hi = 0; hi < file.hunks.length; hi++) {
        const hunk = file.hunks[hi];
        for (let li = 0; li < hunk.lines.length; li++) {
          const line = hunk.lines[li];
          const lower = line.content.toLowerCase();
          let pos = lower.indexOf(lowerQuery, 0);
          while (pos !== -1) {
            results.push({
              fileIndex: fi,
              hunkIndex: hi,
              lineIndex: li,
              charStart: pos,
              charEnd: pos + query.length,
            });
            pos = lower.indexOf(lowerQuery, pos + 1); // advance by 1 to find overlapping matches
          }
        }
      }
    }
    return results;
  }, [files, query]);

  // Reset currentIndex when matches change
  useEffect(() => {
    setCurrentIndex(matches.length > 0 ? 0 : -1);
  }, [matches]);

  const next = useCallback(() => {
    setCurrentIndex((i) => (matches.length === 0 ? -1 : (i + 1) % matches.length));
  }, [matches.length]);

  const prev = useCallback(() => {
    setCurrentIndex((i) => (matches.length === 0 ? -1 : (i - 1 + matches.length) % matches.length));
  }, [matches.length]);

  const currentMatch = currentIndex >= 0 ? (matches[currentIndex] ?? null) : null;

  return {
    matches,
    currentIndex,
    count: matches.length,
    currentMatch,
    next,
    prev,
    setQuery,
    query,
  };
}
