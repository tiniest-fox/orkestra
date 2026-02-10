import { describe, expect, it } from "vitest";
import type { LogEntry } from "../types/workflow";
import { parseAssistantQuestions } from "./assistantQuestions";

describe("parseAssistantQuestions", () => {
  it("should return empty array for empty logs", () => {
    const result = parseAssistantQuestions([]);
    expect(result).toEqual([]);
  });

  it("should return empty array when no text entries contain question blocks", () => {
    const logs: LogEntry[] = [
      { type: "text", content: "Just some regular text" },
      { type: "text", content: "More text without questions" },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toEqual([]);
  });

  it("should extract questions from a valid orkestra-questions block in a text entry", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `Here are some questions:

\`\`\`orkestra-questions
[
  {
    "question": "What color do you prefer?",
    "options": [
      { "label": "Red", "description": "Bold and vibrant" },
      { "label": "Blue", "description": "Calm and serene" }
    ]
  }
]
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      question: "What color do you prefer?",
      options: [
        { label: "Red", description: "Bold and vibrant" },
        { label: "Blue", description: "Calm and serene" },
      ],
    });
  });

  it("should ignore question blocks before the last user_message (multi-turn scenario)", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[
  { "question": "Old question from turn 1" }
]
\`\`\``,
      },
      {
        type: "user_message",
        content: "User answered the question",
      },
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[
  { "question": "New question from turn 2" }
]
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("New question from turn 2");
  });

  it("should use the last question block when multiple exist in the latest turn", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `First attempt:
\`\`\`orkestra-questions
[
  { "question": "First question" }
]
\`\`\`

Actually, let me correct that:
\`\`\`orkestra-questions
[
  { "question": "Corrected question" }
]
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Corrected question");
  });

  it("should return empty array for malformed JSON", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`orkestra-questions
{ this is not valid json }
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toEqual([]);
  });

  it("should return empty array for valid JSON that is not an array", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`orkestra-questions
{ "question": "This is an object, not an array" }
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toEqual([]);
  });

  it("should filter out entries with empty question field", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[
  { "question": "Valid question" },
  { "question": "" },
  { "question": "   " },
  { "context": "Missing question field" }
]
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Valid question");
  });

  it("should filter out entries with missing question field", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[
  { "question": "Valid question" },
  { "context": "No question field here" }
]
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Valid question");
  });

  it("should handle questions with and without options", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[
  {
    "question": "Free-form question?",
    "context": "No options provided"
  },
  {
    "question": "Multiple choice question?",
    "options": [
      { "label": "Option A" },
      { "label": "Option B" }
    ]
  }
]
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toHaveLength(2);
    expect(result[0].question).toBe("Free-form question?");
    expect(result[0].options).toBeUndefined();
    expect(result[1].question).toBe("Multiple choice question?");
    expect(result[1].options).toHaveLength(2);
  });

  it("should handle questions with and without context", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[
  {
    "question": "Question without context"
  },
  {
    "question": "Question with context",
    "context": "This provides additional details"
  }
]
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toHaveLength(2);
    expect(result[0].question).toBe("Question without context");
    expect(result[0].context).toBeUndefined();
    expect(result[1].question).toBe("Question with context");
    expect(result[1].context).toBe("This provides additional details");
  });

  it("should scan all text entries when no user_message exists", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: "Some initial text",
      },
      {
        type: "tool_use",
        tool: "bash",
        id: "tool-1",
        input: { tool: "bash", command: "echo test" },
      },
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[
  { "question": "Question from the second text entry" }
]
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Question from the second text entry");
  });

  it("should handle multiple text entries in the latest turn", () => {
    const logs: LogEntry[] = [
      {
        type: "user_message",
        content: "User prompt",
      },
      {
        type: "text",
        content: "First text entry without questions",
      },
      {
        type: "tool_use",
        tool: "read",
        id: "tool-1",
        input: { tool: "read", file_path: "/some/file" },
      },
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[
  { "question": "Question from second text entry" }
]
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Question from second text entry");
  });

  it("should handle edge case with question block across multiple text entries", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[
  { "question": "First question" }
]
\`\`\``,
      },
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[
  { "question": "Second question - this one wins" }
]
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Second question - this one wins");
  });

  it("should handle non-object items in the array", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[
  { "question": "Valid question" },
  "not an object",
  42,
  null,
  { "question": "Another valid question" }
]
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toHaveLength(2);
    expect(result[0].question).toBe("Valid question");
    expect(result[1].question).toBe("Another valid question");
  });

  it("should preserve all question properties including optional ones", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[
  {
    "question": "What is your preferred approach?",
    "context": "We need to decide on the implementation strategy",
    "options": [
      {
        "label": "Approach A",
        "description": "Fast but risky"
      },
      {
        "label": "Approach B",
        "description": "Slow but safe"
      }
    ]
  }
]
\`\`\``,
      },
    ];

    const result = parseAssistantQuestions(logs);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      question: "What is your preferred approach?",
      context: "We need to decide on the implementation strategy",
      options: [
        { label: "Approach A", description: "Fast but risky" },
        { label: "Approach B", description: "Slow but safe" },
      ],
    });
  });
});
