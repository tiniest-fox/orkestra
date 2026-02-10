import type { LogEntry, WorkflowQuestion } from "../types/workflow";

/**
 * Regex to extract orkestra-questions fenced code blocks.
 * Matches:
 *   ```orkestra-questions
 *   [json content]
 *   ```
 */
const QUESTION_BLOCK_REGEX = /```orkestra-questions\s*\n([\s\S]*?)\n\s*```/g;

/**
 * Removes orkestra-questions fenced code blocks from text content.
 *
 * Question blocks are parsed by parseAssistantQuestions() and rendered as
 * interactive widgets, so the raw JSON is redundant in the chat display.
 *
 * @param content - Text content that may contain question blocks
 * @returns Content with question blocks removed and trimmed
 */
export function stripQuestionBlocks(content: string): string {
  return content.replace(QUESTION_BLOCK_REGEX, "").trim();
}

/**
 * Parses assistant questions from log entries.
 *
 * Scans text entries after the last user_message for orkestra-questions fenced
 * code blocks. If multiple blocks exist in the latest turn, uses the last one.
 * Validates each question has a non-empty question field.
 *
 * @param logs - Array of log entries from a session
 * @returns Parsed questions, or empty array if none found/malformed
 */
export function parseAssistantQuestions(logs: LogEntry[]): WorkflowQuestion[] {
  if (logs.length === 0) {
    return [];
  }

  // Find the index of the last user_message
  let lastUserMessageIndex = -1;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].type === "user_message") {
      lastUserMessageIndex = i;
      break;
    }
  }

  // Scan only text entries after the last user_message
  const startIndex = lastUserMessageIndex + 1;
  const textEntries = logs.slice(startIndex).filter((entry) => entry.type === "text");

  if (textEntries.length === 0) {
    return [];
  }

  // Find all orkestra-questions blocks in the latest turn
  let lastQuestionBlock: string | null = null;

  for (const entry of textEntries) {
    const matches = Array.from(entry.content.matchAll(QUESTION_BLOCK_REGEX));
    if (matches.length > 0) {
      // Use the last match in this entry
      lastQuestionBlock = matches[matches.length - 1][1];
    }
  }

  if (!lastQuestionBlock) {
    return [];
  }

  // Parse and validate the JSON
  try {
    const parsed = JSON.parse(lastQuestionBlock);

    if (!Array.isArray(parsed)) {
      return [];
    }

    // Filter and validate each question
    const validQuestions: WorkflowQuestion[] = [];
    for (const q of parsed) {
      if (typeof q !== "object" || q === null) {
        console.warn("Assistant question entry is not an object:", q);
        continue;
      }
      if (typeof q.question !== "string" || q.question.trim() === "") {
        console.warn("Assistant question entry missing valid 'question' field:", q);
        continue;
      }
      validQuestions.push(q);
    }
    return validQuestions;
  } catch (err) {
    // Malformed JSON - gracefully degrade
    console.warn("Failed to parse assistant questions block as JSON:", err);
    return [];
  }
}
