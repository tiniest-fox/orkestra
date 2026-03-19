//! FileSection — one file's header + hunks, used by DiffContent virtualizer.

import { Fragment } from "react";
import type { HighlightedFileDiff, HighlightedLine } from "../../hooks/useDiff";
import type { PrComment } from "../../types/workflow";
import { CollapsedSection } from "./CollapsedSection";
import { DiffLine } from "./DiffLine";
import { DraftCommentBubble } from "./DraftCommentBubble";
import { FileHeaderContent } from "./FileHeaderContent";
import { HunkGap } from "./HunkGap";
import type { SearchRange } from "./highlightSearchInHtml";
import { LineCommentInput } from "./LineCommentInput";
import type { DraftComment } from "./types";
import { FILE_HEADER_BUTTON_BASE } from "./types";
import type { DiffMatch } from "./useDiffSearch";

const COLLAPSE_THRESHOLD = 8;

interface FileSectionProps {
  file: HighlightedFileDiff;
  commentsByLine: Map<number, PrComment[]>;
  draftsByLine: Map<string, DraftComment[]>;
  isActive: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  activeCommentLine: {
    filePath: string;
    lineNumber: number;
    lineType: "add" | "delete" | "context";
  } | null;
  onLineClick?: (lineNumber: number, lineType: "add" | "delete" | "context") => void;
  onSaveDraft?: (lineNumber: number, lineType: "add" | "delete" | "context", body: string) => void;
  onCancelDraft?: () => void;
  onDeleteDraft?: (id: string) => void;
  draftBody?: string;
  onDraftBodyChange?: (body: string) => void;
  fileMatches: DiffMatch[];
  currentMatch: DiffMatch | null;
  onExpandContext?: (
    hunkIndex: number,
    position: "above" | "between" | "below",
    amount: number,
  ) => void;
  contextLines?: number;
}

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
  fileMatches,
  currentMatch,
  onExpandContext,
  contextLines = 3,
}: FileSectionProps) {
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
      {/* File path header — clickable to collapse/expand. */}
      <button type="button" onClick={onToggleCollapsed} className={FILE_HEADER_BUTTON_BASE}>
        <FileHeaderContent
          path={file.path}
          oldPath={file.old_path}
          isCollapsed={isCollapsed}
          showKbd={isActive}
        />
      </button>

      {!isCollapsed &&
        (() => {
          const hunks = file.hunks;
          const isDeleted = file.change_type === "deleted";
          return hunks.map((hunk, hunkIndex) => {
            const aboveGap = hunkIndex === 0 && !isDeleted ? hunk.new_start - 1 : null;
            const betweenGap =
              hunkIndex < hunks.length - 1
                ? hunks[hunkIndex + 1].new_start - (hunk.new_start + hunk.new_count)
                : null;
            const isLast = hunkIndex === hunks.length - 1;

            return (
              <div
                key={`${hunk.old_start}-${hunk.new_start}`}
                className="border-b border-border last:border-b-0"
              >
                {hunkIndex === 0 &&
                  !isDeleted &&
                  onExpandContext &&
                  aboveGap !== null &&
                  aboveGap > 0 && (
                    <HunkGap
                      gapSize={aboveGap}
                      position="above"
                      onExpand={(amount) => onExpandContext(0, "above", amount)}
                    />
                  )}
                <div className="bg-canvas px-4 py-1 font-mono text-forge-mono-label text-text-quaternary">
                  @@ -{hunk.old_start},{hunk.old_count} +{hunk.new_start},{hunk.new_count} @@
                </div>
                <HunkLines
                  lines={hunk.lines}
                  hunkIndex={hunkIndex}
                  commentsByLine={commentsByLine}
                  draftsByLine={draftsByLine}
                  activeCommentLine={activeCommentLine}
                  onLineClick={onLineClick}
                  onSaveDraft={onSaveDraft}
                  onCancelDraft={onCancelDraft}
                  onDeleteDraft={onDeleteDraft}
                  draftBody={draftBody}
                  onDraftBodyChange={onDraftBodyChange}
                  fileMatches={fileMatches}
                  currentMatch={currentMatch}
                  contextLines={contextLines}
                />
                {betweenGap !== null && onExpandContext && (
                  <HunkGap
                    gapSize={betweenGap}
                    position="between"
                    onExpand={(amount) => onExpandContext(hunkIndex, "between", amount)}
                  />
                )}
                {isLast &&
                  !isDeleted &&
                  onExpandContext &&
                  (() => {
                    const lastShownLine =
                      [...hunk.lines].reverse().find((l) => l.new_line_number !== null)
                        ?.new_line_number ?? null;
                    const totalLines = file.total_new_lines ?? null;
                    const hasMoreBelow =
                      totalLines !== null && lastShownLine !== null
                        ? lastShownLine < totalLines
                        : false;
                    return hasMoreBelow ? (
                      <HunkGap
                        gapSize={null}
                        position="below"
                        onExpand={(amount) => onExpandContext(hunkIndex, "below", amount)}
                      />
                    ) : null;
                  })()}
              </div>
            );
          });
        })()}
    </>
  );
}

// -- Helpers --

type Section = {
  type: "render" | "collapse";
  lines: HighlightedLine[];
  /** Index of the first line within the hunk's lines array. */
  startLineIndex: number;
};

function flushContext(
  sections: Section[],
  context: HighlightedLine[],
  startIndex: number,
  threshold: number,
) {
  if (context.length > threshold) {
    sections.push({ type: "render", lines: context.slice(0, 3), startLineIndex: startIndex });
    sections.push({
      type: "collapse",
      lines: context.slice(3, -3),
      startLineIndex: startIndex + 3,
    });
    sections.push({
      type: "render",
      lines: context.slice(-3),
      startLineIndex: startIndex + context.length - 3,
    });
  } else {
    sections.push({ type: "render", lines: context, startLineIndex: startIndex });
  }
}

interface HunkLinesProps {
  lines: HighlightedLine[];
  hunkIndex: number;
  commentsByLine: Map<number, PrComment[]>;
  draftsByLine: Map<string, DraftComment[]>;
  activeCommentLine: {
    filePath: string;
    lineNumber: number;
    lineType: "add" | "delete" | "context";
  } | null;
  onLineClick?: (lineNumber: number, lineType: "add" | "delete" | "context") => void;
  onSaveDraft?: (lineNumber: number, lineType: "add" | "delete" | "context", body: string) => void;
  onCancelDraft?: () => void;
  onDeleteDraft?: (id: string) => void;
  draftBody?: string;
  onDraftBodyChange?: (body: string) => void;
  fileMatches: DiffMatch[];
  currentMatch: DiffMatch | null;
  contextLines?: number;
}

function HunkLines({
  lines,
  hunkIndex,
  commentsByLine,
  draftsByLine,
  activeCommentLine,
  onLineClick,
  onSaveDraft,
  onCancelDraft,
  onDeleteDraft,
  draftBody,
  onDraftBodyChange,
  fileMatches,
  currentMatch,
  contextLines = 3,
}: HunkLinesProps) {
  const collapseThreshold = Math.max(COLLAPSE_THRESHOLD, contextLines * 2 + 2);
  const sections: Section[] = [];
  let currentContext: HighlightedLine[] = [];
  let contextStartIndex = 0;
  let lineIndex = 0;

  for (const line of lines) {
    if (line.line_type === "context") {
      if (currentContext.length === 0) contextStartIndex = lineIndex;
      currentContext.push(line);
    } else {
      if (currentContext.length > 0) {
        flushContext(sections, currentContext, contextStartIndex, collapseThreshold);
        currentContext = [];
      }
      sections.push({ type: "render", lines: [line], startLineIndex: lineIndex });
    }
    lineIndex++;
  }

  if (currentContext.length > 0) {
    flushContext(sections, currentContext, contextStartIndex, collapseThreshold);
  }

  return sections.map((section, i) => {
    if (section.type === "collapse") {
      const forceExpanded = fileMatches.some(
        (m) =>
          m.hunkIndex === hunkIndex &&
          m.lineIndex >= section.startLineIndex &&
          m.lineIndex < section.startLineIndex + section.lines.length,
      );
      return (
        <CollapsedSection
          key={section.startLineIndex}
          lines={section.lines}
          forceExpanded={forceExpanded}
          hunkIndex={hunkIndex}
          startLineIndex={section.startLineIndex}
          fileMatches={fileMatches}
          currentMatch={currentMatch}
        />
      );
    }
    return section.lines.map((line, j) => {
      // Resolve to new_line_number, falling back to old_line_number for deleted lines
      const lineNumber = line.new_line_number ?? line.old_line_number;
      const lineComments = lineNumber !== null ? commentsByLine.get(lineNumber) : undefined;
      const draftKey = lineNumber !== null ? `${line.line_type}:${lineNumber}` : null;
      const lineDrafts = draftKey !== null ? draftsByLine.get(draftKey) : undefined;
      const isActiveInput =
        lineNumber !== null &&
        activeCommentLine?.lineNumber === lineNumber &&
        activeCommentLine?.lineType === line.line_type;
      const absLineIndex = section.startLineIndex + j;

      const lineMatches = fileMatches.filter(
        (m) => m.hunkIndex === hunkIndex && m.lineIndex === absLineIndex,
      );
      const searchRanges: SearchRange[] = lineMatches.map((m) => ({
        charStart: m.charStart,
        charEnd: m.charEnd,
        isCurrent:
          currentMatch !== null &&
          m.hunkIndex === currentMatch.hunkIndex &&
          m.lineIndex === currentMatch.lineIndex &&
          m.charStart === currentMatch.charStart &&
          m.charEnd === currentMatch.charEnd,
      }));
      const isCurrentMatchLine = searchRanges.some((r) => r.isCurrent);

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
            searchRanges={searchRanges.length > 0 ? searchRanges : undefined}
            isCurrentMatchLine={isCurrentMatchLine}
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
    });
  });
}
