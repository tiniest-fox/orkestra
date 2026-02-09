import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { useCommitDiff } from "../../hooks/useCommitDiff";
import type { HighlightedFileDiff } from "../../hooks/useDiff";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { DiffContent } from "../Diff/DiffContent";
import { DiffFileList } from "../Diff/DiffFileList";
import { EmptyState, FlexContainer, Panel } from "../ui";
import { CommitDiffSkeleton } from "./CommitDiffSkeleton";

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
    return <CommitDiffSkeleton commitHash={commitHash} onClose={onClose} />;
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
