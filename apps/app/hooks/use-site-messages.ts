import { useMutation } from "convex/react";
import { api } from "@repo/convex/_generated/api";
import type { Doc, Id } from "@repo/convex/_generated/dataModel";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

export function useSiteMessages(
  siteId: Id<"sites"> | undefined,
  messages: Doc<"messages">[] | null | undefined,
) {
  // Messages are already reactive from usePreloadedQuery in parent
  const sendMessage = useMutation(api.messages.upsertMessage);

  const agentMessageLength =
    messages?.filter((message: Doc<"messages">) => message.role === "assistant")
      .length ?? 0;

  const handleSubmit = async (message: PromptInputMessage) => {
    const trimmedText = message.text?.trim();
    if (!trimmedText || !siteId) return;

    try {
      await sendMessage({
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: trimmedText }],
        siteId,
      });
    } catch (error) {
      console.error("[message] Failed to send message:", error);
    }
  };

  return {
    messages,
    agentMessageLength,
    handleSubmit,
  };
}
