/**
 * DiffPanel - Full-screen diff viewer.
 *
 * Layout:
 * - Left: File list (250px)
 * - Right: Unified diff view
 *
 * Fetches diff data with 2-second polling.
 * Injects syntax CSS into a <style> tag.
 */

import { useEffect, useState } from "react";
import { type HighlightedFileDiff, useDiff } from "../../hooks/useDiff";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { DiffContent } from "./DiffContent";
import { DiffFileList } from "./DiffFileList";

interface DiffPanelProps {
  taskId: string;
}

export function DiffPanel({ taskId }: DiffPanelProps) {
  const { diff, loading, error } = useDiff(taskId);
  const { css } = useSyntaxCss();
  const [selectedFile, setSelectedFile] = useState<HighlightedFileDiff | null>(null);

  // Auto-select first file when diff loads
  useEffect(() => {
    if (diff && diff.files.length > 0 && !selectedFile) {
      setSelectedFile(diff.files[0]);
    }
  }, [diff, selectedFile]);

  if (loading && !diff) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">Loading diff...</div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-500">
        Error loading diff: {error}
      </div>
    );
  }

  if (!diff || diff.files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        No changes to display
      </div>
    );
  }

  return (
    <>
      {/* Inject syntax CSS */}
      {css && (
        <style
          // biome-ignore lint/security/noDangerouslySetInnerHtml: syntect CSS output is trusted
          dangerouslySetInnerHTML={{
            __html: `
              /* Light theme syntax */
              @media (prefers-color-scheme: light) {
                ${css.light}
              }

              /* Dark theme syntax */
              @media (prefers-color-scheme: dark) {
                ${css.dark}
              }
            `,
          }}
        />
      )}

      {/* Two-pane layout */}
      <div className="flex-1 flex overflow-hidden">
        <DiffFileList
          files={diff.files}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
        />
        <DiffContent file={selectedFile} />
      </div>
    </>
  );
}
