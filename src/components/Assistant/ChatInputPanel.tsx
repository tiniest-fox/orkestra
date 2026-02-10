/**
 * ChatInputPanel - Text input with send/stop buttons for assistant chat.
 *
 * Manages its own message input state and keyboard shortcuts.
 * Renders the border-top and padding (no Panel.Footer wrapper needed).
 */

import { Send, Square } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui";

interface ChatInputPanelProps {
  onSend: (message: string) => void;
  onStop: () => void;
  isAgentWorking: boolean;
}

export function ChatInputPanel({ onSend, onStop, isAgentWorking }: ChatInputPanelProps) {
  const [messageInput, setMessageInput] = useState("");

  const handleSend = () => {
    const trimmed = messageInput.trim();
    if (!trimmed || isAgentWorking) return;
    setMessageInput("");
    onSend(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-stone-200 dark:border-stone-700 p-3">
      <div className="flex gap-2">
        <textarea
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Shift+Enter for newline)"
          disabled={isAgentWorking}
          className="flex-1 resize-none rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
          rows={3}
        />
        {isAgentWorking ? (
          <Button variant="secondary" onClick={onStop} title="Stop agent">
            <Square className="w-4 h-4" />
          </Button>
        ) : (
          <Button onClick={handleSend} disabled={!messageInput.trim()} title="Send message (Enter)">
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
