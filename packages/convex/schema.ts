import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    userId: v.string(), // Clerk user ID
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    primaryOrgId: v.optional(v.string()),
  }).index("by_userId", ["userId"]),

  organizations: defineTable({
    orgId: v.string(),
    name: v.string(),
    slug: v.string(),
    createdBy: v.string(), // Clerk user ID
    imageUrl: v.optional(v.string()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_slug", ["slug"]),

  sites: defineTable({
    slug: v.string(), // Human-friendly URL slug (e.g., "happy-cloud-789")
    userId: v.string(),
    orgId: v.string(),
    sessionId: v.optional(v.string()), // Claude Agent SDK session ID (UUID)
    sandboxId: v.optional(v.string()), // Daytona sandbox ID
    previewUrl: v.optional(v.string()), // Daytona preview URL for the dev server
    status: v.optional(
      v.union(
        v.literal("creating"), // Initial setup before Daytona sandbox is created
        v.literal("started"), // Sandbox is running (replaces "ready")
        v.literal("stopped"), // Sandbox has been stopped
        v.literal("error"), // Error during creation or runtime
        v.literal("deleted") // Sandbox has been deleted
      )
    ),
    lastWebhookTimestamp: v.optional(v.string()), // ISO timestamp of last processed webhook
    scheduledShutdownId: v.optional(v.id("_scheduled_functions")), // ID of scheduled shutdown to enable cancellation
    worker: v.optional(
      v.object({
        lastHeartbeat: v.number(),
        isStreaming: v.boolean(),
      })
    ),
    devServer: v.optional(
      v.object({
        isRunning: v.boolean(),
        lastChecked: v.number(),
      })
    ),
  }).index("by_slug", ["slug"]),

  messages: defineTable({
    id: v.string(),
    role: v.union(
      v.literal("system"),
      v.literal("user"),
      v.literal("assistant"),
    ),
    parts: v.array(v.any()),
    metadata: v.optional(v.any()),
    userId: v.string(),
    orgId: v.string(),
    siteId: v.id("sites"),
  })
    .index("by_siteId", ["siteId"])
    .index("by_message_id", ["id"]),

  presence: defineTable({
    userId: v.string(), // Clerk user ID
    siteId: v.id("sites"), // Which site they're active on
    lastHeartbeat: v.number(), // Date.now() timestamp
  })
    .index("by_siteId", ["siteId"])
    .index("by_siteId_and_userId", ["siteId", "userId"]),
});
