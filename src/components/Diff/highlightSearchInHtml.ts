// Injects <mark> tags into syntect syntax-highlighted HTML for search match highlighting.

/**
 * A pre-computed match range in content-space (where HTML entities count as one character),
 * matching the offsets produced by `useDiffSearch`.
 */
export interface SearchRange {
  charStart: number; // content-space offset (matches DiffMatch)
  charEnd: number; // content-space offset (exclusive)
  isCurrent: boolean;
}

/**
 * Returns a copy of `html` with each range in `ranges` wrapped in `<mark>` tags.
 *
 * Ranges are in content-space, so HTML entities like `&lt;` count as a single character.
 * The function detects entities during the rebuild loop and emits them as one content position.
 *
 * Syntect produces flat `<span class="...">text</span>` sequences (no nesting), so we
 * only need to track one level of open span when splitting marks across tag boundaries.
 *
 * Uses CSS class `search-match` for regular matches and `search-match-current` for
 * the highlighted current match.
 */
export function highlightSearchInHtml(html: string, ranges: SearchRange[]): string {
  if (ranges.length === 0) return html;

  let result = "";
  let textPos = 0; // content-space position; advances once per character outside tags; entities count as 1
  let rangeIdx = 0;
  let insideMark = false;
  let currentMarkClass = "search-match";
  let currentSpanClass: string | null = null;
  let inTag = false;

  // Buffer for the current tag being parsed
  let tagBuf = "";

  for (let i = 0; i <= html.length; i++) {
    const ch = i < html.length ? html[i] : null;

    if (ch === "<") {
      inTag = true;
      tagBuf = "<";
      continue;
    }

    if (inTag) {
      if (ch === null) {
        // Unterminated tag at end — just emit as-is
        result += tagBuf;
        break;
      }
      tagBuf += ch;
      if (ch === ">") {
        inTag = false;
        // Determine if this tag opens or closes a span
        if (/^<span /i.test(tagBuf)) {
          const classMatch = /class="([^"]*)"/.exec(tagBuf);
          currentSpanClass = classMatch ? classMatch[1] : "";
        } else if (/^<\/span>/i.test(tagBuf)) {
          currentSpanClass = null;
        }
        result += tagBuf;
        tagBuf = "";
      }
      continue;
    }

    if (ch === null) break;

    // Outside a tag: ch is a content character at textPos.
    // Detect HTML entity: '&' followed by ';' within 10 chars.
    let emit = ch;
    let skipTo = -1;
    if (ch === "&") {
      const semi = html.indexOf(";", i + 1);
      if (semi !== -1 && semi - i <= 10) {
        emit = html.substring(i, semi + 1);
        skipTo = semi;
      }
    }

    const range = rangeIdx < ranges.length ? ranges[rangeIdx] : null;

    // Open mark when we enter a range
    if (range && textPos === range.charStart && !insideMark) {
      currentMarkClass = range.isCurrent ? "search-match-current" : "search-match";
      if (currentSpanClass !== null) {
        result += `</span><mark class="${currentMarkClass}"><span class="${currentSpanClass}">`;
      } else {
        result += `<mark class="${currentMarkClass}">`;
      }
      insideMark = true;
    }

    result += emit;
    if (skipTo !== -1) i = skipTo; // skip past entity; loop will increment past ';'
    textPos++;

    // Close mark when we exit a range
    if (range && textPos === range.charEnd && insideMark) {
      if (currentSpanClass !== null) {
        result += `</span></mark><span class="${currentSpanClass}">`;
      } else {
        result += `</mark>`;
      }
      insideMark = false;
      rangeIdx++;
    }
  }

  return result;
}
