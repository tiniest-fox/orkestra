//! Shared types for diff-related components.

export interface DraftComment {
  id: string;
  filePath: string;
  lineNumber: number;
  lineType: "add" | "delete" | "context";
  body: string;
}
