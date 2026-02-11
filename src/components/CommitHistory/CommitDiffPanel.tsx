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

  // Reset to first file on every commit change (diff identity changes only when commitHash changes).
  // Unlike DiffPanel (which polls), we want to reset selection when switching commits.
  useEffect(() => {
    if (diff && diff.files.length > 0) {
      setSelectedPath(diff.files[0].path);
    } else {
      setSelectedPath(null);
    }
  }, [diff]);

  const handleSelectFile = (file: HighlightedFileDiff) => {
    setSelectedPath(file.path);
  };

  // Determine body content based on state
  let bodyContent: React.ReactNode;
  let bodyClassName: string;

  if (loading && !diff) {
    bodyContent = <CommitDiffSkeleton />;
    bodyClassName = "flex-1 flex pt-0";
  } else if (error) {
    bodyContent = <span className="text-error-600 dark:text-error-400">Error: {error}</span>;
    bodyClassName = "flex-1 flex items-center justify-center";
  } else if (!diff || diff.files.length === 0) {
    bodyContent = <EmptyState icon={FileText} message="No changes in this commit" />;
    bodyClassName = "flex-1 flex items-center justify-center";
  } else {
    bodyContent = (
      <>
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
      </>
    );
    bodyClassName = "flex-1 flex pt-0";
  }

  return (
    <Panel className="flex flex-col">
      <Panel.Header>
        <Panel.Title>
          <code className="text-xs font-mono">{commitHash}</code>
        </Panel.Title>
        <Panel.CloseButton onClick={onClose} />
      </Panel.Header>
      <Panel.Body className={bodyClassName}>{bodyContent}</Panel.Body>
    </Panel>
  );
}
