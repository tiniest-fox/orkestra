//! Content-cleaning utilities for feed log entry display.

/**
 * Strips `<parameter name="content">...</parameter>` XML blocks from text.
 *
 * These blocks appear in raw tool-use output and are redundant in the chat
 * display since the rendered content already shows the parameter value.
 *
 * @param content - Raw text that may contain parameter XML blocks
 * @returns Text with parameter blocks removed and trimmed
 */
export function stripParameterBlocks(content: string): string {
  return content.replace(/<parameter name="content">[\s\S]*?<\/antml:parameter>/g, "").trim();
}
