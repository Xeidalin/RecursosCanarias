import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

function requireDeployKey(deployKey) {
  const expected = process.env.CONVEX_DEPLOY_KEY;
  if (!expected || deployKey !== expected) {
    throw new Error("No autorizado");
  }
}

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
    slug:      v.string(),
    name:      v.string(),
    intro:     v.string(),
    nature:    v.string(),
    culture:   v.string(),
    deployKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireDeployKey(args.deployKey);
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
