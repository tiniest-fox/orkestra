//! Dropdown for switching between saved daemon projects in the FeedHeader.

import { ChevronDown, Plus, X } from "lucide-react";
import { useState } from "react";
import { useProjects } from "../../providers";
import { Dropdown } from "../ui/Dropdown";

function displayName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return url;
  }
}

export function ProjectSwitcher() {
  const { projects, currentProject, switchProject, startAddProject, removeProject } = useProjects();
  const [open, setOpen] = useState(false);

  if (!currentProject) return null;

  const projectName = currentProject.projectName || displayName(currentProject.url);
  const canRemove = projects.length > 1;

  return (
    <div className="flex items-center gap-2">
      <span className="text-text-quaternary select-none">·</span>
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        align="left"
        className="min-w-[220px]"
        trigger={({ onClick }) => (
          <button
            type="button"
            onClick={onClick}
            className="flex items-center gap-1 text-[13px] font-semibold text-text-secondary hover:text-text-primary transition-colors select-none"
          >
            <span>{projectName}</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
        )}
      >
        <div className="py-1">
          {projects.map((project) => {
            const isActive = project.id === currentProject.id;
            const name = project.projectName || displayName(project.url);
            return (
              <div key={project.id} className="group flex items-center hover:bg-canvas">
                <button
                  type="button"
                  className="flex-1 min-w-0 flex items-center px-3 py-2 text-left"
                  onClick={() => {
                    if (!isActive) {
                      switchProject(project.id);
                    }
                  }}
                >
                  <div className="min-w-0">
                    <div
                      className={`text-sm truncate ${isActive ? "font-semibold text-text-primary" : "font-normal text-text-secondary"}`}
                    >
                      {name}
                    </div>
                    <div className="text-[11px] text-text-tertiary truncate">{project.url}</div>
                  </div>
                </button>
                {canRemove && (
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 p-1.5 mr-1 rounded text-text-tertiary hover:text-text-secondary transition-opacity shrink-0"
                    onClick={() => removeProject(project.id)}
                    aria-label={`Remove ${name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
          <div className="border-t border-border my-1" />
          <button
            type="button"
            className="w-full flex items-center gap-1.5 px-3 py-2 text-sm text-accent hover:bg-canvas text-left"
            onClick={() => {
              setOpen(false);
              startAddProject();
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add project
          </button>
        </div>
      </Dropdown>
    </div>
  );
}
