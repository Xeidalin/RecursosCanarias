import { query, mutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
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

function isValidExternalUrl(url) {
  if (!url) return true;
  try {
    const p = new URL(url);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch { return false; }
}

function requireDeployKey(deployKey) {
  const expected = process.env.CONVEX_DEPLOY_KEY;
  if (!expected || deployKey !== expected) {
    throw new Error("No autorizado");
  }
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

export const listAdmin = query({
  args: {
    paginationOpts: paginationOptsValidator,
    q:              v.optional(v.string()),
    category:       v.optional(CATEGORY_VALUES),
  },
  handler: async (ctx, args) => {
    const hasSearch = Boolean(args.q?.trim());

    if (hasSearch) {
      const docs = await ctx.db
        .query("blogPosts")
        .withSearchIndex("search_posts_title", (b) => {
          let q = b.search("title", args.q);
          if (args.category) q = q.eq("category", args.category);
          return q;
        })
        .collect();
      return { items: docs.map(toApi), continueCursor: null, isDone: true };
    }

    let q;
    if (args.category) {
      q = ctx.db.query("blogPosts")
        .withIndex("by_category_published", (b) => b.eq("category", args.category))
        .order("desc");
    } else {
      q = ctx.db.query("blogPosts").order("desc");
    }

    const result = await q.paginate(args.paginationOpts);
    return {
      items: result.page.map(toApi),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// ─── Mutations admin ────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    deployKey:   v.string(),
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
    requireDeployKey(args.deployKey);
    const slug = args.slug.trim();
    const dup  = await ctx.db
      .query("blogPosts")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (dup) throw new Error(`Ya existe un post con el slug '${slug}'`);

    const body            = args.body ?? "";
    const readingMinutes  = computeReadingMinutes(body);
    const externalUrlNorm = (args.externalUrl ?? "").trim();

    if (externalUrlNorm && !isValidExternalUrl(externalUrlNorm)) {
      throw new Error("externalUrl no es una URL segura");
    }

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
    deployKey:   v.string(),
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
    requireDeployKey(args.deployKey);
    const { id, deployKey: _, ...rest } = args;
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

    if (rest.externalUrl && !isValidExternalUrl(rest.externalUrl)) {
      throw new Error("externalUrl no es una URL segura");
    }

    if (rest.title !== undefined && !rest.title) throw new Error("title no puede estar vacío");
    if (rest.slug !== undefined && !rest.slug) throw new Error("slug no puede estar vacío");
    if (rest.excerpt !== undefined && !rest.excerpt) throw new Error("excerpt no puede estar vacío");
    if (rest.islands !== undefined && rest.islands.length === 0) {
      throw new Error("islands no puede estar vacío");
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
  args: { deployKey: v.string(), id: v.id("blogPosts") },
  handler: async (ctx, { deployKey, id }) => {
    requireDeployKey(deployKey);
    await ctx.db.delete(id);
    return { deleted: id };
  },
});
