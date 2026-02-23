import type { RenderOptions } from "@testing-library/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { TasksProvider } from "../../providers/TasksProvider";
import { WorkflowConfigProvider } from "../../providers/WorkflowConfigProvider";

/**
 * Render a component with all necessary providers for testing.
 * Use this when testing components that depend on context providers.
 */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(
    <WorkflowConfigProvider>
      <TasksProvider>{ui}</TasksProvider>
    </WorkflowConfigProvider>,
    options,
  );
}
