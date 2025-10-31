import { mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const HEARTBEAT_TIMEOUT_MS = 30000; // 30 seconds
const SHUTDOWN_DELAY_MS = 30000; // 30 seconds

/**
 * Heartbeat mutation - called by client every 10s to maintain presence
 * Also handles entry logic: resume stopped sandbox, cancel pending shutdown
 */
export const heartbeat = mutation({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const userId = identity.subject;
    const now = Date.now();

    // Upsert user's heartbeat timestamp
    const existing = await ctx.db
      .query("activeUsers")
      .withIndex("by_siteId_and_userId", (q) =>
        q.eq("siteId", siteId).eq("userId", userId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastHeartbeat: now });
    } else {
      await ctx.db.insert("activeUsers", {
        userId,
        siteId,
        lastHeartbeat: now,
      });
    }

    // Get site to check status and scheduled shutdown
    const site = await ctx.db.get(siteId);
    if (!site) {
      console.error("[presence:heartbeat] Site not found", { siteId });
      return;
    }

    // Entry logic: Cancel pending shutdown if exists
    if (site.scheduledShutdownId) {
      console.log("[presence:heartbeat] User entered, canceling scheduled shutdown", {
        siteId,
        userId,
      });
      await ctx.scheduler.runAfter(0, internal.sites.cancelScheduledShutdown, {
        siteId,
      });
    }

    // Entry logic: Resume sandbox if stopped
    if (site.status === "stopped") {
      console.log("[presence:heartbeat] User entered, resuming stopped sandbox", {
        siteId,
        userId,
      });
      await ctx.scheduler.runAfter(0, internal.sandbox.resumeSandbox, {
        siteId,
      });
    }

    // Schedule presence check (for exit detection)
    await ctx.scheduler.runAfter(0, internal.presence.checkSitePresence, {
      siteId,
    });
  },
});

/**
 * Leave mutation - called when user explicitly leaves (component unmount)
 */
export const leave = mutation({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const userId = identity.subject;

    // Remove user from activeUsers
    const existing = await ctx.db
      .query("activeUsers")
      .withIndex("by_siteId_and_userId", (q) =>
        q.eq("siteId", siteId).eq("userId", userId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      console.log("[presence:leave] User left", { siteId, userId });
    }

    // Schedule presence check to detect if all users are gone
    await ctx.scheduler.runAfter(0, internal.presence.checkSitePresence, {
      siteId,
    });
  },
});

/**
 * Internal mutation to check site presence and manage sandbox lifecycle
 */
export const checkSitePresence = internalMutation({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    const now = Date.now();
    const staleThreshold = now - HEARTBEAT_TIMEOUT_MS;

    // Get all users for this site
    const allUsers = await ctx.db
      .query("activeUsers")
      .withIndex("by_siteId", (q) => q.eq("siteId", siteId))
      .collect();

    // Filter out stale users and delete them
    const activeUsers = [];
    for (const user of allUsers) {
      if (user.lastHeartbeat < staleThreshold) {
        await ctx.db.delete(user._id);
        console.log("[presence:check] Removed stale user", {
          siteId,
          userId: user.userId,
          lastHeartbeat: user.lastHeartbeat,
        });
      } else {
        activeUsers.push(user);
      }
    }

    const activeCount = activeUsers.length;
    console.log("[presence:check] Active users count", { siteId, activeCount });

    // Get site record
    const site = await ctx.db.get(siteId);
    if (!site) {
      console.error("[presence:check] Site not found", { siteId });
      return;
    }

    // If no active users and no shutdown scheduled, schedule one
    if (activeCount === 0 && !site.scheduledShutdownId) {
      console.log("[presence:check] No users active, scheduling shutdown", {
        siteId,
        delay: `${SHUTDOWN_DELAY_MS / 1000}s`,
      });

      const scheduledId = await ctx.scheduler.runAfter(
        SHUTDOWN_DELAY_MS,
        internal.sandbox.stopSandbox,
        { siteId }
      );

      await ctx.db.patch(siteId, {
        scheduledShutdownId: scheduledId,
      });
    }
    // If users are active and shutdown is scheduled, cancel it
    else if (activeCount > 0 && site.scheduledShutdownId) {
      console.log("[presence:check] Users active, canceling scheduled shutdown", {
        siteId,
        activeCount,
      });

      await ctx.scheduler.runAfter(0, internal.sites.cancelScheduledShutdown, {
        siteId,
      });
    }
  },
});

/**
 * Cron job to clean up stale activeUsers entries globally
 * Runs every minute
 */
export const cleanupStaleUsers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const staleThreshold = now - HEARTBEAT_TIMEOUT_MS;

    const allUsers = await ctx.db.query("activeUsers").collect();
    let cleaned = 0;

    for (const user of allUsers) {
      if (user.lastHeartbeat < staleThreshold) {
        await ctx.db.delete(user._id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log("[presence:cleanup] Cleaned stale users", { count: cleaned });
    }
  },
});
