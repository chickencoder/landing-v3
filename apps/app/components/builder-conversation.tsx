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
  MessageRenderer,
  OptimisticAgentMessage,
} from "@/components/message-renderer";
import type { Doc } from "@repo/convex/_generated/dataModel";
import { ArrowUp, HomeIcon } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import Link from "next/link";
import { Button } from "./ui/button";
import { useParams } from "next/navigation";

interface CurrentUser {
  name: string;
  imageUrl: string;
}

function Toolbar() {
  const { orgId, slug } = useParams<{ orgId: string; slug: string }>();
  return (
    <div>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={`/${orgId}`}>
                <Button size="icon" variant="ghost">
                  <HomeIcon className="size-4" />
                </Button>
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>/</BreadcrumbSeparator>
          <BreadcrumbItem>{slug}</BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}

interface BuilderConversationProps {
  messages: Doc<"messages">[] | null | undefined;
  currentUser: CurrentUser | null;
  agentMessageLength: number;
  onSubmit: (message: PromptInputMessage) => void;
}

export function BuilderConversation({
  messages,
  currentUser,
  agentMessageLength,
  onSubmit,
}: BuilderConversationProps) {
  return (
    <div className="flex max-w-100 w-full flex-col">
      <div className="w-full flex flex-1 flex-col gap-2 overflow-hidden">
        <Conversation className="w-full">
          <ConversationContent className="pt-0 px-2">
            <MessageRenderer
              messages={messages ?? []}
              currentUser={currentUser}
            />
            {agentMessageLength === 0 && <OptimisticAgentMessage />}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>
      <div className="flex justify-center">
        <PromptInput onSubmit={onSubmit} className="bg-card">
          <PromptInputBody className="rounded-none">
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
  );
}
