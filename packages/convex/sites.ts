import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const create = mutation({
  args: {
    message: v.optional(v.string()),
  },
  handler: async (ctx, { message }) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const userId = identity.subject; // Clerk user ID
    const orgId = identity.org_id; // Clerk org ID from active organization

    if (!orgId) {
      throw new Error(
        "No active organization. Please select an organization first.",
      );
    }

    // Create site record
    const siteId = await ctx.db.insert("sites", {
      userId,
      orgId: orgId as string,
    });

    // If message is provided, insert it and schedule the sandbox action
    if (message) {
      // Insert user message
      await ctx.db.insert("messages", {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: message }],
        siteId,
        userId,
        orgId: orgId as string,
      });

      // Schedule the sandbox action to run immediately
      await ctx.scheduler.runAfter(0, internal.sandbox.startSandbox, {
        siteId,
      });
    }

    return { siteId };
  },
});

// Internal query to get site by ID (used by action)
export const getSiteById = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    return await ctx.db.get(siteId);
  },
});

// Internal query to find site by sandbox ID (used by webhooks)
export const getSiteBySandboxId = internalQuery({
  args: { sandboxId: v.string() },
  handler: async (ctx, { sandboxId }) => {
    return await ctx.db
      .query("sites")
      .filter((q) => q.eq(q.field("sandboxId"), sandboxId))
      .first();
  },
});

// Internal mutation to update sandboxId (used by action)
// Also clears session ID since new sandbox = new environment
export const updateSandboxId = internalMutation({
  args: {
    siteId: v.id("sites"),
    sandboxId: v.string(),
  },
  handler: async (ctx, { siteId, sandboxId }) => {
    await ctx.db.patch(siteId, {
      sandboxId,
      sessionId: undefined, // Clear old session - new sandbox means no session files
    });
  },
});

// Internal mutation to update site status (used by action and webhooks)
export const updateSiteStatus = internalMutation({
  args: {
    siteId: v.id("sites"),
    status: v.union(
      v.literal("creating"),
      v.literal("started"),
      v.literal("stopped"),
      v.literal("error"),
      v.literal("deleted"),
    ),
  },
  handler: async (ctx, { siteId, status }) => {
    await ctx.db.patch(siteId, { status });
  },
});

// Internal mutation to update preview URL (used by action)
export const updatePreviewUrl = internalMutation({
  args: {
    siteId: v.id("sites"),
    previewUrl: v.string(),
  },
  handler: async (ctx, { siteId, previewUrl }) => {
    await ctx.db.patch(siteId, { previewUrl });
  },
});

// Query to get site with status
export const getSite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    return await ctx.db.get(siteId);
  },
});
