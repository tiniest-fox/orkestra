import { useState } from "react";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { StartupErrorScreen } from "./components/StartupErrorScreen";
import { StartupSplashScreen } from "./components/StartupSplashScreen";
import { WorkflowKanbanBoard } from "./components/WorkflowKanbanBoard";
import { WorkflowTaskDetailSidebar } from "./components/WorkflowTaskDetailSidebar";
import { useStartup } from "./hooks/useStartup";
import { useWorkflow } from "./hooks/useWorkflow";
import type { WorkflowTask } from "./types/workflow";

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<WorkflowTask | null>(null);

  // Check startup status first
  const { isReady, loading: startupLoading, errors: startupErrors, retry } = useStartup();

  // Only load workflow data if startup succeeded
  const { config, tasks, loading, error, createTask, refetch } = useWorkflow();

  // Keep selected task in sync with latest data
  const currentSelectedTask = selectedTask
    ? tasks.find((t) => t.id === selectedTask.id) || selectedTask
    : null;

  // Show splash screen during startup initialization
  if (startupLoading) {
    return <StartupSplashScreen />;
  }

  // Show error screen if startup failed
  if (!isReady) {
    return <StartupErrorScreen errors={startupErrors} onRetry={retry} />;
  }

  // Normal app UI
  return (
    <div className="h-screen bg-gray-100 flex flex-col">
      <header className="flex-shrink-0 bg-white shadow-sm border-b border-gray-200">
        <div className="px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Orkestra</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + New Task
            </button>
          </div>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden">
          {error && (
            <div className="mx-6 mt-6 mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              Error loading tasks: {error.message}
            </div>
          )}
          {loading || !config ? (
            <div className="flex items-center justify-center h-64 px-6">
              <div className="text-gray-500">Loading...</div>
            </div>
          ) : (
            <WorkflowKanbanBoard
              config={config}
              tasks={tasks}
              selectedTaskId={selectedTask?.id}
              onSelectTask={setSelectedTask}
            />
          )}
        </main>

        {currentSelectedTask && config && (
          <WorkflowTaskDetailSidebar
            task={currentSelectedTask}
            config={config}
            onClose={() => setSelectedTask(null)}
            onTaskUpdated={refetch}
          />
        )}
      </div>

      <CreateTaskModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={createTask}
      />
    </div>
  );
}

export default App;
