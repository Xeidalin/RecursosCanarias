import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const CATEGORY_VALUES = v.union(
  v.literal("articulo"),
  v.literal("recurso-destacado"),
  v.literal("novedad"),
  v.literal("noticia-consejeria"),
);

function toApi(doc) {
  return {
    id:             doc._id,
    title:          doc.title,
    slug:           doc.slug,
    category:       doc.category,
    excerpt:        doc.excerpt,
    body:           doc.body ?? "",
    coverImage:     doc.coverImage,
    islands:        doc.islands,
    readingMinutes: doc.readingMinutes,
    externalUrl:    doc.externalUrl ?? "",
    featured:       doc.featured,
    publishedAt:    doc.publishedAt,
    views:          doc.views,
  };
}

// Calcula minutos de lectura desde el cuerpo en markdown (≥1).
function computeReadingMinutes(body) {
  const words = String(body || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// ─── Queries públicas ───────────────────────────────────────────────────────

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

export const getById = query({
  args: { id: v.id("blogPosts") },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    return doc ? toApi(doc) : null;
  },
});

// ─── Admin listing con cursor + búsqueda ────────────────────────────────────

function encodeCursor(doc) {
  const json = JSON.stringify({ ct: doc._creationTime, id: doc._id });
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export const listAdmin = query({
  args: {
    q:        v.optional(v.string()),
    category: v.optional(CATEGORY_VALUES),
    cursor:   v.optional(v.string()),
    limit:    v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit     = Math.min(Math.max(1, args.limit ?? 20), 100);
    const hasSearch = Boolean(args.q?.trim());
    const parsed    = hasSearch ? null : decodeCursor(args.cursor ?? null);

    let docs;
    if (hasSearch) {
      docs = await ctx.db
        .query("blogPosts")
        .withSearchIndex("search_posts_title", (b) => {
          let q = b.search("title", args.q);
          if (args.category) q = q.eq("category", args.category);
          return q;
        })
        .collect();
    } else {
      docs = await ctx.db.query("blogPosts").order("desc").collect();
      if (args.category) docs = docs.filter((d) => d.category === args.category);
    }

    if (!hasSearch) {
      docs.sort((a, b) =>
        b._creationTime !== a._creationTime
          ? b._creationTime - a._creationTime
          : a._id < b._id ? -1 : 1
      );
    }
    const total = docs.length;

    if (parsed) {
      const idx = docs.findIndex(
        (d) => d._creationTime < parsed.ct ||
              (d._creationTime === parsed.ct && d._id > parsed.id)
      );
      docs = idx === -1 ? [] : docs.slice(idx);
    }

    const page       = docs.slice(0, limit);
    const nextCursor = (!hasSearch && docs.length > limit)
      ? encodeCursor(page[page.length - 1])
      : null;

    return { items: page.map(toApi), nextCursor, total };
  },
});

// ─── Mutations admin ────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    title:       v.string(),
    slug:        v.string(),
    category:    CATEGORY_VALUES,
    excerpt:     v.string(),
    body:        v.optional(v.string()),
    coverImage:  v.optional(v.string()),
    islands:     v.array(v.string()),
    externalUrl: v.optional(v.string()),
    featured:    v.optional(v.boolean()),
    publishedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = args.slug.trim();
    const dup  = await ctx.db
      .query("blogPosts")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (dup) throw new Error(`Ya existe un post con el slug '${slug}'`);

    const body            = args.body ?? "";
    const readingMinutes  = computeReadingMinutes(body);
    const externalUrlNorm = (args.externalUrl ?? "").trim();

    const insert = {
      title:          args.title.trim(),
      slug,
      category:       args.category,
      excerpt:        args.excerpt.trim(),
      body,
      coverImage:     (args.coverImage ?? "").trim(),
      islands:        args.islands,
      readingMinutes,
      featured:       args.featured ?? false,
      publishedAt:    (args.publishedAt ?? new Date().toISOString()),
      views:          0,
    };
    if (externalUrlNorm) insert.externalUrl = externalUrlNorm;

    const id  = await ctx.db.insert("blogPosts", insert);
    const doc = await ctx.db.get(id);
    return toApi(doc);
  },
});

export const update = mutation({
  args: {
    id:          v.id("blogPosts"),
    title:       v.optional(v.string()),
    slug:        v.optional(v.string()),
    category:    v.optional(CATEGORY_VALUES),
    excerpt:     v.optional(v.string()),
    body:        v.optional(v.string()),
    coverImage:  v.optional(v.string()),
    islands:     v.optional(v.array(v.string())),
    externalUrl: v.optional(v.string()),
    featured:    v.optional(v.boolean()),
    publishedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    const current = await ctx.db.get(id);
    if (!current) throw new Error("Post no encontrado");

    if (rest.slug !== undefined && rest.slug.trim() !== current.slug) {
      const newSlug = rest.slug.trim();
      const dup = await ctx.db
        .query("blogPosts")
        .withIndex("by_slug", (q) => q.eq("slug", newSlug))
        .unique();
      if (dup && dup._id !== id) throw new Error(`Ya existe un post con el slug '${newSlug}'`);
      rest.slug = newSlug;
    }

    for (const k of ["title", "excerpt", "coverImage", "externalUrl", "publishedAt"]) {
      if (typeof rest[k] === "string") rest[k] = rest[k].trim();
    }

    if (rest.body !== undefined) {
      rest.readingMinutes = computeReadingMinutes(rest.body);
    }

    await ctx.db.patch(id, rest);
    const doc = await ctx.db.get(id);
    return toApi(doc);
  },
});

export const remove = mutation({
  args: { id: v.id("blogPosts") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return { deleted: id };
  },
});
