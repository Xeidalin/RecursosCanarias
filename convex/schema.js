import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  resources: defineTable({
    title:       v.string(),
    slug:        v.string(),
    kind:        v.union(
      v.literal("pdf"), v.literal("image"), v.literal("song"),
      v.literal("audio"), v.literal("video"), v.literal("presentation"),
      v.literal("activity")
    ),
    isExternal:  v.boolean(),
    sourceUrl:   v.optional(v.string()),
    fileUrl:     v.optional(v.string()),
    islands:     v.array(v.string()),  // kept for display; junctions for filtering
    topics:      v.array(v.string()),
    levels:      v.array(v.string()),
    description: v.string(),
    imageUrl:    v.string(),
    license:     v.string(),
    tags:        v.array(v.string()),
    og: v.optional(v.object({
      title:       v.string(),
      description: v.string(),
      image:       v.string(),
      favicon:     v.string(),
      domain:      v.string(),
      fetchedAt:   v.string(),
      failed:      v.boolean(),
    })),
    views:     v.number(),
    downloads: v.number(),
    createdAt: v.string(),
  })
  .index("by_slug", ["slug"])
  .index("by_created", ["createdAt"])
  .index("by_external_created", ["isExternal", "createdAt"])
  .searchIndex("search_resources_title", {
    searchField:   "title",
    filterFields:  ["kind"],
  }),

  // Junction tables for multi-value faceted filtering (see docs/decisions/filtros.md)
  // ["todas"] in islands expands to one row per island slug via syncFacets
  resourceIslands: defineTable({
    resourceId: v.id("resources"),
    islandSlug: v.string(),
  })
  .index("by_island",   ["islandSlug"])
  .index("by_resource", ["resourceId"]),

  resourceTopics: defineTable({
    resourceId: v.id("resources"),
    topicSlug:  v.string(),
  })
  .index("by_topic",    ["topicSlug"])
  .index("by_resource", ["resourceId"]),

  resourceLevels: defineTable({
    resourceId: v.id("resources"),
    levelSlug:  v.string(),
  })
  .index("by_level",    ["levelSlug"])
  .index("by_resource", ["resourceId"]),

  // Opaque token for email unsubscribe (no email in URL)
  unsubscribeTokens: defineTable({
    token:        v.string(),
    subscriberId: v.id("subscribers"),
    createdAt:    v.string(),
  }).index("by_token", ["token"]),

  blogPosts: defineTable({
    title:    v.string(),
    slug:     v.string(),
    category: v.union(
      v.literal("articulo"),
      v.literal("recurso-destacado"),
      v.literal("novedad"),
      v.literal("noticia-consejeria")
    ),
    excerpt:        v.string(),
    body:           v.string(),
    coverImage:     v.string(),
    islands:        v.array(v.string()),
    readingMinutes: v.number(),
    externalUrl:    v.optional(v.string()),
    featured:       v.boolean(),
    publishedAt:    v.string(),
    views:          v.number(),
  })
  .index("by_published",          ["publishedAt"])
  .index("by_slug",               ["slug"])
  .index("by_category_published", ["category", "publishedAt"])
  .searchIndex("search_posts_title", {
    searchField:  "title",
    filterFields: ["category"],
  }),

  islandPages: defineTable({
    slug:    v.string(),
    name:    v.string(),
    intro:   v.string(),
    nature:  v.string(),
    culture: v.string(),
  }).index("by_slug", ["slug"]),

  subscribers: defineTable({
    email:           v.string(),
    createdAt:       v.string(),
    unsubscribedAt:  v.optional(v.string()),
  }).index("by_email", ["email"]),

  admins: defineTable({
    username:     v.string(),
    passwordHash: v.string(),
    salt:         v.string(),
    createdAt:    v.string(),
  }).index("by_username", ["username"]),

  pageViews: defineTable({
    path:  v.string(),
    day:   v.string(),
    count: v.number(),
  }).index("by_day_path", ["day", "path"]),

  contactMessages: defineTable({
    name:      v.string(),
    email:     v.string(),
    message:   v.string(),
    type:      v.string(),
    createdAt: v.string(),
    handled:   v.boolean(),
  }).index("by_handled_created", ["handled", "createdAt"]),
});
