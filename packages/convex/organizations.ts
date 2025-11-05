import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

export const syncOrganization = internalMutation({
  args: {
    orgId: v.string(),
    name: v.string(),
    slug: v.string(),
    createdBy: v.string(),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        slug: args.slug,
        imageUrl: args.imageUrl,
      });
      return existing._id;
    } else {
      const orgId = await ctx.db.insert("organizations", {
        orgId: args.orgId,
        name: args.name,
        slug: args.slug,
        createdBy: args.createdBy,
        imageUrl: args.imageUrl,
      });
      return orgId;
    }
  },
});

export const deleteOrganization = internalMutation({
  args: {
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .first();

    if (org) {
      await ctx.db.delete(org._id);
    }
  },
});

export const getUserOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const userId = identity.subject;

    // For now, return organizations created by the user
    // TODO: When we add organizationMemberships table, query that instead
    return await ctx.db
      .query("organizations")
      .filter((q) => q.eq(q.field("createdBy"), userId))
      .collect();
  },
});
