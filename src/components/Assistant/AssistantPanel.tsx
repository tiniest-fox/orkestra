/**
 * AssistantPanel - Main chat interface for the project assistant.
 *
 * Features:
 * - Message log display (reuses LogList component)
 * - Text input with send/stop buttons
 * - Session history browser
 * - Auto-scroll to latest messages
 */

import { History, Plus, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAssistant } from "../../hooks/useAssistant";
import { LogList } from "../Logs/LogList";
import { Button, EmptyState, FlexContainer, Panel } from "../ui";
import { SessionHistory } from "./SessionHistory";

interface AssistantPanelProps {
  onClose: () => void;
}

export function AssistantPanel({ onClose }: AssistantPanelProps) {
  const {
    activeSession,
    sessions,
    logs,
    isLoading,
    isAgentWorking,
    sendMessage,
    stopAgent,
    newSession,
    selectSession,
  } = useAssistant();

  const [messageInput, setMessageInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally scroll when logs change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  // Stop agent on unmount
  useEffect(() => {
    return () => {
      if (isAgentWorking) {
        stopAgent();
      }
    };
  }, [isAgentWorking, stopAgent]);

  const handleSend = async () => {
    const trimmed = messageInput.trim();
    if (!trimmed || isAgentWorking) return;

    setMessageInput("");
    await sendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = async () => {
    await stopAgent();
  };

  const handleNewSession = async () => {
    await newSession();
    setMessageInput("");
  };

  const sessionTitle = activeSession?.title || "Assistant";

  return (
    <Panel autoFill>
      <FlexContainer direction="vertical">
        {/* Header */}
        <Panel.Header className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700">
          <div className="flex items-center gap-2">
            <Panel.Title>{sessionTitle}</Panel.Title>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
              title="Session history"
            >
              <History className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleNewSession} title="New session">
              <Plus className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} title="Close">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </Panel.Header>

        {/* Message area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 min-h-0">
          {logs.length === 0 && !isLoading ? (
            <div className="flex items-center justify-center h-full">
              <EmptyState
                message="Start a conversation"
                description="Type a message below to chat with the assistant."
              />
            </div>
          ) : (
            <>
              <LogList logs={logs} isLoading={isLoading} />
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input area */}
        <Panel.Footer className="border-t border-stone-200 dark:border-stone-700 p-3">
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
              <Button variant="secondary" onClick={handleStop} title="Stop agent">
                <Square className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSend}
                disabled={!messageInput.trim()}
                title="Send message (Enter)"
              >
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
        </Panel.Footer>
      </FlexContainer>

      {/* Session history overlay */}
      {showHistory && (
        <SessionHistory
          sessions={sessions}
          activeSessionId={activeSession?.id ?? null}
          onSelectSession={(session) => {
            selectSession(session);
            setShowHistory(false);
          }}
          onClose={() => setShowHistory(false)}
        />
      )}
    </Panel>
  );
}
