/**
 * AssistantPanel - Main chat interface for the project assistant.
 *
 * Features:
 * - Message log display (reuses LogList component)
 * - Text input with send/stop buttons
 * - Session history browser
 * - Auto-scroll to latest messages
 */

import { History, Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAssistant } from "../../providers";
import { LogList } from "../Logs/LogList";
import { Button, EmptyState, FlexContainer, Panel, PanelLayout, Slot } from "../ui";
import { ChatInputPanel } from "./ChatInputPanel";

interface AssistantPanelProps {
  onClose: () => void;
  onToggleHistory: () => void;
}

export function AssistantPanel({ onClose, onToggleHistory }: AssistantPanelProps) {
  const { activeSession, logs, isLoading, isAgentWorking, sendMessage, stopAgent, newSession } =
    useAssistant();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally scroll when logs change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const handleNewSession = async () => {
    await newSession();
  };

  const sessionTitle = activeSession?.title || "Assistant";

  return (
    <PanelLayout direction="vertical">
      {/* Main content area - always visible */}
      <Slot id="assistant-main" type="grow" visible={true}>
        <Panel autoFill>
          <FlexContainer direction="vertical">
            {/* Header */}
            <Panel.Header className="flex items-center justify-between border-b border-stone-200 dark:border-stone-700">
              <div className="flex items-center gap-2">
                <Panel.Title>{sessionTitle}</Panel.Title>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={onToggleHistory} title="Session history">
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
          </FlexContainer>
        </Panel>
      </Slot>

      {/* Footer: Chat input - always visible (for now) */}
      <Slot id="assistant-footer-input" type="auto" visible={true} plain>
        <ChatInputPanel onSend={sendMessage} onStop={stopAgent} isAgentWorking={isAgentWorking} />
      </Slot>
    </PanelLayout>
  );
}
