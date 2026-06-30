// Parses ORKESTRA_PORT sentinel lines from run script output.

import { stripAnsi } from "./ansi";

// ============================================================================
// Constants
// ============================================================================

const PORT_PATTERN = /^ORKESTRA_PORT\s+(\S+)=(\d+)$/;

// ============================================================================
// Pure functions
// ============================================================================

/**
 * Parses an `ORKESTRA_PORT <Label>=<port>` sentinel line.
 * Returns null for non-matching or invalid lines (port out of 1–65535 range).
 * ANSI escape codes are stripped before matching.
 */
export function parsePortDeclaration(line: string): { label: string; port: number } | null {
  const clean = stripAnsi(line).trim();
  const match = PORT_PATTERN.exec(clean);
  if (!match) return null;
  const label = match[1];
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return null;
  return { label, port };
}
