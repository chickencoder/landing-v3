import { ConvexClient } from "convex/browser";
import { api } from "@repo/convex/_generated/api";
import type { Id } from "@repo/convex/_generated/dataModel";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type {
  TextBlock,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";

const customPrompt = `
  You are a website and landing page building agent called "Landing". Your website is https://www.landing.so.

  Your task is answer user requests to build, design and update the user's website and landing pages.

  All websites are Next.js 16 projects with TailwindCSS, shadcn-ui and a custom registry of shadcn components under the namespace @landing.

  This custom registry is our secret sauce and must be used when creating new pages. Using the registry results in high quality results.

  Use the shadcn MCP to list out the available landing page blocks. Only use blocks from the @landing namespace to build the page.
  Once you have selected the blocks you want to use, install them and read them to understand how they are structured.

  Implement a shared navbar and footer in the layout file.

  You are currently in the next.js project directory. Work from here. The user can see a live preview of the site on the right hand side.

  ## Process Management

  The dev server and this worker process are both managed by supervisord and will auto-restart if they crash.

  **Dev server**: Running on port 3000 (managed by supervisord as "dev-server")
  **Worker**: This process you're running in (managed by supervisord as "worker")

  ### Managing the dev server:
  - Check status: \`supervisorctl status dev-server\`
  - Restart: \`supervisorctl restart dev-server\`
  - View logs: \`tail -f /home/landing/project/dev.log\`
  - Read full logs: \`cat /home/landing/project/dev.log\`

  ### If the dev server isn't responding or you need to see what's happening:
  1. Check logs first: \`cat /home/landing/project/dev.log\`
  2. Check process status: \`supervisorctl status dev-server\`
  3. Restart if needed: \`supervisorctl restart dev-server\`

  Do NOT try to manually run \`npm run dev\` - supervisord is already managing this process.
`;

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

// Check if dev server is accepting connections on port 3000
async function checkDevServer(): Promise<boolean> {
  try {
    const { createConnection } = await import("net");

    return new Promise<boolean>((resolve) => {
      const socket = createConnection({ port: 3000, host: "localhost" }, () => {
        socket.end();
        resolve(true);
      });

      socket.on("error", () => {
        resolve(false);
      });

      // Timeout after 2 seconds
      socket.setTimeout(2000, () => {
        socket.destroy();
        resolve(false);
      });
    });
  } catch (error) {
    log("warn", "Failed to check dev server status", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
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

// Wait for client to establish connection by attempting a simple query
log("info", "Waiting for Convex client connection...");
let connectionAttempts = 0;
const maxAttempts = 10;
while (connectionAttempts < maxAttempts) {
  try {
    await client.query(api.messages.getMessagesBySiteId, { siteId });
    log("info", "Convex client connected successfully");
    break;
  } catch (error) {
    connectionAttempts++;
    if (connectionAttempts >= maxAttempts) {
      log("error", "Failed to connect to Convex after max attempts", {
        attempts: connectionAttempts,
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
    log("info", `Convex connection attempt ${connectionAttempts} failed, retrying...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Start worker heartbeat
const HEARTBEAT_INTERVAL_MS = 10000; // 10 seconds
const heartbeatInterval = setInterval(async () => {
  try {
    const isDevServerRunning = await checkDevServer();
    const now = Date.now();

    await client.mutation(api.sites.updateWorkerState, {
      siteId,
      worker: {
        lastHeartbeat: now,
        isStreaming: streamingState.isActivelyStreaming,
      },
      devServer: {
        isRunning: isDevServerRunning,
        lastChecked: now,
      },
    });

    log("info", "Worker heartbeat sent", {
      isStreaming: streamingState.isActivelyStreaming,
      devServerRunning: isDevServerRunning,
    });
  } catch (error) {
    log("error", "Failed to send worker heartbeat", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}, HEARTBEAT_INTERVAL_MS);

// Send initial heartbeat immediately
(async () => {
  try {
    const isDevServerRunning = await checkDevServer();
    const now = Date.now();

    await client.mutation(api.sites.updateWorkerState, {
      siteId,
      worker: {
        lastHeartbeat: now,
        isStreaming: false,
      },
      devServer: {
        isRunning: isDevServerRunning,
        lastChecked: now,
      },
    });

    log("info", "Initial worker heartbeat sent", {
      devServerRunning: isDevServerRunning,
    });
  } catch (error) {
    log("error", "Failed to send initial heartbeat", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
})();

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
  isActivelyStreaming: boolean; // True when Claude is actively responding to a message
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
  isActivelyStreaming: false,
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
  parts: Array<TextBlock | ToolUseBlock>,
) {
  try {
    await client.mutation(api.messages.upsertMessage, {
      id: messageId,
      role: "assistant",
      parts: parts,
      siteId,
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
    log("info", "Starting streaming session");

    // Check if we can resume an existing session from environment variable
    let resumeSessionId: string | null = null;
    if (process.env.SESSION_ID) {
      try {
        const existingMessages = await client.query(
          api.messages.getMessagesBySiteId,
          { siteId }
        );

        if (existingMessages.length > 0) {
          resumeSessionId = process.env.SESSION_ID;
          log("info", "Found existing session to resume from environment", {
            sessionId: resumeSessionId.substring(0, 20) + "...",
            messageCount: existingMessages.length,
          });
        } else {
          log("info", "Session ID provided but no messages found, starting fresh");
        }
      } catch (error) {
        log("warn", "Could not fetch previous messages, starting fresh session", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      log("info", "No previous session ID, starting fresh");
    }

    const queryOptions: Options = {
      permissionMode: "bypassPermissions",
      maxTurns: 50,
      model: "claude-sonnet-4-5-20250929",
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: customPrompt,
      },
      mcpServers: {
        shadcn: {
          command: "npx",
          args: ["shadcn@latest", "mcp"],
        },
      },
      allowedTools: [
        "mcp__shadcn__get_project_registries",
        "mcp__shadcn__list_items_in_registries",
        "mcp__shadcn__search_items_in_registries",
        "mcp__shadcn__view_items_in_registries",
        "mcp__shadcn__get_item_examples_from_registries",
        "mcp__shadcn__get_add_command_for_items",
        "mcp__shadcn__get_audit_checklist",
      ],
      settingSources: ["project", "user"],
      includePartialMessages: true,
      stderr: (data: string) => {
        log("error", "Claude Code stderr:", { output: data });
      },
      ...(resumeSessionId && { resume: resumeSessionId }),
    };

    if (resumeSessionId) {
      streamingState.sessionId = resumeSessionId;
    }

    log("info", "Initializing Claude Agent SDK", {
      resuming: !!resumeSessionId,
      sessionId: resumeSessionId ? resumeSessionId.substring(0, 20) + "..." : "new",
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
            streamingState.isActivelyStreaming = true;
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
            currentMessageChunks,
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
              currentMessageChunks,
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
              currentMessageChunks,
            );
          }
        }
      } else if (message.type === "result") {
        if (currentAssistantMessageId && currentMessageChunks.length > 0) {
          await updateAssistantMessage(
            currentAssistantMessageId,
            currentMessageChunks,
          );

          const textBlocks = currentMessageChunks.filter(
            (c) => c.type === "text",
          ).length;
          const toolBlocks = currentMessageChunks.filter(
            (c) => c.type === "tool_use",
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
              streamingState.currentProcessingMessage.id,
            );
            log("info", "Marked user message as processed", {
              userMessageId: streamingState.currentProcessingMessage.id,
              totalProcessed: streamingState.processedMessageIds.size,
            });
          }

          currentAssistantMessageId = null;
          currentMessageChunks = [];
          streamingState.isActivelyStreaming = false;

          log("info", "Reset streaming flag to false");
        }
      } else if (message.type === "system") {
        if (message.subtype === "init" && message.session_id) {
          streamingState.sessionId = message.session_id;

          try {
            await client.mutation(api.messages.updateSessionId, {
              siteId,
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
        `Processing ${streamingState.messageQueue.length} queued message(s)`,
      );
      processStreamingSession().catch((error) => {
        log("error", "Failed to restart streaming session", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    } else {
      log("info", "Streaming session completed, worker now idle", {
        isStreamingActive: streamingState.isStreamingActive,
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
      `Queued message (queue size: ${streamingState.messageQueue.length})`,
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

/**
 * Check if a user message has been processed by looking for an assistant message after it
 */
async function isMessageProcessed(userMessageId: string): Promise<boolean> {
  try {
    const allMessages = await client.query(api.messages.getMessagesBySiteId, {
      siteId,
    });

    const userMsgIndex = allMessages.findIndex((m) => m.id === userMessageId);
    if (userMsgIndex === -1) return false;

    // Check if there's an assistant message after this user message
    for (let i = userMsgIndex + 1; i < allMessages.length; i++) {
      if (allMessages[i].role === "assistant") {
        return true;
      }
    }

    return false;
  } catch (error) {
    log("error", "Failed to check if message is processed", {
      userMessageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// Subscribe to messages from Convex
client.onUpdate(
  api.messages.getLatestUserMessage,
  { siteId },
  async (userMessage) => {
    if (userMessage) {
      if (!streamingState.hasInitialized) {
        log("info", "First message received, initializing state", {
          messageId: userMessage.id,
        });
        streamingState.lastSeenMessageId = userMessage.id;
        streamingState.hasInitialized = true;

        // Check if already processed
        const alreadyProcessed = await isMessageProcessed(userMessage.id);
        if (alreadyProcessed) {
          log("info", "First message already processed, skipping", {
            messageId: userMessage.id,
          });
          return;
        }

        // Process the first message immediately
        processUserMessage(userMessage).catch((error) => {
          log("error", "Error processing first message (will retry)", {
            messageId: userMessage.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }

      // Skip if we've already processed this message (in-memory check)
      if (streamingState.processedMessageIds.has(userMessage.id)) {
        return;
      }

      // Skip if this is the same message we're currently processing
      if (streamingState.lastSeenMessageId === userMessage.id) {
        return;
      }

      // Check database to see if this message has been processed
      const alreadyProcessed = await isMessageProcessed(userMessage.id);
      if (alreadyProcessed) {
        log("info", "Message already processed, skipping", {
          messageId: userMessage.id,
        });
        streamingState.processedMessageIds.add(userMessage.id);
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
  },
);

log("info", "Worker subscribed to messages", { siteId });
