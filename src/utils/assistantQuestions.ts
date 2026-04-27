// Thin wrapper over parseOrkBlocks — preserves the parseAssistantQuestions/stripQuestionBlocks API.
import type { LogEntry, WorkflowQuestion } from "../types/workflow";
import { parseOrkBlocks, stripOrkBlocks } from "./orkBlocks";

export { stripOrkBlocks as stripQuestionBlocks };

export function parseAssistantQuestions(logs: LogEntry[]): WorkflowQuestion[] {
  const blocks = parseOrkBlocks(logs);
  const lastQuestions = [...blocks].reverse().find((b) => b.type === "questions");
  return lastQuestions?.type === "questions" ? lastQuestions.questions : [];
}
