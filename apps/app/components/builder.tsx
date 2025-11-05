"use client";

import { BuilderConversation } from "@/components/builder-conversation";
import { BuilderPreview } from "@/components/builder-preview";
import { useSiteMessages } from "@/hooks/use-site-messages";
import { useSitePresence } from "@/hooks/use-site-presence";
import { useSiteStatus } from "@/hooks/use-site-status";
import { useUser } from "@clerk/nextjs";
import { api } from "@repo/convex/_generated/api";
import { useQuery } from "convex/react";

export function Builder({ slug }: { slug: string }) {
  const { user } = useUser();
  const isAuthenticated = !!user;
  const data = useQuery(api.messages.getMessagesBySite, { slug });
  const site = data?.site;
  const messages = data?.messages;

  // Custom hooks for state management
  useSitePresence(slug, isAuthenticated);
  const { agentMessageLength, handleSubmit } = useSiteMessages(
    site?._id,
    messages,
  );
  const { previewUrl, shouldShowLoadingOverlay, loadingMessage } =
    useSiteStatus(site);

  // Compute current user info
  const currentUser = user
    ? {
        name: user.fullName || user.username || "User",
        imageUrl: user.imageUrl,
      }
    : null;

  return (
    <div className="flex h-dvh p-2 gap-2">
      <BuilderConversation
        messages={messages}
        currentUser={currentUser}
        agentMessageLength={agentMessageLength}
        onSubmit={handleSubmit}
      />
      <BuilderPreview
        previewUrl={previewUrl}
        shouldShowLoadingOverlay={shouldShowLoadingOverlay}
        loadingMessage={loadingMessage}
      />
    </div>
  );
}
