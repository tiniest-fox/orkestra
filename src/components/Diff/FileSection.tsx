//! FileSection — one file's header + hunks, used by DiffContent virtualizer.

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment } from "react";
import type { HighlightedFileDiff, HighlightedLine } from "../../hooks/useDiff";
import type { PrComment } from "../../types/workflow";
import { Kbd } from "../ui/Kbd";
import { CollapsedSection } from "./CollapsedSection";
import { DiffLine } from "./DiffLine";
import { DraftCommentBubble } from "./DraftCommentBubble";
import { LineCommentInput } from "./LineCommentInput";
import type { DraftComment } from "./types";

const COLLAPSE_THRESHOLD = 8;

export function FileSection({
  file,
  commentsByLine,
  draftsByLine,
  isActive,
  isCollapsed,
  onToggleCollapsed,
  activeCommentLine,
  onLineClick,
  onSaveDraft,
  onCancelDraft,
  onDeleteDraft,
  draftBody,
  onDraftBodyChange,
}: {
  file: HighlightedFileDiff;
  commentsByLine: Map<number, PrComment[]>;
  draftsByLine: Map<number, DraftComment[]>;
  isActive: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  activeCommentLine: { filePath: string; lineNumber: number } | null;
  onLineClick?: (lineNumber: number, lineType: "add" | "delete" | "context") => void;
  onSaveDraft?: (lineNumber: number, lineType: "add" | "delete" | "context", body: string) => void;
  onCancelDraft?: () => void;
  onDeleteDraft?: (id: string) => void;
  draftBody?: string;
  onDraftBodyChange?: (body: string) => void;
}) {
  if (file.is_binary) {
    return (
      <div className="p-4">
        <div className="font-sans text-forge-body font-medium text-text-primary mb-1">
          {file.path}
        </div>
        <div className="font-sans text-forge-body text-text-tertiary">Binary file</div>
      </div>
    );
  }

  return (
    <>
      {/* File path header — clickable to collapse/expand. sticky top-0 keeps it pinned. */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="sticky top-0 z-10 w-full text-left bg-surface-2 border-b border-border px-4 py-2 font-sans text-forge-body font-medium text-text-primary flex items-center gap-2 hover:bg-surface-3 transition-colors"
      >
        <span className="flex-1 truncate">
          {file.path}
          {file.old_path && (
            <span className="text-text-quaternary ml-2">(renamed from {file.old_path})</span>
          )}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {isActive && <Kbd>C</Kbd>}
          {isCollapsed ? (
            <ChevronRight size={13} className="text-text-quaternary" />
          ) : (
            <ChevronDown size={13} className="text-text-quaternary" />
          )}
        </span>
      </button>

      {!isCollapsed &&
        file.hunks.map((hunk) => (
          <div
            key={`${hunk.old_start}-${hunk.new_start}`}
            className="border-b border-border last:border-b-0"
          >
            <div className="bg-canvas px-4 py-1 font-mono text-forge-mono-label text-text-quaternary">
              @@ -{hunk.old_start},{hunk.old_count} +{hunk.new_start},{hunk.new_count} @@
            </div>
            {renderHunkLines(
              hunk.lines,
              commentsByLine,
              draftsByLine,
              activeCommentLine,
              onLineClick,
              onSaveDraft,
              onCancelDraft,
              onDeleteDraft,
              draftBody,
              onDraftBodyChange,
            )}
          </div>
        ))}
    </>
  );
}

// -- Helpers --

function flushContext(
  sections: { type: "render" | "collapse"; lines: HighlightedLine[] }[],
  context: HighlightedLine[],
) {
  if (context.length > COLLAPSE_THRESHOLD) {
    sections.push({ type: "render", lines: context.slice(0, 3) });
    sections.push({ type: "collapse", lines: context.slice(3, -3) });
    sections.push({ type: "render", lines: context.slice(-3) });
  } else {
    sections.push({ type: "render", lines: context });
  }
}

function renderHunkLines(
  lines: HighlightedLine[],
  commentsByLine: Map<number, PrComment[]>,
  draftsByLine: Map<number, DraftComment[]>,
  activeCommentLine: { filePath: string; lineNumber: number } | null,
  onLineClick?: (lineNumber: number, lineType: "add" | "delete" | "context") => void,
  onSaveDraft?: (lineNumber: number, lineType: "add" | "delete" | "context", body: string) => void,
  onCancelDraft?: () => void,
  onDeleteDraft?: (id: string) => void,
  draftBody?: string,
  onDraftBodyChange?: (body: string) => void,
) {
  const sections: { type: "render" | "collapse"; lines: HighlightedLine[] }[] = [];
  let currentContext: HighlightedLine[] = [];

  for (const line of lines) {
    if (line.line_type === "context") {
      currentContext.push(line);
    } else {
      if (currentContext.length > 0) {
        flushContext(sections, currentContext);
        currentContext = [];
      }
      sections.push({ type: "render", lines: [line] });
    }
  }

  if (currentContext.length > 0) {
    flushContext(sections, currentContext);
  }

  return sections.map((section, i) =>
    section.type === "collapse" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: section order is stable within hunk
      <CollapsedSection key={i} lines={section.lines} />
    ) : (
      section.lines.map((line, j) => {
        // Resolve to new_line_number, falling back to old_line_number for deleted lines
        const lineNumber = line.new_line_number ?? line.old_line_number;
        const lineComments = lineNumber !== null ? commentsByLine.get(lineNumber) : undefined;
        const lineDrafts = lineNumber !== null ? draftsByLine.get(lineNumber) : undefined;
        const isActiveInput = lineNumber !== null && activeCommentLine?.lineNumber === lineNumber;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: line order is stable within section
          <Fragment key={`${i}-${j}`}>
            <DiffLine
              line={line}
              onOpenCommentInput={
                onLineClick && lineNumber !== null
                  ? () => onLineClick(lineNumber, line.line_type)
                  : undefined
              }
            />
            {lineComments && lineComments.length > 0 && (
              <div className="px-4 py-2 font-sans text-forge-body bg-surface-2 border-b border-border">
                {lineComments.map((c) => (
                  <div key={c.id} className="text-text-tertiary">
                    {c.author}: {c.body}
                  </div>
                ))}
              </div>
            )}
            {isActiveInput && onSaveDraft && onCancelDraft && lineNumber !== null && (
              <LineCommentInput
                onSave={(body) => onSaveDraft(lineNumber, line.line_type, body)}
                onCancel={onCancelDraft}
                value={draftBody}
                onChange={onDraftBodyChange}
              />
            )}
            {lineDrafts &&
              lineDrafts.length > 0 &&
              onDeleteDraft &&
              lineDrafts.map((draft) => (
                <DraftCommentBubble key={draft.id} comment={draft} onDelete={onDeleteDraft} />
              ))}
          </Fragment>
        );
      })
    ),
  );
}
