//! Diff file jump list — tree view, click to scroll to a file section.

import type { HighlightedFileDiff } from "../../hooks/useDiff";
import { DiffFileEntry } from "./DiffFileEntry";

interface DiffFileListProps {
  files: HighlightedFileDiff[];
  activePath: string | null;
  onJumpTo: (path: string) => void;
}

// ============================================================================
// Tree building
// ============================================================================

type FileNode = { kind: "file"; name: string; file: HighlightedFileDiff };
type DirNode = { kind: "dir"; name: string; children: TreeNode[] };
type TreeNode = FileNode | DirNode;

function buildTree(files: HighlightedFileDiff[]): TreeNode[] {
  const root: DirNode = { kind: "dir", name: "", children: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let child = node.children.find((c): c is DirNode => c.kind === "dir" && c.name === parts[i]);
      if (!child) {
        child = { kind: "dir", name: parts[i], children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.children.push({ kind: "file", name: parts[parts.length - 1], file });
  }

  return root.children;
}

// ============================================================================
// Rendering
// ============================================================================

function TreeNodes({
  nodes,
  depth,
  activePath,
  onJumpTo,
}: {
  nodes: TreeNode[];
  depth: number;
  activePath: string | null;
  onJumpTo: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "dir" ? (
          <div key={node.name}>
            <div
              className="font-mono text-forge-mono-sm text-text-quaternary py-0.5 truncate font-medium"
              style={{ paddingLeft: depth * 12 + 8 }}
              title={node.name}
            >
              {node.name}
            </div>
            <TreeNodes
              nodes={node.children}
              depth={depth + 1}
              activePath={activePath}
              onJumpTo={onJumpTo}
            />
          </div>
        ) : (
          <DiffFileEntry
            key={node.file.path}
            file={node.file}
            name={node.name}
            depth={depth}
            isActive={node.file.path === activePath}
            onClick={() => onJumpTo(node.file.path)}
          />
        ),
      )}
    </>
  );
}

export function DiffFileList({ files, activePath, onJumpTo }: DiffFileListProps) {
  const tree = buildTree(files);

  return (
    <div className="w-56 flex-shrink-0 flex flex-col -mr-2">
      <div className="sticky top-0 z-10 px-3 py-2 bg-canvas border-b border-border font-mono text-forge-mono-sm font-semibold text-text-tertiary">
        {files.length} {files.length === 1 ? "file" : "files"}
      </div>
      <div className="flex-1 overflow-auto py-1 space-y-0.5">
        <TreeNodes nodes={tree} depth={0} activePath={activePath} onJumpTo={onJumpTo} />
      </div>
    </div>
  );
}
