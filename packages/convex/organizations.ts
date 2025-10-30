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

export const getOrganization = query({
  args: {
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("organizations")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .first();
  },
});

export const getUserOrganizations = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // For now, return organizations created by the user
    // TODO: When we add organizationMemberships table, query that instead
    return await ctx.db
      .query("organizations")
      .filter((q) => q.eq(q.field("createdBy"), args.userId))
      .collect();
  },
});

export const getOrganizationBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});
