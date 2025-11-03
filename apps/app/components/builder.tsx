"use client";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewNavigation,
  WebPreviewUrl,
} from "@/components/ai-elements/web-preview";
import {
  MessageRenderer,
  OptimisticAgentMessage,
} from "@/components/message-renderer";
import { useUser } from "@clerk/nextjs";
import { api } from "@repo/convex/_generated/api";
import type { Id } from "@repo/convex/_generated/dataModel";
import {
  Preloaded,
  useConvexAuth,
  useMutation,
  usePreloadedQuery,
  useQuery,
} from "convex/react";
import { ArrowUp, Loader } from "lucide-react";
import { useEffect } from "react";

export function Builder({
  slug,
  preloadedMessagesQuery,
}: {
  slug: string;
  preloadedMessagesQuery: Preloaded<typeof api.messages.getMessagesBySite>;
}) {
  const { isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const messages = usePreloadedQuery(preloadedMessagesQuery);
  const site = useQuery(
    api.sites.getSiteBySlug,
    isAuthenticated ? { slug } : "skip"
  );
  const sendMessage = useMutation(api.messages.upsertMessage);
  const heartbeat = useMutation(api.presence.heartbeat);
  const leave = useMutation(api.presence.leave);

  // Presence tracking with instant exit detection
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleError = (context: string) => (err: unknown) =>
      console.error(`[presence] ${context} failed:`, err);

    // Send initial heartbeat
    heartbeat({ slug }).catch(handleError("Initial heartbeat"));

    // Periodic heartbeat while tab is visible
    const interval = setInterval(() => {
      if (!document.hidden) {
        heartbeat({ slug }).catch(handleError("Heartbeat"));
      }
    }, 10_000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        leave({ slug }).catch(handleError("Leave (visibility)"));
      } else {
        heartbeat({ slug }).catch(handleError("Heartbeat (visibility)"));
      }
    };

    const handleBeforeUnload = () => {
      leave({ slug }).catch(handleError("Leave (beforeunload)"));
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      leave({ slug }).catch(handleError("Leave (unmount)"));
    };
  }, [slug, heartbeat, leave, isAuthenticated]);

  const agentMessageLength = messages.filter(
    (message: any) => message.role === "assistant"
  ).length;

  const currentUser = user
    ? {
        name: user.fullName || user.username || "User",
        imageUrl: user.imageUrl,
      }
    : null;

  const handleSubmit = async (message: PromptInputMessage) => {
    const trimmedText = message.text?.trim();
    if (!trimmedText) return;

    try {
      await sendMessage({
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: trimmedText }],
        slug,
      });
    } catch (error) {
      console.error("[message] Failed to send message:", error);
    }
  };

  const getLoadingMessage = () => {
    if (site?.status === "creating") return "Setting up your workspace...";
    if (site?.status === "stopped") return "Workspace is stopped";
    if (site?.status === "error") return "Error loading workspace";
    if (site?.status === "deleted") return "Workspace has been deleted";
    if (site?.status === "started" && !site?.devServer?.isRunning) {
      return "Starting dev server...";
    }
    return "Loading workspace...";
  };

  const shouldShowLoadingOverlay =
    site?.status !== "started" ||
    !site?.previewUrl ||
    !site?.devServer?.isRunning;

  return (
    <div className="flex h-screen p-2 gap-2">
      {/* Left Column - Conversation Thread */}
      <div className="flex w-[24rem] flex-col">
        <div className="flex flex-1 flex-col items-center overflow-hidden">
          <Conversation className="w-full">
            <ConversationContent className="pt-0 px-2">
              <MessageRenderer
                messages={messages as any}
                currentUser={currentUser}
              />
              {agentMessageLength === 0 && <OptimisticAgentMessage />}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>

        <div className="flex justify-center">
          <PromptInput onSubmit={handleSubmit} className="bg-card">
            <PromptInputBody>
              <PromptInputTextarea placeholder="Describe changes to your site..." />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools />
              <PromptInputSubmit variant="secondary">
                <ArrowUp />
              </PromptInputSubmit>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>

      {/* Right Column - Web Preview */}
      <div className="flex-1 relative">
        <WebPreview
          defaultUrl={site?.previewUrl || ""}
          className="overflow-hidden h-full"
        >
          <WebPreviewNavigation>
            <WebPreviewUrl />
          </WebPreviewNavigation>
          <WebPreviewBody />
        </WebPreview>

        {/* Loading overlay - smoothly transitions between states */}
        {shouldShowLoadingOverlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg">
            <div className="flex flex-col items-center gap-2">
              <Loader className="size-4 animate-spin" />
              <p className="text-muted-foreground">{getLoadingMessage()}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
