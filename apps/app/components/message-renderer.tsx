"use client";

import {
  Message,
  MessageContent,
  MessageAvatar,
} from "@/components/ai-elements/message";
import { Response } from "@/components/ai-elements/response";
import { ToolParam } from "@/components/ai-elements/task";
import { LoadingText } from "@/components/loading-text";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Bot,
  FileText,
  FilePlus,
  Globe,
  Pencil,
  Search,
  SearchCode,
  Terminal,
} from "lucide-react";

type MessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      name: string;
      input?: Record<string, unknown>;
      id?: string;
    };

type MessageData = {
  _id: string;
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  metadata?: {
    isComplete?: boolean;
  };
  userId: string;
  orgId: string;
  siteId: string;
};

type UserInfo = {
  name: string;
  imageUrl?: string;
};

interface MessageRendererProps {
  messages: MessageData[];
  currentUser: UserInfo | null;
}

interface ToolCallPart {
  name: string;
  input?: Record<string, unknown>;
}

const getToolIcon = (toolName: string) => {
  const iconProps = { className: "size-3.5 shrink-0" };
  switch (toolName) {
    case "Glob":
      return <Search {...iconProps} />;
    case "Read":
      return <FileText {...iconProps} />;
    case "Edit":
      return <Pencil {...iconProps} />;
    case "Write":
      return <FilePlus {...iconProps} />;
    case "Bash":
      return <Terminal {...iconProps} />;
    case "Grep":
      return <SearchCode {...iconProps} />;
    case "Task":
      return <Bot {...iconProps} />;
    case "WebFetch":
      return <Globe {...iconProps} />;
    case "WebSearch":
      return <Search {...iconProps} />;
    default:
      return null;
  }
};

const getToolLabel = (
  toolName: string,
  input: Record<string, unknown> | undefined,
  isComplete: boolean,
): { label: string; param?: string } => {
  const fileName =
    typeof input?.file_path === "string"
      ? input.file_path.split("/").pop()
      : undefined;

  let label = "";
  let param: string | undefined;

  switch (toolName) {
    case "Glob":
      if (isComplete && typeof input?.pattern === "string") {
        label = "Searched for";
        param = input.pattern;
      } else {
        label = isComplete ? "Searched for files" : "Searching for files";
      }
      break;
    case "Read":
      if (isComplete && fileName) {
        label = "Read";
        param = fileName;
      } else {
        label = isComplete ? "Read file" : "Reading file";
      }
      break;
    case "Edit":
      if (isComplete && fileName) {
        label = "Edited";
        param = fileName;
      } else {
        label = isComplete ? "Edited file" : "Editing file";
      }
      break;
    case "Write":
      if (isComplete && fileName) {
        label = "Wrote";
        param = fileName;
      } else {
        label = isComplete ? "Wrote file" : "Writing file";
      }
      break;
    case "Bash":
      if (typeof input?.command === "string") {
        label = isComplete ? "Executed" : "Executing";
        param =
          input.command.length > 40
            ? `${input.command.slice(0, 40)}...`
            : input.command;
      } else {
        label = isComplete ? "Executed command" : "Executing command";
      }
      break;
    case "Grep":
      if (isComplete && typeof input?.pattern === "string") {
        label = "Searched for";
        param = input.pattern;
      } else {
        label = isComplete ? "Searched code" : "Searching code";
      }
      break;
    case "Task":
      label =
        typeof input?.description === "string"
          ? input.description
          : isComplete
            ? "Ran task"
            : "Running task";
      break;
    case "WebFetch":
      if (isComplete && typeof input?.url === "string") {
        label = "Fetched";
        param = input.url;
      } else {
        label = isComplete ? "Fetched content" : "Fetching content";
      }
      break;
    case "WebSearch":
      if (isComplete && typeof input?.query === "string") {
        label = "Searched";
        param = input.query;
      } else {
        label = isComplete ? "Searched web" : "Searching web";
      }
      break;
    default:
      label = toolName;
  }

  return { label, param };
};

const ToolCall = ({
  part,
  isComplete,
}: {
  part: ToolCallPart;
  isComplete: boolean;
}) => {
  const icon = getToolIcon(part.name);
  const { label, param } = getToolLabel(part.name, part.input, isComplete);

  if (isComplete) {
    return (
      <div className="text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {icon}
          <span>{label}</span>
          {param && (
            <ToolParam className="whitespace-nowrap overflow-hidden text-ellipsis">
              {param}
            </ToolParam>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 text-sm">
      {icon}
      <LoadingText>
        <span className="inline-flex items-center gap-1.5">
          <span>{label}</span>
          {param && (
            <ToolParam className="whitespace-nowrap overflow-hidden text-ellipsis">
              {param}
            </ToolParam>
          )}
        </span>
      </LoadingText>
    </div>
  );
};

const MessageHeader = ({
  isAssistant,
  userName,
  avatarSrc,
}: {
  isAssistant: boolean;
  userName: string;
  avatarSrc?: string;
}) => (
  <div className="inline-flex items-center gap-2">
    {isAssistant ? (
      <Avatar className="size-5">
        <AvatarFallback className="brightness-130 text-primary">
          <Bot className="size-4" />
        </AvatarFallback>
      </Avatar>
    ) : (
      <MessageAvatar src={avatarSrc || ""} className="size-5" name={userName} />
    )}
    <span className="font-medium">{userName}</span>
  </div>
);

export function OptimisticAgentMessage() {
  return (
    <Message from="assistant">
      <MessageContent variant="flat">
        <MessageHeader isAssistant={true} userName="Landing" />
        <LoadingText>Spinning up sandbox...</LoadingText>
      </MessageContent>
    </Message>
  );
}

export function MessageRenderer({
  messages,
  currentUser,
}: MessageRendererProps) {
  return (
    <>
      {messages.map((message) => {
        const isAssistant = message.role === "assistant";
        const isUser = message.role === "user";
        const isMessageComplete = message.metadata?.isComplete === true;
        const isEmptyAssistantMessage =
          isAssistant && message.parts.length === 0;

        const userName = isAssistant
          ? "Landing"
          : isUser && currentUser
            ? currentUser.name
            : "User";

        const avatarSrc =
          isUser && currentUser ? currentUser.imageUrl : undefined;

        return (
          <div key={message._id}>
            <Message from="system">
              <MessageContent variant="flat">
                <MessageHeader
                  isAssistant={isAssistant}
                  userName={userName}
                  avatarSrc={avatarSrc}
                />

                {isEmptyAssistantMessage ? (
                  <LoadingText>Thinking</LoadingText>
                ) : (
                  <div className="space-y-3">
                    {message.parts.map((part, partIndex) => {
                      if (part.type === "text") {
                        return <Response key={partIndex}>{part.text}</Response>;
                      }

                      if (
                        part.type === "tool_use" &&
                        part.name !== "TodoWrite"
                      ) {
                        const isLastPart =
                          partIndex === message.parts.length - 1;
                        const isToolLoading = isLastPart && !isMessageComplete;
                        const isFirstPart = partIndex === 0;

                        return (
                          <div
                            key={partIndex}
                            className={isFirstPart ? "mt-2" : ""}
                          >
                            <ToolCall
                              part={part as ToolCallPart}
                              isComplete={!isToolLoading}
                            />
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                )}
              </MessageContent>
            </Message>
          </div>
        );
      })}
    </>
  );
}
