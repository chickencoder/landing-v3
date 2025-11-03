import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get all messages for a site
 */
export const getMessagesBySite = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, { slug }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Look up site by slug
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();

    if (!site) throw new Error(`Site not found: ${slug}`);

    // Verify user owns this site
    if (site.userId !== identity.subject) {
      throw new Error("Unauthorized: You do not own this site");
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_siteId", (q) => q.eq("siteId", site._id))
      .collect();

    return messages;
  },
});

/**
 * Get the latest user message for a site
 */
export const getLatestUserMessage = query({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    const message = await ctx.db
      .query("messages")
      .withIndex("by_siteId", (q) => q.eq("siteId", siteId))
      .filter((q) => q.eq(q.field("role"), "user"))
      .order("desc")
      .first();

    return message;
  },
});

/**
 * Upsert a message (create or update)
 */
export const upsertMessage = mutation({
  args: {
    id: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    parts: v.array(v.any()),
    slug: v.string(),
  },
  handler: async (ctx, { id, role, parts, slug }) => {
    // Get user identity from Clerk JWT
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("Unauthenticated: No valid session found");
    }

    // Look up site by slug
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();

    if (!site) {
      throw new Error(`Site not found: ${slug}`);
    }

    // Security: Verify the authenticated user owns this site
    if (site.userId !== identity.subject) {
      throw new Error(
        `Unauthorized: User ${identity.subject} does not own site ${slug}`
      );
    }

    const userId = site.userId;
    const orgId = site.orgId;
    const siteId = site._id;

    // Check if message already exists
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_message_id", (q) => q.eq("id", id))
      .first();

    if (existing) {
      // Update existing message
      await ctx.db.patch(existing._id, {
        parts,
      });
      return existing._id;
    } else {
      // Create new message
      const messageId = await ctx.db.insert("messages", {
        id,
        role,
        parts,
        siteId,
        userId,
        orgId,
      });
      return messageId;
    }
  },
});

/**
 * Update the session ID for a site
 */
export const updateSessionId = mutation({
  args: {
    siteId: v.id("sites"),
    sessionId: v.string(),
  },
  handler: async (ctx, { siteId, sessionId }) => {
    await ctx.db.patch(siteId, {
      sessionId,
    });
  },
});

/**
 * Get session ID for a site
 */
export const getSessionId = query({
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    return site?.sessionId || null;
  },
});

/**
 * Internal mutation to insert a message (used by actions, no auth required)
 */
export const insertMessage = internalMutation({
  args: {
    id: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    parts: v.array(v.any()),
    siteId: v.id("sites"),
    userId: v.string(),
    orgId: v.string(),
  },
  handler: async (ctx, { id, role, parts, siteId, userId, orgId }) => {
    // Check if message already exists
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_message_id", (q) => q.eq("id", id))
      .first();

    if (existing) {
      // Update existing message
      await ctx.db.patch(existing._id, {
        parts,
      });
      return existing._id;
    } else {
      // Create new message
      const messageId = await ctx.db.insert("messages", {
        id,
        role,
        parts,
        siteId,
        userId,
        orgId,
      });
      return messageId;
    }
  },
});
