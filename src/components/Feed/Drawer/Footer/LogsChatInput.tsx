// Compose area for the Logs tab — sits between the log list and footer action buttons.

import type React from "react";
import { ChatComposeArea } from "../../ChatComposeArea";

interface LogsChatInputProps {
  chatMessage: string;
  onChatMessageChange: (v: string) => void;
  chatTextareaRef: React.RefObject<HTMLTextAreaElement>;
  chatSending: boolean;
  chatAgentActive: boolean;
  onSendChat: () => void;
  onInterrupt: () => void;
  chatError: string | null;
}

export function LogsChatInput({
  chatMessage,
  onChatMessageChange,
  chatTextareaRef,
  chatSending,
  chatAgentActive,
  onSendChat,
  onInterrupt,
  chatError,
}: LogsChatInputProps) {
  return (
    <ChatComposeArea
      value={chatMessage}
      onChange={onChatMessageChange}
      textareaRef={chatTextareaRef}
      sending={chatSending}
      agentActive={chatAgentActive}
      onSend={onSendChat}
      onStop={onInterrupt}
      placeholder="Message the agent…"
      error={chatError}
      className="shrink-0 px-4 pt-0 pb-4"
    />
  );
}
