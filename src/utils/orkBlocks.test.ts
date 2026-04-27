import { describe, expect, it } from "vitest";
import type { LogEntry } from "../types/workflow";
import { parseOrkBlocks, stripOrkBlocks } from "./orkBlocks";

describe("parseOrkBlocks", () => {
  it("parses ork block with type: questions", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`ork
{"type":"questions","questions":[{"question":"What color?","options":[{"label":"Red"},{"label":"Blue"}]}]}
\`\`\``,
      },
    ];
    const blocks = parseOrkBlocks(logs);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("questions");
    if (blocks[0].type === "questions") {
      expect(blocks[0].questions).toHaveLength(1);
      expect(blocks[0].questions[0].question).toBe("What color?");
    }
  });

  it("parses ork block with type: proposal — all fields", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`ork
{"type":"proposal","flow":"default","stage":"planning","title":"My Trak","content":"Some content"}
\`\`\``,
      },
    ];
    const blocks = parseOrkBlocks(logs);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "proposal",
      flow: "default",
      stage: "planning",
      title: "My Trak",
      content: "Some content",
    });
  });

  it("parses ork block with type: proposal — missing optional fields", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`ork
{"type":"proposal"}
\`\`\``,
      },
    ];
    const blocks = parseOrkBlocks(logs);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "proposal",
      flow: undefined,
      stage: undefined,
      title: undefined,
      content: undefined,
    });
  });

  it("backward compat: orkestra-questions block with raw array -> normalized to questions", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`orkestra-questions
[{"question":"Old format question"}]
\`\`\``,
      },
    ];
    const blocks = parseOrkBlocks(logs);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("questions");
    if (blocks[0].type === "questions") {
      expect(blocks[0].questions[0].question).toBe("Old format question");
    }
  });

  it("backward compat: orkestra-questions block in text entry is parsed correctly", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `Here are some questions:

\`\`\`orkestra-questions
[{"question":"Legacy question","options":[{"label":"Yes"},{"label":"No"}]}]
\`\`\``,
      },
    ];
    const blocks = parseOrkBlocks(logs);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("questions");
    if (blocks[0].type === "questions") {
      expect(blocks[0].questions[0].options).toHaveLength(2);
    }
  });

  it("mixed blocks: both questions and proposal in same turn -> returns both", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`ork
{"type":"questions","questions":[{"question":"Q1"}]}
\`\`\`

\`\`\`ork
{"type":"proposal","title":"My Trak"}
\`\`\``,
      },
    ];
    const blocks = parseOrkBlocks(logs);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("questions");
    expect(blocks[1].type).toBe("proposal");
  });

  it("malformed JSON -> returns empty array", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`ork
{ this is not valid json }
\`\`\``,
      },
    ];
    const blocks = parseOrkBlocks(logs);
    expect(blocks).toEqual([]);
  });

  it("invalid question entries are filtered out (missing/empty question field)", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`ork
{"type":"questions","questions":[{"question":"Valid"},{"question":""},{"context":"no question"}]}
\`\`\``,
      },
    ];
    const blocks = parseOrkBlocks(logs);
    expect(blocks).toHaveLength(1);
    if (blocks[0].type === "questions") {
      expect(blocks[0].questions).toHaveLength(1);
      expect(blocks[0].questions[0].question).toBe("Valid");
    }
  });

  it("only scans after last user_message", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`ork
{"type":"proposal","title":"Old proposal"}
\`\`\``,
      },
      { type: "user_message", content: "User replied" },
      {
        type: "text",
        content: `\`\`\`ork
{"type":"proposal","title":"New proposal"}
\`\`\``,
      },
    ];
    const blocks = parseOrkBlocks(logs);
    expect(blocks).toHaveLength(1);
    if (blocks[0].type === "proposal") {
      expect(blocks[0].title).toBe("New proposal");
    }
  });

  it("unknown type is filtered out", () => {
    const logs: LogEntry[] = [
      {
        type: "text",
        content: `\`\`\`ork
{"type":"unknown_type","data":"something"}
\`\`\``,
      },
    ];
    const blocks = parseOrkBlocks(logs);
    expect(blocks).toEqual([]);
  });

  it("returns empty array for empty logs", () => {
    expect(parseOrkBlocks([])).toEqual([]);
  });
});

describe("stripOrkBlocks", () => {
  it("removes ork blocks", () => {
    const content = `Some text.\n\n\`\`\`ork\n{"type":"proposal"}\n\`\`\`\n\nMore text.`;
    const result = stripOrkBlocks(content);
    expect(result).not.toContain("```ork");
    expect(result).toContain("Some text.");
    expect(result).toContain("More text.");
  });

  it("removes orkestra-questions blocks", () => {
    const content = `Text before.\n\n\`\`\`orkestra-questions\n[{"question":"Q"}]\n\`\`\`\n\nText after.`;
    const result = stripOrkBlocks(content);
    expect(result).not.toContain("orkestra-questions");
    expect(result).toContain("Text before.");
    expect(result).toContain("Text after.");
  });

  it("preserves surrounding text", () => {
    const content = `Intro.\n\n\`\`\`ork\n{"type":"proposal","title":"T"}\n\`\`\`\n\nConclusion.`;
    const result = stripOrkBlocks(content);
    expect(result).toContain("Intro.");
    expect(result).toContain("Conclusion.");
  });

  it("leaves other code blocks (```javascript) untouched", () => {
    const content = '```javascript\nconsole.log(\'hi\');\n```\n\n```ork\n{"type":"proposal"}\n```';
    const result = stripOrkBlocks(content);
    expect(result).toContain("```javascript");
    expect(result).toContain("console.log");
    expect(result).not.toContain("```ork");
  });

  it("returns empty string when content is only an ork block", () => {
    const result = stripOrkBlocks('```ork\n{"type":"proposal"}\n```');
    expect(result).toBe("");
  });

  it("handles empty string input", () => {
    expect(stripOrkBlocks("")).toBe("");
  });
});
