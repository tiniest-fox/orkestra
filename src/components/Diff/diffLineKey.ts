// Constructs a stable key for identifying a specific line within a diff.
export function diffLineKey(hunkIndex: number, lineIndex: number): string {
  return `${hunkIndex}-${lineIndex}`;
}
