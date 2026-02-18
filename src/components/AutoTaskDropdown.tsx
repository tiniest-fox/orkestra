/**
 * AutoTaskDropdown - Dropdown menu for quick-creating tasks from templates.
 * Only renders when templates are available.
 */

import { MoreVertical } from "lucide-react";
import { useState } from "react";
import type { AutoTaskTemplate } from "../types/workflow";
import { Dropdown, IconButton } from "./ui";

interface AutoTaskDropdownProps {
  templates: AutoTaskTemplate[];
  onSelect: (template: AutoTaskTemplate) => void;
}

export function AutoTaskDropdown({ templates, onSelect }: AutoTaskDropdownProps) {
  const [open, setOpen] = useState(false);

  if (templates.length === 0) return null;

  const handleSelect = (template: AutoTaskTemplate) => {
    setOpen(false);
    onSelect(template);
  };

  return (
    <Dropdown
      trigger={({ onClick }) => (
        <IconButton
          onClick={onClick}
          icon={<MoreVertical size={16} />}
          aria-label="Task templates"
          variant="secondary"
          size="sm"
        />
      )}
      align="right"
      open={open}
      onOpenChange={setOpen}
    >
      {templates.map((template) => (
        <Dropdown.Item key={template.filename} onClick={() => handleSelect(template)}>
          {template.title}
        </Dropdown.Item>
      ))}
    </Dropdown>
  );
}
