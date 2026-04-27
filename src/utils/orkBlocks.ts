// Generic parser for ork fenced code blocks; also handles legacy orkestra-questions blocks.
import type { LogEntry, WorkflowQuestion } from "../types/workflow";

// Matches both ```ork and ```orkestra-questions blocks
const ORK_BLOCK_REGEX = /```(?:ork|orkestra-questions)\s*\n([\s\S]*?)\n\s*```/g;

export type OrkBlock =
  | { type: "questions"; questions: WorkflowQuestion[] }
  | { type: "proposal"; flow?: string; stage?: string; title?: string; content?: string };

/**
 * Removes ork and orkestra-questions fenced code blocks from text content.
 */
export function stripOrkBlocks(content: string): string {
  return content.replace(ORK_BLOCK_REGEX, "").trim();
}

/**
 * Parses ork blocks from log entries in the latest agent turn.
 * Returns all valid typed payloads found. Only scans text entries after the last user_message.
 */
export function parseOrkBlocks(logs: LogEntry[]): OrkBlock[] {
  if (logs.length === 0) return [];

  let lastUserMessageIndex = -1;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].type === "user_message") {
      lastUserMessageIndex = i;
      break;
    }
  }

  const textEntries = logs.slice(lastUserMessageIndex + 1).filter((entry) => entry.type === "text");
  if (textEntries.length === 0) return [];

  const blocks: OrkBlock[] = [];
  for (const entry of textEntries) {
    const matches = Array.from(entry.content.matchAll(ORK_BLOCK_REGEX));
    for (const match of matches) {
      const parsed = parseOrkBlockJson(match[1]);
      if (parsed) blocks.push(parsed);
    }
  }

  return blocks;
}

function parseOrkBlockJson(json: string): OrkBlock | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;

    // Backward compat: raw array -> questions type
    if (Array.isArray(parsed)) {
      return normalizeQuestionsArray(parsed);
    }

    if (parsed.type === "questions" && Array.isArray(parsed.questions)) {
      const questions = validateQuestions(parsed.questions);
      return questions.length > 0 ? { type: "questions", questions } : null;
    }

    if (parsed.type === "proposal") {
      return {
        type: "proposal",
        flow: typeof parsed.flow === "string" ? parsed.flow : undefined,
        stage: typeof parsed.stage === "string" ? parsed.stage : undefined,
        title: typeof parsed.title === "string" ? parsed.title : undefined,
        content: typeof parsed.content === "string" ? parsed.content : undefined,
      };
    }

    return null;
  } catch {
    console.warn("Failed to parse ork block JSON");
    return null;
  }
}

function normalizeQuestionsArray(arr: unknown[]): OrkBlock | null {
  const questions = validateQuestions(arr);
  return questions.length > 0 ? { type: "questions", questions } : null;
}

function validateQuestions(arr: unknown[]): WorkflowQuestion[] {
  const valid: WorkflowQuestion[] = [];
  for (const q of arr) {
    if (typeof q !== "object" || q === null) continue;
    // biome-ignore lint/suspicious/noExplicitAny: runtime validation of unknown shape
    if (typeof (q as any).question !== "string" || (q as any).question.trim() === "") continue;
    valid.push(q as WorkflowQuestion);
  }
  return valid;
}
