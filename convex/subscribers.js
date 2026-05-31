import { query, mutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireDeployKey(deployKey) {
  const expected = process.env.CONVEX_DEPLOY_KEY;
  if (!expected || deployKey !== expected) {
    throw new Error("No autorizado");
  }
}

export const subscribe = mutation({
  args: {
    email:     v.string(),
    deployKey: v.string(),
  },
  handler: async (ctx, { email, deployKey }) => {
    requireDeployKey(deployKey);

    const normalized = email.trim().toLowerCase();
    if (!normalized || !EMAIL_RE.test(normalized)) {
      throw new Error("Email inválido");
    }

    const existing = await ctx.db
      .query("subscribers")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();
    if (existing) {
      if (!existing.unsubscribedAt) return { status: "already" };
      await ctx.db.patch(existing._id, { unsubscribedAt: undefined });
      return { status: "created" };
    }
    await ctx.db.insert("subscribers", {
      email: normalized,
      createdAt: new Date().toISOString(),
    });
    return { status: "created" };
  },
});

export const listAdmin = query({
  args: {
    paginationOpts: paginationOptsValidator,
    deployKey:      v.string(),
  },
  handler: async (ctx, { paginationOpts, deployKey }) => {
    requireDeployKey(deployKey);
    const result = await ctx.db.query("subscribers").order("desc")
      .paginate(paginationOpts);
    return {
      items: result.page.map((doc) => ({
        _id:            doc._id,
        email:          doc.email,
        createdAt:      doc.createdAt,
        unsubscribedAt: doc.unsubscribedAt ?? null,
      })),
      continueCursor: result.continueCursor,
      isDone:         result.isDone,
    };
  },
});

export const generateToken = mutation({
  args: {
    email:     v.string(),
    deployKey: v.string(),
  },
  handler: async (ctx, { email, deployKey }) => {
    requireDeployKey(deployKey);
    const normalized = email.trim().toLowerCase();
    const sub = await ctx.db
      .query("subscribers")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();
    if (!sub || sub.unsubscribedAt) return null;

    const token = Array.from(
      { length: 32 },
      () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
    ).join("");

    await ctx.db.insert("unsubscribeTokens", {
      token,
      subscriberId: sub._id,
      createdAt: new Date().toISOString(),
    });
    return token;
  },
});

export const unsubscribeByToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const doc = await ctx.db
      .query("unsubscribeTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!doc) return { ok: false, reason: "Token no válido o ya utilizado." };

    const sub = await ctx.db.get(doc.subscriberId);
    if (sub && !sub.unsubscribedAt) {
      await ctx.db.patch(doc.subscriberId, {
        unsubscribedAt: new Date().toISOString(),
      });
    }
    await ctx.db.delete(doc._id);
    return { ok: true };
  },
});

export const listAll = query({
  args: {
    deployKey: v.string(),
  },
  handler: async (ctx, { deployKey }) => {
    requireDeployKey(deployKey);
    const docs = await ctx.db.query("subscribers").order("desc").collect();
    return docs.map((doc) => ({
      _id:            doc._id,
      email:          doc.email,
      createdAt:      doc.createdAt,
      unsubscribedAt: doc.unsubscribedAt ?? null,
    }));
  },
});
