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
    userId: v.string(),
    orgId: v.string(),
    sessionId: v.optional(v.string()), // Claude Agent SDK session ID (UUID)
    daytonaSessionId: v.optional(v.string()), // Daytona process session ID
    commandId: v.optional(v.string()),
    sandboxId: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("creating"),
        v.literal("ready"),
        v.literal("error")
      )
    ),
  }),

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
});
