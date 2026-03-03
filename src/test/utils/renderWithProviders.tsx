import type { RenderOptions } from "@testing-library/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { TasksProvider } from "../../providers/TasksProvider";
import { WorkflowConfigProvider } from "../../providers/WorkflowConfigProvider";
import { TransportProvider } from "../../transport";

/**
 * Render a component with all necessary providers for testing.
 * Use this when testing components that depend on context providers.
 *
 * TransportProvider is mocked in setup.ts to return the mockTransport singleton,
 * so components calling useTransport() get the test mock automatically.
 */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(
    <TransportProvider>
      <WorkflowConfigProvider>
        <TasksProvider>{ui}</TasksProvider>
      </WorkflowConfigProvider>
    </TransportProvider>,
    options,
  );
}
