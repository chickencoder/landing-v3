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
    timestamp: v.optional(v.string()),
  },
  handler: async (ctx, { siteId, status, timestamp }) => {
    await ctx.db.patch(siteId, {
      status,
      ...(timestamp && { lastWebhookTimestamp: timestamp }),
    });
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

// Internal mutation to schedule a shutdown
export const scheduleShutdown = internalMutation({
  args: {
    siteId: v.id("sites"),
    scheduledId: v.id("_scheduled_functions"),
  },
  handler: async (ctx, { siteId, scheduledId }) => {
    await ctx.db.patch(siteId, {
      scheduledShutdownId: scheduledId,
    });
  },
});

// Internal mutation to cancel a scheduled shutdown
export const cancelScheduledShutdown = internalMutation({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site) {
      throw new Error(`Site ${siteId} not found`);
    }

    if (site.scheduledShutdownId) {
      await ctx.scheduler.cancel(site.scheduledShutdownId);
      await ctx.db.patch(siteId, {
        scheduledShutdownId: undefined,
      });
    }
  },
});

// Internal mutation to clear scheduled shutdown ID (after execution)
export const clearScheduledShutdown = internalMutation({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    await ctx.db.patch(siteId, {
      scheduledShutdownId: undefined,
    });
  },
});

// Mutation to update worker and dev server state (called by worker)
export const updateWorkerState = mutation({
  args: {
    siteId: v.id("sites"),
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
  },
  handler: async (ctx, { siteId, worker, devServer }) => {
    // Verify authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Verify the user owns this site
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error(`Site ${siteId} not found`);
    if (site.userId !== identity.subject) {
      throw new Error("Unauthorized: You do not own this site");
    }

    const updates: any = {};
    if (worker) updates.worker = worker;
    if (devServer) updates.devServer = devServer;

    await ctx.db.patch(siteId, updates);
  },
});

// Internal mutation to update worker state (called by webhooks/actions)
export const updateWorkerStateInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
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
  },
  handler: async (ctx, { siteId, worker, devServer }) => {
    const updates: any = {};
    if (worker) updates.worker = worker;
    if (devServer) updates.devServer = devServer;

    await ctx.db.patch(siteId, updates);
  },
});
