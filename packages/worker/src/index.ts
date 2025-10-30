import { ConvexClient } from "convex/browser";
import { api } from "@repo/convex/_generated/api";
import type { Id } from "@repo/convex/_generated/dataModel";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type {
  TextBlock,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";

// Logging utilities
function log(level: "info" | "warn" | "error", message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (data) {
    console[level](`${prefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console[level](`${prefix} ${message}`);
  }
}

// Environment validation
if (!process.env.CONVEX_URL) {
  log("error", "CONVEX_URL environment variable is required");
  process.exit(1);
}

if (!process.env.SITE_ID) {
  log("error", "SITE_ID environment variable is required");
  process.exit(1);
}

if (!process.env.CLERK_TOKEN) {
  log("error", "CLERK_TOKEN environment variable is required");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  log("error", "ANTHROPIC_API_KEY environment variable is required");
  process.exit(1);
}

log("info", "Starting sandbox worker", {
  convexUrl: process.env.CONVEX_URL.substring(0, 50) + "...",
  siteId: process.env.SITE_ID,
  nodeVersion: process.version,
  platform: process.platform,
});

const client = new ConvexClient(process.env.CONVEX_URL);
const siteId = process.env.SITE_ID as Id<"sites">;

// Authenticate the Convex client with Clerk JWT token
log("info", "Authenticating Convex client with Clerk token");

const clerkToken = process.env.CLERK_TOKEN!;

// Validate and log token expiration
try {
  const tokenParts = clerkToken.split(".");
  const payload = JSON.parse(atob(tokenParts[1]));
  const now = Math.floor(Date.now() / 1000);
  const secondsUntilExpiry = payload.exp - now;

  if (secondsUntilExpiry < 0) {
    log("error", "Token has expired", {
      expiredSecondsAgo: Math.abs(secondsUntilExpiry),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });
    process.exit(1);
  } else if (secondsUntilExpiry < 300) {
    log("warn", "Token expires soon", {
      secondsUntilExpiry,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });
  } else {
    log("info", "Token is valid", {
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      secondsUntilExpiry,
    });
  }
} catch (e) {
  log("error", "Invalid token format", { error: String(e) });
  process.exit(1);
}

client.setAuth(() => Promise.resolve(clerkToken));

// Wait for client to establish connection
await new Promise((resolve) => setTimeout(resolve, 1000));

interface MessagePart {
  text?: string;
  content?: string;
  [key: string]: any;
}

interface UserMessage {
  id: string;
  role: "user";
  parts: Array<string | MessagePart>;
}

interface StreamingState {
  hasInitialized: boolean;
  lastSeenMessageId: string | null;
  processedMessageIds: Set<string>; // Track completed messages
  messageQueue: UserMessage[];
  isStreamingActive: boolean;
  sessionId: string | null;
  currentProcessingMessage: UserMessage | null;
  messageQueueResolver: ((message: UserMessage | null) => void) | null;
}

const streamingState: StreamingState = {
  hasInitialized: false,
  lastSeenMessageId: null,
  processedMessageIds: new Set(),
  messageQueue: [],
  isStreamingActive: false,
  sessionId: null,
  currentProcessingMessage: null,
  messageQueueResolver: null,
};

/**
 * Async generator that yields user messages to Claude SDK
 */
async function* generateUserMessages() {
  log("info", "Generator started, waiting for messages");

  while (true) {
    const message = await new Promise<UserMessage | null>((resolve) => {
      if (streamingState.messageQueue.length > 0) {
        const nextMessage = streamingState.messageQueue.shift();
        log("info", "Generator: Message available in queue", {
          messageId: nextMessage?.id,
          queueSize: streamingState.messageQueue.length,
        });
        resolve(nextMessage || null);
      } else {
        log("info", "Generator: No messages, waiting...");
        streamingState.messageQueueResolver = resolve;
      }
    });

    if (!message) {
      log("warn", "Generator: Received null message, continuing");
      continue;
    }

    log("info", "Generator: Processing message", {
      messageId: message.id,
    });

    const userContent = message.parts
      ?.map((part: MessagePart | string) => {
        if (typeof part === "string") return part;
        return part.text || part.content || JSON.stringify(part);
      })
      .filter(Boolean)
      .join(" ");

    if (!userContent?.trim()) {
      log("warn", "Generator: Empty user content, skipping", {
        messageId: message.id,
      });
      continue;
    }

    if (!streamingState.currentProcessingMessage) {
      streamingState.currentProcessingMessage = message;
    }

    const messageToYield = {
      type: "user" as const,
      message: {
        role: "user" as const,
        content: userContent,
      },
      parent_tool_use_id: null,
      session_id: streamingState.sessionId || `site-${siteId}`,
      userMessageId: message.id, // Track which user message this is for
    };

    log("info", "Generator: Yielding message to Claude", {
      messageId: message.id,
      contentLength: userContent.length,
    });

    yield messageToYield;
  }
}

/**
 * Update assistant message in Convex
 */
async function updateAssistantMessage(
  messageId: string,
  parts: Array<TextBlock | ToolUseBlock>
) {
  try {
    await client.mutation(api.messages.upsertMessage, {
      id: messageId,
      role: "assistant",
      parts: parts,
      siteId: siteId,
    });
  } catch (error) {
    log("error", "Failed to update assistant message", {
      messageId,
      partCount: parts.length,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error; // Re-throw to allow caller to handle
  }
}

/**
 * Main streaming session processor
 */
async function processStreamingSession() {
  if (streamingState.isStreamingActive) return;

  streamingState.isStreamingActive = true;

  try {
    log("info", "Starting new streaming session");

    // TODO: Resume not working - session files don't persist across worker restarts
    // Disable for now until we figure out persistent session storage
    const resumeSessionId: string | null = null;

    const queryOptions: Options = {
      permissionMode: "bypassPermissions",
      maxTurns: 50,
      model: "claude-sonnet-4-5-20250929",
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
      },
      settingSources: [],
      includePartialMessages: true,
      stderr: (data: string) => {
        log("error", "Claude Code stderr:", { output: data });
      },
    };

    log("info", "Initializing Claude Agent SDK", {
      resuming: false,
      model: "claude-sonnet-4-5-20250929",
      permissionMode: "bypassPermissions",
      maxTurns: 50,
    });

    const claudeQuery = query({
      prompt: generateUserMessages(),
      options: queryOptions,
    });

    let currentAssistantMessageId: string | null = null;
    let currentMessageChunks: Array<TextBlock | ToolUseBlock> = [];
    let currentUserMessageId: string | null = null;

    for await (const message of claudeQuery) {
      if (message.type === "user") {
        // Tool results from Claude - continue building the same assistant message
        continue;
      }

      if (message.type === "stream_event") {
        if (message.event.type === "content_block_start") {
          if (!currentAssistantMessageId) {
            currentAssistantMessageId = crypto.randomUUID();
            streamingState.currentProcessingMessage = null;
            log("info", "Starting new assistant message", {
              messageId: currentAssistantMessageId.substring(0, 8) + "...",
            });
          }

          const block = message.event.content_block;

          if (block.type === "text") {
            currentMessageChunks.push({
              type: "text" as const,
              text: block.text || "",
              citations: [],
            });
          } else if (block.type === "tool_use") {
            currentMessageChunks.push({
              type: "tool_use" as const,
              id: block.id,
              name: block.name,
              input: "",
            });
            log("info", `Claude is using tool: ${block.name}`, {
              toolId: block.id,
            });
          }

          await updateAssistantMessage(
            currentAssistantMessageId,
            currentMessageChunks
          );
        } else if (message.event.type === "content_block_delta") {
          const lastChunk =
            currentMessageChunks[currentMessageChunks.length - 1];

          if (
            message.event.delta.type === "text_delta" &&
            lastChunk?.type === "text"
          ) {
            currentMessageChunks[currentMessageChunks.length - 1] = {
              ...lastChunk,
              text: lastChunk.text + message.event.delta.text,
            };
          } else if (
            message.event.delta.type === "input_json_delta" &&
            lastChunk?.type === "tool_use"
          ) {
            currentMessageChunks[currentMessageChunks.length - 1] = {
              ...lastChunk,
              input:
                (lastChunk.input as string) + message.event.delta.partial_json,
            };
          }

          if (currentAssistantMessageId) {
            await updateAssistantMessage(
              currentAssistantMessageId,
              currentMessageChunks
            );
          }
        } else if (message.event.type === "content_block_stop") {
          const lastChunk =
            currentMessageChunks[currentMessageChunks.length - 1];

          if (
            lastChunk?.type === "tool_use" &&
            typeof lastChunk.input === "string"
          ) {
            try {
              lastChunk.input = JSON.parse(lastChunk.input);
              log("info", `Tool input parsed for ${lastChunk.name}`);
            } catch (error) {
              log("error", "Failed to parse tool input JSON", {
                toolName: lastChunk.name,
                toolId: lastChunk.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          if (currentAssistantMessageId) {
            await updateAssistantMessage(
              currentAssistantMessageId,
              currentMessageChunks
            );
          }
        }
      } else if (message.type === "result") {
        if (currentAssistantMessageId && currentMessageChunks.length > 0) {
          await updateAssistantMessage(
            currentAssistantMessageId,
            currentMessageChunks
          );

          const textBlocks = currentMessageChunks.filter(
            (c) => c.type === "text"
          ).length;
          const toolBlocks = currentMessageChunks.filter(
            (c) => c.type === "tool_use"
          ).length;

          log("info", "Finalized assistant message", {
            messageId: currentAssistantMessageId.substring(0, 8) + "...",
            totalParts: currentMessageChunks.length,
            textBlocks,
            toolBlocks,
          });

          // Mark the user message as successfully processed
          if (streamingState.currentProcessingMessage) {
            streamingState.processedMessageIds.add(
              streamingState.currentProcessingMessage.id
            );
            log("info", "Marked user message as processed", {
              userMessageId: streamingState.currentProcessingMessage.id,
              totalProcessed: streamingState.processedMessageIds.size,
            });
          }

          currentAssistantMessageId = null;
          currentMessageChunks = [];
        }
      } else if (message.type === "system") {
        if (message.subtype === "init" && message.session_id) {
          streamingState.sessionId = message.session_id;

          try {
            await client.mutation(api.messages.updateSessionId, {
              siteId: siteId,
              sessionId: message.session_id,
            });
            log("info", "Saved Claude session ID to site", {
              sessionId: message.session_id.substring(0, 20) + "...",
            });
          } catch (error) {
            log("error", "Failed to update site with session ID", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    log("info", "Streaming session ended normally");
  } catch (error) {
    log("error", "Streaming session error", {
      errorName: error instanceof Error ? error.name : "Unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: (error as any)?.code,
      stack: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    streamingState.isStreamingActive = false;

    if (streamingState.messageQueue.length > 0) {
      log(
        "info",
        `Processing ${streamingState.messageQueue.length} queued message(s)`
      );
      processStreamingSession().catch((error) => {
        log("error", "Failed to restart streaming session", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }
}

/**
 * Process a new user message
 */
async function processUserMessage(userMessage: UserMessage | null) {
  if (!userMessage || !userMessage.parts || !Array.isArray(userMessage.parts)) {
    log("warn", "Skipping invalid user message", {
      hasMessage: !!userMessage,
      hasParts: !!userMessage?.parts,
      isArray: Array.isArray(userMessage?.parts),
    });
    return;
  }

  log("info", "Processing user message", {
    messageId: userMessage.id,
    partCount: userMessage.parts.length,
    isStreamingActive: streamingState.isStreamingActive,
    queueSize: streamingState.messageQueue.length,
  });

  // If already processing, queue this message
  if (streamingState.isStreamingActive) {
    streamingState.messageQueue.push(userMessage);
    log(
      "info",
      `Queued message (queue size: ${streamingState.messageQueue.length})`
    );

    // Wake up the generator if it's waiting
    if (streamingState.messageQueueResolver) {
      const resolver = streamingState.messageQueueResolver;
      streamingState.messageQueueResolver = null;
      resolver(userMessage);
    }
    return;
  }

  // Add to queue and start processing
  streamingState.messageQueue.push(userMessage);

  // Wake up any pending resolver
  if (streamingState.messageQueueResolver) {
    const resolver = streamingState.messageQueueResolver;
    streamingState.messageQueueResolver = null;
    resolver(userMessage);
  }

  // Start streaming session if not active
  if (!streamingState.isStreamingActive) {
    log("info", "Starting streaming session", {
      messageId: userMessage.id,
      queueSize: streamingState.messageQueue.length,
    });
    processStreamingSession().catch((error) => {
      log("error", "Failed to start streaming session", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

// Subscribe to messages from Convex
client.onUpdate(
  api.messages.getLatestUserMessage,
  { siteId },
  (userMessage) => {
    if (userMessage) {
      if (!streamingState.hasInitialized) {
        log("info", "First message received, initializing state", {
          messageId: userMessage.id,
        });
        streamingState.lastSeenMessageId = userMessage.id;
        streamingState.hasInitialized = true;

        // Process the first message immediately instead of marking it as processed
        processUserMessage(userMessage).catch((error) => {
          log("error", "Error processing first message (will retry)", {
            messageId: userMessage.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }

      // Skip if we've already processed this message
      if (streamingState.processedMessageIds.has(userMessage.id)) {
        return;
      }

      // Skip if this is the same message we're currently processing
      if (streamingState.lastSeenMessageId === userMessage.id) {
        return;
      }

      log("info", "New user message detected", {
        messageId: userMessage.id,
        role: userMessage.role,
      });

      // Mark as seen to prevent duplicate processing while it's in flight
      streamingState.lastSeenMessageId = userMessage.id;

      processUserMessage(userMessage).catch((error) => {
        log("error", "Error processing message (will retry)", {
          messageId: userMessage.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Reset lastSeenMessageId so it can be retried
        streamingState.lastSeenMessageId = null;
        // Don't mark as processed on error - allow retry on next update
      });
    } else {
      if (!streamingState.hasInitialized) {
        log("info", "No messages yet, initializing as empty");
        streamingState.hasInitialized = true;
      }
    }
  }
);

log("info", "Worker subscribed to messages", { siteId });
