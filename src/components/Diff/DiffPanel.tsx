/**
 * DiffPanel - Full-screen diff viewer.
 *
 * Layout:
 * - Left: File list
 * - Right: Unified diff view
 *
 * Fetches diff data with 2-second polling.
 * Injects syntax CSS into a <style> tag.
 */

import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { type HighlightedFileDiff, useDiff } from "../../hooks/useDiff";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { EmptyState, FlexContainer, LoadingState, Panel } from "../ui";
import { DiffContent } from "./DiffContent";
import { DiffFileList } from "./DiffFileList";

interface DiffPanelProps {
  taskId: string;
  onClose: () => void;
}

export function DiffPanel({ taskId, onClose }: DiffPanelProps) {
  const { diff, loading, error } = useDiff(taskId);
  const { css } = useSyntaxCss();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Derive selected file from path (survives diff refresh)
  const selectedFile = diff?.files.find((f) => f.path === selectedPath) ?? null;

  // Auto-select first file when diff loads, but preserve manual selection across polls.
  // Unlike CommitDiffPanel (which switches commits), we poll the same diff and should
  // NOT reset selection when diff refreshes with same content.
  useEffect(() => {
    if (diff && diff.files.length > 0 && !selectedPath) {
      setSelectedPath(diff.files[0].path);
    }
  }, [diff, selectedPath]);

  const handleSelectFile = (file: HighlightedFileDiff) => {
    setSelectedPath(file.path);
  };

  if (loading && !diff) {
    return (
      <Panel className="flex flex-col">
        <Panel.Header>
          <Panel.Title>Changes</Panel.Title>
          <Panel.CloseButton onClick={onClose} />
        </Panel.Header>
        <Panel.Body className="flex-1 flex items-center justify-center">
          <LoadingState message="Loading..." className="py-0" />
        </Panel.Body>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel className="flex flex-col">
        <Panel.Header>
          <Panel.Title>Changes</Panel.Title>
          <Panel.CloseButton onClick={onClose} />
        </Panel.Header>
        <Panel.Body className="flex-1 flex items-center justify-center text-error-600 dark:text-error-400">
          Error: {error}
        </Panel.Body>
      </Panel>
    );
  }

  if (!diff || diff.files.length === 0) {
    return (
      <Panel className="flex flex-col">
        <Panel.Header>
          <Panel.Title>Changes</Panel.Title>
          <Panel.CloseButton onClick={onClose} />
        </Panel.Header>
        <Panel.Body className="flex-1 flex items-center justify-center">
          <EmptyState icon={FileText} message="No changes to display" />
        </Panel.Body>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-col">
      <Panel.Header>
        <Panel.Title>Changes</Panel.Title>
        <Panel.CloseButton onClick={onClose} />
      </Panel.Header>
      <Panel.Body className="flex-1 flex pt-0">
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
        <FlexContainer>
          <DiffFileList
            files={diff.files}
            selectedFile={selectedFile}
            onSelectFile={handleSelectFile}
          />
          <Panel className="flex-1">
            <DiffContent file={selectedFile} />
          </Panel>
        </FlexContainer>
      </Panel.Body>
    </Panel>
  );
}
