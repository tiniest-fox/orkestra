//! ANSI escape code utilities: strip raw sequences and render colorized spans.

// ============================================================================
// Types
// ============================================================================

export interface AnsiSegment {
  text: string;
  classes: string[];
}

// ============================================================================
// Constants
// ============================================================================

// Maps ANSI SGR foreground color codes to Tailwind Forge classes.
// Normal (30-37) and bright (90-97) variants map to the same tokens.
const COLOR_MAP: Record<number, string> = {
  30: "text-text-tertiary",
  31: "text-status-error",
  32: "text-status-success",
  33: "text-status-warning",
  34: "text-status-info",
  35: "text-violet",
  36: "text-teal",
  37: "text-text-primary",
  // Bright variants
  90: "text-text-tertiary",
  91: "text-status-error",
  92: "text-status-success",
  93: "text-status-warning",
  94: "text-status-info",
  95: "text-violet",
  96: "text-teal",
  97: "text-text-primary",
};

// ============================================================================
// Pure functions
// ============================================================================

/** Removes all ANSI SGR escape sequences from text. */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is required for ANSI sequence matching
  return text.replace(/\x1b\[[\d;]*m/g, "");
}

/**
 * Parses ANSI SGR escape codes in text and returns styled segments.
 * Each segment carries the display text and the Tailwind classes to apply.
 */
export function parseAnsiSegments(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is required for ANSI sequence matching
  const re = /\x1b\[([\d;]*)m/g;

  let colorClass: string | null = null;
  let bold = false;
  let lastIndex = 0;

  const pushSegment = (segText: string) => {
    const classes: string[] = [];
    if (colorClass) classes.push(colorClass);
    if (bold) classes.push("font-bold");
    segments.push({ text: segText, classes });
  };

  for (const match of text.matchAll(re)) {
    if (match.index > lastIndex) {
      pushSegment(text.slice(lastIndex, match.index));
    }

    const nums = match[1] === "" ? [0] : match[1].split(";").map(Number);
    for (const n of nums) {
      if (n === 0) {
        colorClass = null;
        bold = false;
      } else if (n === 1) {
        bold = true;
      } else {
        const mapped = COLOR_MAP[n];
        if (mapped) colorClass = mapped;
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    pushSegment(text.slice(lastIndex));
  }

  return segments;
}

// ============================================================================
// Component
// ============================================================================

interface AnsiTextProps {
  text: string;
}

/** Renders ANSI-colored terminal output as styled spans using Forge tokens. */
export function AnsiText({ text }: AnsiTextProps) {
  const segments = parseAnsiSegments(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.classes.length > 0 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments have no stable identity
          <span key={i} className={seg.classes.join(" ")}>
            {seg.text}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments have no stable identity
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
