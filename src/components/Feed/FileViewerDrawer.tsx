// File viewer drawer with syntax-highlighted content and auto-refresh polling.

import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { HighlightedLine } from "../../hooks/useDiff";
import { usePolling } from "../../hooks/usePolling";
import { useConnectionState, useTransport } from "../../transport";
import { isDisconnectError } from "../../utils/transportErrors";
import { Drawer } from "../ui/Drawer/Drawer";
import { IconButton } from "../ui/IconButton";

interface FileViewerDrawerProps {
  filePath: string;
  onClose: () => void;
}

export function FileViewerDrawer({ filePath, onClose }: FileViewerDrawerProps) {
  const transport = useTransport();
  const connectionState = useConnectionState();
  const [lines, setLines] = useState<HighlightedLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filePath is the trigger, not read inside the effect body
  useEffect(() => {
    setLines(null);
    setError(null);
  }, [filePath]);

  const fetchContent = useCallback(async () => {
    try {
      const result = await transport.call<HighlightedLine[] | null>("get_project_file_content", {
        file_path: filePath,
      });
      if (result === null) {
        setError("File not found");
        setLines(null);
      } else {
        setLines(result);
        setError(null);
      }
    } catch (err) {
      if (!isDisconnectError(err)) {
        setError(String(err));
      }
    }
  }, [transport, filePath]);

  usePolling(connectionState === "connected" ? fetchContent : null, 2000);

  return (
    <Drawer onClose={onClose}>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="font-mono text-forge-mono-sm text-text-primary truncate min-w-0">
            {filePath}
          </div>
          <IconButton
            icon={<X size={14} />}
            aria-label="Close file viewer"
            onClick={onClose}
            size="sm"
          />
        </div>
        {/* Content */}
        <div className="flex-1 overflow-auto">
          {error && <div className="p-4 text-text-secondary text-forge-body">{error}</div>}
          {!error && lines === null && (
            <div className="p-4 text-text-quaternary text-forge-body">Loading...</div>
          )}
          {!error &&
            lines &&
            lines.map((line, i) => {
              const content = (
                <div
                  className="whitespace-pre-wrap break-words px-2 text-text-primary"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: syntect output is trusted
                  dangerouslySetInnerHTML={{ __html: line.html }}
                />
              );
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
                <div key={i} className="flex font-mono text-forge-mono-md">
                  <div className="w-12 text-right pr-3 text-text-quaternary select-none shrink-0 bg-surface border-r border-border">
                    {line.new_line_number}
                  </div>
                  {content}
                </div>
              );
            })}
        </div>
      </div>
    </Drawer>
  );
}
