/**
 * Shared prose styling for markdown rendering.
 */

/**
 * Prose classes for light backgrounds with dark mode support.
 * Used in contexts like ArtifactView where both light and dark modes are needed.
 */
export const PROSE_CLASSES_LIGHT = [
  // Base prose
  "prose prose-sm max-w-none",
  // Colors
  "prose-headings:text-stone-800",
  "dark:prose-headings:text-stone-200",
  "prose-p:text-stone-700",
  "dark:prose-p:text-stone-200",
  "prose-strong:text-stone-800",
  "dark:prose-strong:text-stone-200",
  "prose-li:text-stone-700",
  "dark:prose-li:text-stone-200",
  "prose-a:text-orange-600",
  "dark:prose-a:text-orange-400",
  "prose-blockquote:text-stone-600 prose-blockquote:border-stone-300",
  "dark:prose-blockquote:text-stone-300 dark:prose-blockquote:border-stone-600",
  "prose-code:bg-stone-100 prose-code:px-1 prose-code:rounded prose-code:text-stone-800",
  "dark:prose-code:bg-stone-800 dark:prose-code:text-stone-200",
  "prose-pre:bg-stone-100 prose-pre:text-stone-800",
  "dark:prose-pre:bg-stone-800 dark:prose-pre:text-stone-200",
  "prose-th:text-stone-800 prose-td:text-stone-700",
  "dark:prose-th:text-stone-200 dark:prose-td:text-stone-300",
  // Compact heading sizes: h1 ~16px (1.143em of 14px base), h2 ~15px, h3 ~14.5px, h4-h6 at base
  "prose-h1:text-[1.143em] prose-h1:font-semibold",
  "prose-h2:text-[1.071em] prose-h2:font-semibold",
  "prose-h3:text-[1.035em] prose-h3:font-semibold",
  "prose-h4:text-sm prose-h4:font-semibold",
  "prose-h5:text-sm prose-h5:font-medium",
  "prose-h6:text-sm prose-h6:font-medium",
  // Compact vertical spacing
  "prose-headings:mt-3 prose-headings:mb-1",
  "prose-p:my-1",
  "prose-ul:my-1 prose-ol:my-1",
  "prose-ul:pl-[1.1em] prose-ol:pl-[1.1em]",
  "prose-li:my-0",
  "prose-pre:my-1.5",
  "prose-blockquote:my-1.5",
  "prose-hr:my-2",
  // Table overflow
  "artifact-prose",
].join(" ");

/**
 * Prose classes for dark backgrounds (no light mode variant).
 * Used in contexts like TextLogEntry where the background is always dark.
 */
export const PROSE_CLASSES_DARK = [
  // Base prose
  "prose prose-sm max-w-none",
  // Colors (dark theme only)
  "prose-headings:text-stone-200",
  "prose-p:text-stone-200",
  "prose-strong:text-stone-200",
  "prose-li:text-stone-200",
  "prose-a:text-orange-400",
  "prose-blockquote:text-stone-300 prose-blockquote:border-stone-600",
  "prose-code:bg-stone-800 prose-code:px-1 prose-code:rounded prose-code:text-stone-200",
  "prose-pre:bg-stone-800 prose-pre:text-stone-200",
  "prose-th:text-stone-200 prose-td:text-stone-300",
  // Compact heading sizes
  "prose-h1:text-[1.143em] prose-h1:font-semibold",
  "prose-h2:text-[1.071em] prose-h2:font-semibold",
  "prose-h3:text-[1.035em] prose-h3:font-semibold",
  "prose-h4:text-sm prose-h4:font-semibold",
  "prose-h5:text-sm prose-h5:font-medium",
  "prose-h6:text-sm prose-h6:font-medium",
  // Compact vertical spacing
  "prose-headings:mt-3 prose-headings:mb-1",
  "prose-p:my-1",
  "prose-ul:my-1 prose-ol:my-1",
  "prose-ul:pl-[1.1em] prose-ol:pl-[1.1em]",
  "prose-li:my-0",
  "prose-pre:my-1.5",
  "prose-blockquote:my-1.5",
  "prose-hr:my-2",
].join(" ");
