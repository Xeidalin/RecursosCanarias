// Junction-table helpers for faceted filtering.
// See docs/decisions/filtros.md for the design rationale.

const ALL_ISLANDS = [
  "tenerife", "gran-canaria", "lanzarote", "fuerteventura",
  "la-palma", "la-gomera", "el-hierro",
];

// islands: ["todas"] → all 7 slugs; specific values pass through unchanged
function expandIslands(islands) {
  if (islands.includes("todas")) return ALL_ISLANDS;
  return islands;
}

/**
 * Keeps junction tables in sync with a resource's facet arrays.
 * Deletes all existing junction rows for the resource, then inserts fresh ones.
 * Safe to call on create, update, and delete (pass empty arrays before delete).
 *
 * @param {import("convex/server").MutationCtx} ctx
 * @param {import("convex/values").Id<"resources">} resourceId
 * @param {{ islands: string[], topics: string[], levels: string[] }} facets
 */
export async function syncFacets(ctx, resourceId, { islands, topics, levels }) {
  // Delete existing junctions in parallel
  await Promise.all([
    ctx.db.query("resourceIslands")
      .withIndex("by_resource", (q) => q.eq("resourceId", resourceId))
      .collect()
      .then((rows) => Promise.all(rows.map((r) => ctx.db.delete(r._id)))),
    ctx.db.query("resourceTopics")
      .withIndex("by_resource", (q) => q.eq("resourceId", resourceId))
      .collect()
      .then((rows) => Promise.all(rows.map((r) => ctx.db.delete(r._id)))),
    ctx.db.query("resourceLevels")
      .withIndex("by_resource", (q) => q.eq("resourceId", resourceId))
      .collect()
      .then((rows) => Promise.all(rows.map((r) => ctx.db.delete(r._id)))),
  ]);

  // Deduplicate before inserting to prevent duplicate junctions from duplicate input values
  const islandSlugs = [...new Set(expandIslands(islands))];
  const topicSlugs  = [...new Set(topics)];
  const levelSlugs  = [...new Set(levels)];

  await Promise.all([
    ...islandSlugs.map((islandSlug) =>
      ctx.db.insert("resourceIslands", { resourceId, islandSlug })
    ),
    ...topicSlugs.map((topicSlug) =>
      ctx.db.insert("resourceTopics", { resourceId, topicSlug })
    ),
    ...levelSlugs.map((levelSlug) =>
      ctx.db.insert("resourceLevels", { resourceId, levelSlug })
    ),
  ]);
}
