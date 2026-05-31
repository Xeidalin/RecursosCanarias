import { query } from "./_generated/server";
import { v } from "convex/values";

// Búsqueda unificada: recursos + blog posts.
// Devuelve resultados combinados ordenados por relevancia (search index order).
export const unifiedSearch = query({
  args: {
    q:     v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { q, limit }) => {
    const max = Math.min(limit ?? 20, 50);
    const term = q.trim();
    if (!term) return { results: [] };

    // Buscar recursos por título
    const resourceDocs = await ctx.db
      .query("resources")
      .withSearchIndex("search_resources_title", (b) =>
        b.search("title", term)
      )
      .take(max);

    // Buscar blog posts por título
    const blogDocs = await ctx.db
      .query("blogPosts")
      .withSearchIndex("search_posts_title", (b) =>
        b.search("title", term)
      )
      .take(max);

    // Combinar y ordenar por relevancia (intercalado simple)
    const results = [];
    const rSeen = new Set();
    const bSeen = new Set();

    let ri = 0, bi = 0;
    while (results.length < max && (ri < resourceDocs.length || bi < blogDocs.length)) {
      if (ri < resourceDocs.length) {
        const r = resourceDocs[ri++];
        if (!rSeen.has(r._id)) {
          rSeen.add(r._id);
          results.push({
            type: "resource",
            id: r._id,
            title: r.title,
            slug: r.slug,
            kind: r.kind,
            description: r.description?.slice(0, 160) || "",
            imageUrl: r.imageUrl || "",
          });
        }
      }
      if (bi < blogDocs.length && results.length < max) {
        const b = blogDocs[bi++];
        if (!bSeen.has(b._id)) {
          bSeen.add(b._id);
          results.push({
            type: "post",
            id: b._id,
            title: b.title,
            slug: b.slug,
            category: b.category,
            description: b.excerpt?.slice(0, 160) || "",
            imageUrl: b.coverImage || "",
          });
        }
      }
    }

    return { results };
  },
});
