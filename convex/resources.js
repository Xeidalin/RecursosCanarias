import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { syncFacets } from "./resourceFacets.js";

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

function toApi(doc) {
  return {
    id:          doc._id,
    slug:        doc.slug,
    title:       doc.title,
    kind:        doc.kind,
    isExternal:  doc.isExternal,
    sourceUrl:   doc.sourceUrl   ?? "",
    fileUrl:     doc.fileUrl     ?? "",
    islands:     doc.islands,
    topics:      doc.topics,
    levels:      doc.levels,
    description: doc.description,
    imageUrl:    doc.imageUrl,
    license:     doc.license,
    tags:        doc.tags,
    og:          doc.og          ?? null,
    views:       doc.views,
    downloads:   doc.downloads,
    createdAt:   doc.createdAt,
  };
}

const KIND_VALUES = v.union(
  v.literal("pdf"), v.literal("image"), v.literal("song"),
  v.literal("audio"), v.literal("video"), v.literal("presentation"),
  v.literal("activity")
);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const list = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("resources").collect();
    return docs
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .map(toApi);
  },
});

export const getById = query({
  args: { id: v.id("resources") },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    return doc ? toApi(doc) : null;
  },
});

// ---------------------------------------------------------------------------
// listFiltered — cursor-based, junction pipeline
// See docs/decisions/filtros.md for design rationale.
//
// Cursor: pair (creationTime, _id) encoded as base64url.
// Uses btoa/atob (Web API) — Convex runtime has no Node.js Buffer.
// ---------------------------------------------------------------------------

function encodeCursor(doc) {
  const json = JSON.stringify({ ct: doc._creationTime, id: doc._id });
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const padded  = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

// Returns Set<Id<table>> of resourceIds that match any of the given values for a facet.
// OR within the same facet.
async function idsForFacet(ctx, table, indexName, slugField, values) {
  const arrays = await Promise.all(
    values.map((val) =>
      ctx.db
        .query(table)
        .withIndex(indexName, (q) => q.eq(slugField, val))
        .collect()
        .then((rows) => rows.map((r) => r.resourceId))
    )
  );
  return new Set(arrays.flat());
}

export const listFiltered = query({
  args: {
    kind:    v.optional(KIND_VALUES),          // tightened: only valid literal values
    islands: v.optional(v.array(v.string())),
    topics:  v.optional(v.array(v.string())),
    levels:  v.optional(v.array(v.string())),
    q:       v.optional(v.string()),
    cursor:  v.optional(v.string()),
    limit:   v.optional(v.number()),
    hasFile: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit     = Math.min(args.limit ?? 24, 100);
    const hasSearch = Boolean(args.q?.trim());
    // Cursor is only valid when there is no text search (relevance order ≠ creationTime order).
    const parsed    = hasSearch ? null : decodeCursor(args.cursor ?? null);

    // Step 1: candidate IDs per facet (OR within facet)
    const facetSets = [];
    if (args.islands?.length) {
      facetSets.push(await idsForFacet(ctx, "resourceIslands", "by_island", "islandSlug", args.islands));
    }
    if (args.topics?.length) {
      facetSets.push(await idsForFacet(ctx, "resourceTopics", "by_topic", "topicSlug", args.topics));
    }
    if (args.levels?.length) {
      facetSets.push(await idsForFacet(ctx, "resourceLevels", "by_level", "levelSlug", args.levels));
    }

    // Step 2: AND intersection between facets
    let candidateIds = null;
    for (const set of facetSets) {
      candidateIds = candidateIds === null
        ? set
        : new Set([...candidateIds].filter((id) => set.has(id)));
    }

    // Step 3: optional text search
    if (args.q?.trim()) {
      const searchDocs = await ctx.db
        .query("resources")
        .withSearchIndex("search_resources_title", (b) => {
          let q = b.search("title", args.q);
          if (args.kind) q = q.eq("kind", args.kind);
          return q;
        })
        .collect();
      const searchIds = new Set(searchDocs.map((d) => d._id));
      candidateIds = candidateIds === null
        ? searchIds
        : new Set([...candidateIds].filter((id) => searchIds.has(id)));
    }

    // Step 4: load documents
    let docs;
    if (candidateIds !== null) {
      docs = (await Promise.all([...candidateIds].map((id) => ctx.db.get(id)))).filter(Boolean);
      if (args.kind && !args.q) {
        docs = docs.filter((d) => d.kind === args.kind);
      }
    } else {
      docs = await ctx.db.query("resources").order("desc").collect();
      if (args.kind) {
        docs = docs.filter((d) => d.kind === args.kind);
      }
    }

    // Step 4a2: optional hasFile filter (only resources with fileUrl)
    if (args.hasFile) {
      docs = docs.filter((d) => d.fileUrl && d.fileUrl.trim());
    }

    // Step 4b: sort by creationTime desc, tie-break _id asc.
    // When text search is active the array is already in relevance order — keep it.
    if (!hasSearch) {
      docs.sort((a, b) =>
        b._creationTime !== a._creationTime
          ? b._creationTime - a._creationTime
          : a._id < b._id ? -1 : 1
      );
    }

    // Total BEFORE cursor — for UI result counter
    const total = docs.length;

    // Step 5: apply cursor (only when not doing text search)
    if (parsed) {
      const idx = docs.findIndex(
        (d) =>
          d._creationTime < parsed.ct ||
          (d._creationTime === parsed.ct && d._id > parsed.id)
      );
      docs = idx === -1 ? [] : docs.slice(idx);
    }

    // Step 6: paginate.
    // Text-search results: no nextCursor — relevance order is incompatible with (ct, id) cursor.
    const page       = docs.slice(0, limit);
    const nextCursor = (!hasSearch && docs.length > limit)
      ? encodeCursor(page[page.length - 1])
      : null;

    return { items: page.map(toApi), nextCursor, total };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    slug:        v.string(),
    title:       v.string(),
    kind:        KIND_VALUES,
    isExternal:  v.boolean(),
    sourceUrl:   v.optional(v.string()),
    fileUrl:     v.optional(v.string()),
    islands:     v.array(v.string()),
    topics:      v.array(v.string()),
    levels:      v.array(v.string()),
    description: v.optional(v.string()),
    imageUrl:    v.optional(v.string()),
    license:     v.optional(v.string()),
    tags:        v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const slug = args.slug.trim();
    const duplicate = await ctx.db
      .query("resources")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (duplicate) throw new Error(`Ya existe un recurso con el slug '${slug}'`);

    const id = await ctx.db.insert("resources", {
      slug,
      title:       args.title.trim(),
      kind:        args.kind,
      isExternal:  args.isExternal,
      sourceUrl:   (args.sourceUrl  ?? "").trim(),
      fileUrl:     (args.fileUrl    ?? "").trim(),
      islands:     args.islands,
      topics:      args.topics,
      levels:      args.levels,
      description: (args.description ?? "").trim(),
      imageUrl:    (args.imageUrl    ?? "").trim(),
      license:     (args.license     ?? "Uso educativo").trim(),
      tags:        args.tags         ?? [],
      views:       0,
      downloads:   0,
      createdAt:   new Date().toISOString(),
    });
    await syncFacets(ctx, id, { islands: args.islands, topics: args.topics, levels: args.levels });
    const doc = await ctx.db.get(id);
    return toApi(doc);
  },
});

export const update = mutation({
  args: {
    id:          v.id("resources"),
    slug:        v.optional(v.string()),
    title:       v.optional(v.string()),
    kind:        v.optional(KIND_VALUES),
    isExternal:  v.optional(v.boolean()),
    sourceUrl:   v.optional(v.string()),
    fileUrl:     v.optional(v.string()),
    islands:     v.optional(v.array(v.string())),
    topics:      v.optional(v.array(v.string())),
    levels:      v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    imageUrl:    v.optional(v.string()),
    license:     v.optional(v.string()),
    tags:        v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    const current = await ctx.db.get(id);
    if (!current) throw new Error("Recurso no encontrado");

    // Slug uniqueness si cambia
    if (rest.slug !== undefined && rest.slug.trim() !== current.slug) {
      const newSlug = rest.slug.trim();
      const dup = await ctx.db
        .query("resources")
        .withIndex("by_slug", (q) => q.eq("slug", newSlug))
        .unique();
      if (dup && dup._id !== id) {
        throw new Error(`Ya existe un recurso con el slug '${newSlug}'`);
      }
      rest.slug = newSlug;
    }

    // Trim de strings opcionales
    for (const k of ["title", "sourceUrl", "fileUrl", "description", "imageUrl", "license"]) {
      if (typeof rest[k] === "string") rest[k] = rest[k].trim();
    }

    await ctx.db.patch(id, rest);

    // Re-sincroniza facets solo si alguna cambia. Si una faceta no se envió,
    // mantenemos la actual para no borrar junctions por accidente.
    if (rest.islands || rest.topics || rest.levels) {
      const next = await ctx.db.get(id);
      await syncFacets(ctx, id, {
        islands: next.islands,
        topics:  next.topics,
        levels:  next.levels,
      });
    }

    const doc = await ctx.db.get(id);
    return toApi(doc);
  },
});

export const remove = mutation({
  args: { id: v.id("resources") },
  handler: async (ctx, { id }) => {
    // Clean up junction rows before deleting the resource
    await syncFacets(ctx, id, { islands: [], topics: [], levels: [] });
    await ctx.db.delete(id);
    return { deleted: id };
  },
});

// Returns up to `limit` external resources whose og is missing or older than `olderThanMs`.
// Uses index by_external_created to scan only external resources (oldest first) instead of
// loading the full table. Paginates internally until enough stale candidates are found.
export const listStaleOg = query({
  args: {
    limit:       v.optional(v.number()),
    olderThanMs: v.optional(v.number()),
  },
  handler: async (ctx, { limit, olderThanMs }) => {
    const max    = Math.min(Math.max(1, limit ?? 50), 200);
    const cutoff = Date.now() - (olderThanMs ?? 30 * 24 * 60 * 60 * 1000);
    const stale  = [];
    let cursor   = null;

    while (stale.length < max) {
      const result = await ctx.db.query("resources")
        .withIndex("by_external_created", (q) => q.eq("isExternal", true))
        .order("asc")
        .paginate({ numItems: 100, cursor });

      for (const d of result.page) {
        if (!d.sourceUrl) continue;
        if (!d.og) { stale.push(d); continue; }
        const fetchedAt = Date.parse(d.og.fetchedAt || "");
        if (Number.isNaN(fetchedAt) || fetchedAt < cutoff) stale.push(d);
        if (stale.length >= max) break;
      }

      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    return stale.map((d) => ({ id: d._id, sourceUrl: d.sourceUrl }));
  },
});

export const setOg = mutation({
  args: {
    id: v.id("resources"),
    og: v.object({
      title:       v.string(),
      description: v.string(),
      image:       v.string(),
      favicon:     v.string(),
      domain:      v.string(),
      fetchedAt:   v.string(),
      failed:      v.boolean(),
    }),
  },
  handler: async (ctx, { id, og }) => {
    await ctx.db.patch(id, { og });
    return { updated: id };
  },
});

// ---------------------------------------------------------------------------
// Bulk seed — only runs if the table is empty
// ---------------------------------------------------------------------------

const SEED_ITEM = v.object({
  slug:        v.string(),
  title:       v.string(),
  kind:        KIND_VALUES,
  isExternal:  v.boolean(),
  sourceUrl:   v.optional(v.string()),
  fileUrl:     v.optional(v.string()),
  islands:     v.array(v.string()),
  topics:      v.array(v.string()),
  levels:      v.array(v.string()),
  description: v.optional(v.string()),
  imageUrl:    v.optional(v.string()),
  license:     v.optional(v.string()),
  tags:        v.optional(v.array(v.string())),
  views:       v.optional(v.number()),
  downloads:   v.optional(v.number()),
  createdAt:   v.optional(v.string()),
});

export const recordDownload = mutation({
  args: { id: v.id("resources") },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    if (!doc) throw new Error("Recurso no encontrado");
    await ctx.db.patch(id, { downloads: (doc.downloads || 0) + 1 });
    return { downloads: (doc.downloads || 0) + 1 };
  },
});

export const seedV2 = mutation({
  args: { items: v.array(SEED_ITEM) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("resources").collect();
    if (existing.length > 0) {
      return { inserted: 0, skipped: existing.length };
    }

    let inserted = 0;
    for (const item of args.items) {
      const id = await ctx.db.insert("resources", {
        slug:        item.slug,
        title:       item.title,
        kind:        item.kind,
        isExternal:  item.isExternal,
        sourceUrl:   item.sourceUrl  ?? "",
        fileUrl:     item.fileUrl    ?? "",
        islands:     item.islands,
        topics:      item.topics,
        levels:      item.levels,
        description: item.description ?? "",
        imageUrl:    item.imageUrl    ?? "",
        license:     item.license     ?? "Uso educativo",
        tags:        item.tags        ?? [],
        views:       item.views       ?? 0,
        downloads:   item.downloads   ?? 0,
        createdAt:   item.createdAt   ?? new Date().toISOString(),
      });
      await syncFacets(ctx, id, {
        islands: item.islands,
        topics:  item.topics,
        levels:  item.levels,
      });
      inserted++;
    }
    return { inserted, skipped: 0 };
  },
});
