/**
 * Hook for progressive HTML rendering.
 *
 * Splits pre-rendered HTML into an initial chunk (rendered immediately)
 * and the remainder (appended after a frame). This keeps the first paint
 * fast — the user sees content instantly while the rest fills in without
 * blocking the animation.
 *
 * When `defer` is true the hook stays on the initial chunk until
 * defer becomes false (e.g. after a Column animation settles),
 * then appends the rest on the next frame.
 */

import { useEffect, useRef, useState } from "react";

/** Number of top-level HTML elements to render immediately. */
const INITIAL_ELEMENT_COUNT = 8;

/**
 * Regex that matches the boundary just before a top-level block element opening tag.
 * We split on these to carve out individual top-level elements.
 */
const BLOCK_ELEMENT_RE = /<(?:h[1-6]|p|ul|ol|li|pre|blockquote|table|hr|div|section)\b/gi;

/**
 * Split HTML into two parts: an initial slice (first N top-level elements)
 * and the rest. Splitting is done by finding opening tags of block-level
 * elements — cheap string scanning, no DOM parsing.
 */
function splitHtml(html: string, count: number): [string, string] {
  let found = 0;
  BLOCK_ELEMENT_RE.lastIndex = 0;

  let match = BLOCK_ELEMENT_RE.exec(html);
  while (match) {
    found++;
    if (found > count) {
      // We've passed `count` elements — split here
      return [html.slice(0, match.index), html.slice(match.index)];
    }
    match = BLOCK_ELEMENT_RE.exec(html);
  }

  // Fewer than `count` elements — return everything as initial
  return [html, ""];
}

interface UseChunkedHtmlResult {
  /** HTML string to render right now. Grows from initial chunk to full content. */
  html: string;
  /** Whether the full content has been rendered yet. */
  isComplete: boolean;
}

/**
 * Progressively render HTML: show the first few elements immediately,
 * append the rest after a frame so the animation isn't blocked.
 *
 * @param fullHtml  The complete HTML string to render.
 * @param defer     When true, hold on the initial chunk. The rest is
 *                  appended one frame after defer becomes false.
 */
export function useChunkedHtml(fullHtml: string, defer = false): UseChunkedHtmlResult {
  const [initial, rest] = splitHtml(fullHtml, INITIAL_ELEMENT_COUNT);
  const hasRest = rest.length > 0;

  // When not deferred (no animation running), show full content immediately.
  // When deferred (animation in progress), start with the initial chunk only.
  const [showFull, setShowFull] = useState(() => !defer);
  const prevHtmlRef = useRef(fullHtml);

  // Reset when content changes (e.g. switching artifacts)
  if (prevHtmlRef.current !== fullHtml) {
    prevHtmlRef.current = fullHtml;
    setShowFull(!defer);
  }

  useEffect(() => {
    // While deferred or already showing full content, nothing to do.
    if (defer || showFull) return;

    if (!hasRest) {
      // Small content — no chunking needed, show immediately.
      setShowFull(true);
      return;
    }

    // Schedule the rest for the next frame so the current frame
    // (with just the initial chunk) can paint without jank.
    const id = requestAnimationFrame(() => {
      setShowFull(true);
    });
    return () => cancelAnimationFrame(id);
  }, [defer, showFull, hasRest]);

  return {
    html: showFull ? fullHtml : initial,
    isComplete: showFull || (!hasRest && !defer),
  };
}
