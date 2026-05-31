import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

function requireDeployKey(deployKey) {
  const expected = process.env.CONVEX_DEPLOY_KEY;
  if (!expected || deployKey !== expected) {
    throw new Error("No autorizado");
  }
}

export const getByUsername = query({
  args: { username: v.string(), deployKey: v.string() },
  handler: async (ctx, { username, deployKey }) => {
    requireDeployKey(deployKey);
    return await ctx.db
      .query("admins")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
  },
});

export const create = mutation({
  args: {
    username:     v.string(),
    passwordHash: v.string(),
    salt:         v.string(),
    deployKey:    v.string(),
  },
  handler: async (ctx, { username, passwordHash, salt, deployKey }) => {
    requireDeployKey(deployKey);
    const existing = await ctx.db
      .query("admins")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    if (existing) throw new Error(`El usuario '${username}' ya existe.`);

    return await ctx.db.insert("admins", {
      username,
      passwordHash,
      salt,
      createdAt: new Date().toISOString(),
    });
  },
});
