/**
 * Extract a human-readable message from an unknown error.
 *
 * Handles Tauri's serialized error objects ({ code, message }),
 * standard Error instances, and plain strings.
 */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as Record<string, unknown>).message);
  }
  if (typeof err === "object" && err !== null) {
    return JSON.stringify(err);
  }
  return String(err);
}
