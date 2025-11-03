import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { generateSlug } from "./lib/slugGenerator";

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

    // Generate a unique slug with collision detection
    let slug: string;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      slug = generateSlug();
      const existing = await ctx.db
        .query("sites")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();

      if (!existing) {
        break; // Slug is unique
      }

      attempts++;
    }

    if (attempts === maxAttempts) {
      throw new Error("Failed to generate unique slug after 10 attempts");
    }

    // Create site record
    const siteId = await ctx.db.insert("sites", {
      slug: slug!,
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

    return { siteId, slug: slug! };
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
    // Check if this update is older than the last processed webhook
    if (timestamp) {
      const site = await ctx.db.get(siteId);
      if (site?.lastWebhookTimestamp) {
        const incomingTime = new Date(timestamp).getTime();
        const lastProcessedTime = new Date(site.lastWebhookTimestamp).getTime();

        if (incomingTime <= lastProcessedTime) {
          console.log("[updateSiteStatus] Ignoring out-of-order webhook:", {
            siteId,
            incomingTimestamp: timestamp,
            lastProcessedTimestamp: site.lastWebhookTimestamp,
          });
          return; // Don't update if this webhook is older
        }
      }
    }

    await ctx.db.patch(siteId, {
      status,
      ...(timestamp && { lastWebhookTimestamp: timestamp }),
    });
  },
});


// Query to get site with status
export const getSite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    return await ctx.db.get(siteId);
  },
});

// Query to get site by slug
export const getSiteBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
  },
});

// Public query to get sandboxId from site slug (no auth required for proxy)
export const getSandboxIdBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();

    if (!site) {
      return null;
    }

    return {
      sandboxId: site.sandboxId,
      status: site.status,
    };
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

    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");

    // Verify the user owns this site
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
