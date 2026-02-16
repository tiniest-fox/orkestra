import { FileText } from "lucide-react";
import type { HighlightedFileDiff, HighlightedTaskDiff } from "../../hooks/useDiff";
import { useSyntaxCss } from "../../hooks/useSyntaxCss";
import { EmptyState, ErrorState, FlexContainer, Panel } from "../ui";
import { DiffContent } from "./DiffContent";
import { DiffFileList } from "./DiffFileList";
import { DiffSkeleton } from "./DiffSkeleton";

interface DiffPanelBodyProps {
  diff: HighlightedTaskDiff | null;
  loading: boolean;
  error: unknown;
  emptyMessage: string;
  selectedFile: HighlightedFileDiff | null;
  onSelectFile: (file: HighlightedFileDiff) => void;
}

export function DiffPanelBody({
  diff,
  loading,
  error,
  emptyMessage,
  selectedFile,
  onSelectFile,
}: DiffPanelBodyProps) {
  const { css } = useSyntaxCss();

  // Determine body content based on state
  let bodyContent: React.ReactNode;
  let bodyClassName: string;

  if (loading && !diff) {
    bodyContent = <DiffSkeleton />;
    bodyClassName = "flex-1 flex pt-0";
  } else if (error != null) {
    bodyContent = <ErrorState message="Failed to load diff" error={error} />;
    bodyClassName = "flex-1 flex items-center justify-center";
  } else if (!diff || diff.files.length === 0) {
    bodyContent = <EmptyState icon={FileText} message={emptyMessage} />;
    bodyClassName = "flex-1 flex items-center justify-center";
  } else {
    bodyContent = (
      <>
        {/* Inject syntax CSS */}
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

        {/* Two-pane layout */}
        <FlexContainer>
          <DiffFileList
            files={diff.files}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
          />
          <Panel className="flex-1">
            <DiffContent file={selectedFile} />
          </Panel>
        </FlexContainer>
      </>
    );
    bodyClassName = "flex-1 flex pt-0";
  }

  return <Panel.Body className={bodyClassName}>{bodyContent}</Panel.Body>;
}
