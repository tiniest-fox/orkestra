/**
 * PR tab - displays the pull request link.
 */

import { ExternalLink } from "lucide-react";
import { FlexContainer, Link, Panel } from "../ui";

interface PrTabProps {
  prUrl: string;
}

export function PrTab({ prUrl }: PrTabProps) {
  return (
    <FlexContainer direction="vertical" padded={true}>
      <Panel accent="info" autoFill={false} padded={true}>
        <div className="flex items-center gap-2">
          <ExternalLink className="w-4 h-4 text-info-500" />
          <Link href={prUrl} external className="text-sm">
            View Pull Request
          </Link>
        </div>
      </Panel>
    </FlexContainer>
  );
}
