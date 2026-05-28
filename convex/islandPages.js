import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query("islandPages")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("islandPages").collect();
  },
});

export const upsert = mutation({
  args: {
    slug:    v.string(),
    name:    v.string(),
    intro:   v.string(),
    nature:  v.string(),
    culture: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("islandPages")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        name:    args.name,
        intro:   args.intro,
        nature:  args.nature,
        culture: args.culture,
      });
      return existing._id;
    }
    return await ctx.db.insert("islandPages", args);
  },
});
