import { useCurrentBranch } from "../hooks/useCurrentBranch";
import { useDisplayContext } from "../providers";

export function BranchIndicator() {
  const { branch, latestCommitMessage } = useCurrentBranch();
  const { layout, toggleGitHistory } = useDisplayContext();

  if (!branch) return null;

  const isActive = layout.preset === "GitHistory" || layout.preset === "GitCommit";

  const handleClick = () => {
    toggleGitHistory();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 text-xs rounded px-2 py-1 transition-colors overflow-hidden min-w-0 ${
        isActive
          ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
          : "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800"
      }`}
    >
      <BranchIcon />
      <span className="flex-shrink-0">{branch}</span>
      {latestCommitMessage && (
        <>
          <span className="text-stone-400 dark:text-stone-500 flex-shrink-0">/</span>
          <span className="truncate min-w-0">{latestCommitMessage}</span>
        </>
      )}
    </button>
  );
}

function BranchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="flex-shrink-0"
      aria-hidden="true"
    >
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
    </svg>
  );
}
