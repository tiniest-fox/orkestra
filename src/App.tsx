import { useState } from "react";
import { KanbanBoard } from "./components/KanbanBoard";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { TaskDetailSidebar } from "./components/TaskDetailSidebar";
import { useTasks } from "./hooks/useTasks";
import { Task } from "./types/task";

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const { tasks, loading, error, createTask, updateTaskStatus, refetch } = useTasks();

  // Keep selected task in sync with latest data
  const currentSelectedTask = selectedTask
    ? tasks.find((t) => t.id === selectedTask.id) || selectedTask
    : null;

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Orkestra</h1>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            + New Task
          </button>
        </div>
      </header>
      <main className="p-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            Error loading tasks: {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading tasks...</div>
          </div>
        ) : (
          <KanbanBoard
            tasks={tasks}
            onUpdateStatus={updateTaskStatus}
            selectedTaskId={selectedTask?.id}
            onSelectTask={setSelectedTask}
          />
        )}
      </main>

      <CreateTaskModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={createTask}
      />

      {currentSelectedTask && (
        <TaskDetailSidebar
          task={currentSelectedTask}
          onClose={() => setSelectedTask(null)}
          onTaskUpdated={refetch}
        />
      )}
    </div>
  );
}

export default App;
