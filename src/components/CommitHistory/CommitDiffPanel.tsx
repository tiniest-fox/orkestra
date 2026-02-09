import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { useCommitDiff } from "../../hooks/useCommitDiff";
import type { HighlightedFileDiff } from "../../hooks/useDiff";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { DiffContent } from "../Diff/DiffContent";
import { DiffFileList } from "../Diff/DiffFileList";
import { EmptyState, FlexContainer, Panel } from "../ui";

interface CommitDiffPanelProps {
  commitHash: string;
  onClose: () => void;
}

export function CommitDiffPanel({ commitHash, onClose }: CommitDiffPanelProps) {
  const { diff, loading, error } = useCommitDiff(commitHash);
  const { css } = useSyntaxCss();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const selectedFile = diff?.files.find((f) => f.path === selectedPath) ?? null;

  useEffect(() => {
    if (diff && diff.files.length > 0 && !selectedPath) {
      setSelectedPath(diff.files[0].path);
    }
  }, [diff, selectedPath]);

  // Reset selected path when commit changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitHash change should reset selection
  useEffect(() => {
    setSelectedPath(null);
  }, [commitHash]);

  const handleSelectFile = (file: HighlightedFileDiff) => {
    setSelectedPath(file.path);
  };

  if (loading && !diff) {
    return (
      <Panel className="flex flex-col">
        <Panel.Header>
          <Panel.Title>
            <code className="text-xs font-mono">{commitHash}</code>
          </Panel.Title>
          <Panel.CloseButton onClick={onClose} />
        </Panel.Header>
        <Panel.Body className="flex-1 flex pt-0">
          <FlexContainer>
            {/* File list skeleton */}
            <div className="w-48 flex-shrink-0 flex flex-col -mr-2">
              <div className="px-2 py-1 mr-4 h-7 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
              <div className="flex-1 mt-1 space-y-1">
                {Array.from({ length: 5 }, (_, i) => (
                  <div
                    key={i}
                    className="h-7 bg-stone-200 dark:bg-stone-700 rounded animate-pulse"
                  />
                ))}
              </div>
            </div>
            {/* Diff content skeleton */}
            <div className="flex-1 p-4 space-y-2">
              {Array.from({ length: 12 }, (_, i) => (
                <div
                  key={i}
                  className="h-4 bg-stone-200 dark:bg-stone-700 rounded animate-pulse"
                  style={{ width: `${[85, 70, 95, 60, 75, 90, 65, 80, 55, 88, 72, 68][i]}%` }}
                />
              ))}
            </div>
          </FlexContainer>
        </Panel.Body>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel className="flex flex-col">
        <Panel.Header>
          <Panel.Title>
            <code className="text-xs font-mono">{commitHash}</code>
          </Panel.Title>
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
          <Panel.Title>
            <code className="text-xs font-mono">{commitHash}</code>
          </Panel.Title>
          <Panel.CloseButton onClick={onClose} />
        </Panel.Header>
        <Panel.Body className="flex-1 flex items-center justify-center">
          <EmptyState icon={FileText} message="No changes in this commit" />
        </Panel.Body>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-col">
      <Panel.Header>
        <Panel.Title>
          <code className="text-xs font-mono">{commitHash}</code>
        </Panel.Title>
        <Panel.CloseButton onClick={onClose} />
      </Panel.Header>
      <Panel.Body className="flex-1 flex pt-0">
        {css && (
          <style
            // biome-ignore lint/security/noDangerouslySetInnerHtml: syntect CSS output is trusted
            dangerouslySetInnerHTML={{
              __html: `
                @media (prefers-color-scheme: light) {
                  ${css.light}
                }
                @media (prefers-color-scheme: dark) {
                  ${css.dark}
                }
              `,
            }}
          />
        )}
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
