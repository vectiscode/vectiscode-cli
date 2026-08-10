import type { AiMessage } from "../types.js";

export function publicAiMessage(message: AiMessage): AiMessage {
  const publicMessage = { ...message };
  delete publicMessage.providerTrace;
  delete publicMessage.usageCostCredits;
  return publicMessage as AiMessage;
}

export function publicAiMessages(messages: AiMessage[]): AiMessage[] {
  return messages.map(publicAiMessage);
}

export function publicChatResponse<T extends { userMessage: AiMessage; assistantMessage: AiMessage }>(response: T): T {
  return {
    ...response,
    userMessage: publicAiMessage(response.userMessage),
    assistantMessage: publicAiMessage(response.assistantMessage)
  };
}
