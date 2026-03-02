//! Shared types and constants for diff-related components.

/** Base Tailwind classes for the file-header toggle button. */
export const FILE_HEADER_BUTTON_BASE =
  "w-full text-left bg-surface-2 border-b border-border px-4 py-2 font-sans text-forge-body font-medium text-text-primary flex items-center gap-2 hover:bg-surface-3 transition-colors";

export interface DraftComment {
  id: string;
  filePath: string;
  lineNumber: number;
  lineType: "add" | "delete" | "context";
  body: string;
}
