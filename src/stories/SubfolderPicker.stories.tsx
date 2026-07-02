// Storybook stories for SubfolderPicker — loading, directory list, empty, and error states.

import type { Meta, StoryObj } from "@storybook/react";
import { LoadingState, Panel } from "../components/ui";
import { DrawerHeader } from "../components/ui/Drawer/DrawerHeader";
import { storybookDecorator } from "./storybook-helpers";

// ============================================================================
// Visual showcase component
// ============================================================================

// SubfolderPicker calls the service REST API directly (not the transport layer),
// so these stories use a controlled view component to showcase each visual state.

interface SubfolderPickerViewProps {
  projectName: string;
  directories: string[];
  hasLoaded: boolean;
  creating: string | null;
  error: string | null;
}

function SubfolderPickerView({
  projectName,
  directories,
  hasLoaded,
  creating,
  error,
}: SubfolderPickerViewProps) {
  return (
    <Panel autoFill={false}>
      <DrawerHeader title={`Open Subfolder — ${projectName}`} onClose={() => {}} />
      <div className="p-4 flex-1 overflow-auto max-h-[60vh]">
        {!hasLoaded ? (
          <LoadingState message="Loading directories..." />
        ) : directories.length === 0 && !error ? (
          <p className="text-sm text-text-secondary text-center py-4">No subdirectories found.</p>
        ) : (
          <div className="-mx-4 px-4">
            {directories.map((dir) => (
              <button
                key={dir}
                type="button"
                disabled={creating !== null}
                className="w-full text-left flex items-center gap-4 px-2 py-2 rounded-panel-sm hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {}}
              >
                <span className="text-sm font-medium text-text-primary truncate">{dir}</span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="mt-2 text-xs text-status-error">{error}</p>}
        {creating && !error && (
          <p className="mt-2 text-xs text-text-secondary">Creating project for "{creating}"...</p>
        )}
      </div>
    </Panel>
  );
}

// ============================================================================
// Stories
// ============================================================================

const meta = {
  title: "Service/SubfolderPicker",
  component: SubfolderPickerView,
  decorators: [storybookDecorator],
  parameters: {
    layout: "centered",
  },
  args: {
    projectName: "my-monorepo",
    directories: [],
    hasLoaded: false,
    creating: null,
    error: null,
  },
} satisfies Meta<typeof SubfolderPickerView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Initial loading state — spinner while directories are being fetched. */
export const Loading: Story = {
  args: {
    hasLoaded: false,
  },
};

/** Directory list loaded — shows selectable subdirectories. */
export const WithDirectories: Story = {
  args: {
    hasLoaded: true,
    directories: ["frontend", "backend", "packages/web", "packages/core", "docs"],
  },
};

/** Creating in progress — buttons disabled, status message shown. */
export const Creating: Story = {
  args: {
    hasLoaded: true,
    directories: ["frontend", "backend"],
    creating: "frontend",
  },
};

/** No subdirectories found in the repo root. */
export const Empty: Story = {
  args: {
    hasLoaded: true,
    directories: [],
  },
};

/** API error — fetch failed, error message shown below the content area. */
export const FetchError: Story = {
  args: {
    hasLoaded: true,
    directories: [],
    error: "Failed to list directories: permission denied",
  },
};
