import { query } from "./_generated/server";
import { v } from "convex/values";

function toApi(doc) {
  return {
    id:             doc._id,
    title:          doc.title,
    slug:           doc.slug,
    category:       doc.category,
    excerpt:        doc.excerpt,
    coverImage:     doc.coverImage,
    islands:        doc.islands,
    readingMinutes: doc.readingMinutes,
    externalUrl:    doc.externalUrl ?? "",
    featured:       doc.featured,
    publishedAt:    doc.publishedAt,
    views:          doc.views,
  };
}

export const list = query({
  args: {
    limit:    v.optional(v.number()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, { limit = 20, category }) => {
    const docs = await ctx.db
      .query("blogPosts")
      .withIndex("by_published")
      .order("desc")
      .collect();
    const filtered = category ? docs.filter((d) => d.category === category) : docs;
    return filtered.slice(0, limit).map(toApi);
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const doc = await ctx.db
      .query("blogPosts")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    return doc ? toApi(doc) : null;
  },
});
