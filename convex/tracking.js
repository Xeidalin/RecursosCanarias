import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function requireDeployKey(deployKey) {
  const expected = process.env.CONVEX_DEPLOY_KEY;
  if (!expected || deployKey !== expected) {
    throw new Error("No autorizado");
  }
}

// POST /api/track llama a esta mutación
export const record = mutation({
  args: { path: v.string() },
  handler: async (ctx, { path }) => {
    const day = todayISO();
    const existing = await ctx.db
      .query("pageViews")
      .withIndex("by_day_path", (q) => q.eq("day", day).eq("path", path))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { count: existing.count + 1 });
    } else {
      await ctx.db.insert("pageViews", { path, day, count: 1 });
    }
  },
});

// GET /api/admin/stats — estadísticas para el dashboard
export const getStats = query({
  args: { deployKey: v.string() },
  handler: async (ctx, { deployKey }) => {
    requireDeployKey(deployKey);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const today = todayISO();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // Total resources
    const allResources = await ctx.db.query("resources").collect();

    // Total blog posts
    const allPosts = await ctx.db.query("blogPosts").collect();

    // External resources with OG enrichment
    const externalWithOg = allResources.filter((r) => r.isExternal && r.og?.failed === false).length;

    // Total subscribers (active)
    const subscribers = await ctx.db.query("subscribers").collect();
    const activeSubs = subscribers.filter((s) => !s.unsubscribedAt).length;

    // Unhandled contact messages
    const messages = await ctx.db.query("contactMessages").collect();
    const unhandled = messages.filter((m) => !m.handled).length;

    // Page views: only query last 30 days via index (avoids unbounded collect)
    const allViews = await ctx.db
      .query("pageViews")
      .withIndex("by_day_path", (q) => q.gte("day", thirtyDaysAgo))
      .collect();

    let viewsToday = 0, viewsYesterday = 0, views7d = 0, views30d = 0;
    const topPages = new Map();

    for (const v of allViews) {
      if (v.day === today) viewsToday += v.count;
      if (v.day === yesterday) viewsYesterday += v.count;
      if (v.day >= sevenDaysAgo) views7d += v.count;
      views30d += v.count;

      const curr = topPages.get(v.path) || 0;
      topPages.set(v.path, curr + v.count);
    }

    const top5 = [...topPages.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, count]) => ({ path, count }));

    return {
      resources: { total: allResources.length, externalWithOg },
      blogPosts: { total: allPosts.length },
      subscribers: { active: activeSubs, total: subscribers.length },
      contactMessages: { unhandled, total: messages.length },
      pageViews: { today: viewsToday, yesterday: viewsYesterday, last7d: views7d, last30d: views30d, top5 },
    };
  },
});
