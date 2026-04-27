// Collapsible card for displaying an agent-proposed Trak with an Accept action.

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { OrkBlock } from "../../utils/orkBlocks";
import { PROSE_CLASSES } from "../../utils/prose";
import { Button } from "../ui/Button";
import { richContentComponents, richContentPlugins } from "../ui/RichContent";

type TrakProposal = Extract<OrkBlock, { type: "proposal" }>;

interface ProposalCardProps {
  proposal: TrakProposal;
  onAccept: () => void;
  loading?: boolean;
}

export function ProposalCard({ proposal, onAccept, loading }: ProposalCardProps) {
  const [expanded, setExpanded] = useState(true);
  const toggle = () => setExpanded((v) => !v);

  const badgeParts = [proposal.flow, proposal.stage].filter(Boolean);
  const badgeText = badgeParts.join(" > ");

  return (
    <div className="my-1 bg-surface border border-border rounded-panel overflow-hidden">
      <button
        type="button"
        className="flex items-center justify-between w-full px-3 py-2 cursor-pointer select-none hover:bg-surface-2 text-left"
        onClick={toggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-forge-body font-semibold text-text-primary whitespace-nowrap">
            Proposed Trak
          </span>
          {badgeText && (
            <span className="font-mono text-forge-mono-sm text-text-secondary truncate">
              {badgeText}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-text-tertiary shrink-0 ml-2" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-tertiary shrink-0 ml-2" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-3 pt-2 pb-3">
          {proposal.title && (
            <p className="text-forge-body-md font-semibold text-text-primary mb-2">
              {proposal.title}
            </p>
          )}
          {proposal.content ? (
            <div className={`text-forge-body font-sans ${PROSE_CLASSES}`}>
              <ReactMarkdown remarkPlugins={richContentPlugins} components={richContentComponents}>
                {proposal.content}
              </ReactMarkdown>
            </div>
          ) : !proposal.title ? (
            <p className="text-forge-body text-text-quaternary italic">No content</p>
          ) : null}
          <div className="mt-3">
            <Button variant="primary" size="sm" onClick={onAccept} disabled={loading}>
              Accept
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
